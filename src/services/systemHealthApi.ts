import { withAccountQuery } from './accountContext'
import { authHeaders } from './auth'

export type SystemHealth = {
  ok: boolean
  schoolId?: string
  profile: 'test' | 'prod'
  prismaEnabled: boolean
  prismaConnected: boolean
  storageMode: 'database' | 'file-fallback'
  message: string
}

const source = (import.meta.env.VITE_BASIC_DATA_SOURCE ?? 'api').trim().toLowerCase()
const profile = (import.meta.env.VITE_API_PROFILE ?? 'test').trim().toLowerCase() || 'test'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

export class SystemHealthApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'SystemHealthApiError'
  }
}

function endpoint(path: string): string {
  return `${apiBaseUrl}${path}`
}

export function isApiSourceEnabled(): boolean {
  return source === 'api'
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const response = await fetch(withAccountQuery(endpoint(`/api/${profile}/system/health`)), {
    method: 'GET',
    headers: authHeaders()
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: unknown } | null
    throw new SystemHealthApiError(response.status, String(payload?.message || `HTTP ${response.status}`))
  }
  return (await response.json()) as SystemHealth
}
