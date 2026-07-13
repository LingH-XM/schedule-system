import type { AuthRole, AuthUser, LoginPayload, LoginResult } from '../types/auth'

const TOKEN_KEY = 'schedule_auth_token'
const USER_KEY = 'schedule_auth_user'
const REMEMBERED_USERNAME_KEY = 'schedule_auth_remembered_username'
const FAILED_LOGIN_KEY = 'schedule_auth_failed_login'
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 10
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

type FailedLoginState = {
  count: number
  lockedUntil: number | null
}

type BackendLoginResult =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'USER_DISABLED' | 'UNAVAILABLE' }

const roleRank: Record<AuthRole, number> = {
  admin: 1,
  super_admin: 2
}

function getStore(persistent: boolean): Storage {
  return persistent ? localStorage : sessionStorage
}

function readAuthFromStorage(key: string): string | null {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key)
}

function readFailedState(): FailedLoginState {
  const raw = localStorage.getItem(FAILED_LOGIN_KEY)
  if (!raw) return { count: 0, lockedUntil: null }
  try {
    const parsed = JSON.parse(raw) as FailedLoginState
    return {
      count: Number.isFinite(parsed.count) ? parsed.count : 0,
      lockedUntil: parsed.lockedUntil ?? null
    }
  } catch {
    return { count: 0, lockedUntil: null }
  }
}

function saveFailedState(state: FailedLoginState): void {
  localStorage.setItem(FAILED_LOGIN_KEY, JSON.stringify(state))
}

function clearFailedState(): void {
  localStorage.removeItem(FAILED_LOGIN_KEY)
}

function getRemainingLockSeconds(lockedUntil: number): number {
  const diff = Math.ceil((lockedUntil - Date.now()) / 1000)
  return diff > 0 ? diff : 0
}

function checkLockedState(): number {
  const state = readFailedState()
  if (!state.lockedUntil) return 0
  const seconds = getRemainingLockSeconds(state.lockedUntil)
  if (seconds === 0) clearFailedState()
  return seconds
}

function recordFailedLogin(): LoginResult {
  const state = readFailedState()
  const nextCount = state.count + 1
  if (nextCount >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000
    saveFailedState({ count: nextCount, lockedUntil })
    return { ok: false, reason: 'LOCKED', remainingSeconds: getRemainingLockSeconds(lockedUntil) }
  }
  saveFailedState({ count: nextCount, lockedUntil: null })
  return { ok: false, reason: 'INVALID_CREDENTIALS' }
}

export async function login(payload: LoginPayload): Promise<LoginResult> {
  const remainingSeconds = checkLockedState()
  if (remainingSeconds > 0) {
    return { ok: false, reason: 'LOCKED', remainingSeconds }
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      if (result.reason === 'INVALID_CREDENTIALS') {
        return recordFailedLogin()
      }
      return { ok: false, reason: 'NETWORK' }
    }

    clearFailedState()

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

export function getCurrentAccountId(): string {
  const user = getCurrentUser()
  return String(user?.accountId || user?.username || 'default').trim() || 'default'
}

export function getRememberedUsername(): string {
  return localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? ''
}
