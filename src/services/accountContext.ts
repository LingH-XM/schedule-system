import { getCurrentAccountId } from './auth'

const DEFAULT_ACCOUNT_ID = 'default'

function sanitizeAccountId(raw: string): string {
  const value = String(raw || DEFAULT_ACCOUNT_ID).trim()
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || DEFAULT_ACCOUNT_ID
}

export function currentAccountId(): string {
  return sanitizeAccountId(getCurrentAccountId())
}

export function withAccountStorageKey(baseKey: string): string {
  return `${baseKey}:${currentAccountId()}`
}

export function withAccountQuery(path: string): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}accountId=${encodeURIComponent(currentAccountId())}`
}
