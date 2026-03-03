import type { EngineLesson } from './workbenchEngine'

export type ArrangementScopeLike = {
  rows: Array<{ values: Record<string, number | null> }>
}

export type ValidationReport = {
  totalRequired: number
  totalPlaced: number
  totalRemaining: number
  conflictCount: number
}

function toNonNegativeInt(raw: unknown): number {
  return Math.max(0, Math.floor(Number(raw) || 0))
}

function normalizeTeacherNames(raw: string[] | string | undefined | null): string[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)))
  }
  const text = String(raw || '').trim()
  if (!text) return []
  return text
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function calcTotalRequiredLessons(arrangementScopes: Record<string, ArrangementScopeLike>): number {
  let totalRequired = 0
  Object.values(arrangementScopes).forEach((scope) => {
    scope.rows.forEach((row) => {
      Object.values(row.values).forEach((value) => {
        totalRequired += toNonNegativeInt(value)
      })
    })
  })
  return totalRequired
}

export function calcTotalPlacedLessons(
  scheduleMap: Record<string, Record<string, EngineLesson | null>>,
  classIds: string[]
): number {
  let totalPlaced = 0
  classIds.forEach((classId) => {
    const grid = scheduleMap[classId] || {}
    Object.values(grid).forEach((lesson) => {
      if (lesson) totalPlaced += 1
    })
  })
  return totalPlaced
}

export function calcTeacherConflictCount(scheduleMap: Record<string, Record<string, EngineLesson | null>>): number {
  const teacherSlotCounter = new Map<string, number>()
  Object.values(scheduleMap).forEach((grid) => {
    Object.entries(grid || {}).forEach(([slotKey, lesson]) => {
      if (!lesson) return
      const teachers = normalizeTeacherNames(lesson.teacherNames?.length ? lesson.teacherNames : lesson.teacher)
      teachers.forEach((teacher) => {
        const key = `${slotKey}::${teacher}`
        teacherSlotCounter.set(key, (teacherSlotCounter.get(key) || 0) + 1)
      })
    })
  })
  let conflictCount = 0
  teacherSlotCounter.forEach((count) => {
    if (count > 1) conflictCount += 1
  })
  return conflictCount
}

export function buildValidationReport(params: {
  arrangementScopes: Record<string, ArrangementScopeLike>
  scheduleMap: Record<string, Record<string, EngineLesson | null>>
  classIds: string[]
}): ValidationReport {
  const totalRequired = calcTotalRequiredLessons(params.arrangementScopes)
  const totalPlaced = calcTotalPlacedLessons(params.scheduleMap, params.classIds)
  return {
    totalRequired,
    totalPlaced,
    totalRemaining: Math.max(0, totalRequired - totalPlaced),
    conflictCount: calcTeacherConflictCount(params.scheduleMap)
  }
}

export function calcSchedulingProgress(totalRequired: number, totalPlaced: number): number {
  if (totalRequired <= 0) return 0
  const totalRemaining = Math.max(0, totalRequired - totalPlaced)
  const done = Math.max(0, totalRequired - totalRemaining)
  return Math.max(0, Math.min(100, Math.round((done / totalRequired) * 100)))
}
