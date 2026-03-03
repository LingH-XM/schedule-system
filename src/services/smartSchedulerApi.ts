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
  locked?: boolean
}

export type ApiSolveDemand = {
  assignmentKey: string
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
    consecutivePreferredWeight?: number
  }
  consecutiveConstraints?: ApiConsecutiveConstraint[]
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

export async function solveSmartByApi(payload: ApiSmartSolveRequest): Promise<ApiSmartSolveEnvelope> {
  const response = await fetch(endpoint(`/api/${profile}/scheduler/solve-smart`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!response.ok) {
    let message = ''
    let code = 'HTTP_ERROR'
    let detail = ''
    try {
      const err = (await response.json()) as { message?: unknown; error?: unknown; code?: unknown; detail?: unknown }
      code = String(err?.code || code).trim() || code
      detail = String(err?.detail || '').trim()
      if (Array.isArray(err?.message)) {
        message = err.message.map((item) => String(item || '')).filter(Boolean).join('; ')
      } else {
        message = String(err?.message || err?.error || '').trim()
      }
    } catch {
      // ignore
    }
    if (!message) message = `HTTP ${response.status}`
    throw new SmartSchedulerApiError(message, code, detail)
  }
  const json = (await response.json()) as {
    ok?: boolean
    engine?: unknown
    fallback?: unknown
    result?: ApiSmartSolveResult
    logs?: ApiSmartSolveLog[]
  }
  if (!json?.ok || !json.result) {
    throw new Error('Invalid solver response')
  }
  return {
    engine: String(json.engine || 'unknown'),
    fallback: Boolean(json.fallback),
    result: json.result,
    logs: Array.isArray(json.logs) ? json.logs : []
  }
}
