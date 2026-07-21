export type SolverLesson = {
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

export type SolveDemand = {
  assignmentKey: string
  sourceClassId?: string
  remaining: number
  targetClassIds: string[]
  lessonsByClass: Record<string, SolverLesson>
  teacherNames: string[]
  forbiddenSlotsByClass?: Record<string, string[]>
}

export type ConsecutiveConstraint = {
  classId: string
  courseIds: string[]
  weeklyConsecutiveCount: number
  preferredDays: string[]
}

export type CourseRelationConstraint = {
  classId: string
  courseAIds: string[]
  courseBIds: string[]
  relationType: '前后互斥' | '同天互斥'
}

export type SmartSolveRequest = {
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
    differentDayPeriod?: {
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
  consecutiveConstraints?: ConsecutiveConstraint[]
  courseRelationConstraints?: CourseRelationConstraint[]
  scheduleMap: Record<string, Record<string, SolverLesson | null>>
  demands: SolveDemand[]
}

export type SmartPlacement = {
  classId: string
  slotKey: string
  lesson: SolverLesson
}

export type SmartSolveResult = {
  placements: SmartPlacement[]
  placedCount: number
  remainingCount: number
}

export type SmartSolveLog = {
  phase: string
  message: string
  at: string
}

export type SmartSolveEnvelope = {
  engine: 'greedy-v1' | 'ortools-cpsat'
  fallback: boolean
  result: SmartSolveResult
  logs: SmartSolveLog[]
}
