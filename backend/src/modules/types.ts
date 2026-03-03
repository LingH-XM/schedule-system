export type DataProfile = 'test' | 'prod'
export type DataResource = 'basic-data' | 'rule-settings' | 'schedule-plans' | 'workbench-state'

export function normalizeProfile(raw: unknown): DataProfile {
  const value = String(raw || '').trim().toLowerCase()
  return value === 'prod' || value === 'production' ? 'prod' : 'test'
}

export function sanitizePlanId(raw: unknown): string {
  const value = String(raw || 'default').trim()
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || 'default'
}
