import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { PrismaService } from './prisma.service.js'
import {
  effectivePermissions,
  normalizeRole,
  normalizeStringList,
  ROLE_PERMISSIONS,
  type AuthContext,
  type AuthRole,
  type AuthScope
} from './auth.types.js'

const DEFAULT_INITIAL_PASSWORD = '111111'
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCK_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

type LoginFailure = {
  ok: false
  reason: 'INVALID_CREDENTIALS' | 'USER_DISABLED' | 'UNAVAILABLE' | 'LOCKED'
  attemptsRemaining?: number
  remainingSeconds?: number
}

type LoginAttemptState = { count: number; lockedUntil: number | null }

export type UserRecord = {
  userId: string
  schoolId: string
  schoolName: string
  username: string
  phone?: string | null
  name: string
  role: AuthRole
  permissions: string[]
  scopes: AuthScope[]
  mustChangePassword: boolean
  isActive: boolean
  deletedAt?: Date | null
  createdAt?: Date
  lastLoginAt?: Date | null
}

type CreateUserInput = {
  name: string
  schoolName?: string
  phone?: string
  role: AuthRole
  permissions?: string[]
  campusIds?: string[]
  grades?: string[]
}

type UpdateUserInput = CreateUserInput & {
  currentUsername: string
  schoolId: string
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly loginAttempts = new Map<string, LoginAttemptState>()
  private readonly tokenSecret = process.env.AUTH_TOKEN_SECRET || 'schedule-system-local-development-secret'

  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeedAdmin()
    await this.migrateLegacySchoolAdminRoles()
    await this.migrateSchoolBoundChildUsernames()
  }

  async login(usernameRaw: string, passwordRaw: string) {
    const username = String(usernameRaw || '').trim()
    const password = String(passwordRaw || '')
    if (!username || !password) return { ok: false, reason: 'INVALID_CREDENTIALS' } as LoginFailure

    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.account?.upsert) return { ok: false, reason: 'UNAVAILABLE' } as LoginFailure

    const row = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { username },
          { phone: normalizePhone(username) || '__never_match__' }
        ]
      },
      include: { school: { select: { name: true, deletedAt: true } }, scopes: true }
    })

    const attemptKey = String(row?.username || username).trim().toLowerCase()
    const lockedFailure = this.readLockedAttempt(attemptKey)
    if (lockedFailure) return lockedFailure
    if (!row) return this.recordFailedAttempt(attemptKey)
    if (row.deletedAt || row.school.deletedAt || !row.isActive) return { ok: false, reason: 'USER_DISABLED' } as LoginFailure
    if (!verifyPassword(row.passwordHash, password)) return this.recordFailedAttempt(attemptKey)

    this.loginAttempts.delete(attemptKey)
    this.loginAttempts.delete(username.toLowerCase())
    await prisma.account.update({ where: { schoolId: row.schoolId }, data: { lastActiveAt: new Date() } })
    await prisma.user.update({
      where: { id: row.id },
      data: {
        lastLoginAt: new Date(),
        ...(!String(row.passwordHash).startsWith('scrypt$') ? { passwordHash: hashPassword(password) } : {})
      }
    })

    const user = this.toUserRecord(row, row.school.name)
    return { ok: true as const, token: this.issueSession(user), user }
  }

  async resolveSession(token: string): Promise<AuthContext | null> {
    const payload = this.verifyToken(token)
    if (!payload) return null
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return null
    const row = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { school: { select: { deletedAt: true } }, scopes: true }
    })
    if (!row || row.deletedAt || row.school.deletedAt || !row.isActive || row.schoolId !== payload.schoolId) return null
    const role = normalizeRole(row.role)
    return {
      userId: row.id,
      schoolId: row.schoolId,
      username: row.username,
      name: row.name,
      role,
      permissions: effectivePermissions(role, row.permissions),
      scopes: row.scopes.map((scope) => ({ campusId: scope.campusId, grade: scope.grade })),
      mustChangePassword: Boolean(row.mustChangePassword)
    }
  }

  async listUsers(actor: AuthContext, includeDeleted = false): Promise<UserRecord[]> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return []
    if (actor.role !== 'super_admin' && actor.role !== 'school_admin') return []

    const rows = await prisma.user.findMany({
      where: {
        ...(actor.role === 'super_admin'
          ? { role: 'school_admin' }
          : { schoolId: actor.schoolId, role: { in: ['grade_scheduler', 'viewer'] } }),
        ...(includeDeleted ? { deletedAt: { not: null } } : { deletedAt: null })
      },
      include: { school: { select: { name: true } }, scopes: true },
      orderBy: [{ createdAt: 'desc' }]
    })
    return rows
      .map((row) => this.toUserRecord(row, row.school.name))
      .sort((a, b) => {
        if (includeDeleted) return (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0)
        if (a.userId === actor.userId) return -1
        if (b.userId === actor.userId) return 1
        return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
      })
  }

  async createUser(actor: AuthContext, input: CreateUserInput) {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.account) return { ok: false as const, reason: 'UNAVAILABLE' as const }
    if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
      return { ok: false as const, reason: 'FORBIDDEN' as const }
    }

    const role = this.allowedCreatedRole(actor, input.role)
    if (!role) return { ok: false as const, reason: 'FORBIDDEN' as const }
    const normalizedPhone = normalizePhone(input.phone)
    if (normalizedPhone && !isValidPhone(normalizedPhone)) return { ok: false as const, reason: 'INVALID_PHONE' as const }
    if (normalizedPhone && (await prisma.user.findUnique({ where: { phone: normalizedPhone }, select: { id: true } }))) {
      return { ok: false as const, reason: 'PHONE_EXISTS' as const }
    }

    const createsSchool = actor.role === 'super_admin' && role === 'school_admin'
    const schoolId = createsSchool ? await this.generateSchoolId() : actor.schoolId
    const schoolName = String(input.schoolName || input.name || '').trim()
    if (createsSchool) {
      await prisma.account.create({ data: { schoolId, name: schoolName, lastActiveAt: new Date() } })
    }

    const scopes = normalizeScopes(input.campusIds, input.grades, role)
    const permissions = normalizePermissions(role, input.permissions)
    const username = createsSchool
      ? await this.generateSchoolAdminUsername(schoolId)
      : await this.generateChildUsername()
    try {
      const created = await prisma.user.create({
        data: {
          schoolId,
          username,
          phone: normalizedPhone,
          passwordHash: hashPassword(DEFAULT_INITIAL_PASSWORD),
          name: input.name,
          role,
          permissions: permissions as Prisma.InputJsonValue,
          mustChangePassword: true,
          createdByUserId: actor.userId,
          isActive: true,
          deletedAt: null,
          scopes: scopes.length ? { create: scopes } : undefined
        },
        include: { school: { select: { name: true } }, scopes: true }
      })
      return { ok: true as const, user: this.toUserRecord(created, created.school.name), initialPassword: DEFAULT_INITIAL_PASSWORD }
    } catch (error) {
      if (createsSchool) await prisma.account.delete({ where: { schoolId } }).catch(() => undefined)
      throw error
    }
  }

  async updateUserInfo(actor: AuthContext, input: UpdateUserInput) {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.account) return { ok: false as const, reason: 'UNAVAILABLE' as const }
    const existing = await prisma.user.findUnique({
      where: { username: input.currentUsername },
      include: { school: { select: { name: true } }, scopes: true }
    })
    if (!existing || existing.deletedAt) return { ok: false as const, reason: 'NOT_FOUND' as const }
    if (!this.canManage(actor, existing) || input.schoolId !== existing.schoolId) {
      return { ok: false as const, reason: input.schoolId !== existing.schoolId ? 'SCHOOL_ID_IMMUTABLE' as const : 'FORBIDDEN' as const }
    }

    const role = normalizeRole(input.role)
    if (actor.role === 'school_admin' && !['grade_scheduler', 'viewer'].includes(role)) {
      return { ok: false as const, reason: 'FORBIDDEN' as const }
    }
    if (existing.username === 'admin' && (role !== 'super_admin' || input.schoolId !== 'admin')) {
      return { ok: false as const, reason: 'FORBIDDEN' as const }
    }
    const phone = normalizePhone(input.phone)
    if (phone && !isValidPhone(phone)) return { ok: false as const, reason: 'INVALID_PHONE' as const }
    if (phone && phone !== existing.phone && (await prisma.user.findUnique({ where: { phone }, select: { id: true } }))) {
      return { ok: false as const, reason: 'PHONE_EXISTS' as const }
    }

    if (actor.role === 'super_admin' && role === 'school_admin' && input.schoolName?.trim()) {
      await prisma.account.update({ where: { schoolId: existing.schoolId }, data: { name: input.schoolName.trim() } })
    }
    const scopes = normalizeScopes(input.campusIds, input.grades, role)
    const permissions = normalizePermissions(role, input.permissions)
    const updated = await prisma.$transaction(async (tx) => {
      await tx.userScope.deleteMany({ where: { userId: existing.id } })
      return tx.user.update({
        where: { id: existing.id },
        data: {
          phone,
          name: input.name,
          role,
          permissions: permissions as Prisma.InputJsonValue,
          scopes: scopes.length ? { create: scopes } : undefined
        },
        include: { school: { select: { name: true } }, scopes: true }
      })
    })
    return { ok: true as const, user: this.toUserRecord(updated, updated.school.name) }
  }

  async setUserActive(actor: AuthContext, username: string, isActive: boolean) {
    const target = await this.findManageableUser(actor, username)
    if (!target) return { ok: false as const, reason: 'NOT_FOUND' as const }
    if (target.id === actor.userId) return { ok: false as const, reason: 'FORBIDDEN' as const }
    const prisma = await this.prismaService.getClient()
    await prisma!.user.update({ where: { id: target.id }, data: { isActive } })
    return { ok: true as const }
  }

  async resetPassword(actor: AuthContext, username: string, nextPassword: string) {
    if (String(nextPassword || '').trim().length < 6) return { ok: false as const, reason: 'INVALID_PASSWORD' as const }
    const target = await this.findManageableUser(actor, username)
    if (!target) return { ok: false as const, reason: 'NOT_FOUND' as const }
    const prisma = await this.prismaService.getClient()
    await prisma!.user.update({
      where: { id: target.id },
      data: { passwordHash: hashPassword(nextPassword), mustChangePassword: true }
    })
    return { ok: true as const }
  }

  async changeOwnPassword(actor: AuthContext, currentPassword: string, nextPassword: string) {
    if (String(nextPassword || '').length < 8) return { ok: false as const, reason: 'INVALID_PASSWORD' as const }
    if (currentPassword === nextPassword) return { ok: false as const, reason: 'SAME_PASSWORD' as const }
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return { ok: false as const, reason: 'UNAVAILABLE' as const }
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { passwordHash: true } })
    if (!user || !verifyPassword(user.passwordHash, currentPassword)) {
      return { ok: false as const, reason: 'INVALID_CURRENT_PASSWORD' as const }
    }
    await prisma.user.update({
      where: { id: actor.userId },
      data: { passwordHash: hashPassword(nextPassword), mustChangePassword: false }
    })
    return { ok: true as const }
  }

  async deleteUser(actor: AuthContext, username: string) {
    const target = await this.findManageableUser(actor, username)
    if (!target) return { ok: false as const, reason: 'NOT_FOUND' as const }
    if (target.id === actor.userId || target.username === 'admin') return { ok: false as const, reason: 'FORBIDDEN' as const }
    const prisma = await this.prismaService.getClient()
    const deletedAt = new Date()
    if (actor.role === 'super_admin' && normalizeRole(target.role) === 'school_admin') {
      await prisma!.$transaction([
        prisma!.account.update({ where: { schoolId: target.schoolId }, data: { deletedAt } }),
        prisma!.user.updateMany({ where: { schoolId: target.schoolId }, data: { deletedAt, isActive: false } })
      ])
    } else {
      await prisma!.user.update({ where: { id: target.id }, data: { deletedAt, isActive: false } })
    }
    return { ok: true as const }
  }

  async restoreUser(actor: AuthContext, username: string) {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return { ok: false as const, reason: 'UNAVAILABLE' as const }
    const target = await prisma.user.findUnique({ where: { username } })
    if (!target || !target.deletedAt || !this.canManage(actor, target)) return { ok: false as const, reason: 'NOT_FOUND' as const }
    if (actor.role === 'super_admin' && normalizeRole(target.role) === 'school_admin') {
      await prisma.$transaction([
        prisma.account.update({ where: { schoolId: target.schoolId }, data: { deletedAt: null } }),
        prisma.user.updateMany({ where: { schoolId: target.schoolId }, data: { deletedAt: null, isActive: true } })
      ])
    } else {
      await prisma.user.update({ where: { id: target.id }, data: { deletedAt: null, isActive: true } })
    }
    return { ok: true as const }
  }

  async purgeUser(actor: AuthContext, username: string) {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return { ok: false as const, reason: 'UNAVAILABLE' as const }
    const target = await prisma.user.findUnique({ where: { username } })
    if (!target || !target.deletedAt || !this.canManage(actor, target) || target.username === 'admin') {
      return { ok: false as const, reason: 'NOT_FOUND' as const }
    }
    if (actor.role === 'super_admin' && normalizeRole(target.role) === 'school_admin') {
      await prisma.$transaction([
        prisma.teachingAssignment.deleteMany({ where: { schoolId: target.schoolId } }),
        prisma.teacher.deleteMany({ where: { schoolId: target.schoolId } }),
        prisma.course.deleteMany({ where: { schoolId: target.schoolId } }),
        prisma.schoolClass.deleteMany({ where: { schoolId: target.schoolId } }),
        prisma.snapshot.deleteMany({ where: { schoolId: target.schoolId } }),
        prisma.userScope.deleteMany({ where: { user: { schoolId: target.schoolId } } }),
        prisma.user.deleteMany({ where: { schoolId: target.schoolId } }),
        prisma.account.delete({ where: { schoolId: target.schoolId } })
      ])
    } else {
      await prisma.user.delete({ where: { id: target.id } })
    }
    return { ok: true as const }
  }

  private toUserRecord(row: any, schoolName: string): UserRecord {
    const role = normalizeRole(row.role)
    return {
      userId: row.id,
      schoolId: row.schoolId,
      schoolName,
      username: row.username,
      phone: row.phone ?? null,
      name: row.name,
      role,
      permissions: effectivePermissions(role, row.permissions),
      scopes: Array.isArray(row.scopes)
        ? row.scopes.map((scope: any) => ({ campusId: scope.campusId, grade: scope.grade }))
        : [],
      mustChangePassword: Boolean(row.mustChangePassword),
      isActive: Boolean(row.isActive),
      deletedAt: row.deletedAt ?? null,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt ?? null
    }
  }

  private allowedCreatedRole(actor: AuthContext, requested: AuthRole): AuthRole | null {
    if (actor.role === 'super_admin') return requested === 'super_admin' ? 'super_admin' : 'school_admin'
    if (actor.role === 'school_admin' && ['grade_scheduler', 'viewer'].includes(requested)) return requested
    return null
  }

  private canManage(actor: AuthContext, target: { id: string; schoolId: string; role: string }): boolean {
    if (actor.role === 'super_admin') return normalizeRole(target.role) === 'school_admin'
    if (actor.role !== 'school_admin' || target.schoolId !== actor.schoolId) return false
    return ['grade_scheduler', 'viewer'].includes(normalizeRole(target.role))
  }

  private async findManageableUser(actor: AuthContext, username: string) {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return null
    const target = await prisma.user.findUnique({ where: { username } })
    return target && this.canManage(actor, target) ? target : null
  }

  private issueSession(user: UserRecord): string {
    const payload = Buffer.from(
      JSON.stringify({ userId: user.userId, schoolId: user.schoolId, exp: Date.now() + SESSION_TTL_MS })
    ).toString('base64url')
    const signature = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('base64url')
    return `${payload}.${signature}`
  }

  private verifyToken(token: string): { userId: string; schoolId: string } | null {
    const [payload, signature] = String(token || '').split('.')
    if (!payload || !signature) return null
    const expected = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('base64url')
    const actualBytes = Buffer.from(signature)
    const expectedBytes = Buffer.from(expected)
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
      if (Number(parsed.exp) <= Date.now()) return null
      const userId = String(parsed.userId || '').trim()
      const schoolId = String(parsed.schoolId || '').trim()
      return userId && schoolId ? { userId, schoolId } : null
    } catch {
      return null
    }
  }

  private readLockedAttempt(key: string): LoginFailure | null {
    const state = this.loginAttempts.get(key)
    if (!state?.lockedUntil) return null
    const remainingSeconds = Math.ceil((state.lockedUntil - Date.now()) / 1000)
    if (remainingSeconds <= 0) {
      this.loginAttempts.delete(key)
      return null
    }
    return { ok: false, reason: 'LOCKED', remainingSeconds }
  }

  private recordFailedAttempt(key: string): LoginFailure {
    const nextCount = (this.loginAttempts.get(key)?.count || 0) + 1
    if (nextCount >= MAX_LOGIN_ATTEMPTS) {
      this.loginAttempts.set(key, { count: nextCount, lockedUntil: Date.now() + LOGIN_LOCK_MS })
      return { ok: false, reason: 'LOCKED', remainingSeconds: Math.ceil(LOGIN_LOCK_MS / 1000) }
    }
    this.loginAttempts.set(key, { count: nextCount, lockedUntil: null })
    return { ok: false, reason: 'INVALID_CREDENTIALS', attemptsRemaining: MAX_LOGIN_ATTEMPTS - nextCount }
  }

  private async ensureSeedAdmin(): Promise<void> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.account) return
    await prisma.account.upsert({
      where: { schoolId: 'admin' },
      update: { name: '超级管理员', lastActiveAt: new Date() },
      create: { schoolId: 'admin', name: '超级管理员', lastActiveAt: new Date() }
    })
    await prisma.user.upsert({
      where: { username: 'admin' },
      update: {
        schoolId: 'admin', phone: null, name: '超级管理员', role: 'super_admin',
        permissions: ['*'], mustChangePassword: false, isActive: true, deletedAt: null
      },
      create: {
        schoolId: 'admin', username: 'admin', phone: null, passwordHash: hashPassword('Admin@123456'),
        name: '超级管理员', role: 'super_admin', permissions: ['*'], mustChangePassword: false,
        isActive: true, deletedAt: null
      }
    })
  }

  private async migrateSchoolBoundChildUsernames(): Promise<void> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return
    const childUsers = await prisma.user.findMany({
      where: { role: { in: ['grade_scheduler', 'viewer'] } },
      select: { id: true, schoolId: true, username: true }
    })
    for (const user of childUsers) {
      if (!isSchoolBoundChildUsername(user.username, user.schoolId)) continue
      const candidate = await this.generateChildUsername()
      await prisma.user.update({ where: { id: user.id }, data: { username: candidate } })
    }
  }

  private async migrateLegacySchoolAdminRoles(): Promise<void> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return
    await prisma.user.updateMany({ where: { role: 'admin' }, data: { role: 'school_admin' } })
  }

  private async generateSchoolAdminUsername(schoolId: string): Promise<string> {
    const prisma = await this.prismaService.getClient()
    const base = String(schoolId || 'user').replace(/[^a-zA-Z0-9._-]/g, '_')
    for (let suffix = 1; suffix < 10000; suffix += 1) {
      const candidate = suffix === 1 ? base : `${base}_${suffix}`
      if (!(await prisma?.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate
    }
    return `${base}_${Date.now().toString().slice(-6)}`
  }

  private async generateChildUsername(): Promise<string> {
    const prisma = await this.prismaService.getClient()
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = `tch${randomDigits(8)}`
      if (!(await prisma?.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate
    }
    return `tch${Date.now().toString().slice(-8)}`
  }

  private async generateSchoolId(): Promise<string> {
    const prisma = await this.prismaService.getClient()
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = `sch${randomDigits(9)}`
      if (!(await prisma?.account.findUnique({ where: { schoolId: candidate }, select: { id: true } }))) return candidate
    }
    return `sch${Date.now().toString().slice(-9)}`
  }
}

function isSchoolBoundChildUsername(username: string, schoolId: string): boolean {
  if (/^sch[a-zA-Z0-9]+_\d+$/i.test(String(username || ''))) return true
  const schoolToken = String(schoolId || '')
    .replace(/^sch/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12)
  if (!schoolToken) return false
  return new RegExp(`^tch${escapeRegExp(schoolToken)}\\d{2,4}$`, 'i').test(String(username || ''))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePermissions(role: AuthRole, raw: unknown): string[] {
  if (role === 'super_admin' || role === 'school_admin') return ['*']
  const custom = normalizeStringList(raw)
  if (!custom.length) return ROLE_PERMISSIONS[role]
  const allowed = new Set(ROLE_PERMISSIONS[role])
  const bounded = custom.filter((permission) => allowed.has(permission))
  return bounded.length ? bounded : ROLE_PERMISSIONS[role]
}

function normalizeScopes(campusIdsRaw: unknown, gradesRaw: unknown, role: AuthRole): AuthScope[] {
  if (role === 'super_admin' || role === 'school_admin') return []
  const campusIds = normalizeStringList(campusIdsRaw)
  const grades = normalizeStringList(gradesRaw)
  const campuses = campusIds.length ? campusIds : ['*']
  const gradeValues = grades.length ? grades : ['*']
  return campuses.flatMap((campusId) => gradeValues.map((grade) => ({ campusId, grade })))
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('base64url')
  const digest = crypto.scryptSync(password, salt, 64).toString('base64url')
  return `scrypt$${salt}$${digest}`
}

function verifyPassword(storedHash: string, password: string): boolean {
  const stored = String(storedHash || '')
  if (!stored.startsWith('scrypt$')) {
    const legacy = crypto.createHash('sha256').update(password).digest('hex')
    return safeEqual(stored, legacy)
  }
  const [, salt, expected] = stored.split('$')
  if (!salt || !expected) return false
  const actual = crypto.scryptSync(password, salt, 64).toString('base64url')
  return safeEqual(expected, actual)
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes)
}

function normalizePhone(value: string | undefined): string | null {
  const normalized = String(value || '').replace(/\s+/g, '').trim()
  return normalized || null
}

function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone)
}

function randomDigits(length: number): string {
  let value = ''
  while (value.length < length) value += crypto.randomInt(0, 10).toString()
  return value.slice(0, length)
}
