export type AuthRole = 'super_admin' | 'school_admin' | 'grade_scheduler' | 'viewer'

export type AuthScope = {
  campusId: string
  grade: string
}

export type AuthContext = {
  userId: string
  schoolId: string
  username: string
  name: string
  role: AuthRole
  permissions: string[]
  scopes: AuthScope[]
  mustChangePassword: boolean
}

export type AuthenticatedRequest = {
  headers?: Record<string, string | string[] | undefined>
  url?: string
  auth?: AuthContext
}

export const ROLE_PERMISSIONS: Record<AuthRole, string[]> = {
  super_admin: ['*'],
  school_admin: ['*'],
  grade_scheduler: [
    'basic_data.read',
    'basic_data.grade_edit',
    'schedule.read',
    'schedule.edit',
    'schedule.solve',
    'schedule.submit',
    'timetable.read',
    'timetable.export'
  ],
  viewer: ['basic_data.read', 'schedule.read', 'timetable.read', 'timetable.export']
}

export function normalizeRole(raw: unknown): AuthRole {
  const value = String(raw || '').trim()
  if (value === 'super_admin') return 'super_admin'
  if (value === 'grade_scheduler') return 'grade_scheduler'
  if (value === 'viewer') return 'viewer'
  return 'school_admin'
}

export function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)))
}

export function effectivePermissions(role: AuthRole, raw: unknown): string[] {
  const custom = normalizeStringList(raw)
  return custom.length > 0 ? custom : ROLE_PERMISSIONS[role]
}

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.permissions.includes('*') || auth.permissions.includes(permission)
}

export function hasScope(auth: AuthContext, campusId: string, grade: string): boolean {
  if (auth.role === 'super_admin' || auth.role === 'school_admin') return true
  return auth.scopes.some(
    (scope) =>
      (scope.campusId === '*' || scope.campusId === campusId) &&
      (scope.grade === '*' || scope.grade === grade)
  )
}
