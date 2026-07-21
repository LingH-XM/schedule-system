import type { AuthRole, AuthUser, LoginPayload, LoginResult } from '../types/auth'

const TOKEN_KEY = 'schedule_auth_token'
const USER_KEY = 'schedule_auth_user'
const REMEMBERED_USERNAME_KEY = 'schedule_auth_remembered_username'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

type BackendLoginResult =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; reason: 'INVALID_CREDENTIALS'; attemptsRemaining?: number }
  | { ok: false; reason: 'LOCKED'; remainingSeconds: number }
  | { ok: false; reason: 'USER_DISABLED' | 'UNAVAILABLE' }

const roleRank: Record<AuthRole, number> = {
  viewer: 1,
  grade_scheduler: 2,
  school_admin: 3,
  super_admin: 4
}

function getStore(persistent: boolean): Storage {
  return persistent ? localStorage : sessionStorage
}

function readAuthFromStorage(key: string): string | null {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key)
}

export async function login(payload: LoginPayload): Promise<LoginResult> {
  const abortController = new AbortController()
  const timeout = window.setTimeout(() => abortController.abort(), 12000)
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        username: payload.username.trim(),
        password: payload.password
      })
    })

    if (!response.ok) {
      return { ok: false, reason: 'NETWORK' }
    }

    const result = (await response.json()) as BackendLoginResult
    if (!result.ok) {
      if (result.reason === 'LOCKED') return result
      if (result.reason === 'INVALID_CREDENTIALS') return result
      if (result.reason === 'USER_DISABLED') return result
      return { ok: false, reason: 'NETWORK' }
    }

    if (payload.remember) {
      localStorage.setItem(REMEMBERED_USERNAME_KEY, payload.username.trim())
    } else {
      localStorage.removeItem(REMEMBERED_USERNAME_KEY)
    }

    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)

    const store = getStore(payload.remember)
    store.setItem(TOKEN_KEY, result.token)
    store.setItem(USER_KEY, JSON.stringify(result.user))
    return { ok: true }
  } catch {
    return { ok: false, reason: 'NETWORK' }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
}

export function isAuthenticated(): boolean {
  return Boolean(readAuthFromStorage(TOKEN_KEY))
}

export function getCurrentUser(): AuthUser | null {
  const rawUser = readAuthFromStorage(USER_KEY)
  if (!rawUser) return null
  try {
    return JSON.parse(rawUser) as AuthUser
  } catch {
    return null
  }
}

export function hasRequiredRole(currentRole: AuthRole | undefined, requiredRole: AuthRole): boolean {
  if (!currentRole) return false
  return (roleRank[currentRole] ?? 0) >= (roleRank[requiredRole] ?? 0)
}

export function getCurrentSchoolId(): string {
  const user = getCurrentUser()
  return String(user?.schoolId || user?.username || 'default').trim() || 'default'
}

export function getAuthToken(): string {
  return readAuthFromStorage(TOKEN_KEY) ?? ''
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken()
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}

export function hasPermission(permission: string): boolean {
  const permissions = getCurrentUser()?.permissions ?? []
  return permissions.includes('*') || permissions.includes(permission)
}

export function canAccessScope(campusId: string, grade: string): boolean {
  const user = getCurrentUser()
  if (!user) return false
  if (user.role === 'super_admin' || user.role === 'school_admin') return true
  return (user.scopes ?? []).some(
    (scope) =>
      (scope.campusId === '*' || scope.campusId === campusId) &&
      (scope.grade === '*' || scope.grade === grade)
  )
}

export function getRememberedUsername(): string {
  return localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? ''
}

export async function changeOwnPassword(currentPassword: string, nextPassword: string): Promise<{
  ok: boolean
  reason?: 'INVALID_PASSWORD' | 'SAME_PASSWORD' | 'INVALID_CURRENT_PASSWORD' | 'UNAVAILABLE'
}> {
  const response = await fetch(`${apiBaseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ currentPassword, nextPassword })
  })
  if (!response.ok) return { ok: false, reason: 'UNAVAILABLE' }
  const result = await response.json()
  if (result.ok) {
    const user = getCurrentUser()
    if (user) {
      user.mustChangePassword = false
      const store = localStorage.getItem(USER_KEY) ? localStorage : sessionStorage
      store.setItem(USER_KEY, JSON.stringify(user))
      window.dispatchEvent(new Event('auth-session-updated'))
    }
  }
  return result
}
