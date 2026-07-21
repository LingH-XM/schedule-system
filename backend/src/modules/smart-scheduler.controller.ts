import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards
} from '@nestjs/common'
import { AuthGuard, requireAuth } from './auth.guard.js'
import { hasPermission, hasScope, type AuthenticatedRequest } from './auth.types.js'
import { PrismaService } from './prisma.service.js'
import { SmartSchedulerQueueService } from './smart-scheduler-queue.service.js'
import { normalizeProfile } from './types.js'
import type { SmartSolveRequest } from './smart-scheduler.types.js'

type DefaultRulePair = {
  enabled: boolean
  main: string
  secondary: string
}

@Controller()
@UseGuards(AuthGuard)
export class SmartSchedulerController {
  constructor(
    @Inject(SmartSchedulerQueueService) private readonly queue: SmartSchedulerQueueService,
    @Inject(PrismaService) private readonly prismaService: PrismaService
  ) {}

  @Post('/api/:profile/scheduler/solve-smart')
  @HttpCode(202)
  async solveSmart(
    @Req() httpRequest: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Body() body: unknown
  ) {
    const auth = requireAuth(httpRequest)
    if (!hasPermission(auth, 'schedule.solve')) throw new ForbiddenException('没有提交智能排课的权限')
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    const request = this.parseRequest(body)
    await this.assertClassScope(auth, profile, request.classIds)
    return {
      ok: true,
      job: this.queue.enqueue(auth.schoolId, auth.userId, profile, request)
    }
  }

  @Get('/api/:profile/scheduler/solve-smart/:jobId')
  getSmartJob(
    @Req() httpRequest: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Param('jobId') jobId: string
  ) {
    const auth = requireAuth(httpRequest)
    if (!hasPermission(auth, 'schedule.read')) throw new ForbiddenException('没有查看智能排课任务的权限')
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    const job = this.queue.getJob(auth.schoolId, auth.userId, profile, String(jobId || '').trim())
    if (!job) throw new NotFoundException('智能排课任务不存在或已过期')
    return { ok: true, job }
  }

  private async assertClassScope(auth: NonNullable<AuthenticatedRequest['auth']>, profile: 'test' | 'prod', classIds: string[]) {
    if (auth.role === 'super_admin' || auth.role === 'school_admin') return
    const prisma = await this.prismaService.getClient()
    if (!prisma?.schoolClass) return
    const classes = await prisma.schoolClass.findMany({
      where: { schoolId: auth.schoolId, profile, classId: { in: classIds } },
      select: { campusId: true, grade: true }
    })
    if (classes.length !== new Set(classIds).size) {
      throw new ForbiddenException('无法确认部分班级的授权范围')
    }
    if (classes.some((item) => !hasScope(auth, item.campusId, item.grade))) {
      throw new ForbiddenException('智能排课请求包含未授权的年级或校区')
    }
  }

  private parseDefaultRulePair(raw: unknown): DefaultRulePair {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    return {
      enabled: Boolean(obj.enabled),
      main: String(obj.main || ''),
      secondary: String(obj.secondary || '')
    }
  }

  private parseRequest(body: unknown): SmartSolveRequest {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }
    const raw = body as Record<string, unknown>
    if (typeof raw.selectedClassId !== 'string' || !raw.selectedClassId.trim()) {
      throw new BadRequestException('selectedClassId is required')
    }
    if (!Array.isArray(raw.classIds) || raw.classIds.length <= 0) {
      throw new BadRequestException('classIds must be a non-empty array')
    }
    if (!Array.isArray(raw.slotKeys) || raw.slotKeys.length <= 0) {
      throw new BadRequestException('slotKeys must be a non-empty array')
    }
    if (!raw.scheduleMap || typeof raw.scheduleMap !== 'object' || Array.isArray(raw.scheduleMap)) {
      throw new BadRequestException('scheduleMap must be an object')
    }
    if (!Array.isArray(raw.demands)) {
      throw new BadRequestException('demands must be an array')
    }

    const defaultRulesRaw =
      raw.defaultRules && typeof raw.defaultRules === 'object' && !Array.isArray(raw.defaultRules)
        ? (raw.defaultRules as Record<string, unknown>)
        : {}
    const noonBoundaryByClassRaw =
      raw.noonBoundaryByClass && typeof raw.noonBoundaryByClass === 'object' && !Array.isArray(raw.noonBoundaryByClass)
        ? (raw.noonBoundaryByClass as Record<string, unknown>)
        : {}
    const consecutiveConstraintsRaw = Array.isArray(raw.consecutiveConstraints) ? raw.consecutiveConstraints : []
    const courseRelationConstraintsRaw = Array.isArray(raw.courseRelationConstraints) ? raw.courseRelationConstraints : []
    const teacherRuleOptionsRaw =
      raw.teacherRuleOptions && typeof raw.teacherRuleOptions === 'object' && !Array.isArray(raw.teacherRuleOptions)
        ? (raw.teacherRuleOptions as Record<string, unknown>)
        : {}
    const ruleOptionsRaw =
      raw.ruleOptions && typeof raw.ruleOptions === 'object' && !Array.isArray(raw.ruleOptions)
        ? (raw.ruleOptions as Record<string, unknown>)
        : {}
    const boundedWeight = (value: unknown, fallback: number, max = 1000): number => {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) return fallback
      return Math.max(0, Math.min(max, Math.floor(numeric)))
    }
    const optionalBoolean = (value: unknown): boolean | undefined =>
      typeof value === 'boolean' ? value : undefined

    return {
      selectedClassId: String(raw.selectedClassId),
      classIds: raw.classIds.map((item) => String(item || '')).filter(Boolean),
      slotKeys: raw.slotKeys.map((item) => String(item || '')).filter(Boolean),
      fixedSlotKeys: Array.isArray(raw.fixedSlotKeys) ? raw.fixedSlotKeys.map((item) => String(item || '')).filter(Boolean) : [],
      defaultRules: {
        enabled: Boolean(defaultRulesRaw.enabled),
        mainCourseIds: Array.isArray(defaultRulesRaw.mainCourseIds)
          ? defaultRulesRaw.mainCourseIds.map((item) => String(item || '')).filter(Boolean)
          : [],
        secondaryCourseIds: Array.isArray(defaultRulesRaw.secondaryCourseIds)
          ? defaultRulesRaw.secondaryCourseIds.map((item) => String(item || '')).filter(Boolean)
          : [],
        syncStart: this.parseDefaultRulePair(defaultRulesRaw.syncStart),
        distribution: this.parseDefaultRulePair(defaultRulesRaw.distribution),
        differentDayPeriod: this.parseDefaultRulePair(defaultRulesRaw.differentDayPeriod),
        noCrossNoon: this.parseDefaultRulePair(defaultRulesRaw.noCrossNoon),
        sameClassNoConsecutive: this.parseDefaultRulePair(defaultRulesRaw.sameClassNoConsecutive),
        twoLessonsGap: this.parseDefaultRulePair(defaultRulesRaw.twoLessonsGap)
      },
      noonBoundaryByClass: Object.fromEntries(
        Object.entries(noonBoundaryByClassRaw)
          .map(([classId, value]) => {
            const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
            const morningEnd = Math.floor(Number(obj.morningEnd))
            const afternoonStart = Math.floor(Number(obj.afternoonStart))
            if (!classId || !Number.isFinite(morningEnd) || !Number.isFinite(afternoonStart)) return null
            if (morningEnd <= 0 || afternoonStart <= 0 || afternoonStart <= morningEnd) return null
            return [classId, { morningEnd, afternoonStart }] as const
          })
          .filter((item): item is readonly [string, { morningEnd: number; afternoonStart: number }] => Boolean(item))
      ),
      teacherHourConstraints: Array.isArray(raw.teacherHourConstraints)
        ? raw.teacherHourConstraints
            .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
              teacherName: String(item.teacherName || '').trim(),
              maxDailyLessons: Number.isFinite(Number(item.maxDailyLessons)) ? Math.floor(Number(item.maxDailyLessons)) : null,
              maxConsecutiveLessons: Number.isFinite(Number(item.maxConsecutiveLessons))
                ? Math.floor(Number(item.maxConsecutiveLessons))
                : null,
              weekDistribution: ['周分散', '周集中'].includes(String(item.weekDistribution || ''))
                ? (String(item.weekDistribution) as '周分散' | '周集中')
                : null,
              dayDistribution: ['日分散', '日集中'].includes(String(item.dayDistribution || ''))
                ? (String(item.dayDistribution) as '日分散' | '日集中')
                : null
            }))
            .filter((item) => item.teacherName)
        : [],
      teacherMutualConstraints: Array.isArray(raw.teacherMutualConstraints)
        ? raw.teacherMutualConstraints
            .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
              teacherGroupA: Array.isArray(item.teacherGroupA)
                ? Array.from(new Set(item.teacherGroupA.map((name) => String(name || '').trim()).filter(Boolean)))
                : [],
              teacherGroupB: Array.isArray(item.teacherGroupB)
                ? Array.from(new Set(item.teacherGroupB.map((name) => String(name || '').trim()).filter(Boolean)))
                : []
            }))
            .filter((item) => item.teacherGroupA.length > 0 && item.teacherGroupB.length > 0)
        : [],
      teacherRuleOptions: {
        enableTeacherMutual: optionalBoolean(teacherRuleOptionsRaw.enableTeacherMutual),
        weekDistributionWeight: boundedWeight(teacherRuleOptionsRaw.weekDistributionWeight, 45),
        dayDistributionWeight: boundedWeight(teacherRuleOptionsRaw.dayDistributionWeight, 25)
      },
      ruleOptions: {
        enableGlobalFixedPoint: optionalBoolean(ruleOptionsRaw.enableGlobalFixedPoint),
        enableCombineCourse: optionalBoolean(ruleOptionsRaw.enableCombineCourse),
        enableCourseArea: optionalBoolean(ruleOptionsRaw.enableCourseArea),
        enableCourseBan: optionalBoolean(ruleOptionsRaw.enableCourseBan),
        enableCourseDefault: optionalBoolean(ruleOptionsRaw.enableCourseDefault),
        enableMainSecondary: optionalBoolean(ruleOptionsRaw.enableMainSecondary),
        enableOddEven: optionalBoolean(ruleOptionsRaw.enableOddEven),
        enableCourseRelation: optionalBoolean(ruleOptionsRaw.enableCourseRelation),
        consecutivePreferredWeight: boundedWeight(ruleOptionsRaw.consecutivePreferredWeight, 30, 2000)
      },
      consecutiveConstraints: consecutiveConstraintsRaw
        .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          classId: String(item.classId || '').trim(),
          courseIds: Array.isArray(item.courseIds) ? item.courseIds.map((v) => String(v || '').trim()).filter(Boolean) : [],
          weeklyConsecutiveCount: Math.max(0, Math.min(5, Math.floor(Number(item.weeklyConsecutiveCount) || 0))),
          preferredDays: Array.isArray(item.preferredDays)
            ? Array.from(new Set(item.preferredDays.map((v) => String(v || '').trim()).filter(Boolean)))
            : []
        }))
        .filter((item) => item.classId && item.courseIds.length > 0 && item.weeklyConsecutiveCount > 0),
      courseRelationConstraints: courseRelationConstraintsRaw
        .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          classId: String(item.classId || '').trim(),
          courseAIds: Array.isArray(item.courseAIds)
            ? Array.from(new Set(item.courseAIds.map((value) => String(value || '').trim()).filter(Boolean)))
            : [],
          courseBIds: Array.isArray(item.courseBIds)
            ? Array.from(new Set(item.courseBIds.map((value) => String(value || '').trim()).filter(Boolean)))
            : [],
          relationType: String(item.relationType || '') as '前后互斥' | '同天互斥'
        }))
        .filter(
          (item) =>
            item.classId &&
            item.courseAIds.length > 0 &&
            item.courseBIds.length > 0 &&
            ['前后互斥', '同天互斥'].includes(item.relationType)
        ),
      scheduleMap: raw.scheduleMap as SmartSolveRequest['scheduleMap'],
      demands: raw.demands as SmartSolveRequest['demands']
    }
  }
}
