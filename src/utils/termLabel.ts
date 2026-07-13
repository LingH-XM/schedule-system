export function formatSchoolYearLabel(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.endsWith('学年') ? text : `${text}学年`
}

export function formatSchoolTermLabel(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''

  const matched = text.match(/^(\d{4}-\d{4})(?:学年)?-(.+)$/)
  if (!matched) return text

  return `${formatSchoolYearLabel(matched[1])} ${matched[2].trim()}`
}

export function formatSchoolTermLabelFromParts(year: string, semester: string): string {
  const yearLabel = formatSchoolYearLabel(year)
  const semesterLabel = String(semester || '').trim()
  return [yearLabel, semesterLabel].filter(Boolean).join(' ')
}
