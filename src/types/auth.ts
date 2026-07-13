export type AuthRole = 'super_admin' | 'admin'

export type AuthUser = {
  accountId: string
  accountName?: string
  username: string
  phone?: string | null
  name: string
  role: AuthRole
}

export type LoginPayload = {
  username: string
  password: string
  remember: boolean
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_CREDENTIALS' }
  | { ok: false; reason: 'LOCKED'; remainingSeconds: number }
  | { ok: false; reason: 'NETWORK' }
