export type AuthRole = 'super_admin' | 'school_admin' | 'grade_scheduler' | 'viewer'

export type AuthScope = {
  campusId: string
  grade: string
}

export type AuthUser = {
  userId: string
  schoolId: string
  schoolName?: string
  username: string
  phone?: string | null
  name: string
  role: AuthRole
  permissions: string[]
  scopes: AuthScope[]
  mustChangePassword?: boolean
}

export type LoginPayload = {
  username: string
  password: string
  remember: boolean
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_CREDENTIALS'; attemptsRemaining?: number }
  | { ok: false; reason: 'LOCKED'; remainingSeconds: number }
  | { ok: false; reason: 'USER_DISABLED' }
  | { ok: false; reason: 'NETWORK' }
