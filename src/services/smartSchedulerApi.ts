import { withAccountQuery } from './accountContext'

export type ApiSolverLesson = {
  assignmentKey: string
  courseId: string
  courseIds?: string[]
  teacherId: string
  name: string
  teacher: string
  teacherNames?: string[]
  color: string
  isCombined?: boolean
  isOddEven?: boolean
  oddCourseId?: string
  evenCourseId?: string
  oddCourseName?: string
  evenCourseName?: string
  locked?: boolean
}

export type ApiSolveDemand = {
  assignmentKey: string
  sourceClassId?: string
  remaining: number
  targetClassIds: string[]
  lessonsByClass: Record<string, ApiSolverLesson>
  teacherNames: string[]
  forbiddenSlotsByClass?: Record<string, string[]>
}

export type ApiConsecutiveConstraint = {
  classId: string
  courseIds: string[]
  weeklyConsecutiveCount: number
  preferredDays: string[]
}

export type ApiCourseRelationConstraint = {
  classId: string
  courseAIds: string[]
  courseBIds: string[]
  relationType: '前后互斥' | '同天互斥'
}

export type ApiSmartSolveRequest = {
  selectedClassId: string
  classIds: string[]
  slotKeys: string[]
  fixedSlotKeys?: string[]
  defaultRules?: {
    enabled?: boolean
    mainCourseIds?: string[]
    secondaryCourseIds?: string[]
    syncStart?: {
      enabled: boolean
      main: string
      secondary: string
    }
    distribution?: {
      enabled: boolean
      main: string
      secondary: string
    }
    noCrossNoon?: {
      enabled: boolean
      main: string
      secondary: string
    }
    sameClassNoConsecutive?: {
      enabled: boolean
      main: string
      secondary: string
    }
    twoLessonsGap?: {
      enabled: boolean
      main: string
      secondary: string
    }
  }
  noonBoundaryByClass?: Record<string, { morningEnd: number; afternoonStart: number }>
  teacherHourConstraints?: Array<{
    teacherName: string
    maxDailyLessons: number | null
    maxConsecutiveLessons: number | null
    weekDistribution: '周分散' | '周集中' | null
    dayDistribution: '日分散' | '日集中' | null
  }>
  teacherMutualConstraints?: Array<{
    teacherGroupA: string[]
    teacherGroupB: string[]
  }>
  teacherRuleOptions?: {
    enableTeacherMutual?: boolean
    weekDistributionWeight?: number
    dayDistributionWeight?: number
  }
  ruleOptions?: {
    enableGlobalFixedPoint?: boolean
    enableCombineCourse?: boolean
    enableCourseArea?: boolean
    enableCourseBan?: boolean
    enableCourseDefault?: boolean
    enableMainSecondary?: boolean
    enableOddEven?: boolean
    enableCourseRelation?: boolean
    consecutivePreferredWeight?: number
  }
  consecutiveConstraints?: ApiConsecutiveConstraint[]
  courseRelationConstraints?: ApiCourseRelationConstraint[]
  scheduleMap: Record<string, Record<string, ApiSolverLesson | null>>
  demands: ApiSolveDemand[]
}

export type ApiSmartPlacement = {
  classId: string
  slotKey: string
  lesson: ApiSolverLesson
}

export type ApiSmartSolveResult = {
  placements: ApiSmartPlacement[]
  placedCount: number
  remainingCount: number
}

export type ApiSmartSolveLog = {
  phase: string
  message: string
  at: string
}

export type ApiSmartSolveEnvelope = {
  engine: string
  fallback: boolean
  result: ApiSmartSolveResult
  logs: ApiSmartSolveLog[]
}

export type ApiSmartQueueStatus = 'queued' | 'running' | 'completed' | 'failed'

export type ApiSmartQueueUpdate = {
  id: string
  status: ApiSmartQueueStatus
  position: number
  waitingAhead: number
  queueSize: number
  queuedAt: string
  startedAt: string | null
  completedAt: string | null
  estimatedStartAt: string | null
  estimatedFinishAt: string | null
  estimatedDurationMs: number
}

type ApiSmartQueueJob = ApiSmartQueueUpdate & {
  result?: ApiSmartSolveEnvelope
  error?: {
    code?: string
    message?: string
    detail?: string
  }
}

export class SmartSchedulerApiError extends Error {
  constructor(
    message: string,
    readonly code: string = 'UNKNOWN',
    readonly detail: string = ''
  ) {
    super(message)
    this.name = 'SmartSchedulerApiError'
  }
}

const profile = (import.meta.env.VITE_API_PROFILE ?? 'test').trim().toLowerCase() || 'test'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

function endpoint(path: string): string {
  return `${apiBaseUrl}${path}`
}

async function readApiError(response: Response): Promise<SmartSchedulerApiError> {
  let message = ''
  let code = 'HTTP_ERROR'
  let detail = ''
  try {
    const err = (await response.json()) as { message?: unknown; error?: unknown; code?: unknown; detail?: unknown }
    code = String(err?.code || code).trim() || code
    detail = String(err?.detail || '').trim()
    if (Array.isArray(err?.message)) {
      message = err.message.map((item) => String(item || '')).filter(Boolean).join('; ')
    } else if (err?.message && typeof err.message === 'object') {
      const nested = err.message as { message?: unknown; code?: unknown; detail?: unknown }
      code = String(nested.code || code).trim() || code
      detail = String(nested.detail || detail).trim()
      message = String(nested.message || err.error || '').trim()
    } else {
      message = String(err?.message || err?.error || '').trim()
    }
  } catch {
    // ignore malformed error payload
  }
  if (!message) message = `HTTP ${response.status}`
  return new SmartSchedulerApiError(message, code, detail)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function solveSmartByApi(
  payload: ApiSmartSolveRequest,
  onQueueUpdate?: (update: ApiSmartQueueUpdate) => void
): Promise<ApiSmartSolveEnvelope> {
  const response = await fetch(withAccountQuery(endpoint(`/api/${profile}/scheduler/solve-smart`)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!response.ok) {
    throw await readApiError(response)
  }

  const submitted = (await response.json()) as { ok?: boolean; job?: ApiSmartQueueJob }
  if (!submitted?.ok || !submitted.job?.id) {
    throw new SmartSchedulerApiError('智能排课任务提交失败：返回格式异常', 'INVALID_QUEUE_RESPONSE')
  }

  let job = submitted.job
  const deadline = Date.now() + 2 * 60 * 60 * 1000
  while (Date.now() < deadline) {
    onQueueUpdate?.(job)
    if (job.status === 'completed' && job.result?.result) {
      return {
        engine: String(job.result.engine || 'unknown'),
        fallback: Boolean(job.result.fallback),
        result: job.result.result,
        logs: Array.isArray(job.result.logs) ? job.result.logs : []
      }
    }
    if (job.status === 'failed') {
      throw new SmartSchedulerApiError(
        String(job.error?.message || '智能排课任务执行失败'),
        String(job.error?.code || 'ORTOOLS_UNKNOWN'),
        String(job.error?.detail || '')
      )
    }

    await sleep(1000)
    const statusResponse = await fetch(
      withAccountQuery(endpoint(`/api/${profile}/scheduler/solve-smart/${encodeURIComponent(job.id)}`)),
      { method: 'GET' }
    )
    if (!statusResponse.ok) throw await readApiError(statusResponse)
    const statusPayload = (await statusResponse.json()) as { ok?: boolean; job?: ApiSmartQueueJob }
    if (!statusPayload?.ok || !statusPayload.job?.id) {
      throw new SmartSchedulerApiError('智能排课任务状态异常', 'INVALID_QUEUE_RESPONSE')
    }
    job = statusPayload.job
  }

  throw new SmartSchedulerApiError('智能排课排队等待超时，请稍后重试。', 'QUEUE_WAIT_TIMEOUT')
}
