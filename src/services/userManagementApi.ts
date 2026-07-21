import { authHeaders } from './auth'
import type { AuthRole, AuthScope } from '../types/auth'

export type ManagedUser = {
  userId: string
  schoolId: string
  schoolName: string
  username: string
  phone?: string | null
  name: string
  role: AuthRole
  permissions: string[]
  scopes: AuthScope[]
  mustChangePassword: boolean
  isActive: boolean
  deletedAt?: string | null
  createdAt?: string
  lastLoginAt?: string | null
}

export type ManagedUserInput = {
  name: string
  schoolName?: string
  phone?: string
  role: AuthRole
  permissions?: string[]
  campusIds?: string[]
  grades?: string[]
}

type FailureReason =
  | 'NOT_FOUND'
  | 'PHONE_EXISTS'
  | 'INVALID_PHONE'
  | 'SCHOOL_ID_IMMUTABLE'
  | 'INVALID_PASSWORD'
  | 'UNAVAILABLE'
  | 'FORBIDDEN'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

export async function fetchManagedUsers(includeDeleted = false): Promise<ManagedUser[]> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users${includeDeleted ? '?includeDeleted=1' : ''}`, {
    method: 'GET',
    headers: authHeaders()
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = (await response.json()) as { ok: boolean; users?: ManagedUser[] }
  return Array.isArray(payload.users) ? payload.users : []
}

export async function createManagedUser(input: ManagedUserInput): Promise<{ ok: true; user?: ManagedUser; initialPassword?: string } | { ok: false; reason: FailureReason }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function updateManagedUser(input: ManagedUserInput & { currentUsername: string; schoolId: string }): Promise<{ ok: true; user?: ManagedUser } | { ok: false; reason: FailureReason }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(input.currentUsername)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function updateManagedUserStatus(username: string, isActive: boolean): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/status`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ isActive })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

export async function resetManagedUserPassword(username: string, password: string): Promise<{ ok: true } | { ok: false; reason: FailureReason }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/password`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function deleteManagedUser(username: string): Promise<{ ok: true } | { ok: false; reason: FailureReason }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}`, {
    method: 'DELETE', headers: authHeaders()
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function restoreManagedUser(username: string): Promise<{ ok: true } | { ok: false; reason: FailureReason }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/restore`, {
    method: 'POST', headers: authHeaders()
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function purgeManagedUser(username: string): Promise<{ ok: true } | { ok: false; reason: FailureReason }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/permanent`, {
    method: 'DELETE', headers: authHeaders()
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
