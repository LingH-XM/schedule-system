export type AuthUser = {
  name: string
  role: 'admin'
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
