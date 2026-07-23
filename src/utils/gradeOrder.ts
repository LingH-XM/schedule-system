export const STANDARD_GRADE_LABELS = [
  '一年级',
  '二年级',
  '三年级',
  '四年级',
  '五年级',
  '六年级',
  '七年级',
  '八年级',
  '九年级'
] as const

export const GRADE_ORDER_MAP: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(STANDARD_GRADE_LABELS.map((grade, index) => [grade, index + 1]))
)

const EXTENDED_GRADE_ORDER: Readonly<Record<string, number>> = Object.freeze({
  高一: 10,
  高二: 11,
  高三: 12,
  十年级: 10,
  十一年级: 11,
  十二年级: 12
})

export function resolveGradeOrder(value: string): number {
  const grade = String(value || '').trim()
  if (grade === '全部年级') return 0

  const standardOrder = GRADE_ORDER_MAP[grade] ?? EXTENDED_GRADE_ORDER[grade]
  if (standardOrder != null) return standardOrder

  const numericMatch = grade.match(/^(\d+)年级$/)
  if (numericMatch) return Number(numericMatch[1])

  return Number.POSITIVE_INFINITY
}

export function compareGradeLabels(a: string, b: string): number {
  const normalizedA = String(a || '').trim()
  const normalizedB = String(b || '').trim()
  const orderA = resolveGradeOrder(normalizedA)
  const orderB = resolveGradeOrder(normalizedB)

  if (orderA !== orderB) return orderA - orderB
  return normalizedA.localeCompare(normalizedB, 'zh-CN', { numeric: true })
}

export function sortGradeLabels(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  ).sort(compareGradeLabels)
}
