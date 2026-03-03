import { BadRequestException, Body, Controller, Inject, Param, Post, ServiceUnavailableException } from '@nestjs/common'
import { normalizeProfile } from './types.js'
import { OrtoolsSolveError, SmartSchedulerService } from './smart-scheduler.service.js'
import type { SmartSolveRequest } from './smart-scheduler.types.js'

type DefaultRulePair = {
  enabled: boolean
  main: string
  secondary: string
}

@Controller()
export class SmartSchedulerController {
  constructor(@Inject(SmartSchedulerService) private readonly scheduler: SmartSchedulerService) {}

  @Post('/api/:profile/scheduler/solve-smart')
  async solveSmart(@Param('profile') profileParam: string, @Body() body: unknown) {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    normalizeProfile(profileParam)
    const request = this.parseRequest(body)
    let solved
    try {
      solved = await this.scheduler.solveSmart(request)
    } catch (error) {
      if (error instanceof OrtoolsSolveError) {
        throw new ServiceUnavailableException({
          code: error.code,
          message: `智能排课失败：${error.message}`,
          detail: error.detail
        })
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new ServiceUnavailableException({
        code: 'ORTOOLS_UNKNOWN',
        message: `智能排课失败：${reason}`,
        detail: ''
      })
    }
    return {
      ok: true,
      engine: solved.engine,
      fallback: solved.fallback,
      result: solved.result,
      logs: solved.logs
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
      scheduleMap: raw.scheduleMap as SmartSolveRequest['scheduleMap'],
      demands: raw.demands as SmartSolveRequest['demands']
    }
  }
}
