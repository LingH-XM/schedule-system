export type EngineLesson = {
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

export type EngineCoursePoolBlock = {
  assignmentKey: string
  courseIds: string[]
  teacher: string
  teacherNames: string[]
}

export type EngineDragPayload =
  | { source: 'pool'; assignmentKey: string }
  | { source: 'grid'; classId: string; slotKey: string }

export type DropEvaluationContext = {
  payload: EngineDragPayload | null
  selectedClassId: string
  period: number
  day: string
  keyOf: (period: number, day: string) => string
  scheduleMap: Record<string, Record<string, EngineLesson | null>>
  globalFixedPointLabel: (period: number, day: string) => string | null
  getPoolBlock: (assignmentKey: string) => EngineCoursePoolBlock | null
  resolveDropTargetClassIds: (classId: string, block: EngineCoursePoolBlock) => string[]
  buildLessonForClassFromBlock: (classId: string, block: EngineCoursePoolBlock) => EngineLesson
  classLabelById: (classId: string) => string
  teacherBanMessageAtSlot: (lesson: EngineLesson, classId: string, slotKey: string) => string | null
  teacherConflictMessagesAtSlot: (teachers: string[], slotKey: string, excludedClassIds?: string[]) => string[]
  teacherMutualMessageAtSlot?: (teachers: string[], slotKey: string, excludedClassIds?: string[]) => string | null
  courseRuleMessageAtSlot?: (
    lesson: EngineLesson,
    classId: string,
    slotKey: string,
    movingFromSlotKey?: string
  ) => string | null
  sameClassDayAdjacencyMessageAtSlot?: (
    lesson: EngineLesson,
    classId: string,
    slotKey: string,
    movingFromSlotKey?: string
  ) => string | null
}

export type DropEvaluationResult = {
  allowed: boolean
  reason: string | null
}

function teacherListOfLesson(lesson: EngineLesson): string[] {
  if (Array.isArray(lesson.teacherNames) && lesson.teacherNames.length > 0) return lesson.teacherNames
  const raw = String(lesson.teacher || '').trim()
  if (!raw) return []
  return raw
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function evaluateDropTarget(ctx: DropEvaluationContext): DropEvaluationResult {
  const { payload, selectedClassId, period, day } = ctx
  if (!payload) return { allowed: false, reason: null }
  if (!selectedClassId) return { allowed: false, reason: '请先选择班级。' }

  const targetKey = ctx.keyOf(period, day)
  const fixedLabel = ctx.globalFixedPointLabel(period, day)
  if (fixedLabel) return { allowed: false, reason: `该节次已设置全局固定点「${fixedLabel}」，不能排课。` }

  const targetLesson = ctx.scheduleMap[selectedClassId]?.[targetKey] ?? null
  if (targetLesson?.locked) return { allowed: false, reason: '目标节次课程已锁定，不能覆盖。' }

  if (payload.source === 'pool') {
    const block = ctx.getPoolBlock(payload.assignmentKey)
    if (!block) return { allowed: false, reason: '未找到待排课程。' }
    const targetClassIds = ctx.resolveDropTargetClassIds(selectedClassId, block)
    const targetClassSet = new Set(targetClassIds)

    for (const classId of targetClassIds) {
      if (!ctx.scheduleMap[classId]) ctx.scheduleMap[classId] = {}
      const lessonAtClass = ctx.scheduleMap[classId]?.[targetKey] ?? null
      if (lessonAtClass?.locked) {
        return { allowed: false, reason: `班级「${ctx.classLabelById(classId)}」该节次已锁定，不能覆盖。` }
      }
      const nextLesson = ctx.buildLessonForClassFromBlock(classId, block)
      const adjacencyMessage = ctx.sameClassDayAdjacencyMessageAtSlot?.(nextLesson, classId, targetKey)
      if (adjacencyMessage) return { allowed: false, reason: adjacencyMessage }
      const courseRuleMessage = ctx.courseRuleMessageAtSlot?.(nextLesson, classId, targetKey)
      if (courseRuleMessage) return { allowed: false, reason: courseRuleMessage }
      const banMessage = ctx.teacherBanMessageAtSlot(nextLesson, classId, targetKey)
      if (banMessage) return { allowed: false, reason: `${banMessage}，不能排课。` }
      const conflictMessages = ctx.teacherConflictMessagesAtSlot(
        teacherListOfLesson(nextLesson),
        targetKey,
        Array.from(targetClassSet)
      )
      if (conflictMessages.length > 0) return { allowed: false, reason: `${conflictMessages[0]}，不能重复排课。` }
      const mutualMessage = ctx.teacherMutualMessageAtSlot?.(
        teacherListOfLesson(nextLesson),
        targetKey,
        Array.from(targetClassSet)
      )
      if (mutualMessage) return { allowed: false, reason: mutualMessage }
    }
    return { allowed: true, reason: null }
  }

  const sourceLesson = ctx.scheduleMap[payload.classId]?.[payload.slotKey] ?? null
  if (!sourceLesson) return { allowed: false, reason: '源课程不存在。' }
  if (sourceLesson.locked) return { allowed: false, reason: '源课程已锁定，不能拖动。' }
  const sourceAdjacencyMessage = ctx.sameClassDayAdjacencyMessageAtSlot?.(
    sourceLesson,
    payload.classId,
    targetKey,
    payload.slotKey
  )
  if (sourceAdjacencyMessage) return { allowed: false, reason: sourceAdjacencyMessage }

  const sourceCourseRuleMessage = ctx.courseRuleMessageAtSlot?.(
    sourceLesson,
    payload.classId,
    targetKey,
    payload.slotKey
  )
  if (sourceCourseRuleMessage) return { allowed: false, reason: sourceCourseRuleMessage }

  const sourceBanMessage = ctx.teacherBanMessageAtSlot(sourceLesson, payload.classId, targetKey)
  if (sourceBanMessage) return { allowed: false, reason: `${sourceBanMessage}，不能排课。` }

  const sourceConflictMessages = ctx.teacherConflictMessagesAtSlot(
    teacherListOfLesson(sourceLesson),
    targetKey,
    [payload.classId, selectedClassId]
  )
  if (sourceConflictMessages.length > 0) return { allowed: false, reason: `${sourceConflictMessages[0]}，不能重复排课。` }
  const sourceMutualMessage = ctx.teacherMutualMessageAtSlot?.(
    teacherListOfLesson(sourceLesson),
    targetKey,
    [payload.classId, selectedClassId]
  )
  if (sourceMutualMessage) return { allowed: false, reason: sourceMutualMessage }

  if (targetLesson) {
    const targetAdjacencyMessage = ctx.sameClassDayAdjacencyMessageAtSlot?.(
      targetLesson,
      selectedClassId,
      payload.slotKey,
      targetKey
    )
    if (targetAdjacencyMessage) return { allowed: false, reason: targetAdjacencyMessage }
    const targetCourseRuleMessage = ctx.courseRuleMessageAtSlot?.(
      targetLesson,
      selectedClassId,
      payload.slotKey,
      targetKey
    )
    if (targetCourseRuleMessage) return { allowed: false, reason: targetCourseRuleMessage }
    const targetBanMessage = ctx.teacherBanMessageAtSlot(targetLesson, selectedClassId, payload.slotKey)
    if (targetBanMessage) return { allowed: false, reason: `${targetBanMessage}，不能排课。` }
    const targetConflictMessages = ctx.teacherConflictMessagesAtSlot(
      teacherListOfLesson(targetLesson),
      payload.slotKey,
      [selectedClassId, payload.classId]
    )
    if (targetConflictMessages.length > 0) return { allowed: false, reason: `${targetConflictMessages[0]}，不能重复排课。` }
    const targetMutualMessage = ctx.teacherMutualMessageAtSlot?.(
      teacherListOfLesson(targetLesson),
      payload.slotKey,
      [selectedClassId, payload.classId]
    )
    if (targetMutualMessage) return { allowed: false, reason: targetMutualMessage }
  }

  return { allowed: true, reason: null }
}

export function applyDropTarget(ctx: DropEvaluationContext): DropEvaluationResult {
  const checked = evaluateDropTarget(ctx)
  if (!checked.allowed) return checked
  const { payload, selectedClassId, period, day } = ctx
  if (!payload || !selectedClassId) return { allowed: false, reason: '无可执行拖拽动作。' }

  const targetKey = ctx.keyOf(period, day)
  if (!ctx.scheduleMap[selectedClassId]) ctx.scheduleMap[selectedClassId] = {}
  if (payload.source === 'pool') {
    const block = ctx.getPoolBlock(payload.assignmentKey)
    if (!block) return { allowed: false, reason: '未找到待排课程。' }
    const targetClassIds = ctx.resolveDropTargetClassIds(selectedClassId, block)
    const isCombinedDrop = targetClassIds.length > 1
    for (const classId of targetClassIds) {
      if (!ctx.scheduleMap[classId]) ctx.scheduleMap[classId] = {}
      ctx.scheduleMap[classId][targetKey] = {
        ...ctx.buildLessonForClassFromBlock(classId, block),
        isCombined: isCombinedDrop
      }
    }
    return { allowed: true, reason: null }
  }

  const sourceLesson = ctx.scheduleMap[payload.classId]?.[payload.slotKey] ?? null
  if (!sourceLesson) return { allowed: false, reason: '源课程不存在。' }
  const targetLesson = ctx.scheduleMap[selectedClassId]?.[targetKey] ?? null
  ctx.scheduleMap[selectedClassId][targetKey] = sourceLesson
  ctx.scheduleMap[payload.classId][payload.slotKey] = targetLesson
  return { allowed: true, reason: null }
}

export function dropForbiddenLabelFromReason(reason: string | null): string {
  if (!reason) return ''
  if (reason.includes('全局固定点')) return '固定点'
  if (reason.includes('已锁定')) return '已锁定'
  if (reason.includes('同班同课程同日需连排')) return '教案齐头'
  if (reason.includes('课程区域')) return '课程区域'
  if (reason.includes('课程关系')) return '课程关系'
  if (reason.includes('教师互斥')) return '教师互斥'
  if (reason.includes('不排课')) return '教师禁排'
  if (reason.includes('重复排课') || reason.includes('教师「')) return '教师冲突'
  return '不可排'
}
