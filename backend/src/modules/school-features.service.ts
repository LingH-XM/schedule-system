import { Injectable, Inject } from '@nestjs/common'
import { Prisma, type Account } from '@prisma/client'
import { PrismaService } from './prisma.service.js'

export const SCHOOL_FEATURE_CATALOG = [
  { key: 'sub_accounts', label: '子账户管理', description: '允许学校管理员创建并授权校内子账户。', defaultEnabled: true },
  { key: 'basic_data', label: '基础数据', description: '校区、班级、教师、课程和任课信息维护。', defaultEnabled: true },
  { key: 'rule_settings', label: '排课规则', description: '课程规则、教师规则和高级规则配置。', defaultEnabled: true },
  { key: 'smart_scheduler', label: '智能排课', description: '提交求解任务并查看排课过程。', defaultEnabled: true },
  { key: 'schedule_workbench', label: '手动排课', description: '在排课工作台中手动调整和锁定课程。', defaultEnabled: true },
  { key: 'teacher_hours', label: '教师课时统计', description: '统计教师任课课时并导出数据。', defaultEnabled: true },
  { key: 'timetable_management', label: '课表管理', description: '查看、发布、打印和导出课表。', defaultEnabled: true },
  { key: 'data_import_export', label: '导入与导出', description: '启用 Excel 模板、数据导入和批量导出。', defaultEnabled: true },
  { key: 'advanced_rules', label: '高级规则', description: '开放默认规则与权重等高级配置。', defaultEnabled: true }
] as const

export type SchoolFeatureFlags = Record<string, boolean>

@Injectable()
export class SchoolFeaturesService {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  getCatalog() {
    return SCHOOL_FEATURE_CATALOG
  }

  async listSchools() {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.account) return []
    const rows = await prisma.account.findMany({
      where: { deletedAt: null, schoolId: { not: 'admin' } },
      include: {
        users: {
          where: { role: 'school_admin', deletedAt: null },
          select: { username: true, name: true, isActive: true },
          take: 1,
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }]
    })
    return rows.map((row) => this.toRecord(row))
  }

  async getSchool(schoolId: string) {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.account) return null
    const row = await prisma.account.findFirst({
      where: { schoolId, deletedAt: null },
      include: {
        users: {
          where: { role: 'school_admin', deletedAt: null },
          select: { username: true, name: true, isActive: true },
          take: 1,
          orderBy: { createdAt: 'asc' }
        }
      }
    })
    return row ? this.toRecord(row) : null
  }

  async updateSchool(
    schoolId: string,
    input: { featureFlags?: unknown; featureSettings?: unknown; featureNotes?: unknown }
  ) {
    const prisma = await this.prismaService.getClient()
    if (!prisma?.account) return null
    const existing = await prisma.account.findFirst({ where: { schoolId, deletedAt: null }, select: { schoolId: true } })
    if (!existing) return null
    const featureFlags = normalizeFeatureFlags(input.featureFlags)
    const featureSettings = normalizeJsonObject(input.featureSettings)
    const featureNotes = String(input.featureNotes || '').trim().slice(0, 1000)
    const row = await prisma.account.update({
      where: { schoolId },
      data: {
        featureFlags: featureFlags as Prisma.InputJsonValue,
        featureSettings: featureSettings as Prisma.InputJsonValue,
        featureNotes
      },
      include: {
        users: {
          where: { role: 'school_admin', deletedAt: null },
          select: { username: true, name: true, isActive: true },
          take: 1,
          orderBy: { createdAt: 'asc' }
        }
      }
    })
    return this.toRecord(row)
  }

  private toRecord(row: Account & { users: Array<{ username: string; name: string; isActive: boolean }> }) {
    const flags = normalizeFeatureFlags(row.featureFlags)
    const effectiveFlags = Object.fromEntries(
      SCHOOL_FEATURE_CATALOG.map((feature) => [feature.key, flags[feature.key] ?? feature.defaultEnabled])
    )
    for (const [key, enabled] of Object.entries(flags)) effectiveFlags[key] = enabled
    return {
      schoolId: row.schoolId,
      schoolName: row.name,
      administrator: row.users[0] ?? null,
      featureFlags: effectiveFlags,
      featureSettings: normalizeJsonObject(row.featureSettings),
      featureNotes: row.featureNotes,
      updatedAt: row.updatedAt
    }
  }
}

function normalizeFeatureFlags(raw: unknown): SchoolFeatureFlags {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => [String(key).trim(), Boolean(value)] as const)
      .filter(([key]) => /^[a-z][a-z0-9_.-]{1,63}$/i.test(key))
  )
}

function normalizeJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}
