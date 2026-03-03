import { Injectable } from '@nestjs/common'
import type {
  SmartSolveRequest,
  SmartSolveResult,
  SolveDemand,
  SolverLesson,
  SmartPlacement,
  SmartSolveEnvelope,
  SmartSolveLog
} from './smart-scheduler.types.js'

type DemandUnit = {
  demandIndex: number
}

export type OrtoolsErrorCode =
  | 'ORTOOLS_UNAVAILABLE'
  | 'ORTOOLS_TIMEOUT'
  | 'ORTOOLS_BAD_REQUEST'
  | 'ORTOOLS_INFEASIBLE'
  | 'ORTOOLS_HTTP_ERROR'
  | 'ORTOOLS_INVALID_RESPONSE'
  | 'SYNC_START_DAY_COUNT_CONFLICT'
  | 'SYNC_START_EXISTING_CONFLICT'
  | 'SYNC_START_POSTCHECK_DAY_COUNT'
  | 'SYNC_START_POSTCHECK_CONSECUTIVE'
  | 'CONSECUTIVE_EXISTING_CONFLICT'

export class OrtoolsSolveError extends Error {
  constructor(
    readonly code: OrtoolsErrorCode,
    message: string,
    readonly detail: string = ''
  ) {
    super(message)
    this.name = 'OrtoolsSolveError'
  }
}

@Injectable()
export class SmartSchedulerService {
  async solveSmart(request: SmartSolveRequest): Promise<SmartSolveEnvelope> {
    const { result, logs } = await this.solveByOrtools(request)
    return {
      engine: 'ortools-cpsat',
      fallback: false,
      result,
      logs
    }
  }

  private async solveByOrtools(request: SmartSolveRequest): Promise<{ result: SmartSolveResult; logs: SmartSolveLog[] }> {
    const logs: SmartSolveLog[] = []
    const pushLog = (phase: string, message: string) => {
      logs.push({ phase, message, at: new Date().toISOString() })
    }
    const endpoint = String(process.env.ORTOOLS_SOLVER_URL || 'http://127.0.0.1:8790/solve-cpsat').trim()
    const timeoutMs = Math.max(1000, Number(process.env.ORTOOLS_SOLVER_TIMEOUT_MS || 15000))
    const timeoutSec = Math.ceil(timeoutMs / 1000)
    pushLog('准备', `收到排课任务：班级 ${request.classIds.length} 个，节次槽位 ${request.slotKeys.length} 个，课程需求 ${request.demands.length} 条。`)
    const totalNeed = request.demands.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.remaining) || 0)), 0)
    pushLog('建模', `开始构建 OR-Tools 模型：总待安排课时 ${totalNeed} 节。`)
    pushLog('求解', `系统开始自动计算排课结果（最多等待 ${timeoutSec} 秒）。`)
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), timeoutMs)
    const startedAt = Date.now()
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: abortController.signal
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OrtoolsSolveError(
          'ORTOOLS_TIMEOUT',
          `OR-Tools 求解超时（>${timeoutMs}ms）`,
          `endpoint=${endpoint}`
        )
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new OrtoolsSolveError(
        'ORTOOLS_UNAVAILABLE',
        '无法连接 OR-Tools 求解服务',
        `endpoint=${endpoint}; reason=${reason}`
      )
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      const failure = await this.readErrorDetail(response)
      const detail = failure.detail
      pushLog('失败', `本次自动排课未成功${detail ? `：${detail}` : '。'}`)
      if (response.status === 400) {
        throw new OrtoolsSolveError(
          'ORTOOLS_BAD_REQUEST',
          failure.message || '排课请求参数不合法',
          detail || `endpoint=${endpoint}; status=400`
        )
      }
      if (response.status === 422) {
        throw new OrtoolsSolveError(
          (failure.code as OrtoolsErrorCode) || 'ORTOOLS_INFEASIBLE',
          failure.message || '模型不可行或约束冲突',
          detail || `endpoint=${endpoint}; status=422`
        )
      }
      throw new OrtoolsSolveError(
        'ORTOOLS_HTTP_ERROR',
        failure.message || `OR-Tools 求解失败（HTTP ${response.status}）`,
        detail || `endpoint=${endpoint}; status=${response.status}`
      )
    }
    const payload = (await response.json()) as {
      ok?: boolean
      result?: SmartSolveResult
      logs?: unknown
      error?: unknown
      message?: unknown
    }
    if (!payload?.ok || !payload.result) {
      const detail = String(payload?.error || payload?.message || '').trim()
      pushLog('失败', `本次自动排课未成功：系统返回结果异常${detail ? `（${detail}）` : ''}。`)
      throw new OrtoolsSolveError(
        'ORTOOLS_INVALID_RESPONSE',
        'OR-Tools 返回结果格式异常',
        detail || `endpoint=${endpoint}`
      )
    }
    const externalLogs = this.normalizeExternalLogs(payload.logs)
    const elapsed = Date.now() - startedAt
    const elapsedSec = (elapsed / 1000).toFixed(elapsed >= 10000 ? 0 : 1)
    const placed = Number(payload.result.placedCount || 0)
    const remaining = Number(payload.result.remainingCount || 0)
    pushLog('完成', `自动排课完成：已安排 ${placed} 节，还剩 ${remaining} 节待安排，用时约 ${elapsedSec} 秒。`)
    return {
      result: payload.result,
      logs: [...logs, ...externalLogs]
    }
  }

  private async readErrorDetail(response: Response): Promise<{ code: string; message: string; detail: string }> {
    try {
      const payload = (await response.json()) as {
        code?: unknown
        detail?: unknown
        error?: unknown
        message?: unknown
      }
      const code = String(payload?.code || '').trim()
      const message = Array.isArray(payload?.message)
        ? payload.message.map((item) => String(item || '').trim()).filter(Boolean).join('; ')
        : String(payload?.message || payload?.error || '').trim()
      if (payload?.detail && typeof payload.detail === 'object' && !Array.isArray(payload.detail)) {
        const detailObj = payload.detail as { code?: unknown; message?: unknown }
        return {
          code: String(detailObj.code || code || '').trim(),
          message: String(detailObj.message || message || '').trim(),
          detail: JSON.stringify(payload.detail)
        }
      }
      if (Array.isArray(payload?.message)) {
        return { code, message, detail: message }
      }
      const text = String(payload?.detail || payload?.error || payload?.message || '').trim()
      return { code, message: message || text, detail: text }
    } catch {
      try {
        const text = (await response.text()).trim()
        return { code: '', message: text, detail: text }
      } catch {
        return { code: '', message: '', detail: '' }
      }
    }
  }

  private normalizeExternalLogs(raw: unknown): SmartSolveLog[] {
    if (!Array.isArray(raw)) return []
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        const phase = String(row.phase || row.stage || '').trim() || '求解'
        const message = String(row.message || row.detail || row.text || '').trim()
        if (!message) return null
        const at = String(row.at || row.timestamp || '').trim() || new Date().toISOString()
        return { phase, message, at }
      })
      .filter((item): item is SmartSolveLog => Boolean(item))
  }

  private solveByGreedy(request: SmartSolveRequest): SmartSolveResult {
    const fixedSet = new Set((request.fixedSlotKeys || []).filter(Boolean))
    const classIdSet = new Set((request.classIds || []).filter(Boolean))

    for (const classId of classIdSet) {
      if (!request.scheduleMap[classId]) request.scheduleMap[classId] = {}
      for (const slotKey of request.slotKeys) {
        if (!(slotKey in request.scheduleMap[classId])) {
          request.scheduleMap[classId][slotKey] = null
        }
      }
    }

    const units: DemandUnit[] = []
    request.demands.forEach((demand, index) => {
      const remaining = Math.max(0, Math.floor(Number(demand.remaining) || 0))
      for (let i = 0; i < remaining; i += 1) units.push({ demandIndex: index })
    })

    units.sort((a, b) => {
      const da = request.demands[a.demandIndex]
      const db = request.demands[b.demandIndex]
      const ta = Math.max(1, da.targetClassIds.length)
      const tb = Math.max(1, db.targetClassIds.length)
      if (tb !== ta) return tb - ta
      return db.assignmentKey.localeCompare(da.assignmentKey)
    })

    const placements: SmartPlacement[] = []

    for (const unit of units) {
      const demand = request.demands[unit.demandIndex]
      const slotKey = this.pickBestSlot(request, demand, fixedSet, classIdSet)
      if (!slotKey) continue
      const targetClassIds = this.normalizeTargetClassIds(demand, classIdSet)
      const isCombined = targetClassIds.length > 1
      for (const classId of targetClassIds) {
        const lesson = this.buildLessonForClass(demand, classId, isCombined)
        request.scheduleMap[classId][slotKey] = lesson
        placements.push({ classId, slotKey, lesson })
      }
    }

    const remainingCount = this.calcRemainingCount(request.demands, request.scheduleMap)

    return {
      placements,
      placedCount: placements.length,
      remainingCount
    }
  }

  private pickBestSlot(
    request: SmartSolveRequest,
    demand: SolveDemand,
    fixedSet: Set<string>,
    classIdSet: Set<string>
  ): string | null {
    const targetClassIds = this.normalizeTargetClassIds(demand, classIdSet)
    const excludedClassSet = new Set(targetClassIds)
    const demandTeacherNames = this.normalizeTeacherNames(demand.teacherNames)

    for (const slotKey of request.slotKeys) {
      if (fixedSet.has(slotKey)) continue
      if (!this.targetClassesEmptyAtSlot(request, targetClassIds, slotKey)) continue
      if (this.slotForbiddenForDemand(demand, targetClassIds, slotKey)) continue
      if (this.hasTeacherConflictAtSlot(request, demandTeacherNames, slotKey, excludedClassSet)) continue
      return slotKey
    }

    return null
  }

  private targetClassesEmptyAtSlot(request: SmartSolveRequest, classIds: string[], slotKey: string): boolean {
    return classIds.every((classId) => !request.scheduleMap[classId]?.[slotKey])
  }

  private slotForbiddenForDemand(demand: SolveDemand, classIds: string[], slotKey: string): boolean {
    const map = demand.forbiddenSlotsByClass || {}
    return classIds.some((classId) => {
      const list = map[classId] || []
      return list.includes(slotKey)
    })
  }

  private hasTeacherConflictAtSlot(
    request: SmartSolveRequest,
    demandTeachers: string[],
    slotKey: string,
    excludedClassSet: Set<string>
  ): boolean {
    if (demandTeachers.length <= 0) return false
    for (const [classId, grid] of Object.entries(request.scheduleMap)) {
      if (excludedClassSet.has(classId)) continue
      const lesson = grid?.[slotKey]
      if (!lesson) continue
      const teachers = this.lessonTeachers(lesson)
      if (teachers.some((name) => demandTeachers.includes(name))) return true
    }
    return false
  }

  private lessonTeachers(lesson: SolverLesson): string[] {
    const fromList = this.normalizeTeacherNames(lesson.teacherNames || [])
    if (fromList.length > 0) return fromList
    return this.normalizeTeacherNames(lesson.teacher)
  }

  private normalizeTeacherNames(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return Array.from(
        new Set(
          raw
            .map((item) => String(item || '').trim())
            .filter((item) => item && item !== '未设置教师')
        )
      )
    }
    const text = String(raw || '').trim()
    if (!text) return []
    return Array.from(
      new Set(
        text
          .split('/')
          .map((item) => item.trim())
          .filter((item) => item && item !== '未设置教师')
      )
    )
  }

  private normalizeTargetClassIds(demand: SolveDemand, classIdSet: Set<string>): string[] {
    const list = Array.from(new Set((demand.targetClassIds || []).filter((id) => classIdSet.has(id))))
    if (list.length > 0) return list
    const fallback = Object.keys(demand.lessonsByClass || {}).find((id) => classIdSet.has(id))
    return fallback ? [fallback] : []
  }

  private buildLessonForClass(demand: SolveDemand, classId: string, isCombined: boolean): SolverLesson {
    const source = demand.lessonsByClass[classId] || demand.lessonsByClass[Object.keys(demand.lessonsByClass)[0]]
    const lesson: SolverLesson = {
      assignmentKey: source?.assignmentKey || demand.assignmentKey,
      courseId: source?.courseId || '',
      courseIds: Array.isArray(source?.courseIds) ? [...source.courseIds] : undefined,
      teacherId: source?.teacherId || '',
      name: source?.name || '',
      teacher: source?.teacher || '',
      teacherNames: Array.isArray(source?.teacherNames) ? [...source.teacherNames] : undefined,
      color: source?.color || '#5b8fd1',
      isCombined,
      locked: false
    }
    return lesson
  }

  private calcRemainingCount(
    demands: SolveDemand[],
    scheduleMap: Record<string, Record<string, SolverLesson | null>>
  ): number {
    return demands.reduce((sum, demand) => {
      const classId = demand.targetClassIds[0] || Object.keys(demand.lessonsByClass || {})[0]
      if (!classId) return sum + Math.max(0, Math.floor(Number(demand.remaining) || 0))
      const need = Math.max(0, Math.floor(Number(demand.remaining) || 0))
      const placed = Object.values(scheduleMap[classId] || {}).filter(
        (lesson) => lesson?.assignmentKey === demand.assignmentKey
      ).length
      const still = Math.max(0, need - placed)
      return sum + still
    }, 0)
  }
}
