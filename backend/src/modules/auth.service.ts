import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import crypto from 'node:crypto'
import { PrismaService } from './prisma.service.js'

const DEFAULT_INITIAL_PASSWORD = '111111'

type LoginSuccess = {
  ok: true
  user: {
    accountId: string
    accountName: string
    username: string
    phone?: string | null
    name: string
    role: 'super_admin' | 'admin'
  }
}

type LoginFailure = {
  ok: false
  reason: 'INVALID_CREDENTIALS' | 'USER_DISABLED' | 'UNAVAILABLE'
}

type UserRecord = {
  accountId: string
  accountName: string
  username: string
  phone?: string | null
  name: string
  role: 'super_admin' | 'admin'
  isActive: boolean
  deletedAt?: Date | null
  createdAt?: Date
  lastLoginAt?: Date | null
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeedAdmin()
  }

  async login(usernameRaw: string, passwordRaw: string): Promise<LoginSuccess | LoginFailure> {
    const username = String(usernameRaw || '').trim()
    const password = String(passwordRaw || '')
    if (!username || !password) {
      return { ok: false, reason: 'INVALID_CREDENTIALS' }
    }

    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.account?.upsert) {
      return { ok: false, reason: 'UNAVAILABLE' }
    }

    const row = (await prisma.user.findFirst?.({
      where: {
        deletedAt: null,
        OR: [{ username }, { phone: normalizePhone(username) || '__never_match__' }]
      },
      select: {
        accountId: true,
        username: true,
        phone: true,
        passwordHash: true,
        name: true,
        role: true,
        isActive: true,
        deletedAt: true
      }
    })) as
      | {
          accountId: string
          username: string
          phone?: string | null
          passwordHash: string
          name: string
          role: string
          isActive: boolean
          deletedAt?: Date | null
        }
      | null
    const account = (await prisma.account.findUnique?.({
      where: { accountId: row?.accountId || '' },
      select: { name: true }
    })) as { name: string } | null

    if (!row) {
      return { ok: false, reason: 'INVALID_CREDENTIALS' }
    }

    if (row.deletedAt) {
      return { ok: false, reason: 'USER_DISABLED' }
    }

    if (!row.isActive) {
      return { ok: false, reason: 'USER_DISABLED' }
    }

    if (row.passwordHash !== hashPassword(password)) {
      return { ok: false, reason: 'INVALID_CREDENTIALS' }
    }

    await prisma.account.upsert({
      where: { accountId: row.accountId },
      update: { lastActiveAt: new Date() },
      create: { accountId: row.accountId, name: account?.name || row.name, lastActiveAt: new Date() }
    })

    await prisma.user.update({
      where: { username: row.username },
      data: { lastLoginAt: new Date() }
    })

    return {
      ok: true,
      user: {
        accountId: row.accountId,
        accountName: account?.name || row.name,
        username: row.username,
        phone: row.phone ?? null,
        name: row.name,
        role: row.role === 'super_admin' ? 'super_admin' : 'admin'
      }
    }
  }

  async listUsers(includeDeleted = false): Promise<UserRecord[]> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user?.findMany) return []
    const rows = (await prisma.user.findMany({
      where: includeDeleted ? { deletedAt: { not: null } } : { deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        accountId: true,
        username: true,
        phone: true,
        name: true,
        role: true,
        isActive: true,
        deletedAt: true,
        createdAt: true,
        lastLoginAt: true
      }
    })) as Array<{
      accountId: string
      username: string
      phone?: string | null
      name: string
      role: string
      isActive: boolean
      deletedAt?: Date | null
      createdAt?: Date
      lastLoginAt?: Date | null
    }>
    const accountNameById = new Map<string, string>()
    await Promise.all(
      Array.from(new Set(rows.map((item) => item.accountId))).map(async (accountId) => {
        const account = (await prisma.account?.findUnique?.({
          where: { accountId },
          select: { name: true }
        })) as { name: string } | null
        if (account?.name) {
          accountNameById.set(accountId, account.name)
        }
      })
    )
    return rows
      .map((item) => ({
        accountId: item.accountId,
        accountName: accountNameById.get(item.accountId) || item.name,
        username: item.username,
        phone: item.phone ?? null,
        name: item.name,
        role: (item.role === 'super_admin' ? 'super_admin' : 'admin') as 'super_admin' | 'admin',
        isActive: Boolean(item.isActive),
        deletedAt: item.deletedAt ?? null,
        createdAt: item.createdAt,
        lastLoginAt: item.lastLoginAt ?? null
      }))
      .sort((a, b) => {
        if (includeDeleted) {
          return (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0)
        }
        const aIsAdmin = a.username === 'admin' ? 1 : 0
        const bIsAdmin = b.username === 'admin' ? 1 : 0
        if (aIsAdmin !== bIsAdmin) {
          return bIsAdmin - aIsAdmin
        }
        return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
      })
  }

  async createUser(input: {
    accountName: string
    phone?: string
    role?: 'super_admin' | 'admin'
  }): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: 'PHONE_EXISTS' | 'INVALID_PHONE' | 'UNAVAILABLE' }> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.user.create || !prisma.account?.create || !prisma.account?.delete) {
      return { ok: false, reason: 'UNAVAILABLE' }
    }

    const normalizedPhone = normalizePhone(input.phone)
    if (normalizedPhone && !isValidPhone(normalizedPhone)) {
      return { ok: false, reason: 'INVALID_PHONE' }
    }
    if (normalizedPhone) {
      const phoneExisting = (await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        select: { username: true }
      })) as { username: string } | null
      if (phoneExisting) {
        return { ok: false, reason: 'PHONE_EXISTS' }
      }
    }

    const accountId = await this.generateAccountId(input.role ?? 'admin')
    const username = await this.generateUsername(accountId)
    await prisma.account.create({
      data: { accountId, name: input.accountName, lastActiveAt: new Date() }
    })
    let created:
      | {
          accountId: string
          username: string
          phone?: string | null
          name: string
          role: string
          isActive: boolean
          createdAt?: Date
          lastLoginAt?: Date | null
        }
      | null = null
    try {
      created = (await prisma.user.create({
        data: {
          accountId,
          username,
          phone: normalizedPhone,
          passwordHash: hashPassword(DEFAULT_INITIAL_PASSWORD),
          name: input.accountName,
          role: input.role ?? 'admin',
          isActive: true,
          deletedAt: null
        },
        select: {
          accountId: true,
          username: true,
          phone: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true
        }
      })) as {
        accountId: string
        username: string
        phone?: string | null
        name: string
        role: string
        isActive: boolean
        createdAt?: Date
        lastLoginAt?: Date | null
      }
    } catch (error) {
      await prisma.account.delete({ where: { accountId } }).catch(() => undefined)
      throw error
    }

    return {
      ok: true,
      user: {
        accountId: created.accountId,
        accountName: input.accountName,
        username: created.username,
        phone: created.phone ?? null,
        name: created.name,
        role: created.role === 'super_admin' ? 'super_admin' : 'admin',
        isActive: Boolean(created.isActive),
        createdAt: created.createdAt,
        lastLoginAt: created.lastLoginAt ?? null
      }
    }
  }

  async updateUserInfo(input: {
    currentUsername: string
    accountId: string
    accountName: string
    phone?: string
    role: 'super_admin' | 'admin'
  }): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: 'NOT_FOUND' | 'PHONE_EXISTS' | 'INVALID_PHONE' | 'ACCOUNT_ID_IMMUTABLE' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.account?.update) {
      return { ok: false, reason: 'UNAVAILABLE' }
    }

    const existing = (await prisma.user.findUnique({
      where: { username: input.currentUsername },
      select: { username: true, accountId: true, role: true, phone: true, deletedAt: true }
    })) as { username: string; accountId: string; role: string; phone?: string | null; deletedAt?: Date | null } | null
    if (!existing) return { ok: false, reason: 'NOT_FOUND' }
    if (existing.deletedAt) return { ok: false, reason: 'NOT_FOUND' }
    if (input.accountId !== existing.accountId) {
      return { ok: false, reason: 'ACCOUNT_ID_IMMUTABLE' }
    }
    if (existing.username === 'admin' && (input.role !== 'super_admin' || input.accountId !== 'admin')) {
      return { ok: false, reason: 'FORBIDDEN' }
    }

    const normalizedPhone = normalizePhone(input.phone)
    if (normalizedPhone && !isValidPhone(normalizedPhone)) {
      return { ok: false, reason: 'INVALID_PHONE' }
    }
    if (normalizedPhone && normalizedPhone !== (existing.phone ?? null)) {
      const phoneUsed = (await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        select: { username: true }
      })) as { username: string } | null
      if (phoneUsed) return { ok: false, reason: 'PHONE_EXISTS' }
    }

    await prisma.account.update?.({
      where: { accountId: existing.accountId },
      data: {
        name: input.accountName
      }
    })

    const updated = (await prisma.user.update({
      where: { username: input.currentUsername },
      data: {
        accountId: input.accountId,
        phone: normalizedPhone,
        name: input.accountName,
        role: input.role
      },
      select: {
        accountId: true,
        username: true,
        phone: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true
      }
    })) as {
      accountId: string
      username: string
      phone?: string | null
      name: string
      role: string
      isActive: boolean
      createdAt?: Date
      lastLoginAt?: Date | null
    }

    return {
      ok: true,
      user: {
        accountId: updated.accountId,
        accountName: input.accountName,
        username: updated.username,
        phone: updated.phone ?? null,
        name: updated.name,
        role: updated.role === 'super_admin' ? 'super_admin' : 'admin',
        isActive: Boolean(updated.isActive),
        createdAt: updated.createdAt,
        lastLoginAt: updated.lastLoginAt ?? null
      }
    }
  }

  async setUserActive(username: string, isActive: boolean): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' }> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return { ok: false, reason: 'UNAVAILABLE' }
    const existing = (await prisma.user.findUnique({
      where: { username },
      select: { username: true, deletedAt: true }
    })) as { username: string; deletedAt?: Date | null } | null
    if (!existing) return { ok: false, reason: 'NOT_FOUND' }
    if (existing.deletedAt) return { ok: false, reason: 'NOT_FOUND' }
    await prisma.user.update({
      where: { username },
      data: { isActive }
    })
    return { ok: true }
  }

  async resetPassword(
    username: string,
    nextPassword: string
  ): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_PASSWORD' }> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user) return { ok: false, reason: 'UNAVAILABLE' }
    if (String(nextPassword || '').trim().length < 6) {
      return { ok: false, reason: 'INVALID_PASSWORD' }
    }
    const existing = (await prisma.user.findUnique({
      where: { username },
      select: { username: true, deletedAt: true }
    })) as { username: string; deletedAt?: Date | null } | null
    if (!existing) return { ok: false, reason: 'NOT_FOUND' }
    if (existing.deletedAt) return { ok: false, reason: 'NOT_FOUND' }
    await prisma.user.update({
      where: { username },
      data: { passwordHash: hashPassword(nextPassword) }
    })
    return { ok: true }
  }

  async deleteUser(username: string): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user?.update || !prisma.account?.update) {
      return { ok: false, reason: 'UNAVAILABLE' }
    }

    const existing = (await prisma.user.findUnique({
      where: { username },
      select: { username: true, accountId: true, deletedAt: true }
    })) as { username: string; accountId: string; deletedAt?: Date | null } | null
    if (!existing) return { ok: false, reason: 'NOT_FOUND' }
    if (existing.deletedAt) return { ok: false, reason: 'NOT_FOUND' }
    if (existing.username === 'admin' || existing.accountId === 'admin') {
      return { ok: false, reason: 'FORBIDDEN' }
    }

    const deletedAt = new Date()
    await prisma.account.update({
      where: { accountId: existing.accountId },
      data: { deletedAt }
    })
    await prisma.user.update({
      where: { username: existing.username },
      data: { deletedAt, isActive: false }
    })

    return { ok: true }
  }

  async restoreUser(username: string): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user?.update || !prisma.account?.update) {
      return { ok: false, reason: 'UNAVAILABLE' }
    }

    const existing = (await prisma.user.findUnique({
      where: { username },
      select: { username: true, accountId: true, deletedAt: true }
    })) as { username: string; accountId: string; deletedAt?: Date | null } | null
    if (!existing || !existing.deletedAt) return { ok: false, reason: 'NOT_FOUND' }
    if (existing.username === 'admin' || existing.accountId === 'admin') {
      return { ok: false, reason: 'FORBIDDEN' }
    }

    await prisma.account.update({
      where: { accountId: existing.accountId },
      data: { deletedAt: null }
    })
    await prisma.user.update({
      where: { username: existing.username },
      data: { deletedAt: null, isActive: true }
    })
    return { ok: true }
  }

  async purgeUser(username: string): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN' }> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user?.delete || !prisma.account?.delete || !prisma.snapshot.deleteMany) {
      return { ok: false, reason: 'UNAVAILABLE' }
    }

    const existing = (await prisma.user.findUnique({
      where: { username },
      select: { username: true, accountId: true, deletedAt: true }
    })) as { username: string; accountId: string; deletedAt?: Date | null } | null
    if (!existing || !existing.deletedAt) return { ok: false, reason: 'NOT_FOUND' }
    if (existing.username === 'admin' || existing.accountId === 'admin') {
      return { ok: false, reason: 'FORBIDDEN' }
    }

    await prisma.$transaction([
      prisma.teachingAssignment.deleteMany({ where: { accountId: existing.accountId } }),
      prisma.teacher.deleteMany({ where: { accountId: existing.accountId } }),
      prisma.course.deleteMany({ where: { accountId: existing.accountId } }),
      prisma.schoolClass.deleteMany({ where: { accountId: existing.accountId } }),
      prisma.snapshot.deleteMany({ where: { accountId: existing.accountId } }),
      prisma.user.delete({ where: { username: existing.username } }),
      prisma.account.delete({ where: { accountId: existing.accountId } })
    ])
    return { ok: true }
  }

  private async ensureSeedAdmin(): Promise<void> {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.user || !prisma.account?.upsert) return

    await prisma.account.upsert({
      where: { accountId: 'admin' },
      update: { name: '超级管理员', lastActiveAt: new Date() },
      create: { accountId: 'admin', name: '超级管理员', lastActiveAt: new Date() }
    })

    await prisma.user.upsert({
      where: { username: 'admin' },
      update: {
        accountId: 'admin',
        phone: null,
        name: '超级管理员',
        role: 'super_admin',
        isActive: true,
        deletedAt: null
      },
      create: {
        accountId: 'admin',
        username: 'admin',
        phone: null,
        passwordHash: hashPassword('Admin@123456'),
        name: '超级管理员',
        role: 'super_admin',
        isActive: true,
        deletedAt: null
      }
    })
  }

  private async generateUsername(accountId: string): Promise<string> {
    const prisma = await this.prismaService.getClient()
    const base = String(accountId || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_')
    if (!prisma?.user) {
      return base
    }
    let candidate = base
    let suffix = 1
    for (;;) {
      const exists = (await prisma.user.findUnique({
        where: { username: candidate },
        select: { username: true }
      })) as { username: string } | null
      if (!exists) {
        return candidate
      }
      suffix += 1
      candidate = `${base}_${suffix}`
    }
  }

  private async generateAccountId(role: 'super_admin' | 'admin'): Promise<string> {
    const prisma = await this.prismaService.getClient()
    const prefix = role === 'super_admin' ? 'sup' : 'sch'
    if (!prisma?.account?.findUnique) {
      return `${prefix}${randomDigits(9)}`
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = `${prefix}${randomDigits(9)}`
      const existing = (await prisma.account.findUnique({
        where: { accountId: candidate },
        select: { accountId: true }
      })) as { accountId: string } | null
      if (!existing) {
        return candidate
      }
    }
    return `${prefix}${Date.now().toString().slice(-9)}`
  }
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
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
  while (value.length < length) {
    value += crypto.randomInt(0, 10).toString()
  }
  return value.slice(0, length)
}
