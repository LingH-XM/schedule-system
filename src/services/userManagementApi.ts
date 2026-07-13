export type ManagedUser = {
  accountId: string
  accountName: string
  username: string
  phone?: string | null
  role: 'super_admin' | 'admin'
  isActive: boolean
  deletedAt?: string | null
  createdAt?: string
  lastLoginAt?: string | null
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

export async function fetchManagedUsers(includeDeleted = false): Promise<ManagedUser[]> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users${includeDeleted ? '?includeDeleted=1' : ''}`, { method: 'GET' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = (await response.json()) as { ok: boolean; users?: ManagedUser[] }
  return Array.isArray(payload.users) ? payload.users : []
}

export async function createManagedUser(input: {
  accountName: string
  phone?: string
  role: 'super_admin' | 'admin'
}): Promise<{ ok: true } | { ok: false; reason: 'PHONE_EXISTS' | 'INVALID_PHONE' | 'UNAVAILABLE' }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as { ok: true } | { ok: false; reason: 'PHONE_EXISTS' | 'INVALID_PHONE' | 'UNAVAILABLE' }
}

export async function updateManagedUser(input: {
  currentUsername: string
  accountId: string
  accountName: string
  phone?: string
  role: 'super_admin' | 'admin'
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'PHONE_EXISTS' | 'INVALID_PHONE' | 'ACCOUNT_ID_IMMUTABLE' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(input.currentUsername)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: input.accountId,
      accountName: input.accountName,
      phone: input.phone,
      role: input.role
    })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as
    | { ok: true }
    | { ok: false; reason: 'NOT_FOUND' | 'PHONE_EXISTS' | 'INVALID_PHONE' | 'ACCOUNT_ID_IMMUTABLE' | 'UNAVAILABLE' | 'FORBIDDEN' }
}

export async function updateManagedUserStatus(username: string, isActive: boolean): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

export async function resetManagedUserPassword(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_PASSWORD' }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_PASSWORD' }
}

export async function deleteManagedUser(
  username: string
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}`, {
    method: 'DELETE'
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }
}

export async function restoreManagedUser(
  username: string
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/restore`, {
    method: 'POST'
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }
}

export async function purgeManagedUser(
  username: string
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
  const response = await fetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(username)}/permanent`, {
    method: 'DELETE'
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }
}
