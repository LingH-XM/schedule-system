export type CoursePoolOddEvenRule = {
  campus: string
  grade: string
  classNames: string[]
  oddCourse: string
  evenCourse: string
}

export type CoursePoolBlock = {
  id: string
  assignmentKey: string
  courseIds: string[]
  teacherNames: string[]
  name: string
  teacher: string
  color: string
  remaining: number
  isOddEven?: boolean
  oddCourseId?: string
  evenCourseId?: string
  oddCourseName?: string
  evenCourseName?: string
}

export type BuildRequiredCourseBlocksParams = {
  campusName: string
  grade: string
  className: string
  arrangedValues: Record<string, number | null>
  oddEvenRules: CoursePoolOddEvenRule[]
  courses: Array<{ id: string; name: string }>
  teacherNameByCourseId: Map<string, string>
  courseNameById: Map<string, string>
  courseColorById: Map<string, string>
}

export type OddEvenCountIssue = {
  className: string
  oddCourseName: string
  evenCourseName: string
  oddCount: number
  evenCount: number
  message: string
}

function toNonNegativeInt(raw: unknown): number {
  return Math.max(0, Math.floor(Number(raw) || 0))
}

function buildCourseIdResolver(params: BuildRequiredCourseBlocksParams): (raw: string) => string {
  const courseIdByName = new Map(params.courses.map((item) => [item.name, item.id] as const))
  return (raw: string): string => {
    if (!raw) return ''
    if (params.courseNameById.has(raw)) return raw
    return courseIdByName.get(raw) || ''
  }
}

export function findOddEvenCountIssues(params: BuildRequiredCourseBlocksParams): OddEvenCountIssue[] {
  const resolveCourseIdByRuleValue = buildCourseIdResolver(params)
  return params.oddEvenRules
    .filter(
      (rule) =>
        rule.campus === params.campusName &&
        rule.grade === params.grade &&
        rule.classNames.includes(params.className)
    )
    .flatMap((rule) => {
      const oddCourseId = resolveCourseIdByRuleValue(rule.oddCourse)
      const evenCourseId = resolveCourseIdByRuleValue(rule.evenCourse)
      if (!oddCourseId || !evenCourseId || oddCourseId === evenCourseId) return []
      const oddCount = toNonNegativeInt(params.arrangedValues[oddCourseId])
      const evenCount = toNonNegativeInt(params.arrangedValues[evenCourseId])
      if (oddCount === evenCount || (oddCount === 0 && evenCount === 0)) return []
      const oddCourseName = params.courseNameById.get(oddCourseId) || rule.oddCourse
      const evenCourseName = params.courseNameById.get(evenCourseId) || rule.evenCourse
      return [
        {
          className: params.className,
          oddCourseName,
          evenCourseName,
          oddCount,
          evenCount,
          message: `${params.className}“${oddCourseName}/${evenCourseName}”单双周课时不一致（${oddCount}/${evenCount}）`
        }
      ]
    })
}

export function buildRequiredCourseBlocks(params: BuildRequiredCourseBlocksParams): CoursePoolBlock[] {
  const {
    campusName,
    grade,
    className,
    arrangedValues,
    oddEvenRules,
    teacherNameByCourseId,
    courseNameById,
    courseColorById
  } = params

  const resolveCourseIdByRuleValue = buildCourseIdResolver(params)

  const handledCourseIds = new Set<string>()
  const list: CoursePoolBlock[] = []

  oddEvenRules
    .filter((rule) => rule.campus === campusName && rule.grade === grade && rule.classNames.includes(className))
    .forEach((rule) => {
      const oddCourseId = resolveCourseIdByRuleValue(rule.oddCourse)
      const evenCourseId = resolveCourseIdByRuleValue(rule.evenCourse)
      if (!oddCourseId || !evenCourseId || oddCourseId === evenCourseId) return

      const oddCount = toNonNegativeInt(arrangedValues[oddCourseId])
      const evenCount = toNonNegativeInt(arrangedValues[evenCourseId])
      if (oddCount <= 0 || evenCount <= 0 || oddCount !== evenCount) return
      const mergedCount = oddCount

      const assignmentKey = `oe:${oddCourseId}|${evenCourseId}`
      const oddTeacherName = teacherNameByCourseId.get(oddCourseId) || '未设置教师'
      const evenTeacherName = teacherNameByCourseId.get(evenCourseId) || '未设置教师'
      const mergedName = `${courseNameById.get(oddCourseId) || rule.oddCourse}/${courseNameById.get(evenCourseId) || rule.evenCourse}`

      for (let i = 0; i < mergedCount; i += 1) {
        list.push({
          id: `${assignmentKey}-${i}`,
          assignmentKey,
          courseIds: [oddCourseId, evenCourseId],
          teacherNames: [oddTeacherName, evenTeacherName],
          name: mergedName,
          teacher: `${oddTeacherName} / ${evenTeacherName}`,
          color: courseColorById.get(oddCourseId) || '#5b8fd1',
          remaining: 0,
          isOddEven: true,
          oddCourseId,
          evenCourseId,
          oddCourseName: courseNameById.get(oddCourseId) || rule.oddCourse,
          evenCourseName: courseNameById.get(evenCourseId) || rule.evenCourse
        })
      }
      handledCourseIds.add(oddCourseId)
      handledCourseIds.add(evenCourseId)
    })

  Object.entries(arrangedValues).forEach(([courseId, value]) => {
    if (handledCourseIds.has(courseId)) return
    const weekly = toNonNegativeInt(value)
    if (weekly <= 0) return
    const courseName = courseNameById.get(courseId)
    if (!courseName) return
    const teacherName = teacherNameByCourseId.get(courseId) || '未设置教师'
    for (let i = 0; i < weekly; i += 1) {
      list.push({
        id: `${courseId}-${i}`,
        assignmentKey: courseId,
        courseIds: [courseId],
        teacherNames: [teacherName],
        name: courseName,
        teacher: teacherName,
        color: courseColorById.get(courseId) || '#5b8fd1',
        remaining: 0
      })
    }
  })

  return list
}

export function buildRemainingCoursePool(
  requiredBlocks: CoursePoolBlock[],
  placedByAssignmentKey: Map<string, number>
): CoursePoolBlock[] {
  const requiredCounter = new Map<string, CoursePoolBlock>()
  const requiredCount = new Map<string, number>()

  requiredBlocks.forEach((block) => {
    if (!requiredCounter.has(block.assignmentKey)) {
      requiredCounter.set(block.assignmentKey, { ...block, remaining: 0 })
    }
    requiredCount.set(block.assignmentKey, (requiredCount.get(block.assignmentKey) || 0) + 1)
  })

  const remaining: CoursePoolBlock[] = []
  requiredCount.forEach((count, assignmentKey) => {
    const block = requiredCounter.get(assignmentKey)
    if (!block) return
    const used = placedByAssignmentKey.get(assignmentKey) || 0
    remaining.push({
      ...block,
      id: `${assignmentKey}-left`,
      remaining: Math.max(0, count - used)
    })
  })
  return remaining
}
