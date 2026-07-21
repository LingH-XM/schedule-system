import { getCurrentSchoolId, getCurrentUser } from './auth'

const DEFAULT_ACCOUNT_ID = 'default'

function sanitizeAccountId(raw: string): string {
  const value = String(raw || DEFAULT_ACCOUNT_ID).trim()
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || DEFAULT_ACCOUNT_ID
}

export function currentSchoolId(): string {
  return sanitizeAccountId(getCurrentSchoolId())
}

export function withAccountStorageKey(baseKey: string): string {
  const user = getCurrentUser()
  const schoolKey = currentSchoolId()
  if (!user || user.role === 'super_admin' || user.role === 'school_admin') return `${baseKey}:${schoolKey}`
  return `${baseKey}:${schoolKey}:${sanitizeAccountId(user.userId)}`
}

export function withSchoolQuery(path: string): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}schoolId=${encodeURIComponent(currentSchoolId())}`
}

/** @deprecated The server derives schoolId from the signed login token. */
export const withAccountQuery = withSchoolQuery
