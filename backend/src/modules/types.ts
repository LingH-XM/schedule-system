export type DataProfile = 'test' | 'prod'
export type DataResource = 'basic-data' | 'rule-settings' | 'schedule-plans' | 'workbench-state'
export const DEFAULT_SCHOOL_ID = 'default'

export function normalizeProfile(raw: unknown): DataProfile {
  const value = String(raw || '').trim().toLowerCase()
  return value === 'prod' || value === 'production' ? 'prod' : 'test'
}

export function sanitizePlanId(raw: unknown): string {
  const value = String(raw || 'default').trim()
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || 'default'
}

export function buildTermScopedPlanId(planIdRaw: unknown, termIdRaw: unknown): string {
  const planId = sanitizePlanId(planIdRaw)
  const termId = String(termIdRaw || '').trim()
  if (!termId) return planId
  const encodedTermId = Buffer.from(termId, 'utf8').toString('base64url')
  return sanitizePlanId(`${planId}.term.${encodedTermId}`)
}

export function sanitizeSchoolId(raw: unknown): string {
  const value = String(raw || DEFAULT_SCHOOL_ID).trim()
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || DEFAULT_SCHOOL_ID
}
