import { withAccountQuery } from './accountContext'

export type SystemHealth = {
  ok: boolean
  accountId?: string
  profile: 'test' | 'prod'
  prismaEnabled: boolean
  prismaConnected: boolean
  storageMode: 'database' | 'file-fallback'
  message: string
}

const source = (import.meta.env.VITE_BASIC_DATA_SOURCE ?? 'api').trim().toLowerCase()
const profile = (import.meta.env.VITE_API_PROFILE ?? 'test').trim().toLowerCase() || 'test'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

function endpoint(path: string): string {
  return `${apiBaseUrl}${path}`
}

export function isApiSourceEnabled(): boolean {
  return source === 'api'
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const response = await fetch(withAccountQuery(endpoint(`/api/${profile}/system/health`)), { method: 'GET' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as SystemHealth
}
