<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import {
  basicDataRepository,
  type Campus,
  type ClassRecord,
  type CourseItem,
  type ClassHourClassRow,
  type ClassHourRow,
  type TeacherRecord
} from '../../services/basicDataRepository'
import {
  loadSchedulePlans,
  loadWorkbenchPersistSnapshot,
  saveWorkbenchPersistSnapshot,
  type SchedulePlan,
  type WorkbenchPersistSnapshot
} from '../../services/scheduleStateRepository'
import {
  hydrateRuleSettingsSnapshotFromApi,
  loadRuleSettingsSnapshot,
  type GlobalFixedPointRecord
} from '../../services/ruleSettings'
import { notify } from '../../utils/notify'

type LessonLike = {
  name?: string
  teacher?: string
  teacherId?: string
  courseId?: string
}

type TimetableRow = {
  key: string
  label: string
  period: number | null
  isSpecial: boolean
  specialType?: 'break' | 'noon'
}

const timetableType = ref('班级课表')
const timetableTypes = ['班级课表', '教师课表', '课程课表', '学校课表']
const schoolLayout = ref<'horizontal' | 'vertical'>('horizontal')

const timetableSize = ref<'gradeLarge' | 'large' | 'small'>('large')
const exportLayout = ref<'periodLeft' | 'weekLeft'>('periodLeft')
const exportDialogVisible = ref(false)
const optionSettings = reactive({
  schoolYear: true,
  teachingCycle: true,
  headTeacher: true,
  breakTime: true,
  noonBreak: true,
  teacher: true,
  periodTime: true,
  onlyWithLessons: false,
  globalFixedPoint: true,
  shortName: true
})

const campuses = ref<Campus[]>([])
const classRecords = ref<ClassRecord[]>([])
const courses = ref<CourseItem[]>([])
const classHourRows = ref<ClassHourRow[]>([])
const classHourClassRows = ref<ClassHourClassRow[]>([])
const teacherRecords = ref<TeacherRecord[]>([])
const globalFixedPoints = ref<GlobalFixedPointRecord[]>(loadRuleSettingsSnapshot().globalFixedPoints || [])
const selectedClassId = ref('')
const selectedTeacherId = ref('')
const selectedCourseId = ref('')
const selectedCampusId = ref('')
const ALL_GRADE_VALUE = '__all__'
const selectedGrade = ref(ALL_GRADE_VALUE)
const selectedTerm = ref('当前学期')
const currentPlanId = ref('default')
const planKeyword = ref('')
const schedulePlans = ref<SchedulePlan[]>([])
const workbenchPersistState = ref<WorkbenchPersistSnapshot>({ entries: {}, meta: {}, drafts: {}, logs: {} })
const scheduleEntries = ref<Record<string, unknown>>({})
const publishedAt = ref(0)

const allDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function formatDateTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--'
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function formatTermLabel(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''
  const matched = text.match(/^(\d{4}-\d{4})-(.+)$/)
  if (!matched) return text
  return `${matched[1]} ${matched[2]}`
}

const selectedTermLabel = computed(() => formatTermLabel(selectedTerm.value))
const schedulePlanNameById = computed(
  () => new Map(schedulePlans.value.map((item) => [item.id, item.name || item.id] as const))
)
const publishedPlanOptions = computed(() => {
  const keyword = planKeyword.value.trim().toLowerCase()
  return Object.entries(workbenchPersistState.value.meta || {})
    .map(([id, meta]) => ({
      id,
      publishedAt: Number(meta?.publishedAt || 0),
      label: `${schedulePlanNameById.value.get(id) || id}（${formatDateTime(Number(meta?.publishedAt || 0))}）`
    }))
    .filter((item) => item.publishedAt > 0)
    .filter((item) => (keyword ? item.label.toLowerCase().includes(keyword) : true))
    .sort((a, b) => b.publishedAt - a.publishedAt)
})

const classRows = computed(() => {
  return classRecords.value.filter((item) => {
    if (selectedCampusId.value && item.campusId !== selectedCampusId.value) return false
    if (selectedGrade.value !== ALL_GRADE_VALUE && item.grade !== selectedGrade.value) return false
    return true
  })
})

const campusOptions = computed(() => {
  const set = new Map<string, string>()
  campuses.value.forEach((item) => {
    if (!item.id) return
    set.set(item.id, item.name || '未命名校区')
  })
  classRecords.value.forEach((item) => {
    if (!item.campusId || set.has(item.campusId)) return
    set.set(item.campusId, item.campusId)
  })
  return Array.from(set.entries()).map(([id, name]) => ({ id, name }))
})

const gradeOptions = computed(() => {
  const set = new Set<string>()
  classRecords.value
    .filter((item) => (selectedCampusId.value ? item.campusId === selectedCampusId.value : true))
    .forEach((item) => {
      if (item.grade) set.add(item.grade)
    })
  return Array.from(set)
})

const activeClassId = computed(() => {
  if (selectedClassId.value) return selectedClassId.value
  if (selectedGrade.value === ALL_GRADE_VALUE) return ''
  return classRows.value[0]?.id || ''
})
const activeClass = computed(() => classRecords.value.find((item) => item.id === activeClassId.value) || null)
const activeTeacher = computed(() => teacherRecords.value.find((item) => item.id === selectedTeacherId.value) || null)
const activeCourse = computed(() => courses.value.find((item) => item.id === selectedCourseId.value) || null)
const classById = computed(() => new Map(classRecords.value.map((item) => [item.id, item] as const)))

function formatClassDisplayName(classItem: ClassRecord | null | undefined): string {
  if (!classItem) return ''
  const grade = String(classItem.grade || '').trim()
  const className = String(classItem.className || '').trim()
  if (!className) return grade
  if (grade && className.startsWith(grade)) return className
  return grade ? `${grade}-${className}` : className
}

const dayCount = computed(() => {
  if (!activeClass.value) return 5
  const classHour = classHourClassRows.value.find((item) => item.classId === activeClass.value?.id)
  const gradeHour = classHourRows.value.find(
    (item) => item.campusId === activeClass.value?.campusId && item.grade === activeClass.value?.grade
  )
  const count = Number(classHour?.weeklyDays ?? gradeHour?.weeklyDays ?? 5)
  return Math.max(1, Math.min(7, count))
})

const lessonCount = computed(() => {
  if (!activeClass.value) return 8
  const classHour = classHourClassRows.value.find((item) => item.classId === activeClass.value?.id)
  const gradeHour = classHourRows.value.find(
    (item) => item.campusId === activeClass.value?.campusId && item.grade === activeClass.value?.grade
  )
  const total = Number(classHour?.morningStudy ?? gradeHour?.morningStudy ?? 0)
    + Number(classHour?.morningLessons ?? gradeHour?.morningLessons ?? 4)
    + Number(classHour?.afternoonLessons ?? gradeHour?.afternoonLessons ?? 4)
    + Number(classHour?.eveningStudy ?? gradeHour?.eveningStudy ?? 0)
  return Math.max(1, Math.min(12, total))
})

const activeClassHourConfig = computed(() => {
  if (!activeClass.value) {
    return { morningStudy: 0, morningLessons: 4, afternoonLessons: 4, breakSlot: '' }
  }
  const classHour = classHourClassRows.value.find((item) => item.classId === activeClass.value?.id)
  const gradeHour = classHourRows.value.find(
    (item) => item.campusId === activeClass.value?.campusId && item.grade === activeClass.value?.grade
  )
  const source = classHour ?? gradeHour
  return {
    morningStudy: Number(source?.morningStudy ?? 0),
    morningLessons: Number(source?.morningLessons ?? 4),
    afternoonLessons: Number(source?.afternoonLessons ?? 4),
    breakSlot: String(source?.breakSlot || '')
  }
})

const days = computed(() => allDays.slice(0, dayCount.value))
const periods = computed(() => Array.from({ length: lessonCount.value }).map((_, index) => index + 1))

const breakAfterPeriod = computed(() => {
  const config = activeClassHourConfig.value
  const morningStudy = Math.max(0, config.morningStudy)
  const morningLessons = Math.max(0, config.morningLessons)
  const afternoonLessons = Math.max(0, config.afternoonLessons)
  const total = Math.max(1, lessonCount.value)
  if (config.breakSlot === '上午第2节课后') return Math.min(total, morningStudy + 2)
  if (config.breakSlot === '上午第3节课后') return Math.min(total, morningStudy + 3)
  if (config.breakSlot === '下午第2节课后') return Math.min(total, morningStudy + morningLessons + Math.min(2, afternoonLessons))
  return 0
})

const noonAfterPeriod = computed(() => {
  const config = activeClassHourConfig.value
  const morningStudy = Math.max(0, config.morningStudy)
  const morningLessons = Math.max(0, config.morningLessons)
  const afternoonLessons = Math.max(0, config.afternoonLessons)
  const total = Math.max(1, lessonCount.value)
  if (afternoonLessons <= 0) return 0
  const boundary = morningStudy + morningLessons
  if (boundary <= 0 || boundary >= total) return 0
  return boundary
})

const timetableRows = computed<TimetableRow[]>(() => {
  const rows: TimetableRow[] = []
  const breakAfter = breakAfterPeriod.value
  const noonAfter = noonAfterPeriod.value
  periods.value.forEach((period) => {
    rows.push({
      key: `p-${period}`,
      label: String(period),
      period,
      isSpecial: false
    })
    if (noonAfter > 0 && period === noonAfter) {
      rows.push({
        key: `noon-${period}`,
        label: '午休',
        period: null,
        isSpecial: true,
        specialType: 'noon'
      })
    }
    if (breakAfter > 0 && period === breakAfter) {
      rows.push({
        key: `break-${period}`,
        label: '课间操',
        period: null,
        isSpecial: true,
        specialType: 'break'
      })
    }
  })
  return rows
})

function shouldShowSpecialRow(row: TimetableRow): boolean {
  if (!row.isSpecial) return true
  if (row.specialType === 'break') return optionSettings.breakTime
  if (row.specialType === 'noon') return optionSettings.noonBreak
  return true
}

const activeScheduleMap = computed<Record<string, Record<string, LessonLike | null>>>(() => {
  if (!publishedAt.value) return {}
  const entry = scheduleEntries.value[currentPlanId.value] as {
    scheduleMap?: Record<string, Record<string, LessonLike | null>>
    publishedAt?: number
  } | undefined
  if (!entry || Number(entry.publishedAt || 0) <= 0) return {}
  return entry?.scheduleMap || {}
})

const teacherNameById = computed(() => new Map(teacherRecords.value.map((item) => [item.id, item.name] as const)))
const campusNameById = computed(() => new Map(campuses.value.map((item) => [item.id, item.name] as const)))
const classNameById = computed(() => new Map(classRecords.value.map((item) => [item.id, item.className] as const)))

const teacherRows = computed(() => {
  return teacherRecords.value
    .filter((item) => (selectedCampusId.value ? item.campusId === selectedCampusId.value : true))
})

const courseRows = computed(() => {
  return courses.value
    .filter((item) => {
      if (selectedGrade.value === ALL_GRADE_VALUE) return true
      const stage = classRows.value[0]?.stage
      return stage ? item.scopes.includes(stage) : true
    })
})

const activeHeadTeacherName = computed(() => {
  const teacherId = String(activeClass.value?.headTeacherId || '').trim()
  if (!teacherId) return ''
  return String(teacherNameById.value.get(teacherId) || '')
})

const schoolDayCount = computed(() => Math.max(5, ...classRows.value.map((item) => getClassHourConfig(item).weeklyDays)))
const schoolTotalLessons = computed(() => Math.max(1, ...classRows.value.map((item) => getClassHourConfig(item).totalLessons)))
const schoolMorningStudy = computed(() => Math.max(0, ...classRows.value.map((item) => getClassHourConfig(item).morningStudy)))
const schoolDays = computed(() => allDays.slice(0, schoolDayCount.value))
const schoolPeriods = computed(() =>
  Array.from({ length: schoolTotalLessons.value }).map((_, index) => {
    const period = index + 1
    const label = period <= schoolMorningStudy.value ? `早${period}` : String(period - schoolMorningStudy.value)
    return { period, label }
  })
)
const schoolRows = computed(() =>
  classRows.value.map((item) => ({
    classId: item.id,
    className: item.className,
    headTeacherName: String(teacherNameById.value.get(String(item.headTeacherId || '')) || '')
  }))
)

type SchoolVerticalRow = {
  key: string
  day: string
  period: string
  dayIndex: number
  periodIndex: number
  isHeadTeacherRow: boolean
  cells: Record<string, string>
}

const schoolVerticalRows = computed<SchoolVerticalRow[]>(() => {
  const rows: SchoolVerticalRow[] = []
  const headCells: Record<string, string> = {}
  schoolRows.value.forEach((row) => {
    headCells[row.classId] = row.headTeacherName
  })
  rows.push({
    key: 'head-teacher',
    day: '班主任',
    period: '',
    dayIndex: -1,
    periodIndex: -1,
    isHeadTeacherRow: true,
    cells: headCells
  })
  schoolDays.value.forEach((day, dayIndex) => {
    schoolPeriods.value.forEach((period, periodIndex) => {
      const cells: Record<string, string> = {}
      schoolRows.value.forEach((row) => {
        cells[row.classId] = schoolCellText(row.classId, day, period.period)
      })
      rows.push({
        key: `${day}-${period.period}`,
        day: periodIndex === 0 ? day : '',
        period: period.label,
        dayIndex,
        periodIndex,
        isHeadTeacherRow: false,
        cells
      })
    })
  })
  return rows
})

const courseByName = computed(() => {
  const map = new Map<string, CourseItem>()
  courses.value.forEach((item) => {
    if (!item.name) return
    map.set(item.name.trim(), item)
  })
  return map
})

function getClassHourConfig(classItem: ClassRecord | null): {
  weeklyDays: number
  totalLessons: number
  morningStudy: number
  morningLessons: number
  afternoonLessons: number
  breakSlot: string
} {
  if (!classItem) {
    return { weeklyDays: 5, totalLessons: 8, morningStudy: 0, morningLessons: 4, afternoonLessons: 4, breakSlot: '' }
  }
  const classHour = classHourClassRows.value.find((item) => item.classId === classItem.id)
  const gradeHour = classHourRows.value.find((item) => item.campusId === classItem.campusId && item.grade === classItem.grade)
  const source = classHour ?? gradeHour
  const weeklyDays = Math.max(1, Math.min(7, Number(source?.weeklyDays ?? 5)))
  const morningStudy = Math.max(0, Number(source?.morningStudy ?? 0))
  const morningLessons = Math.max(0, Number(source?.morningLessons ?? 4))
  const afternoonLessons = Math.max(0, Number(source?.afternoonLessons ?? 4))
  const eveningStudy = Math.max(0, Number(source?.eveningStudy ?? 0))
  const totalLessons = Math.max(1, Math.min(12, morningStudy + morningLessons + afternoonLessons + eveningStudy))
  return {
    weeklyDays,
    totalLessons,
    morningStudy,
    morningLessons,
    afternoonLessons,
    breakSlot: String(source?.breakSlot || '')
  }
}

function buildClassTimetableRows(classItem: ClassRecord): TimetableRow[] {
  const config = getClassHourConfig(classItem)
  const rows: TimetableRow[] = []
  const periodsOfClass = Array.from({ length: config.totalLessons }).map((_, index) => index + 1)
  const noonAfter = config.afternoonLessons > 0 ? config.morningStudy + config.morningLessons : 0
  let breakAfter = 0
  if (config.breakSlot === '上午第2节课后') breakAfter = config.morningStudy + 2
  if (config.breakSlot === '上午第3节课后') breakAfter = config.morningStudy + 3
  if (config.breakSlot === '下午第2节课后') breakAfter = config.morningStudy + config.morningLessons + Math.min(2, config.afternoonLessons)
  breakAfter = Math.max(0, Math.min(config.totalLessons, breakAfter))
  periodsOfClass.forEach((period) => {
    rows.push({
      key: `p-${period}`,
      label: String(period),
      period,
      isSpecial: false
    })
    if (optionSettings.noonBreak && noonAfter > 0 && period === noonAfter) {
      rows.push({
        key: `noon-${period}`,
        label: '午休',
        period: null,
        isSpecial: true,
        specialType: 'noon'
      })
    }
    if (optionSettings.breakTime && breakAfter > 0 && period === breakAfter) {
      rows.push({
        key: `break-${period}`,
        label: '课间操',
        period: null,
        isSpecial: true,
        specialType: 'break'
      })
    }
  })
  return rows
}

function classLessonText(classItem: ClassRecord, period: number, day: string, includeTeacher = optionSettings.teacher): string {
  const lesson = activeScheduleMap.value[classItem.id]?.[slotKey(period, day)]
  if (!lesson) return ''
  const rawName = String(lesson.name || '').trim()
  const course = courseByName.value.get(rawName)
  const name =
    optionSettings.shortName && String(course?.shortName || '').trim()
      ? String(course?.shortName || '').trim()
      : rawName
  const teacher = includeTeacher ? String(lesson.teacher || '').trim() : ''
  return [name, teacher].filter(Boolean).join('\n')
}

function classFixedPointText(classItem: ClassRecord, period: number, day: string): string {
  if (!optionSettings.globalFixedPoint) return ''
  const campusName = String(campusNameById.value.get(classItem.campusId) || '').trim()
  const grade = String(classItem.grade || '').trim()
  if (!campusName || !grade) return ''
  const hits = globalFixedPoints.value.filter((item) => {
    if (Number(item.period) !== period) return false
    if (String(item.day || '') !== day) return false
    if (String(item.campus || '') !== campusName) return false
    const itemGrade = String(item.grade || '')
    return itemGrade === grade || itemGrade === '全部年级' || itemGrade === ''
  })
  if (!hits.length) return ''
  const exact = hits.find((item) => String(item.grade || '') === grade)
  return String((exact || hits[0]).label || '').trim()
}

function slotKey(period: number, day: string): string {
  return `${period}-${day}`
}

function lessonText(period: number, day: string): string {
  if (!activeClass.value) return ''
  return classLessonText(activeClass.value, period, day)
}

function fixedPointText(period: number, day: string): string {
  if (timetableType.value !== '班级课表') return ''
  if (!activeClass.value) return ''
  return classFixedPointText(activeClass.value, period, day)
}

function rowLessonText(row: TimetableRow, day: string): string {
  if (row.isSpecial) return row.label
  if (!row.period) return ''
  if (timetableType.value === '教师课表') return teacherLessonText(row.period, day)
  if (timetableType.value === '课程课表') return courseLessonText(row.period, day)
  const normal = lessonText(row.period, day)
  if (normal) return normal
  return fixedPointText(row.period, day)
}

function schoolCellText(classId: string, day: string, period: number): string {
  const classItem = classById.value.get(classId)
  if (!classItem) return ''
  const config = getClassHourConfig(classItem)
  if (period > config.totalLessons) return ''
  const text = classLessonText(classItem, period, day)
  if (text) return text
  return classFixedPointText(classItem, period, day)
}

function schoolVerticalCellText(row: SchoolVerticalRow, classId: string): string {
  return String(row.cells[classId] || '')
}

function schoolVerticalSpanMethod({
  row,
  columnIndex
}: {
  row: SchoolVerticalRow
  columnIndex: number
}): [number, number] {
  if (row.isHeadTeacherRow) return [1, 1]
  if (columnIndex !== 0) return [1, 1]
  if (row.periodIndex === 0) return [schoolPeriods.value.length, 1]
  return [0, 0]
}

function isTeacherHit(lesson: LessonLike | null | undefined): boolean {
  if (!lesson || !activeTeacher.value) return false
  const targetId = String(activeTeacher.value.id || '').trim()
  const targetName = String(activeTeacher.value.name || '').trim()
  const lessonTeacherId = String(lesson.teacherId || '').trim()
  const lessonTeacherName = String(lesson.teacher || '').trim()
  if (targetId && lessonTeacherId && targetId === lessonTeacherId) return true
  return Boolean(targetName) && lessonTeacherName === targetName
}

function teacherLessonText(period: number, day: string): string {
  if (!activeTeacher.value) return ''
  const key = slotKey(period, day)
  const blocks: string[] = []
  classRows.value.forEach((classItem) => {
    const lesson = activeScheduleMap.value[classItem.id]?.[key]
    if (!isTeacherHit(lesson)) return
    const className = String(classNameById.value.get(classItem.id) || classItem.className || '')
    const rawName = String(lesson?.name || '').trim()
    const course = courseByName.value.get(rawName)
    const courseName =
      optionSettings.shortName && String(course?.shortName || '').trim()
        ? String(course?.shortName || '').trim()
        : rawName
    blocks.push([className, courseName].filter(Boolean).join('\n'))
  })
  return blocks.join('\n\n')
}

function isCourseHit(lesson: LessonLike | null | undefined): boolean {
  if (!lesson || !activeCourse.value) return false
  const targetId = String(activeCourse.value.id || '').trim()
  const targetName = String(activeCourse.value.name || '').trim()
  const targetShort = String(activeCourse.value.shortName || '').trim()
  const lessonCourseId = String(lesson.courseId || '').trim()
  const lessonName = String(lesson.name || '').trim()
  if (targetId && lessonCourseId && targetId === lessonCourseId) return true
  if (targetName && lessonName === targetName) return true
  return Boolean(targetShort) && lessonName === targetShort
}

function courseLessonText(period: number, day: string): string {
  if (!activeCourse.value) return ''
  const key = slotKey(period, day)
  const blocks: string[] = []
  classRows.value.forEach((classItem) => {
    const lesson = activeScheduleMap.value[classItem.id]?.[key]
    if (!isCourseHit(lesson)) return
    const teacherName = optionSettings.teacher ? String(lesson?.teacher || '').trim() : ''
    const className = String(classNameById.value.get(classItem.id) || classItem.className || '')
    blocks.push([teacherName, className].filter(Boolean).join('\n'))
  })
  return blocks.join('\n\n')
}

function optionEnabled(key: keyof typeof optionSettings): boolean {
  return Boolean(optionSettings[key])
}

const displayedTimetableRows = computed(() => {
  const rows = timetableRows.value.filter((row) => shouldShowSpecialRow(row))
  if (!optionSettings.onlyWithLessons) return rows
  return rows.filter((row) => {
    if (row.isSpecial) return true
    return days.value.some((day) => Boolean(rowLessonText(row, day).trim()))
  })
})

function timetableSpanMethod({
  row,
  columnIndex
}: {
  row: TimetableRow
  columnIndex: number
}): [number, number] {
  if (!row.isSpecial) return [1, 1]
  if (columnIndex === 0) return [1, days.value.length + 1]
  return [0, 0]
}

const BORDER_THIN = {
  top: { style: 'thin' as const, color: { argb: 'FFD9E2F3' } },
  left: { style: 'thin' as const, color: { argb: 'FFD9E2F3' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFD9E2F3' } },
  right: { style: 'thin' as const, color: { argb: 'FFD9E2F3' } }
}

function styleCell(cell: ExcelJS.Cell, opts: { bold?: boolean; fill?: string; align?: 'left' | 'center'; wrap?: boolean; fontSize?: number } = {}): void {
  cell.border = BORDER_THIN
  cell.alignment = { horizontal: opts.align || 'center', vertical: 'middle', wrapText: opts.wrap ?? true }
  cell.font = { name: 'Microsoft YaHei', size: opts.fontSize ?? 10.5, bold: Boolean(opts.bold), color: { argb: 'FF2D3D61' } }
  if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
}

function styleRowCells(row: ExcelJS.Row, colStart: number, colEnd: number, opts: Parameters<typeof styleCell>[1] = {}): void {
  for (let col = colStart; col <= colEnd; col += 1) styleCell(row.getCell(col), opts)
}

function buildLargeSheetExcel(workbook: ExcelJS.Workbook, sheetName: string, exportClasses: ClassRecord[], maxDays: number): void {
  const ws = workbook.addWorksheet(sheetName.slice(0, 31))
  ws.columns = [{ width: 6.5 }, ...new Array(maxDays).fill(null).map(() => ({ width: 16 }))]
  exportClasses.forEach((classItem, classIndex) => {
    const config = getClassHourConfig(classItem)
    const exportDays = allDays.slice(0, config.weeklyDays)
    const titleParts: string[] = []
    if (optionSettings.schoolYear && selectedTerm.value) titleParts.push(selectedTerm.value)
    titleParts.push(formatClassDisplayName(classItem), '课表')
    const headTeacherName =
      optionSettings.headTeacher && classItem.headTeacherId ? String(teacherNameById.value.get(classItem.headTeacherId) || '') : ''
    const title = `${titleParts.filter(Boolean).join(' ')}${optionSettings.headTeacher ? `    班主任:${headTeacherName}` : ''}`.trim()
    const titleRow = ws.addRow([title])
    ws.mergeCells(titleRow.number, 1, titleRow.number, maxDays + 1)
    titleRow.height = 25
    styleRowCells(titleRow, 1, maxDays + 1, { bold: true, align: 'left', fontSize: 11.5 })
    const headRow = ws.addRow(['节次', ...exportDays, ...new Array(maxDays - exportDays.length).fill('')])
    headRow.height = 25
    styleRowCells(headRow, 1, maxDays + 1, { bold: true, fill: 'FFEEF3FD' })
    const classRowsForExport = buildClassTimetableRows(classItem)
    classRowsForExport.forEach((row) => {
      if (row.isSpecial) {
        const specialRow = ws.addRow([row.label])
        ws.mergeCells(specialRow.number, 1, specialRow.number, maxDays + 1)
        specialRow.height = 25
        styleRowCells(specialRow, 1, maxDays + 1, { bold: true, fill: 'FFF6F9FF' })
        return
      }
      const period = Number(row.period || 0)
      const dataCells = exportDays.map((day) => classLessonText(classItem, period, day) || classFixedPointText(classItem, period, day))
      const lessonRow = ws.addRow([row.label, ...dataCells, ...new Array(maxDays - exportDays.length).fill('')])
      lessonRow.height = 40
      styleRowCells(lessonRow, 1, maxDays + 1)
    })
    if (classIndex !== exportClasses.length - 1) {
      const gapRow = ws.addRow(new Array(maxDays + 1).fill(''))
      gapRow.height = 14
      styleRowCells(gapRow, 1, maxDays + 1)
    }
  })
}

function buildGradeLargeSheetExcel(workbook: ExcelJS.Workbook, sheetName: string, rowsOfGrade: ClassRecord[], campusName: string, grade: string): void {
  const ws = workbook.addWorksheet(sheetName.slice(0, 31))
  const dayCountOfSheet = Math.max(...rowsOfGrade.map((item) => getClassHourConfig(item).weeklyDays), 5)
  const totalLessonsOfSheet = Math.max(...rowsOfGrade.map((item) => getClassHourConfig(item).totalLessons), 1)
  const morningStudyOfSheet = Math.max(...rowsOfGrade.map((item) => getClassHourConfig(item).morningStudy), 0)
  const totalCols = 1 + dayCountOfSheet * totalLessonsOfSheet
  ws.columns = [{ width: 12 }, ...new Array(totalCols - 1).fill(null).map(() => ({ width: 13.5 }))]
  const exportDays = allDays.slice(0, dayCountOfSheet)
  const title = [optionSettings.schoolYear ? selectedTerm.value : '', campusName, grade, '课表'].filter(Boolean).join(' ')
  const row1 = ws.addRow([title])
  ws.mergeCells(row1.number, 1, row1.number, totalCols)
  row1.height = 25
  styleRowCells(row1, 1, totalCols, { bold: true, align: 'left', fontSize: 11.5 })
  const headerDays: string[] = ['星期', ...new Array(dayCountOfSheet * totalLessonsOfSheet).fill('')]
  const row2 = ws.addRow(headerDays)
  row2.height = 25
  styleRowCells(row2, 1, totalCols, { bold: true, fill: 'FFEEF3FD' })
  exportDays.forEach((day, dayIndex) => {
    const startCol = 2 + dayIndex * totalLessonsOfSheet
    const endCol = startCol + totalLessonsOfSheet - 1
    ws.mergeCells(row2.number, startCol, row2.number, endCol)
    const dayCell = row2.getCell(startCol)
    dayCell.value = day
    styleCell(dayCell, { bold: true, fill: 'FFEEF3FD' })
  })
  const headerPeriods: string[] = ['节次']
  exportDays.forEach(() => {
    for (let period = 1; period <= totalLessonsOfSheet; period += 1) {
      headerPeriods.push(period <= morningStudyOfSheet ? `早${period}` : String(period - morningStudyOfSheet))
    }
  })
  const row3 = ws.addRow(headerPeriods)
  row3.height = 25
  styleRowCells(row3, 1, totalCols, { bold: true, fill: 'FFEEF3FD' })

  const calcRowHeight = (values: Array<string | number | null | undefined>): number => {
    const maxLines = values.reduce((max, value) => {
      const text = String(value ?? '')
      const lines = Math.max(1, text.split('\n').length)
      return Math.max(max, lines)
    }, 1)
    return Math.max(20, maxLines * 18)
  }

  rowsOfGrade.forEach((classItem) => {
    const classHourConfig = getClassHourConfig(classItem)
    const headTeacherName =
      optionSettings.headTeacher && classItem.headTeacherId ? String(teacherNameById.value.get(classItem.headTeacherId) || '') : ''
    const classLabel = headTeacherName ? `${classItem.className}\n(${headTeacherName})` : classItem.className
    const dataCells: string[] = []
    exportDays.forEach((day) => {
      for (let period = 1; period <= totalLessonsOfSheet; period += 1) {
        if (period > classHourConfig.totalLessons) {
          dataCells.push('')
        } else {
          dataCells.push(classLessonText(classItem, period, day) || classFixedPointText(classItem, period, day))
        }
      }
    })
    const rowValues = [classLabel, ...dataCells]
    const row = ws.addRow(rowValues)
    row.height = calcRowHeight(rowValues)
    styleRowCells(row, 1, totalCols)
  })
}

function buildSmallSheetExcel(workbook: ExcelJS.Workbook, sheetName: string, exportClasses: ClassRecord[]): void {
  const ws = workbook.addWorksheet(sheetName.slice(0, 31))
  ws.columns = [{ width: 5 }, { width: 9.5 }, { width: 9.5 }, { width: 9.5 }, { width: 9.5 }, { width: 9.5 }, { width: 3.8 }, { width: 5 }, { width: 9.5 }, { width: 9.5 }, { width: 9.5 }, { width: 9.5 }, { width: 9.5 }]
  const defaultDays = allDays.slice(0, 5)
  const title = [optionSettings.schoolYear ? selectedTerm.value : '', '课表'].filter(Boolean).join(' ')
  for (let index = 0; index < exportClasses.length; index += 2) {
    const left = exportClasses[index]
    const right = exportClasses[index + 1] || null
    const leftCfg = getClassHourConfig(left)
    const rightCfg = right ? getClassHourConfig(right) : null
    const maxLessons = Math.max(leftCfg.totalLessons, Number(rightCfg?.totalLessons || 0), 1)
    const titleRow = ws.addRow([title])
    ws.mergeCells(titleRow.number, 1, titleRow.number, 13)
    titleRow.height = 20
    styleRowCells(titleRow, 1, 13, { bold: true, align: 'left', fontSize: 11.5 })
    const classRow = ws.addRow([`${left.grade}${left.className}`, '', '', '', '', '', '', right ? `${right.grade}${right.className}` : '', '', '', '', '', ''])
    classRow.height = 14
    styleRowCells(classRow, 1, 13, { bold: true, align: 'left' })
    const headRow = ws.addRow(['节次', ...defaultDays, '', '节次', ...defaultDays])
    headRow.height = 14
    styleRowCells(headRow, 1, 13, { bold: true, fill: 'FFEEF3FD' })
    for (let period = 1; period <= maxLessons; period += 1) {
      const leftCells = defaultDays.map((day) => {
        if (period > leftCfg.totalLessons) return ''
        const text = classLessonText(left, period, day, false)
        return text ? text.replace(/\n/g, ' ') : classFixedPointText(left, period, day)
      })
      const rightCells = defaultDays.map((day) => {
        if (!right || !rightCfg || period > rightCfg.totalLessons) return ''
        const text = classLessonText(right, period, day, false)
        return text ? text.replace(/\n/g, ' ') : classFixedPointText(right, period, day)
      })
      const row = ws.addRow([String(period), ...leftCells, '', String(period), ...rightCells])
      row.height = 20
      styleRowCells(row, 1, 13)
    }
    if (index + 2 < exportClasses.length) {
      const gapRow = ws.addRow(new Array(13).fill(''))
      gapRow.height = 12
      styleRowCells(gapRow, 1, 13)
    }
  }
}

function buildSchoolHorizontalSheetExcel(workbook: ExcelJS.Workbook, sheetName: string, campusName: string, gradeName: string): void {
  const ws = workbook.addWorksheet(sheetName.slice(0, 31))
  const totalCols = 2 + schoolDayCount.value * schoolTotalLessons.value
  ws.columns = [{ width: 16 }, { width: 11 }, ...new Array(totalCols - 2).fill(null).map(() => ({ width: 12 }))]
  const title = [optionSettings.schoolYear ? selectedTerm.value : '', `${campusName}-${gradeName}`, '学校课表'].filter(Boolean).join(' ')
  const row1 = ws.addRow([title])
  ws.mergeCells(row1.number, 1, row1.number, totalCols)
  row1.height = 25
  styleRowCells(row1, 1, totalCols, { bold: true, align: 'left', fontSize: 11.5 })

  const row2 = ws.addRow(['星期', '班主任', ...new Array(totalCols - 2).fill('')])
  row2.height = 24
  styleRowCells(row2, 1, totalCols, { bold: true, fill: 'FFEEF3FD' })
  schoolDays.value.forEach((day, dayIndex) => {
    const startCol = 3 + dayIndex * schoolTotalLessons.value
    const endCol = startCol + schoolTotalLessons.value - 1
    ws.mergeCells(row2.number, startCol, row2.number, endCol)
    row2.getCell(startCol).value = day
    styleCell(row2.getCell(startCol), { bold: true, fill: 'FFEEF3FD' })
  })

  const row3 = ws.addRow(['节次', '', ...schoolPeriods.value.map((item) => item.label).flatMap((value) => new Array(1).fill(value))])
  const expandedPeriods: string[] = []
  schoolDays.value.forEach(() => schoolPeriods.value.forEach((p) => expandedPeriods.push(p.label)))
  row3.values = [undefined, '节次', '', ...expandedPeriods]
  row3.height = 24
  styleRowCells(row3, 1, totalCols, { bold: true, fill: 'FFEEF3FD' })

  schoolRows.value.forEach((row) => {
    const cells: string[] = []
    schoolDays.value.forEach((day) => {
      schoolPeriods.value.forEach((period) => {
        cells.push(schoolCellText(row.classId, day, period.period))
      })
    })
    const dataRow = ws.addRow([row.className, row.headTeacherName, ...cells])
    const maxLines = Math.max(
      1,
      ...cells.map((item) => Math.max(1, String(item || '').split('\n').length)),
      Math.max(1, String(row.className || '').split('\n').length)
    )
    dataRow.height = Math.max(24, maxLines * 16)
    styleRowCells(dataRow, 1, totalCols)
  })
}

function buildSchoolVerticalSheetExcel(workbook: ExcelJS.Workbook, sheetName: string, campusName: string, gradeName: string): void {
  const ws = workbook.addWorksheet(sheetName.slice(0, 31))
  const totalCols = 2 + schoolRows.value.length
  ws.columns = [{ width: 10 }, { width: 8 }, ...new Array(totalCols - 2).fill(null).map(() => ({ width: 13 }))]
  const title = [optionSettings.schoolYear ? selectedTerm.value : '', `${campusName}-${gradeName}`, '学校课表'].filter(Boolean).join(' ')
  const row1 = ws.addRow([title])
  ws.mergeCells(row1.number, 1, row1.number, totalCols)
  row1.height = 25
  styleRowCells(row1, 1, totalCols, { bold: true, align: 'left', fontSize: 11.5 })

  const row2 = ws.addRow(['周次', '节次', ...schoolRows.value.map((item) => item.className)])
  row2.height = 24
  styleRowCells(row2, 1, totalCols, { bold: true, fill: 'FFEEF3FD' })

  const row3 = ws.addRow(['班主任', '', ...schoolRows.value.map((item) => item.headTeacherName)])
  row3.height = 24
  styleRowCells(row3, 1, totalCols, { bold: true, fill: 'FFF6F9FF' })

  schoolDays.value.forEach((day) => {
    const startRow = ws.rowCount + 1
    schoolPeriods.value.forEach((period, index) => {
      const cells = schoolRows.value.map((item) => schoolCellText(item.classId, day, period.period))
      const row = ws.addRow([index === 0 ? day : '', period.label, ...cells])
      const maxLines = Math.max(1, ...cells.map((item) => Math.max(1, String(item || '').split('\n').length)))
      row.height = Math.max(22, maxLines * 16)
      styleRowCells(row, 1, totalCols)
    })
    ws.mergeCells(startRow, 1, startRow + schoolPeriods.value.length - 1, 1)
  })
}

async function exportAs(type: 'excel' | 'pdf'): Promise<void> {
  if (type !== 'excel') {
    notify.info('PDF 导出暂未开放，请先使用 Excel 导出。')
    return
  }
  if (timetableType.value === '班级课表' && exportLayout.value !== 'periodLeft') {
    notify.info('当前仅支持“节次在左”导出。')
    return
  }
  if (!publishedAt.value) {
    notify.warning('暂无已生成课表，请先在排课管理生成课表。')
    return
  }
  const exportClasses = classRows.value
  if (!exportClasses.length) {
    notify.warning('当前筛选下没有班级可导出。')
    return
  }

  const workbook = new ExcelJS.Workbook()
  const campusName = String(campusNameById.value.get(selectedCampusId.value) || '本校区')
  const selectedGradeName = selectedGrade.value === ALL_GRADE_VALUE ? '全年级' : String(selectedGrade.value || '全年级')

  if (timetableType.value === '学校课表') {
    if (schoolLayout.value === 'vertical') {
      buildSchoolVerticalSheetExcel(workbook, `${campusName}-${selectedGradeName}-学校课表-竖版`, campusName, selectedGradeName)
    } else {
      buildSchoolHorizontalSheetExcel(workbook, `${campusName}-${selectedGradeName}-学校课表-横版`, campusName, selectedGradeName)
    }
  } else if (timetableSize.value === 'gradeLarge') {
    const gradeMap = new Map<string, ClassRecord[]>()
    exportClasses.forEach((item) => {
      const key = String(item.grade || '未分年级')
      if (!gradeMap.has(key)) gradeMap.set(key, [])
      gradeMap.get(key)?.push(item)
    })
    Array.from(gradeMap.entries()).forEach(([grade, rowsOfGrade]) => buildGradeLargeSheetExcel(workbook, `${campusName}-${grade}`, rowsOfGrade, campusName, grade))
  } else if (timetableSize.value === 'small') {
    buildSmallSheetExcel(workbook, `${campusName}-${selectedGradeName}`, exportClasses)
  } else {
    const maxDays = Math.max(...exportClasses.map((item) => getClassHourConfig(item).weeklyDays), 5)
    buildLargeSheetExcel(workbook, `${campusName}-${selectedGradeName}`, exportClasses, maxDays)
  }

  const filename =
    timetableType.value === '学校课表'
      ? schoolLayout.value === 'vertical'
        ? `${campusName}-${selectedGradeName}-学校课表-竖版.xlsx`
        : `${campusName}-${selectedGradeName}-学校课表-横版.xlsx`
      : timetableSize.value === 'gradeLarge'
      ? `${campusName}-${selectedGradeName}-年级大课表-横版.xlsx`
      : timetableSize.value === 'small'
      ? `${campusName}-${selectedGradeName}-班级小课表-节次在左.xlsx`
      : `${campusName}-${selectedGradeName}-班级大课表-节次在左.xlsx`
  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
  notify.success(`已导出：${filename}`)
}

async function confirmExportExcel(): Promise<void> {
  await exportAs('excel')
  exportDialogVisible.value = false
}

async function hydrate(): Promise<void> {
  const loaded = await basicDataRepository.load()
  const parsed = loaded && typeof loaded === 'object' ? loaded : {}
  campuses.value = Array.isArray((parsed as { campuses?: unknown[] }).campuses)
    ? ((parsed as { campuses: Campus[] }).campuses || [])
    : []
  classRecords.value = Array.isArray((parsed as { classRecords?: unknown[] }).classRecords)
    ? ((parsed as { classRecords: ClassRecord[] }).classRecords || [])
    : []
  courses.value = Array.isArray((parsed as { courses?: unknown[] }).courses)
    ? ((parsed as { courses: CourseItem[] }).courses || [])
    : []
  classHourRows.value = Array.isArray((parsed as { classHourRows?: unknown[] }).classHourRows)
    ? ((parsed as { classHourRows: ClassHourRow[] }).classHourRows || [])
    : []
  classHourClassRows.value = Array.isArray((parsed as { classHourClassRows?: unknown[] }).classHourClassRows)
    ? ((parsed as { classHourClassRows: ClassHourClassRow[] }).classHourClassRows || [])
    : []
  teacherRecords.value = Array.isArray((parsed as { teacherRecords?: unknown[] }).teacherRecords)
    ? ((parsed as { teacherRecords: TeacherRecord[] }).teacherRecords || [])
    : []
  selectedTerm.value = String((parsed as { selectedTerm?: unknown }).selectedTerm || '当前学期')

  const first = classRecords.value[0]
  selectedCampusId.value = first?.campusId || ''
  selectedGrade.value = ALL_GRADE_VALUE
  selectedClassId.value = first?.id || ''
  selectedTeacherId.value = teacherRows.value[0]?.id || ''
  selectedCourseId.value = courseRows.value[0]?.id || ''

  schedulePlans.value = await loadSchedulePlans()
  const workbench = await loadWorkbenchPersistSnapshot()
  workbenchPersistState.value = workbench
  scheduleEntries.value = (workbenchPersistState.value.entries || {}) as Record<string, unknown>
  const metaList = Object.entries(workbenchPersistState.value.meta || {})
    .map(([id, meta]) => ({ id, publishedAt: Number(meta?.publishedAt || 0) }))
    .filter((item) => item.publishedAt > 0)
    .sort((a, b) => b.publishedAt - a.publishedAt)
  const latest = metaList[0]
  currentPlanId.value = latest?.id || 'default'
  publishedAt.value = latest?.publishedAt || 0
  globalFixedPoints.value = (await hydrateRuleSettingsSnapshotFromApi()).globalFixedPoints || []
}

void hydrate()

watch(
  campusOptions,
  (rows) => {
    if (!rows.length) {
      selectedCampusId.value = ''
      return
    }
    if (!rows.some((item) => item.id === selectedCampusId.value)) {
      selectedCampusId.value = rows[0].id
    }
  },
  { immediate: true }
)

watch(
  gradeOptions,
  (rows) => {
    if (!rows.length) {
      selectedGrade.value = ALL_GRADE_VALUE
      return
    }
    if (selectedGrade.value !== ALL_GRADE_VALUE && !rows.includes(selectedGrade.value)) {
      selectedGrade.value = ALL_GRADE_VALUE
    }
  },
  { immediate: true }
)

watch(
  () => currentPlanId.value,
  (planId) => {
    const published = Number(workbenchPersistState.value.meta?.[planId]?.publishedAt || 0)
    publishedAt.value = published
  },
  { immediate: true }
)

watch(
  publishedPlanOptions,
  (rows) => {
    if (!rows.length) {
      currentPlanId.value = 'default'
      publishedAt.value = 0
      return
    }
    if (!rows.some((item) => item.id === currentPlanId.value)) {
      currentPlanId.value = rows[0].id
    }
  },
  { immediate: true }
)

async function removeCurrentTimetableData(): Promise<void> {
  const targetPlanId = String(currentPlanId.value || '').trim()
  if (!targetPlanId || !workbenchPersistState.value.meta?.[targetPlanId]) {
    notify.warning('请先选择要删除的课表数据。')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认删除课表数据「${schedulePlanNameById.value.get(targetPlanId) || targetPlanId}」吗？删除后无法恢复。`,
      '删除课表数据',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  const next: WorkbenchPersistSnapshot = {
    entries: { ...(workbenchPersistState.value.entries || {}) },
    meta: { ...(workbenchPersistState.value.meta || {}) },
    drafts: { ...(workbenchPersistState.value.drafts || {}) },
    logs: { ...(workbenchPersistState.value.logs || {}) },
    _savedAt: Date.now()
  }
  delete next.entries[targetPlanId]
  delete next.meta[targetPlanId]
  delete next.drafts[targetPlanId]
  delete next.logs[targetPlanId]

  await saveWorkbenchPersistSnapshot(next)
  workbenchPersistState.value = next
  scheduleEntries.value = (next.entries || {}) as Record<string, unknown>
  notify.success('课表数据已删除。')
}

watch(
  classRows,
  (rows) => {
    if (!rows.length) {
      selectedClassId.value = ''
      return
    }
    if (selectedGrade.value === ALL_GRADE_VALUE) {
      selectedClassId.value = ''
      return
    }
    if (!rows.some((item) => item.id === selectedClassId.value)) {
      selectedClassId.value = rows[0].id
    }
  },
  { immediate: true }
)

watch(
  teacherRows,
  (rows) => {
    if (!rows.length) {
      selectedTeacherId.value = ''
      return
    }
    if (!rows.some((item) => item.id === selectedTeacherId.value)) {
      selectedTeacherId.value = rows[0].id
    }
  },
  { immediate: true }
)

watch(
  courseRows,
  (rows) => {
    if (!rows.length) {
      selectedCourseId.value = ''
      return
    }
    if (!rows.some((item) => item.id === selectedCourseId.value)) {
      selectedCourseId.value = rows[0].id
    }
  },
  { immediate: true }
)
</script>

<template>
  <article class="panel timetable-manage-panel">
    <header class="tm-topbar">
      <el-tabs v-model="timetableType" class="tm-type-tabs">
        <el-tab-pane v-for="item in timetableTypes" :key="item" :label="item" :name="item" />
      </el-tabs>
      <div class="tm-actions">
        <el-button type="primary" plain>打印</el-button>
        <el-button type="primary" @click="exportDialogVisible = true">导出课表</el-button>
      </div>
    </header>

    <div class="tm-filterbar">
      <el-input v-model="planKeyword" clearable placeholder="查询课表数据（方案名）" class="tm-filter-select" />
      <el-select v-model="currentPlanId" filterable clearable placeholder="课表数据管理" class="tm-filter-select">
        <el-option v-for="item in publishedPlanOptions" :key="item.id" :label="item.label" :value="item.id" />
      </el-select>
      <el-button type="danger" plain :disabled="!currentPlanId || !publishedAt" @click="removeCurrentTimetableData">
        删除课表数据
      </el-button>
      <el-select v-model="selectedCampusId" placeholder="选择校区" class="tm-filter-select">
        <el-option v-for="item in campusOptions" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-select v-model="selectedGrade" placeholder="选择年级" class="tm-filter-select">
        <el-option label="全年级" :value="ALL_GRADE_VALUE" />
        <el-option v-for="item in gradeOptions" :key="item" :label="item" :value="item" />
      </el-select>
      <template v-if="timetableType === '教师课表'">
        <el-select
          v-model="selectedTeacherId"
          filterable
          clearable
          :reserve-keyword="false"
          default-first-option
          placeholder="输入教师姓名搜索"
          class="tm-filter-select tm-filter-picker"
        >
          <el-option v-for="row in teacherRows" :key="row.id" :label="row.name" :value="row.id" />
        </el-select>
      </template>
      <template v-else-if="timetableType === '课程课表'">
        <el-select
          v-model="selectedCourseId"
          filterable
          clearable
          :reserve-keyword="false"
          default-first-option
          placeholder="输入课程名称搜索"
          class="tm-filter-select tm-filter-picker"
        >
          <el-option v-for="row in courseRows" :key="row.id" :label="row.name" :value="row.id" />
        </el-select>
      </template>
      <template v-else-if="timetableType === '班级课表'">
        <el-select
          v-model="selectedClassId"
          filterable
          clearable
          :reserve-keyword="false"
          default-first-option
          placeholder="输入班级名称搜索"
          class="tm-filter-select tm-filter-picker"
        >
          <el-option v-for="row in classRows" :key="row.id" :label="formatClassDisplayName(row)" :value="row.id" />
        </el-select>
      </template>
    </div>

    <section class="tm-main" :class="{ 'tm-main--school': timetableType === '学校课表' }">
      <aside v-if="timetableType !== '学校课表'" class="tm-left">
        <section class="tm-card">
          <h3>课表选项</h3>
          <div class="tm-option-group">
            <div class="tm-option-title">课表</div>
            <div class="tm-option-inline">
              <el-checkbox v-model="optionSettings.breakTime">课间操</el-checkbox>
              <el-checkbox v-model="optionSettings.noonBreak">午休</el-checkbox>
            </div>
          </div>
          <div class="tm-option-group">
            <div class="tm-option-title">内容</div>
            <el-checkbox v-model="optionSettings.schoolYear">学年学期</el-checkbox>
            <el-checkbox v-model="optionSettings.teachingCycle">教学周期</el-checkbox>
            <el-checkbox v-model="optionSettings.headTeacher">班主任</el-checkbox>
            <el-checkbox v-model="optionSettings.teacher">教师</el-checkbox>
            <el-checkbox v-model="optionSettings.periodTime">课节时间</el-checkbox>
            <el-checkbox v-model="optionSettings.onlyWithLessons">仅显示有课时间</el-checkbox>
            <el-checkbox v-model="optionSettings.globalFixedPoint">全局固定点</el-checkbox>
            <el-checkbox v-model="optionSettings.shortName">使用简称</el-checkbox>
          </div>
        </section>
      </aside>

      <section class="tm-right tm-card">
        <div class="tm-schedule-head">
          <h3 class="tm-schedule-title">
            <span v-if="optionEnabled('schoolYear')" class="tm-title-part">{{ selectedTermLabel }}</span>
            <template v-if="timetableType === '学校课表'">
              <span class="tm-title-part">{{ selectedGrade === ALL_GRADE_VALUE ? '全年级' : selectedGrade }}</span>
              <span class="tm-title-part">学校课表</span>
            </template>
            <template v-else-if="timetableType === '教师课表'">
              <span class="tm-title-part">{{ activeTeacher?.name || '' }}</span>
              <span class="tm-title-part">课表</span>
            </template>
            <template v-else-if="timetableType === '课程课表'">
              <span class="tm-title-part">{{ activeCourse?.name || '' }}</span>
              <span class="tm-title-part">课表</span>
            </template>
            <template v-else>
              <span class="tm-title-part">{{ activeClass ? formatClassDisplayName(activeClass) : '请选择班级' }}</span>
              <span class="tm-title-part">课表</span>
            </template>
          </h3>
          <div v-if="timetableType === '班级课表' && optionEnabled('headTeacher') && activeHeadTeacherName" class="tm-head-teacher">
            班主任：{{ activeHeadTeacherName }}
          </div>
        </div>
        <div v-if="timetableType === '学校课表'" class="tm-school-layout-switch">
          <span>版型：</span>
          <el-radio-group v-model="schoolLayout">
            <el-radio label="horizontal">横版</el-radio>
            <el-radio label="vertical">竖版</el-radio>
          </el-radio-group>
        </div>
        <p v-if="!publishedAt" class="tm-publish-tip">暂无已生成课表，请先在排课管理点击“生成课表”。</p>
        <el-table
          v-if="timetableType === '学校课表' && schoolLayout === 'horizontal'"
          :data="schoolRows"
          row-key="classId"
          border
          class="tm-table"
        >
          <el-table-column prop="className" label="班级" width="140" />
          <el-table-column v-if="optionEnabled('headTeacher')" prop="headTeacherName" label="班主任" width="140" />
          <el-table-column v-for="day in schoolDays" :key="`school-${day}`" :label="day">
            <el-table-column
              v-for="period in schoolPeriods"
              :key="`school-${day}-${period.period}`"
              :label="period.label"
              min-width="120"
            >
              <template #default="{ row }">
                <div class="tm-lesson-cell">
                  <span>{{ schoolCellText(row.classId, day, period.period) }}</span>
                </div>
              </template>
            </el-table-column>
          </el-table-column>
        </el-table>
        <el-table
          v-else-if="timetableType === '学校课表' && schoolLayout === 'vertical'"
          :data="schoolVerticalRows"
          row-key="key"
          border
          class="tm-table"
          :span-method="schoolVerticalSpanMethod"
        >
          <el-table-column prop="day" label="周次" width="98" />
          <el-table-column prop="period" label="节次" width="84" />
          <el-table-column v-for="row in schoolRows" :key="`v-${row.classId}`" :label="row.className" min-width="128">
            <template #default="{ row: dataRow }">
              <div class="tm-lesson-cell">
                <span>{{ schoolVerticalCellText(dataRow, row.classId) }}</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <el-table v-else :data="displayedTimetableRows" row-key="key" border class="tm-table" :span-method="timetableSpanMethod">
          <el-table-column prop="label" label="节次" width="78">
            <template #default="{ row }">
              <span :class="{ 'tm-break-label': row.isSpecial }">{{ optionSettings.periodTime ? row.label : '' }}</span>
            </template>
          </el-table-column>
          <el-table-column v-for="day in days" :key="day" :label="day" min-width="140">
            <template #default="{ row }">
              <div class="tm-lesson-cell" :class="{ 'is-break': row.isSpecial }">
                <span>{{ rowLessonText(row, day) }}</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </section>

    <el-dialog v-model="exportDialogVisible" title="导出课表设置" width="620px" destroy-on-close>
      <div class="tm-option-group">
        <div class="tm-option-title">导出</div>
        <div class="tm-option-inline">
          <span>年级：</span>
          <el-select v-model="selectedGrade" placeholder="选择年级" class="tm-filter-select">
            <el-option label="全年级" :value="ALL_GRADE_VALUE" />
            <el-option v-for="item in gradeOptions" :key="`export-${item}`" :label="item" :value="item" />
          </el-select>
        </div>
        <div v-if="timetableType !== '学校课表'" class="tm-option-inline">
          <span>课表：</span>
          <el-radio-group v-model="timetableSize">
            <el-radio label="gradeLarge">年级大课表</el-radio>
            <el-radio label="large">大课表</el-radio>
            <el-radio label="small">小课表</el-radio>
          </el-radio-group>
        </div>
        <div v-if="timetableType !== '学校课表'" class="tm-option-inline">
          <span>版型：</span>
          <el-radio-group v-model="exportLayout">
            <el-radio label="periodLeft">节次在左</el-radio>
            <el-radio label="weekLeft">星期在左</el-radio>
          </el-radio-group>
        </div>
        <div v-if="timetableType === '学校课表'" class="tm-option-inline">
          <span>学校课表版型：</span>
          <el-radio-group v-model="schoolLayout">
            <el-radio label="horizontal">横版</el-radio>
            <el-radio label="vertical">竖版</el-radio>
          </el-radio-group>
        </div>
      </div>
      <template #footer>
        <el-button @click="exportDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmExportExcel">导出 Excel</el-button>
      </template>
    </el-dialog>
  </article>
</template>
