<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { TableInstance } from 'element-plus'
import * as XLSX from 'xlsx'
import { basicDataRepository } from '../../services/basicDataRepository'
import { loadWorkbenchPersistSnapshot, saveWorkbenchPersistSnapshot } from '../../services/scheduleStateRepository'
import { notify } from '../../utils/notify'

type BaseMenu = {
  key: string
  label: string
  status: 'done' | 'pending' | 'required' | 'none'
}

type BaseGroup = {
  key: string
  label: string
  children: BaseMenu[]
}

type Campus = {
  id: string
  schoolName: string
  name: string
  system: boolean
  educationSystem: '小学' | '初中' | '九年一贯制'
}

type SemesterItem = {
  name: string
  startDate: string
  endDate: string
}

type SchoolYear = {
  id: string
  yearName: string
  yearStartDate: string
  yearEndDate: string
  semesters: SemesterItem[]
}

type TeachingCycle = {
  id: string
  orderNo: number
  cycleName: string
  weekRange: string
  dateRange: string
}

type CourseScope = '小学' | '初中'

type CourseItem = {
  id: string
  name: string
  shortName: string
  subject: string
  scopes: CourseScope[]
  campusId: string
}

type TeacherRecord = {
  id: string
  name: string
  subject: string
  subjectGroup: string
  campusId: string
}

type GroupRecord = {
  id: string
  name: string
  type: '教研与活动分组' | '学科组' | '会议组' | '协作组'
  campusId: string
  memberNames: string[]
  remark: string
}

type TeachingAssignmentRecord = {
  id: string
  campusId: string
  grade: string
  classId: string
  teacherId: string
  courseId: string
  weeklyLessons: number
}

type TeacherRecordView = TeacherRecord & {
  subject: string
  subjectGroup: string
}

type RoomTypeRecord = {
  id: string
  name: string
  system: boolean
}

type RoomRecord = {
  id: string
  roomName: string
  roomTypeId: string
  campusId: string
  buildingName: string
  floorNo: number
  capacity: number
}

type ClassRoomMapRecord = {
  classId: string
  roomId: string
}

type StudentRecord = {
  id: string
  campusId: string
  grade: string
  classId: string
  name: string
  gender: '男' | '女'
  classStudentNo: number
}

type ClassRecord = {
  id: string
  campusId: string
  stage: '小学' | '初中'
  grade: string
  classNo: number
  className: string
  headTeacherId?: string
}

type ClassHourRow = {
  id: string
  campusId: string
  grade: string
  weeklyDays: number
  morningStudy: number
  morningLessons: number
  afternoonLessons: number
  eveningStudy: number
  breakSlot: string
}

type ClassHourClassRow = {
  id: string
  campusId: string
  grade: string
  classId: string
  className: string
  weeklyDays: number
  morningStudy: number
  morningLessons: number
  afternoonLessons: number
  eveningStudy: number
  breakSlot: string
}

type ArrangementRow = {
  id: string
  className: string
  grade: string
  values: Record<string, number | null>
}

type SemesterTableRow = {
  yearId: string
  yearName: string
  yearStartDate: string
  yearEndDate: string
  semesterName: string
  semesterStartDate: string
  semesterEndDate: string
  _isCurrentYear: boolean
  _semesterIndex: number
  _semesterCount: number
  _yearRef: SchoolYear
}

type TermOption = {
  value: string
  label: string
  yearId: string
  semesterName: string
  startDate: string
  endDate: string
}

type ArrangementScopeState = {
  rows: ArrangementRow[]
  batchValues: Record<string, number | null>
}

type ClassHoursBatchDraft = {
  weeklyDays: number | null
  morningStudy: number | null
  morningLessons: number | null
  afternoonLessons: number | null
  eveningStudy: number | null
  breakSlot: string | null
}

type BasicDataSnapshot = {
  campuses: Campus[]
  schoolYears: SchoolYear[]
  teachingCycles: TeachingCycle[]
  courses: CourseItem[]
  roomTypes: RoomTypeRecord[]
  roomRecords: RoomRecord[]
  classRoomMappings: ClassRoomMapRecord[]
  teacherRecords: TeacherRecord[]
  studentRecords: StudentRecord[]
  groupRecords: GroupRecord[]
  teachingAssignments: TeachingAssignmentRecord[]
  classRecords: ClassRecord[]
  classHourRows: ClassHourRow[]
  classHourClassRows: ClassHourClassRow[]
  selectedTerm: string
  selectedHoursCampusId: string
  selectedHoursEducationSystem: Campus['educationSystem']
  arrangementCampusId: string
  arrangementGrade: string
  arrangementRows: ArrangementRow[]
  arrangementBatchValues: Record<string, number | null>
  arrangementScopes: Record<string, ArrangementScopeState>
  classHoursBatchDrafts?: Record<string, ClassHoursBatchDraft>
  _savedAt?: number
}

const groups: BaseGroup[] = [
  {
    key: 'school',
    label: '学校信息',
    children: [
      { key: 'campus', label: '校区设置', status: 'required' },
      { key: 'semester', label: '学年学期', status: 'done' }
    ]
  },
  {
    key: 'teaching',
    label: '教学信息',
    children: [
      { key: 'lesson-cycle', label: '教学周期', status: 'done' },
      { key: 'course-manage', label: '课程管理', status: 'done' },
      { key: 'class-setting', label: '班级设置', status: 'done' },
      { key: 'class-hours', label: '班级课时', status: 'done' },
      { key: 'time-slot', label: '课程安排', status: 'pending' }
    ]
  },
  {
    key: 'people',
    label: '师生信息',
    children: [
      { key: 'group-manage', label: '教研与活动分组', status: 'done' },
      { key: 'teacher-entry', label: '录入教师', status: 'done' },
      { key: 'teaching-info', label: '任课信息', status: 'done' },
      { key: 'student-entry', label: '录入学生', status: 'done' }
    ]
  },
  {
    key: 'classroom',
    label: '教室信息',
    children: [
      { key: 'room-type', label: '教室类型', status: 'done' },
      { key: 'room-entry', label: '录入教室', status: 'done' },
      { key: 'classroom-map', label: '班级教室', status: 'done' }
    ]
  }
]

const activeMenu = ref('campus')

const campuses = ref<Campus[]>([])

const schoolYears = ref<SchoolYear[]>([
  {
    id: '2018-2019',
    yearName: '2018-2019学年',
    yearStartDate: '2018-08-15',
    yearEndDate: '2019-09-15',
    semesters: [
      { name: '第一学期', startDate: '2018-08-15', endDate: '2019-02-10' },
      { name: '第二学期', startDate: '2019-02-14', endDate: '2019-09-15' }
    ]
  },
  {
    id: '2019-2020',
    yearName: '2019-2020学年',
    yearStartDate: '2019-09-16',
    yearEndDate: '2020-08-14',
    semesters: [
      { name: '第一学期', startDate: '2019-09-16', endDate: '2020-02-15' },
      { name: '第二学期', startDate: '2020-02-16', endDate: '2020-08-14' }
    ]
  },
  {
    id: '2020-2021',
    yearName: '2020-2021学年',
    yearStartDate: '2020-08-15',
    yearEndDate: '2021-08-14',
    semesters: [
      { name: '第一学期', startDate: '2020-08-15', endDate: '2021-02-21' },
      { name: '第二学期', startDate: '2021-02-22', endDate: '2021-08-14' }
    ]
  },
  {
    id: '2021-2022',
    yearName: '2021-2022学年',
    yearStartDate: '2021-08-15',
    yearEndDate: '2022-08-14',
    semesters: [
      { name: '第一学期', startDate: '2021-08-15', endDate: '2022-02-14' },
      { name: '第二学期', startDate: '2022-02-15', endDate: '2022-08-14' }
    ]
  },
  {
    id: '2022-2023',
    yearName: '2022-2023学年',
    yearStartDate: '2022-08-15',
    yearEndDate: '2023-08-15',
    semesters: [
      { name: '第一学期', startDate: '2022-08-15', endDate: '2023-01-31' },
      { name: '第二学期', startDate: '2023-02-01', endDate: '2023-08-15' }
    ]
  },
  {
    id: '2023-2024',
    yearName: '2023-2024学年',
    yearStartDate: '2023-08-16',
    yearEndDate: '2024-08-14',
    semesters: [
      { name: '第一学期', startDate: '2023-08-16', endDate: '2024-02-20' },
      { name: '第二学期', startDate: '2024-02-21', endDate: '2024-08-14' }
    ]
  }
])

const TARGET_SCHOOL_YEAR_START = 2027
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_SUBJECT_GROUP_MAP: Record<string, string> = {
  语文: '语文组',
  阅读: '语文组',
  数学: '数学组',
  英语: '英语组',
  英语外教: '英语组',
  物理: '物理组',
  物理非高考: '物理组',
  物理高考: '物理组',
  化学: '化学组',
  化学高考: '化学组',
  生物: '生物组',
  历史: '历史组',
  政治: '政治组',
  地理: '地理组',
  地理高考: '地理组',
  音乐: '音乐组',
  体育: '体育组',
  美术: '美术组',
  信息技术: '信息组',
  通用技术: '技术组',
  班会: '班主任组',
  自习: '行政组'
}
const AVAILABLE_COURSE_SCOPES: CourseScope[] = ['小学', '初中']
const REQUIRED_DEFAULT_COURSE_NAMES = ['语文', '数学', '英语', '科学', '道德与法治', '美术', '音乐', '体育', '劳动']
const LEGACY_REMOVED_COURSE_NAMES = new Set(['班会', '阅读', '自习', '英语外教', '物理非高考', '物理高考'])
const COURSE_COLUMNS = ['课程名称', '课程简称', '所属学科', '应用范围', '所属校区']
const DEFAULT_REQUIRED_SCOPE: CourseScope = '小学'
const EDUCATION_SYSTEM_OPTIONS: Campus['educationSystem'][] = ['小学', '初中', '九年一贯制']

function getDefaultSubjectGroup(subject: string): string {
  const key = subject.trim()
  if (!key) return '未分组'
  const mapped = DEFAULT_SUBJECT_GROUP_MAP[key] ?? `${key}组`
  return /教研组$/.test(mapped) ? mapped : mapped.replace(/组$/, '教研组')
}

function isLegacyTeacherId(id: string): boolean {
  const value = id.trim()
  if (!value) return true
  return /^t-(mock|import|quick)-/i.test(value) || /^t-\d+$/i.test(value)
}

function generateNextTeacherId(existingIds: string[]): string {
  const used = new Set(existingIds.map((item) => item.trim()).filter(Boolean))
  let next = 1
  existingIds.forEach((id) => {
    const matched = id.trim().match(/^T0*(\d+)$/i)
    if (!matched) return
    const num = Number(matched[1])
    if (Number.isFinite(num) && num >= next) {
      next = num + 1
    }
  })

  while (true) {
    const candidate = `T${next}`
    if (!used.has(candidate)) {
      return candidate
    }
    next += 1
  }
}

function buildNormalizedTeacherState(list: TeacherRecord[]): {
  records: TeacherRecord[]
  idMap: Map<string, string>
} {
  const used = new Set<string>()
  const idMap = new Map<string, string>()
  const draft: TeacherRecord[] = []

  list.forEach((item) => {
    const rawId = (item.id ?? '').trim()
    const canonicalMatch = rawId.match(/^T0*(\d+)$/i)
    if (!canonicalMatch || isLegacyTeacherId(rawId)) return
    const num = Number(canonicalMatch[1])
    if (!Number.isFinite(num) || num <= 0) return
    const id = `T${num}`
    if (used.has(id)) return
    used.add(id)
    idMap.set(rawId, id)
    draft.push({
      ...item,
      id,
      subjectGroup: item.subjectGroup?.trim() || getDefaultSubjectGroup(item.subject)
    })
  })

  list.forEach((item) => {
    const rawId = (item.id ?? '').trim()
    if (!rawId) return
    const canonicalMatch = rawId.match(/^T0*(\d+)$/i)
    if (canonicalMatch || isLegacyTeacherId(rawId)) return
    if (used.has(rawId)) return
    used.add(rawId)
    idMap.set(rawId, rawId)
    draft.push({
      ...item,
      id: rawId,
      subjectGroup: item.subjectGroup?.trim() || getDefaultSubjectGroup(item.subject)
    })
  })

  list.forEach((item) => {
    const matched = (item.id ?? '').trim().match(/^T0*(\d+)$/i)
    if (!matched) return
    const num = Number(matched[1])
    if (Number.isFinite(num) && num > 0) {
      used.add(`T${num}`)
    }
  })

  list.forEach((item) => {
    const rawId = (item.id ?? '').trim()
    if (idMap.has(rawId)) return
    const id = generateNextTeacherId(Array.from(used))
    used.add(id)
    idMap.set(rawId, id)
    draft.push({
      ...item,
      id,
      subjectGroup: item.subjectGroup?.trim() || getDefaultSubjectGroup(item.subject)
    })
  })

  return { records: draft, idMap }
}

function normalizeTeacherRecords(list: TeacherRecord[]): TeacherRecord[] {
  return buildNormalizedTeacherState(list).records
}

function normalizeRoomTypeRecords(list: RoomTypeRecord[]): RoomTypeRecord[] {
  const cleaned = list
    .map((item) => ({
      id: String(item.id ?? '').trim() || `room-type-${Date.now()}`,
      name: String(item.name ?? '').trim(),
      system: Boolean(item.system)
    }))
    .filter((item) => item.name)

  const nameSet = new Set<string>()
  const unique = cleaned.filter((item) => {
    if (nameSet.has(item.name)) return false
    nameSet.add(item.name)
    return true
  })

  if (!unique.some((item) => item.name === '普通教室')) {
    unique.unshift({
      id: 'room-type-default',
      name: '普通教室',
      system: true
    })
  } else {
    unique.forEach((item) => {
      if (item.name === '普通教室') {
        item.system = true
      }
    })
  }

  return unique
}

function normalizeRoomRecords(list: RoomRecord[], roomTypeList: RoomTypeRecord[], campusList: Campus[]): RoomRecord[] {
  const roomTypeIds = new Set(roomTypeList.map((item) => item.id))
  const fallbackRoomTypeId = roomTypeList[0]?.id ?? ''
  const campusIds = new Set(campusList.map((item) => item.id))
  const fallbackCampusId = campusList[0]?.id ?? ''

  return list
    .map((item) => {
      const roomName = String(item.roomName ?? '').trim()
      if (!roomName) return null
      const floorNo = Number(item.floorNo)
      const capacity = Number(item.capacity)
      const campusId = campusIds.has(item.campusId) ? item.campusId : fallbackCampusId
      const roomTypeId = roomTypeIds.has(item.roomTypeId) ? item.roomTypeId : fallbackRoomTypeId
      if (!campusId || !roomTypeId) return null
      return {
        id: String(item.id ?? '').trim() || `room-${Date.now()}`,
        roomName,
        roomTypeId,
        campusId,
        buildingName: String(item.buildingName ?? '').trim() || '教学楼',
        floorNo: Number.isFinite(floorNo) && floorNo > 0 ? Math.floor(floorNo) : 1,
        capacity: Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 40
      } as RoomRecord
    })
    .filter((item): item is RoomRecord => Boolean(item))
}

function normalizeClassRoomMappings(
  list: Array<ClassRoomMapRecord | { classId: string; roomTypeId?: string; roomId?: string }>,
  classList: ClassRecord[],
  roomList: RoomRecord[]
): ClassRoomMapRecord[] {
  const classIds = new Set(classList.map((item) => item.id))
  const classById = new Map(classList.map((item) => [item.id, item] as const))
  const roomById = new Map(roomList.map((item) => [item.id, item] as const))
  const existing = new Map<string, string>()

  list.forEach((item) => {
    if (!classIds.has(item.classId)) return
    let roomId = ''

    if ('roomId' in item && item.roomId && roomById.has(item.roomId)) {
      roomId = item.roomId
    } else if ('roomTypeId' in item && item.roomTypeId) {
      const classInfo = classById.get(item.classId)
      if (!classInfo) return
      roomId =
        roomList.find((room) => room.campusId === classInfo.campusId && room.roomTypeId === item.roomTypeId)?.id ??
        roomList.find((room) => room.roomTypeId === item.roomTypeId)?.id ??
        ''
    }

    if (!roomId) return
    existing.set(item.classId, roomId)
  })

  return Array.from(existing.entries()).map(([classId, roomId]) => ({ classId, roomId }))
}

function generateStudentId(existingIds: string[]): string {
  const used = new Set(existingIds.map((item) => item.trim()).filter(Boolean))
  for (let i = 0; i < 2000; i += 1) {
    const digits = Math.floor(10000000 + Math.random() * 90000000)
    const candidate = `stu${digits}`
    if (!used.has(candidate)) {
      return candidate
    }
  }
  return `stu${Date.now().toString().slice(-8)}`
}

function normalizeStudentRecords(list: StudentRecord[], classes: ClassRecord[]): StudentRecord[] {
  const classMap = new Map(classes.map((item) => [item.id, item] as const))
  const allocatedIds: string[] = []
  return list
    .map((item) => {
      const classInfo = classMap.get(item.classId)
      if (!classInfo) return null
      const name = String(item.name ?? '').trim()
      if (!name) return null
      const numericNo = Number(item.classStudentNo)
      const classStudentNo = Number.isFinite(numericNo) && numericNo > 0 ? Math.floor(numericNo) : 1
      let id = (item.id ?? '').trim()
      if (!id || allocatedIds.includes(id)) {
        id = generateStudentId(allocatedIds)
      }
      allocatedIds.push(id)
      return {
        id,
        campusId: classInfo.campusId,
        grade: classInfo.grade,
        classId: classInfo.id,
        name,
        gender: item.gender === '女' ? '女' : '男',
        classStudentNo
      } as StudentRecord
    })
    .filter((item): item is StudentRecord => Boolean(item))
}

function normalizeGroupRecords(list: GroupRecord[]): GroupRecord[] {
  const seen = new Set<string>()
  return list
    .map((item) => {
      const name = String(item.name ?? '').trim()
      if (!name) return null
      const campusId = String(item.campusId ?? '').trim()
      if (!campusId) return null
      const type = item.type === '学科组' ? '教研与活动分组' : item.type
      const memberNames = Array.from(
        new Set(
          (Array.isArray(item.memberNames) ? item.memberNames : [])
            .map((member) => String(member ?? '').trim())
            .filter(Boolean)
        )
      )
      const key = `${campusId}::${type}::${name}`
      if (seen.has(key)) return null
      seen.add(key)
      return {
        ...item,
        name,
        campusId,
        type,
        memberNames
      } as GroupRecord
    })
    .filter((item): item is GroupRecord => Boolean(item))
}

function groupRecordKey(record: Pick<GroupRecord, 'campusId' | 'type' | 'name'>): string {
  return `${record.campusId}::${record.type}::${record.name}`
}

function syncActivityGroupsFromRealData(): void {
  const normalizedCurrent = normalizeGroupRecords(groupRecords.value)
  const currentMap = new Map(normalizedCurrent.map((item) => [groupRecordKey(item), item] as const))
  const teacherNameById = new Map(teacherRecords.value.map((item) => [item.id, item.name] as const))
  const courseSubjectById = new Map(courses.value.map((item) => [item.id, (item.name || item.subject || '').trim()] as const))
  const campusIds = campuses.value.map((item) => item.id).filter(Boolean)
  const subjectSet = new Set(
    courses.value
      .map((item) => (item.name || item.subject || '').trim())
      .filter(Boolean)
  )

  const generatedKeys = new Set<string>()
  const generated: GroupRecord[] = []

  campusIds.forEach((campusId) => {
    subjectSet.forEach((subject) => {
      const groupName = getDefaultSubjectGroup(subject)
      const key = groupRecordKey({ campusId, type: '教研与活动分组', name: groupName })
      generatedKeys.add(key)
      const previous = currentMap.get(key)
      const members = Array.from(
        new Set(
          teachingAssignments.value
            .filter((item) => item.campusId === campusId)
            .filter((item) => courseSubjectById.get(item.courseId) === subject)
            .map((item) => teacherNameById.get(item.teacherId) || '')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      )
      generated.push({
        id: previous?.id || `group-auto-${campusId}-${subject}`,
        name: groupName,
        type: '教研与活动分组',
        campusId,
        memberNames: members,
        remark: previous?.remark || ''
      })
    })
  })

  const manualGroups = normalizedCurrent.filter((item) => {
    if (item.type !== '教研与活动分组') return true
    return !generatedKeys.has(groupRecordKey(item))
  })

  const merged = normalizeGroupRecords([...manualGroups, ...generated])
  const currentSignature = JSON.stringify(normalizedCurrent)
  const nextSignature = JSON.stringify(merged)
  if (currentSignature !== nextSignature) {
    groupRecords.value = merged
  }
}

function normalizeCampuses(list: Campus[]): Campus[] {
  return list
    .map((item) => {
      const raw = (item as Campus & { educationSystem?: string }).educationSystem
      const educationSystem = EDUCATION_SYSTEM_OPTIONS.includes(raw as Campus['educationSystem'])
        ? (raw as Campus['educationSystem'])
        : '九年一贯制'
      const schoolName = ((item as Campus & { schoolName?: string }).schoolName ?? '').trim() || '本校'
      return {
        ...item,
        schoolName,
        educationSystem
      }
    })
    .filter((item) => {
      return !item.system
    })
}

function normalizeCourseRecords(list: CourseItem[]): CourseItem[] {
  return list
    .filter((item) => !item.name.includes('高考'))
    .filter((item) => !LEGACY_REMOVED_COURSE_NAMES.has(item.name))
    .map((item) => {
      const scopes = item.scopes.filter((scope): scope is CourseScope =>
        AVAILABLE_COURSE_SCOPES.includes(scope as CourseScope)
      )
      const singleScope = scopes[0] ?? DEFAULT_REQUIRED_SCOPE
      return {
        ...item,
        scopes: [singleScope],
        campusId: String((item as CourseItem & { campusId?: string }).campusId ?? '').trim()
      }
    })
}

function parseSchoolYearStart(value: string): number | null {
  const matched = value.match(/^(\d{4})-\d{4}(学年)?$/)
  if (!matched) return null
  return Number(matched[1])
}

function buildSchoolYearByStart(startYear: number): SchoolYear {
  const endYear = startYear + 1
  return {
    id: `${startYear}-${endYear}`,
    yearName: `${startYear}-${endYear}学年`,
    yearStartDate: `${startYear}-08-16`,
    yearEndDate: `${endYear}-08-14`,
    semesters: [
      { name: '第一学期', startDate: `${startYear}-08-16`, endDate: `${endYear}-02-20` },
      { name: '第二学期', startDate: `${endYear}-02-21`, endDate: `${endYear}-08-14` }
    ]
  }
}

function ensureSchoolYearsToTarget(list: SchoolYear[]): SchoolYear[] {
  if (list.length === 0) {
    return [buildSchoolYearByStart(TARGET_SCHOOL_YEAR_START)]
  }

  const sorted = [...list].sort((a, b) => {
    const aStart = parseSchoolYearStart(a.yearName) ?? parseSchoolYearStart(a.id) ?? 0
    const bStart = parseSchoolYearStart(b.yearName) ?? parseSchoolYearStart(b.id) ?? 0
    return aStart - bStart
  })

  let maxStart =
    parseSchoolYearStart(sorted[sorted.length - 1].yearName) ??
    parseSchoolYearStart(sorted[sorted.length - 1].id) ??
    TARGET_SCHOOL_YEAR_START
  const result = [...sorted]

  while (maxStart < TARGET_SCHOOL_YEAR_START) {
    maxStart += 1
    result.push(buildSchoolYearByStart(maxStart))
  }

  return result
}

function formatTodayDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isDateWithinRange(target: string, start: string, end: string): boolean {
  if (!DATE_REGEX.test(target) || !DATE_REGEX.test(start) || !DATE_REGEX.test(end)) {
    return false
  }
  return target >= start && target <= end
}

schoolYears.value = ensureSchoolYearsToTarget(schoolYears.value)

const termOptions = computed<TermOption[]>(() =>
  schoolYears.value
    .flatMap((year) =>
      year.semesters.map((semester) => ({
        value: `${year.id}-${semester.name}`,
        label: `${year.id}${semester.name}`,
        yearId: year.id,
        semesterName: semester.name,
        startDate: semester.startDate,
        endDate: semester.endDate
      }))
    )
    .sort((a, b) => {
      if (a.startDate === b.startDate) return a.endDate.localeCompare(b.endDate)
      return a.startDate.localeCompare(b.startDate)
    })
)
const selectedTerm = ref('')
const selectedTermOption = computed(() => termOptions.value.find((item) => item.value === selectedTerm.value) ?? null)

function getCurrentOrFirstTermValue(): string {
  const today = formatTodayDate()
  const current = termOptions.value.find((item) => isDateWithinRange(today, item.startDate, item.endDate))
  if (current) return current.value
  return termOptions.value[0]?.value ?? ''
}

watch(
  termOptions,
  (items) => {
    if (items.length === 0) {
      selectedTerm.value = ''
      return
    }
    const valid = items.some((item) => item.value === selectedTerm.value)
    if (!valid) {
      selectedTerm.value = getCurrentOrFirstTermValue()
    }
  },
  { immediate: true }
)

const teachingCycles = computed<TeachingCycle[]>(() => {
  const term = selectedTermOption.value
  if (!term) return []
  const weekCount = calculateWeekCountByDateRange(term.startDate, term.endDate) ?? 1
  return [
    {
      id: `${term.value}-cycle`,
      orderNo: 1,
      cycleName: `1-${weekCount}周`,
      weekRange: `1-${weekCount}`,
      dateRange: `${term.startDate} 至 ${term.endDate}`
    }
  ]
})

const courseTab = ref<'全部' | CourseScope>('小学')
const courseCampusId = ref('__all__')
const courseKeyword = ref('')
const courseTableRef = ref<TableInstance | null>(null)
const selectedCourseIds = ref<string[]>([])
const classTableRef = ref<TableInstance | null>(null)
const selectedClassIds = ref<string[]>([])
const enabledCourseScopes = computed<CourseScope[]>(() => {
  const set = new Set<CourseScope>()
  campuses.value.forEach((campus) => {
    if (campus.educationSystem === '小学' || campus.educationSystem === '九年一贯制') {
      set.add('小学')
    }
    if (campus.educationSystem === '初中' || campus.educationSystem === '九年一贯制') {
      set.add('初中')
    }
  })
  if (set.size === 0) {
    courses.value.forEach((course) => {
      course.scopes.forEach((scope) => {
        if (scope === '小学' || scope === '初中') {
          set.add(scope)
        }
      })
    })
  }
  if (set.size === 0) {
    set.add(DEFAULT_REQUIRED_SCOPE)
  }
  return AVAILABLE_COURSE_SCOPES.filter((scope) => set.has(scope))
})
const courseTabs = computed<Array<'全部' | CourseScope>>(() => ['全部', ...enabledCourseScopes.value])
const courseCampusOptions = computed(() => campuses.value.map((item) => ({ id: item.id, name: item.name })))
const courses = ref<CourseItem[]>(
  normalizeCourseRecords(
    REQUIRED_DEFAULT_COURSE_NAMES.map((name, index) => ({
      id: `${index + 1}`,
      name,
      shortName: '',
      subject: name,
      scopes: [DEFAULT_REQUIRED_SCOPE],
      campusId: ''
    }))
  )
)

const roomTypes = ref<RoomTypeRecord[]>([
  {
    id: 'room-type-default',
    name: '普通教室',
    system: true
  }
])

const roomRecords = ref<RoomRecord[]>([])
const classRoomMappings = ref<ClassRoomMapRecord[]>([])

const teacherRecords = ref<TeacherRecord[]>([
  {
    id: 'T1',
    name: '陈雄鹰',
    subject: '语文',
    subjectGroup: '语文组',
    campusId: '1'
  },
  {
    id: 'T2',
    name: '张明勇',
    subject: '数学',
    subjectGroup: '数学组',
    campusId: '1'
  },
  {
    id: 'T3',
    name: '薛亚玲',
    subject: '英语',
    subjectGroup: '英语组',
    campusId: '1'
  }
])

const studentRecords = ref<StudentRecord[]>([])

const groupRecords = ref<GroupRecord[]>([])

const teachingAssignments = ref<TeachingAssignmentRecord[]>([])
const teachingInfoDirty = ref(false)

watch(
  courseTabs,
  (tabs) => {
    if (tabs.length <= 0) {
      courseTab.value = '全部'
      return
    }
    if (!tabs.includes(courseTab.value)) {
      courseTab.value = tabs[0] ?? '全部'
    }
  },
  { immediate: true }
)

watch(
  () => courseTab.value,
  async () => {
    selectedCourseIds.value = []
    await nextTick()
    courseTableRef.value?.clearSelection()
  }
)

watch(
  () => courseCampusId.value,
  async () => {
    selectedCourseIds.value = []
    await nextTick()
    courseTableRef.value?.clearSelection()
  }
)

watch(
  campuses,
  (items) => {
    if (courseCampusId.value === '__all__') return
    if (!items.some((item) => item.id === courseCampusId.value)) {
      courseCampusId.value = '__all__'
    }
  },
  { deep: true, immediate: true }
)

function normalizeCourseScopeInput(input: string): CourseScope {
  const trimmed = input.trim()
  if (enabledCourseScopes.value.includes(trimmed as CourseScope)) {
    return trimmed as CourseScope
  }
  return enabledCourseScopes.value[0] ?? DEFAULT_REQUIRED_SCOPE
}

function isCourseVisibleInCampus(course: CourseItem, campusId: string): boolean {
  if (!campusId || campusId === '__all__') return true
  return !course.campusId || course.campusId === campusId
}

const filteredCourses = computed(() => {
  const byCampus = courses.value.filter((item) => isCourseVisibleInCampus(item, courseCampusId.value))
  const byScope = courseTab.value === '全部' ? byCampus : byCampus.filter((item) => item.scopes.includes(courseTab.value))
  const keyword = courseKeyword.value.trim().toLowerCase()
  if (!keyword) return byScope
  const campusNameMap = new Map(campuses.value.map((item) => [item.id, item.name] as const))
  return byScope.filter((item) => {
    const campusName = item.campusId ? (campusNameMap.get(item.campusId) ?? item.campusId) : '全部校区'
    return [item.name, item.shortName, item.subject, campusName].join(' ').toLowerCase().includes(keyword)
  })
})
const filteredCourseIndexMap = computed(() => {
  return Object.fromEntries(filteredCourses.value.map((item, index) => [item.id, index + 1]))
})
const selectedCourseCount = computed(() => selectedCourseIds.value.length)
const selectedClassCount = computed(() => selectedClassIds.value.length)
const courseDialogVisible = ref(false)
const courseDialogMode = ref<'create' | 'edit'>('create')
const courseDialogError = ref('')
const courseEditingId = ref('')
const courseForm = reactive<{
  name: string
  shortName: string
  subject: string
  scope: CourseScope
  campusId: string
}>({
  name: '',
  shortName: '',
  subject: '',
  scope: DEFAULT_REQUIRED_SCOPE,
  campusId: ''
})
const courseSubjectOptions = computed(() =>
  Array.from(
    new Set(
      courses.value
        .map((item) => (item.subject || item.name || '').trim())
        .filter(Boolean)
    )
  )
)

const hourDayOptions = [0, 5, 6, 7]
const hourCountOptions = [0, 1, 2, 3, 4, 5]
const breakSlotOptions = ['', '上午第2节课后', '上午第3节课后', '下午第2节课后']
const selectedHoursCampusId = ref('')
const selectedHoursEducationSystem = ref<Campus['educationSystem']>('九年一贯制')
const resetGradeTarget = ref('__all__')
const classHoursResetDialogVisible = ref(false)
const classHoursResetFinalVisible = ref(false)
const arrangementResetDialogVisible = ref(false)
const arrangementResetFinalVisible = ref(false)

function createDefaultClassHourRow(campusId: string, grade: string): ClassHourRow {
  return {
    id: `${campusId}-${grade}`,
    campusId,
    grade,
    weeklyDays: 0,
    morningStudy: 0,
    morningLessons: 0,
    afternoonLessons: 0,
    eveningStudy: 0,
    breakSlot: ''
  }
}

function normalizeClassHourRows(
  list: ClassHourRow[],
  fallbackCampusId: string,
  allowedCampusIds: Set<string>
): ClassHourRow[] {
  return list
    .map((item) => {
      const rawCampus = (item as ClassHourRow & { campusId?: string }).campusId ?? ''
      const campusId = rawCampus || fallbackCampusId
      return {
        ...item,
        campusId,
        id: item.id || `${campusId}-${item.grade}`
      }
    })
    .filter((item) => allowedCampusIds.has(item.campusId))
}

const classHourRows = ref<ClassHourRow[]>([])
const classHourClassRows = ref<ClassHourClassRow[]>([])

const classRecords = ref<ClassRecord[]>([])

const gradeOrderMap: Record<string, number> = {
  一年级: 1,
  二年级: 2,
  三年级: 3,
  四年级: 4,
  五年级: 5,
  六年级: 6,
  七年级: 7,
  八年级: 8,
  九年级: 9
}

const currentClassHourRows = computed(() =>
  classHourRows.value
    .filter(
      (item) =>
        item.campusId === selectedHoursCampusId.value &&
        isGradeInEducationSystem(item.grade, selectedHoursEducationSystem.value)
    )
    .sort((a, b) => (gradeOrderMap[a.grade] ?? 999) - (gradeOrderMap[b.grade] ?? 999))
)

const classHourResetGradeOptions = computed(() => currentClassHourRows.value.map((item) => item.grade))
const resetGradeTargetLabel = computed(() =>
  resetGradeTarget.value === '__all__' ? '全部年级' : resetGradeTarget.value
)
const classHoursBatchStore = ref<Record<string, ClassHoursBatchDraft>>({})
const createEmptyClassHoursBatchDraft = (): ClassHoursBatchDraft => ({
  weeklyDays: null,
  morningStudy: null,
  morningLessons: null,
  afternoonLessons: null,
  eveningStudy: null,
  breakSlot: null
})
const classHoursBatchForm = reactive<ClassHoursBatchDraft>(createEmptyClassHoursBatchDraft())

function getClassHoursBatchKey(campusId: string, educationSystem: Campus['educationSystem']): string {
  return `${campusId}::${educationSystem}`
}

function applyClassHoursBatchDraftToForm(draft: ClassHoursBatchDraft | null | undefined): void {
  if (!draft) {
    Object.assign(classHoursBatchForm, createEmptyClassHoursBatchDraft())
    return
  }
  classHoursBatchForm.weeklyDays = typeof draft.weeklyDays === 'number' ? draft.weeklyDays : null
  classHoursBatchForm.morningStudy = typeof draft.morningStudy === 'number' ? draft.morningStudy : null
  classHoursBatchForm.morningLessons = typeof draft.morningLessons === 'number' ? draft.morningLessons : null
  classHoursBatchForm.afternoonLessons = typeof draft.afternoonLessons === 'number' ? draft.afternoonLessons : null
  classHoursBatchForm.eveningStudy = typeof draft.eveningStudy === 'number' ? draft.eveningStudy : null
  classHoursBatchForm.breakSlot = typeof draft.breakSlot === 'string' ? draft.breakSlot : null
}

function isClassHoursBatchFormReady(): boolean {
  return (
    classHoursBatchForm.weeklyDays !== null &&
    classHoursBatchForm.morningStudy !== null &&
    classHoursBatchForm.morningLessons !== null &&
    classHoursBatchForm.afternoonLessons !== null &&
    classHoursBatchForm.eveningStudy !== null
  )
}

function syncClassHoursBatchFormBySelection(): void {
  if (!selectedHoursCampusId.value) {
    applyClassHoursBatchDraftToForm(null)
    return
  }
  const key = getClassHoursBatchKey(selectedHoursCampusId.value, selectedHoursEducationSystem.value)
  applyClassHoursBatchDraftToForm(classHoursBatchStore.value[key])
}

function rememberClassHoursBatchDraft(): void {
  if (!selectedHoursCampusId.value) return
  const key = getClassHoursBatchKey(selectedHoursCampusId.value, selectedHoursEducationSystem.value)
  if (!isClassHoursBatchFormReady()) {
    const next = { ...classHoursBatchStore.value }
    delete next[key]
    classHoursBatchStore.value = next
    return
  }
  classHoursBatchStore.value = {
    ...classHoursBatchStore.value,
    [key]: {
      weeklyDays: classHoursBatchForm.weeklyDays,
      morningStudy: classHoursBatchForm.morningStudy,
      morningLessons: classHoursBatchForm.morningLessons,
      afternoonLessons: classHoursBatchForm.afternoonLessons,
      eveningStudy: classHoursBatchForm.eveningStudy,
      breakSlot: classHoursBatchForm.breakSlot ?? ''
    }
  }
}

function isGradeInEducationSystem(grade: string, educationSystem: Campus['educationSystem']): boolean {
  if (educationSystem === '九年一贯制') return true
  const order = gradeOrderMap[grade] ?? 999
  if (educationSystem === '小学') return order <= 6
  return order >= 7 && order <= 9
}

function syncClassHourRowsFromClassSettings(): void {
  const allowedCampusIds = new Set(campuses.value.map((item) => item.id))
  if (allowedCampusIds.size === 0) {
    classHourRows.value = []
    classHourClassRows.value = []
    return
  }

  const normalized = normalizeClassHourRows(classHourRows.value, selectedHoursCampusId.value, allowedCampusIds)
  const existingByKey = new Map(normalized.map((item) => [`${item.campusId}::${item.grade}`, item] as const))
  const desiredEntries = Array.from(
    new Map(
      classRecords.value
        .filter((item) => allowedCampusIds.has(item.campusId))
        .map((item) => [`${item.campusId}::${item.grade}`, { campusId: item.campusId, grade: item.grade }] as const)
    ).values()
  )
  const next = desiredEntries
    .map(({ campusId, grade }) => existingByKey.get(`${campusId}::${grade}`) ?? createDefaultClassHourRow(campusId, grade))
    .sort((a, b) => {
      if (a.campusId !== b.campusId) return a.campusId.localeCompare(b.campusId)
      return (gradeOrderMap[a.grade] ?? 999) - (gradeOrderMap[b.grade] ?? 999)
    })

  classHourRows.value = next

  const classIds = new Set(classRecords.value.map((item) => item.id))
  classHourClassRows.value = classHourClassRows.value.filter(
    (item) => allowedCampusIds.has(item.campusId) && classIds.has(item.classId)
  )
}

const arrangementCampusId = ref('')
const arrangementGrade = ref('二年级')
const arrangementMode = ref<'课程课时' | '教室类型'>('课程课时')

const arrangementStage = computed<CourseScope>(() => {
  const matched = classRecords.value.find(
    (item) => item.campusId === arrangementCampusId.value && item.grade === arrangementGrade.value
  )
  if (matched) {
    return matched.stage
  }
  return (gradeOrderMap[arrangementGrade.value] ?? 99) <= 6 ? '小学' : '初中'
})

const arrangementCourses = computed(() =>
  courses.value.filter(
    (item) =>
      item.name !== '自习' &&
      item.scopes.includes(arrangementStage.value) &&
      isCourseVisibleInCampus(item, arrangementCampusId.value)
  )
)

const arrangementGradeOptions = computed(() => {
  const uniqueGrades = Array.from(new Set(classRecords.value.map((item) => item.grade)))
  if (uniqueGrades.length > 0) {
    return uniqueGrades.sort((a, b) => (gradeOrderMap[a] ?? 999) - (gradeOrderMap[b] ?? 999))
  }
  return ['二年级']
})

const arrangementClassNames = computed(() => {
  const fromClassSetting = classRecords.value
    .filter((item) => item.campusId === arrangementCampusId.value && item.grade === arrangementGrade.value)
    .sort((a, b) => a.classNo - b.classNo)
    .map((item) => item.className)

  return fromClassSetting
})

const arrangementHasClasses = computed(() => arrangementClassNames.value.length > 0)

const arrangementRows = ref<ArrangementRow[]>([])
const arrangementBatchValues = ref<Record<string, number | null>>({})
const arrangementScopeStore = ref<Record<string, ArrangementScopeState>>({})
const arrangementScopeKey = computed(() => `${arrangementCampusId.value}::${arrangementGrade.value}`)
const activeArrangementScopeKey = ref('')
const basicDataHydrated = ref(false)

function getArrangementScopeKey(campusId: string, grade: string): string {
  return `${campusId}::${grade}`
}

function cloneArrangementRows(rows: ArrangementRow[]): ArrangementRow[] {
  return rows.map((row) => ({ ...row, values: { ...row.values } }))
}

function cloneArrangementBatchValues(values: Record<string, number | null>): Record<string, number | null> {
  return { ...values }
}

function normalizeArrangementScopeState(
  sourceRows: ArrangementRow[],
  sourceBatchValues: Record<string, number | null>,
  classNames: string[],
  courseList: CourseItem[],
  grade: string
): ArrangementScopeState {
  const previousByClass = new Map(sourceRows.map((row) => [row.className, row.values] as const))
  const rows = classNames.map((className, index) => {
    const previousValues = previousByClass.get(className) ?? {}
    const values = Object.fromEntries(
      courseList.map((course) => [course.id, typeof previousValues[course.id] === 'number' ? previousValues[course.id] : 0])
    )
    return {
      id: `${className}-${index}`,
      className,
      grade,
      values
    }
  })

  const batchValues = Object.fromEntries(
    courseList.map((course) => [course.id, typeof sourceBatchValues[course.id] === 'number' ? sourceBatchValues[course.id] : 0])
  )

  return { rows, batchValues }
}

function applyArrangementScopeByKey(scopeKey: string): void {
  const stored = arrangementScopeStore.value[scopeKey]
  const normalized = normalizeArrangementScopeState(
    stored?.rows ?? [],
    stored?.batchValues ?? {},
    arrangementClassNames.value,
    arrangementCourses.value,
    arrangementGrade.value
  )

  arrangementRows.value = normalized.rows
  arrangementBatchValues.value = normalized.batchValues
  arrangementScopeStore.value = {
    ...arrangementScopeStore.value,
    [scopeKey]: {
      rows: cloneArrangementRows(normalized.rows),
      batchValues: cloneArrangementBatchValues(normalized.batchValues)
    }
  }
  activeArrangementScopeKey.value = scopeKey
}

function persistCurrentArrangementScope(): void {
  const scopeKey = arrangementScopeKey.value
  const normalized = normalizeArrangementScopeState(
    arrangementRows.value,
    arrangementBatchValues.value,
    arrangementClassNames.value,
    arrangementCourses.value,
    arrangementGrade.value
  )

  arrangementRows.value = normalized.rows
  arrangementBatchValues.value = normalized.batchValues
  arrangementScopeStore.value = {
    ...arrangementScopeStore.value,
    [scopeKey]: {
      rows: cloneArrangementRows(normalized.rows),
      batchValues: cloneArrangementBatchValues(normalized.batchValues)
    }
  }
  activeArrangementScopeKey.value = scopeKey
}
const arrangementClassRecordByName = computed(() => {
  const records = classRecords.value.filter(
    (item) => item.campusId === arrangementCampusId.value && item.grade === arrangementGrade.value
  )
  return new Map(records.map((item) => [item.className, item] as const))
})
const arrangementClassHourByClassId = computed(() => {
  const rows = classHourClassRows.value.filter(
    (item) => item.campusId === arrangementCampusId.value && item.grade === arrangementGrade.value
  )
  return new Map(rows.map((item) => [item.classId, item] as const))
})
const arrangementGradeHourRow = computed(() => {
  return (
    classHourRows.value.find(
      (item) => item.campusId === arrangementCampusId.value && item.grade === arrangementGrade.value
    ) ?? null
  )
})

function getClassHourTotalLessons(row: {
  weeklyDays: number
  morningStudy: number
  morningLessons: number
  afternoonLessons: number
  eveningStudy: number
}): number {
  const lessonsPerDay = row.morningStudy + row.morningLessons + row.afternoonLessons + row.eveningStudy
  return row.weeklyDays * lessonsPerDay
}

const arrangementSummary = computed(() => {
  const classCount = arrangementRows.value.length
  const activeCourseIdSet = new Set<string>()
  let estimatedLessons = 0
  arrangementRows.value.forEach((row) => {
    arrangementCourses.value.forEach((course) => {
      const value = Number(row.values[course.id] || 0)
      if (value > 0) activeCourseIdSet.add(course.id)
    })
  })
  const firstRow = arrangementRows.value[0]
  if (firstRow) {
    estimatedLessons = getArrangementTotalByValues(firstRow.values)
  }
  const courseCount = activeCourseIdSet.size
  return { classCount, courseCount, estimatedLessons }
})

const semesterTableRows = computed<SemesterTableRow[]>(() => {
  const today = formatTodayDate()
  return schoolYears.value.flatMap((year) =>
    year.semesters.map((semester, index) => ({
      yearId: year.id,
      yearName: year.yearName,
      yearStartDate: year.yearStartDate,
      yearEndDate: year.yearEndDate,
      semesterName: semester.name,
      semesterStartDate: semester.startDate,
      semesterEndDate: semester.endDate,
      _isCurrentYear: isDateWithinRange(today, year.yearStartDate, year.yearEndDate),
      _semesterIndex: index,
      _semesterCount: year.semesters.length,
      _yearRef: year
    }))
  )
})

const currentSchoolYearLabel = computed(() => {
  const current = semesterTableRows.value.find((row) => row._isCurrentYear)
  if (!current) return ''
  return current.yearName
})

function semesterSpanMethod({ row, columnIndex }: { row: SemesterTableRow; columnIndex: number }): [number, number] {
  if (columnIndex === 0 || columnIndex === 1 || columnIndex === 2 || columnIndex === 6) {
    if (row._semesterIndex === 0) {
      return [row._semesterCount, 1]
    }
    return [0, 0]
  }
  return [1, 1]
}

function semesterRowClassName({ row }: { row: SemesterTableRow }): string {
  return row._isCurrentYear ? 'current-semester-row' : ''
}

const defaultBasicDataSnapshot: BasicDataSnapshot = {
  campuses: JSON.parse(JSON.stringify(campuses.value)),
  schoolYears: JSON.parse(JSON.stringify(schoolYears.value)),
  teachingCycles: JSON.parse(JSON.stringify(teachingCycles.value)),
  courses: JSON.parse(JSON.stringify(courses.value)),
  roomTypes: JSON.parse(JSON.stringify(roomTypes.value)),
  roomRecords: JSON.parse(JSON.stringify(roomRecords.value)),
  classRoomMappings: JSON.parse(JSON.stringify(classRoomMappings.value)),
  teacherRecords: JSON.parse(JSON.stringify(teacherRecords.value)),
  studentRecords: JSON.parse(JSON.stringify(studentRecords.value)),
  groupRecords: JSON.parse(JSON.stringify(groupRecords.value)),
  teachingAssignments: JSON.parse(JSON.stringify(teachingAssignments.value)),
  classRecords: JSON.parse(JSON.stringify(classRecords.value)),
  classHourRows: JSON.parse(JSON.stringify(classHourRows.value)),
  classHourClassRows: JSON.parse(JSON.stringify(classHourClassRows.value)),
  selectedTerm: selectedTerm.value,
  selectedHoursCampusId: selectedHoursCampusId.value,
  selectedHoursEducationSystem: selectedHoursEducationSystem.value,
  arrangementCampusId: arrangementCampusId.value,
  arrangementGrade: arrangementGrade.value,
  arrangementRows: JSON.parse(JSON.stringify(arrangementRows.value)),
  arrangementBatchValues: JSON.parse(JSON.stringify(arrangementBatchValues.value)),
  arrangementScopes: {},
  classHoursBatchDrafts: {},
  _savedAt: Date.now()
}

function createBasicDataSnapshot(): BasicDataSnapshot {
  const nextScopes = {
    ...arrangementScopeStore.value,
    [arrangementScopeKey.value]: {
      rows: cloneArrangementRows(arrangementRows.value),
      batchValues: cloneArrangementBatchValues(arrangementBatchValues.value)
    }
  }
  return {
    campuses: campuses.value,
    schoolYears: schoolYears.value,
    teachingCycles: teachingCycles.value,
    courses: courses.value,
    roomTypes: roomTypes.value,
    roomRecords: roomRecords.value,
    classRoomMappings: classRoomMappings.value,
    teacherRecords: teacherRecords.value,
    studentRecords: studentRecords.value,
    groupRecords: groupRecords.value,
    teachingAssignments: teachingAssignments.value,
    classRecords: classRecords.value,
    classHourRows: classHourRows.value,
    classHourClassRows: classHourClassRows.value,
    selectedTerm: selectedTerm.value,
    selectedHoursCampusId: selectedHoursCampusId.value,
    selectedHoursEducationSystem: selectedHoursEducationSystem.value,
    arrangementCampusId: arrangementCampusId.value,
    arrangementGrade: arrangementGrade.value,
    arrangementRows: arrangementRows.value,
    arrangementBatchValues: arrangementBatchValues.value,
    arrangementScopes: nextScopes,
    classHoursBatchDrafts: classHoursBatchStore.value,
    _savedAt: Date.now()
  }
}

async function persistBasicData(
  successMessage?: string,
  options?: { silentSuccess?: boolean }
): Promise<boolean> {
  try {
    persistCurrentArrangementScope()
    const result = basicDataRepository.save(createBasicDataSnapshot())
    if (result instanceof Promise) {
      await result
    }
    teachingInfoDirty.value = false
    if (successMessage && !options?.silentSuccess) {
      notify.success(successMessage)
    }
    return true
  } catch (error) {
    console.error('[BasicDataRepository] 保存失败', error)
    notify.error('保存失败，请稍后重试。')
    return false
  }
}

async function verifyCoursePersistence(successMessage: string): Promise<void> {
  const expectedCount = courses.value.length
  try {
    const result = basicDataRepository.load()
    const payload = result instanceof Promise ? await result : result
    const loadedCourses = normalizeCourseRecords(Array.isArray(payload?.courses) ? payload.courses : [])
    const loadedCount = loadedCourses.length
    if (loadedCount === expectedCount) {
      notify.success(`${successMessage} 当前课程总数：${loadedCount} 门。`)
      return
    }
    notify.warning(
      `${successMessage} 回读校验发现数量不一致：当前 ${expectedCount} 门，存储 ${loadedCount} 门。请刷新确认。`
    )
  } catch (error) {
    console.warn('[Course] 保存后回读校验失败', error)
    notify.warning(`${successMessage} 已提交，但回读校验失败，请刷新确认。`)
  }
}

function loadBasicDataSnapshot(): void {
  const applySnapshot = (parsed: Partial<BasicDataSnapshot> | null): void => {
    if (!parsed) {
      basicDataHydrated.value = true
      return
    }

    campuses.value = normalizeCampuses(
      Array.isArray(parsed.campuses) ? parsed.campuses : defaultBasicDataSnapshot.campuses
    )
    schoolYears.value = Array.isArray(parsed.schoolYears) ? parsed.schoolYears : defaultBasicDataSnapshot.schoolYears
    schoolYears.value = ensureSchoolYearsToTarget(schoolYears.value)
    courses.value = normalizeCourseRecords(
      Array.isArray(parsed.courses) ? parsed.courses : defaultBasicDataSnapshot.courses
    )
    roomTypes.value = normalizeRoomTypeRecords(
      Array.isArray(parsed.roomTypes) ? parsed.roomTypes : defaultBasicDataSnapshot.roomTypes
    )
    roomRecords.value = normalizeRoomRecords(
      Array.isArray(parsed.roomRecords) ? parsed.roomRecords : defaultBasicDataSnapshot.roomRecords,
      roomTypes.value,
      campuses.value
    )
    classRecords.value = Array.isArray(parsed.classRecords) ? parsed.classRecords : defaultBasicDataSnapshot.classRecords
    classRoomMappings.value = normalizeClassRoomMappings(
      Array.isArray(parsed.classRoomMappings) ? parsed.classRoomMappings : defaultBasicDataSnapshot.classRoomMappings,
      classRecords.value,
      roomRecords.value
    )
    const rawTeachers = Array.isArray(parsed.teacherRecords) ? parsed.teacherRecords : defaultBasicDataSnapshot.teacherRecords
    const normalizedTeacherState = buildNormalizedTeacherState(rawTeachers)
    teacherRecords.value = normalizedTeacherState.records
    groupRecords.value = normalizeGroupRecords(
      Array.isArray(parsed.groupRecords) ? parsed.groupRecords : defaultBasicDataSnapshot.groupRecords
    )
    const rawAssignments = Array.isArray(parsed.teachingAssignments)
      ? parsed.teachingAssignments
      : defaultBasicDataSnapshot.teachingAssignments
    const teacherIdSet = new Set(teacherRecords.value.map((item) => item.id))
    teachingAssignments.value = rawAssignments
      .map((item) => ({
        ...item,
        teacherId: normalizedTeacherState.idMap.get(item.teacherId) ?? item.teacherId
      }))
      .filter((item) => teacherIdSet.has(item.teacherId))
    studentRecords.value = normalizeStudentRecords(
      Array.isArray(parsed.studentRecords) ? parsed.studentRecords : defaultBasicDataSnapshot.studentRecords,
      classRecords.value
    )
    const fallbackCampusId = campuses.value[0]?.id ?? ''
    const allowedCampusIds = new Set(campuses.value.map((item) => item.id))
    classHourRows.value = normalizeClassHourRows(
      Array.isArray(parsed.classHourRows) ? parsed.classHourRows : defaultBasicDataSnapshot.classHourRows,
      fallbackCampusId,
      allowedCampusIds
    )
    classHourClassRows.value = Array.isArray(parsed.classHourClassRows)
      ? parsed.classHourClassRows.filter((item) => allowedCampusIds.has(item.campusId))
      : defaultBasicDataSnapshot.classHourClassRows
    selectedTerm.value = parsed.selectedTerm ?? defaultBasicDataSnapshot.selectedTerm
    selectedHoursCampusId.value = parsed.selectedHoursCampusId ?? defaultBasicDataSnapshot.selectedHoursCampusId
    selectedHoursEducationSystem.value =
      parsed.selectedHoursEducationSystem && EDUCATION_SYSTEM_OPTIONS.includes(parsed.selectedHoursEducationSystem)
        ? parsed.selectedHoursEducationSystem
        : defaultBasicDataSnapshot.selectedHoursEducationSystem
    classHoursBatchStore.value =
      parsed.classHoursBatchDrafts && typeof parsed.classHoursBatchDrafts === 'object'
        ? (parsed.classHoursBatchDrafts as Record<string, ClassHoursBatchDraft>)
        : {}
    const firstCampusId = campuses.value[0]?.id ?? ''
    const parsedArrangementCampusId = parsed.arrangementCampusId ?? defaultBasicDataSnapshot.arrangementCampusId
    arrangementCampusId.value = allowedCampusIds.has(parsedArrangementCampusId) ? parsedArrangementCampusId : firstCampusId
    if (!allowedCampusIds.has(selectedHoursCampusId.value)) {
      selectedHoursCampusId.value = firstCampusId
    }
    syncClassHoursBatchFormBySelection()
    arrangementGrade.value = parsed.arrangementGrade ?? defaultBasicDataSnapshot.arrangementGrade
    const gradeOptions = Array.from(new Set(classRecords.value.map((item) => item.grade))).sort(
      (a, b) => (gradeOrderMap[a] ?? 999) - (gradeOrderMap[b] ?? 999)
    )
    if (gradeOptions.length > 0 && !gradeOptions.includes(arrangementGrade.value)) {
      arrangementGrade.value = gradeOptions[0]
    }
    const parsedScopes =
      parsed.arrangementScopes && typeof parsed.arrangementScopes === 'object' ? parsed.arrangementScopes : null
    arrangementScopeStore.value = parsedScopes ? { ...parsedScopes } : {}
    const activeScopeKey = getArrangementScopeKey(arrangementCampusId.value, arrangementGrade.value)
    if (
      !parsedScopes ||
      Object.keys(parsedScopes).length === 0 ||
      !Object.prototype.hasOwnProperty.call(arrangementScopeStore.value, activeScopeKey)
    ) {
      arrangementScopeStore.value[activeScopeKey] = {
        rows: Array.isArray(parsed.arrangementRows) ? cloneArrangementRows(parsed.arrangementRows) : [],
        batchValues:
          parsed.arrangementBatchValues && typeof parsed.arrangementBatchValues === 'object'
            ? cloneArrangementBatchValues(parsed.arrangementBatchValues)
            : {}
      }
    }
    applyArrangementScopeByKey(activeScopeKey)
    syncClassHourRowsFromClassSettings()
    basicDataHydrated.value = true
  }

  const loaded = basicDataRepository.load()
  if (loaded instanceof Promise) {
    void loaded.then((parsed) => applySnapshot(parsed))
    return
  }

  applySnapshot(loaded)
}

loadBasicDataSnapshot()

watch(
  [
    campuses,
    schoolYears,
    teachingCycles,
    courses,
    roomTypes,
    roomRecords,
    classRoomMappings,
    teacherRecords,
    studentRecords,
    groupRecords,
    classRecords,
    classHourRows,
    classHourClassRows,
    arrangementRows,
    arrangementBatchValues,
    arrangementScopeStore,
    selectedTerm,
    selectedHoursCampusId,
    selectedHoursEducationSystem,
    arrangementCampusId,
    arrangementGrade
  ],
  () => {
    if (!basicDataHydrated.value) return
    const result = basicDataRepository.save(createBasicDataSnapshot())
    if (result instanceof Promise) {
      void result
    }
  },
  { deep: true }
)

watch(
  [classRecords, roomRecords, roomTypes],
  () => {
    classRoomMappings.value = normalizeClassRoomMappings(classRoomMappings.value, classRecords.value, roomRecords.value)
  },
  { deep: true, immediate: true }
)

watch(
  [teachingAssignments, courses, teacherRecords, campuses],
  () => {
    syncActivityGroupsFromRealData()
  },
  { deep: true, immediate: true }
)

const activeTitle = computed(
  () =>
    groups.flatMap((group) => group.children).find((item) => item.key === activeMenu.value)?.label ??
    '基础数据'
)

function resolveMenuStatus(menu: BaseMenu): BaseMenu['status'] {
  if (['student-entry', 'room-type', 'room-entry', 'classroom-map'].includes(menu.key)) {
    return 'none'
  }
  if (menu.key === 'campus') {
    return campuses.value.length > 0 ? 'done' : 'required'
  }
  if (menu.key === 'course-manage') {
    return courses.value.length > 0 ? 'done' : 'required'
  }
  if (menu.key === 'class-setting') {
    const hasClassesInCurrentScope = classRecords.value.some(
      (item) => item.campusId === classSettingForm.campusId && item.stage === classSettingForm.stage
    )
    return hasClassesInCurrentScope ? 'done' : 'required'
  }
  if (menu.key === 'class-hours') {
    const hasConfigured = [...classHourRows.value, ...classHourClassRows.value].some(
      (item) =>
        Number(item.weeklyDays || 0) > 0 ||
        Number(item.morningStudy || 0) > 0 ||
        Number(item.morningLessons || 0) > 0 ||
        Number(item.afternoonLessons || 0) > 0 ||
        Number(item.eveningStudy || 0) > 0
    )
    return hasConfigured ? 'done' : 'required'
  }
  if (menu.key === 'teaching-info') {
    const hasAssignment = teachingAssignments.value.length > 0
    const hasHeadTeacher = classRecords.value.some((item) => Boolean(String(item.headTeacherId ?? '').trim()))
    return hasAssignment || hasHeadTeacher ? 'done' : 'required'
  }
  if (menu.key === 'teacher-entry') {
    return teacherRecords.value.length > 0 ? 'done' : 'required'
  }
  if (menu.key === 'group-manage') {
    return groupRecords.value.length > 0 ? 'done' : 'required'
  }
  if (menu.key === 'time-slot') {
    const hasLessonsInRows = (rows: ArrangementRow[] | undefined): boolean =>
      Array.isArray(rows) &&
      rows.some((row) =>
        Object.values(row.values || {}).some((value) => {
          const numeric = Number(value || 0)
          return Number.isFinite(numeric) && numeric > 0
        })
      )

    const hasCurrentData = hasLessonsInRows(arrangementRows.value)
    return hasCurrentData ? 'done' : 'required'
  }
  return menu.status
}

async function askTextInput(message: string, title: string, defaultValue = ''): Promise<string | null> {
  try {
    const { value } = await ElMessageBox.prompt(message, title, {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: defaultValue
    })
    return String(value ?? '').trim()
  } catch {
    return null
  }
}

const stageOptions = ['小学', '初中'] as const

const classSettingForm = reactive({
  campusId: '',
  stage: '小学' as (typeof stageOptions)[number],
  grades: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] as string[],
  batchCount: 1,
  startNo: 1
})

const gradeOptions = computed(() => {
  if (classSettingForm.stage === '小学') {
    return ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级']
  }
  return ['七年级', '八年级', '九年级']
})

const isAllGradesChecked = computed(
  () => gradeOptions.value.length > 0 && classSettingForm.grades.length === gradeOptions.value.length
)

const isGradePartiallyChecked = computed(
  () => classSettingForm.grades.length > 0 && classSettingForm.grades.length < gradeOptions.value.length
)

function toggleAllGrades(checked: boolean): void {
  classSettingForm.grades = checked ? [...gradeOptions.value] : []
}

watch(
  campuses,
  (items) => {
    const firstCampusId = items[0]?.id ?? ''

    if (!items.some((item) => item.id === classSettingForm.campusId)) {
      classSettingForm.campusId = firstCampusId
    }

    if (!items.some((item) => item.id === selectedHoursCampusId.value)) {
      selectedHoursCampusId.value = firstCampusId
    }

    if (!items.some((item) => item.id === arrangementCampusId.value)) {
      arrangementCampusId.value = firstCampusId
    }

    syncClassHourRowsFromClassSettings()
  },
  { immediate: true, deep: true }
)

watch(
  classRecords,
  () => {
    syncClassHourRowsFromClassSettings()
  },
  { deep: true }
)

watch([selectedHoursCampusId, selectedHoursEducationSystem], syncClassHoursBatchFormBySelection, { immediate: true })

watch(
  () => classSettingForm.stage,
  () => {
    classSettingForm.grades = [...gradeOptions.value]
  }
)

watch(
  arrangementGradeOptions,
  (options) => {
    if (!options.includes(arrangementGrade.value)) {
      arrangementGrade.value = options[0]
    }
  },
  { immediate: true }
)

watch(
  classHourResetGradeOptions,
  (options) => {
    if (resetGradeTarget.value === '__all__') return
    if (!options.includes(resetGradeTarget.value)) {
      resetGradeTarget.value = '__all__'
    }
  },
  { immediate: true }
)

watch(
  [arrangementCourses, arrangementClassNames],
  () => {
    if (!basicDataHydrated.value) return
    persistCurrentArrangementScope()
    applyArrangementScopeByKey(arrangementScopeKey.value)
  },
  { immediate: true, flush: 'post' }
)

watch(
  arrangementScopeKey,
  (nextScopeKey, prevScopeKey) => {
    if (!basicDataHydrated.value) return
    const fallbackPrev = activeArrangementScopeKey.value
    const sourcePrev = prevScopeKey || fallbackPrev
    if (sourcePrev) {
      arrangementScopeStore.value = {
        ...arrangementScopeStore.value,
        [sourcePrev]: {
          rows: cloneArrangementRows(arrangementRows.value),
          batchValues: cloneArrangementBatchValues(arrangementBatchValues.value)
        }
      }
    }
    applyArrangementScopeByKey(nextScopeKey)
  },
  { flush: 'sync' }
)

const currentClassRecords = computed(() => {
  return classRecords.value
    .filter(
      (item) =>
        item.campusId === classSettingForm.campusId &&
        item.stage === classSettingForm.stage &&
        classSettingForm.grades.includes(item.grade)
    )
    .sort((a, b) => {
      const gradeCompare = (gradeOrderMap[a.grade] ?? 999) - (gradeOrderMap[b.grade] ?? 999)
      if (gradeCompare !== 0) return gradeCompare
      return a.classNo - b.classNo
    })
})

const gradeClassStats = computed(() => {
  const targetCampusId = classSettingForm.campusId
  const targetStage = classSettingForm.stage
  const rows = classRecords.value.filter((item) => item.campusId === targetCampusId && item.stage === targetStage)
  const countByGrade = new Map<string, number>()
  rows.forEach((item) => {
    const key = String(item.grade || '').trim()
    if (!key) return
    countByGrade.set(key, (countByGrade.get(key) || 0) + 1)
  })
  const stats = gradeOptions.value.map((grade) => ({
    grade,
    count: countByGrade.get(grade) || 0
  }))
  const total = stats.reduce((sum, item) => sum + item.count, 0)
  return { stats, total }
})

watch(
  currentClassRecords,
  async (rows) => {
    const visibleIdSet = new Set(rows.map((item) => item.id))
    selectedClassIds.value = selectedClassIds.value.filter((id) => visibleIdSet.has(id))
    await nextTick()
    classTableRef.value?.clearSelection()
    rows.forEach((row) => {
      if (selectedClassIds.value.includes(row.id)) {
        classTableRef.value?.toggleRowSelection(row, true)
      }
    })
  },
  { flush: 'post' }
)

function batchCreateClasses(): void {
  if (classSettingForm.grades.length === 0) {
    notify.warning('请至少选择一个年级。')
    return
  }

  if (classSettingForm.batchCount <= 0 || classSettingForm.startNo <= 0) {
    notify.warning('班级数量和起始班号必须大于 0。')
    return
  }

  const newItems: ClassRecord[] = []

  classSettingForm.grades.forEach((grade) => {
    for (let i = 0; i < classSettingForm.batchCount; i += 1) {
      const classNo = classSettingForm.startNo + i
      const exists = classRecords.value.some(
        (item) =>
          item.campusId === classSettingForm.campusId &&
          item.stage === classSettingForm.stage &&
          item.grade === grade &&
          item.classNo === classNo
      )

      if (exists) continue

      newItems.push({
        id: `${Date.now()}-${grade}-${classNo}-${i}`,
        campusId: classSettingForm.campusId,
        stage: classSettingForm.stage,
        grade,
        classNo,
        className: `${grade}${classNo}班`
      })
    }
  })

  if (newItems.length === 0) {
    notify.warning('没有新增班级，可能与现有班级重复。')
    return
  }

  classRecords.value = [...classRecords.value, ...newItems]
}

async function renameClass(record: ClassRecord): Promise<void> {
  const className = await askTextInput('修改班级名称', '编辑班级', record.className)
  if (!className) return

  classRecords.value = classRecords.value.map((item) =>
    item.id === record.id
      ? {
          ...item,
          className
        }
      : item
  )
}

async function confirmDelete(message: string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, '删除确认', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    return true
  } catch {
    return false
  }
}

async function removeClass(record: ClassRecord): Promise<void> {
  const confirmed = await confirmDelete(`确认删除班级「${record.className}」吗？`)
  if (!confirmed) return
  removeClassesByIds([record.id])
}

function removeClassesByIds(ids: string[]): void {
  const idSet = new Set(ids)
  if (idSet.size <= 0) return

  classRecords.value = classRecords.value.filter((item) => !idSet.has(item.id))
  classRoomMappings.value = classRoomMappings.value.filter((item) => !idSet.has(item.classId))
  studentRecords.value = studentRecords.value.filter((item) => !idSet.has(item.classId))
  teachingAssignments.value = teachingAssignments.value.filter((item) => !idSet.has(item.classId))
  classHourClassRows.value = classHourClassRows.value.filter((item) => !idSet.has(item.classId))
  selectedClassIds.value = selectedClassIds.value.filter((id) => !idSet.has(id))
}

function onClassSelectionChange(rows: ClassRecord[]): void {
  selectedClassIds.value = rows.map((item) => item.id)
}

async function removeClassesBatch(): Promise<void> {
  const ids = Array.from(new Set(selectedClassIds.value))
  if (ids.length === 0) {
    notify.warning('请先选择要删除的班级。')
    return
  }
  const confirmed = await confirmDelete(`确认批量删除已选 ${ids.length} 个班级吗？将同步删除关联学生、任课和教室映射。`)
  if (!confirmed) return

  removeClassesByIds(ids)
  classTableRef.value?.clearSelection()
  notify.success(`已删除 ${ids.length} 个班级。`)
}

function createCampus(): void {
  openCampusDialog()
}

function renameCampus(campus: Campus): void {
  openCampusDialog(campus)
}

async function cleanupWorkbenchDataByCampus(campusId: string, removedClassIds: Set<string>): Promise<number> {
  const snapshot = await loadWorkbenchPersistSnapshot()
  let changed = false
  let removedPlanCount = 0

  const nextEntries: Record<string, unknown> = { ...(snapshot.entries || {}) }
  const nextMeta: Record<string, { savedAt: number; publishedAt: number }> = { ...(snapshot.meta || {}) }
  const nextDrafts: Record<string, unknown> = { ...(snapshot.drafts || {}) }
  const nextLogs: Record<string, unknown[]> = { ...(snapshot.logs || {}) }

  Object.keys(nextEntries).forEach((planKey) => {
    const rawEntry = nextEntries[planKey]
    if (!rawEntry || typeof rawEntry !== 'object') return
    const entry = rawEntry as {
      selectedCampus?: unknown
      scheduleMap?: Record<string, unknown>
    }

    if (String(entry.selectedCampus ?? '') === campusId) {
      delete nextEntries[planKey]
      delete nextMeta[planKey]
      delete nextDrafts[planKey]
      delete nextLogs[planKey]
      changed = true
      removedPlanCount += 1
      return
    }

    const scheduleMap = entry.scheduleMap
    if (!scheduleMap || typeof scheduleMap !== 'object') return

    const cleanedScheduleMap: Record<string, unknown> = { ...scheduleMap }
    let scheduleChanged = false
    removedClassIds.forEach((classId) => {
      if (Object.prototype.hasOwnProperty.call(cleanedScheduleMap, classId)) {
        delete cleanedScheduleMap[classId]
        scheduleChanged = true
      }
    })
    if (scheduleChanged) {
      nextEntries[planKey] = { ...(entry as Record<string, unknown>), scheduleMap: cleanedScheduleMap }
      changed = true
    }

    const rawDraft = nextDrafts[planKey]
    if (!rawDraft || typeof rawDraft !== 'object') return
    const draft = rawDraft as { locks?: Record<string, unknown> }
    if (!draft.locks || typeof draft.locks !== 'object') return

    const cleanedLocks: Record<string, unknown> = { ...draft.locks }
    let draftChanged = false
    removedClassIds.forEach((classId) => {
      if (Object.prototype.hasOwnProperty.call(cleanedLocks, classId)) {
        delete cleanedLocks[classId]
        draftChanged = true
      }
    })
    if (draftChanged) {
      nextDrafts[planKey] = { ...(draft as Record<string, unknown>), locks: cleanedLocks }
      changed = true
    }
  })

  if (changed) {
    await saveWorkbenchPersistSnapshot({
      entries: nextEntries,
      meta: nextMeta,
      drafts: nextDrafts,
      logs: nextLogs,
      _savedAt: Date.now()
    })
  }

  return removedPlanCount
}

async function removeCampus(campus: Campus): Promise<void> {
  if (campus.system) return
  const campusId = campus.id
  const removedClassIds = new Set(classRecords.value.filter((item) => item.campusId === campusId).map((item) => item.id))
  const classCount = classRecords.value.filter((item) => item.campusId === campusId).length
  const teacherCount = teacherRecords.value.filter((item) => item.campusId === campusId).length
  const studentCount = studentRecords.value.filter((item) => item.campusId === campusId).length
  const roomCount = roomRecords.value.filter((item) => item.campusId === campusId).length
  const assignmentCount = teachingAssignments.value.filter((item) => item.campusId === campusId).length
  const groupCount = groupRecords.value.filter((item) => item.campusId === campusId).length
  const classHourCount = classHourRows.value.filter((item) => (item.campusId ?? '') === campusId).length
  const classHourByClassCount = classHourClassRows.value.filter((item) => item.campusId === campusId).length

  const impactMessage = [
    `你正在删除校区「${campus.name}」。`,
    '该操作存在高风险，将同时删除以下关联数据：',
    `- 班级：${classCount}`,
    `- 教师：${teacherCount}`,
    `- 学生：${studentCount}`,
    `- 任课关系：${assignmentCount}`,
    `- 教室：${roomCount}`,
    `- 教研与活动分组：${groupCount}`,
    `- 班级课时（年级维度）：${classHourCount}`,
    `- 班级课时（班级维度）：${classHourByClassCount}`,
    '删除后无法恢复。是否继续？'
  ].join('\n')

  const firstConfirmed = await confirmDelete(impactMessage)
  if (!firstConfirmed) return

  try {
    await ElMessageBox.confirm(`最终确认：删除校区「${campus.name}」及全部关联数据。该操作不可恢复。`, '危险操作二次确认', {
      type: 'error',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }

  campuses.value = campuses.value.filter((item) => item.id !== campusId)
  classRecords.value = classRecords.value.filter((item) => item.campusId !== campusId)
  teacherRecords.value = teacherRecords.value.filter((item) => item.campusId !== campusId)
  studentRecords.value = studentRecords.value.filter((item) => item.campusId !== campusId)
  roomRecords.value = roomRecords.value.filter((item) => item.campusId !== campusId)
  teachingAssignments.value = teachingAssignments.value.filter((item) => item.campusId !== campusId)
  groupRecords.value = groupRecords.value.filter((item) => item.campusId !== campusId)
  classHourRows.value = classHourRows.value.filter((item) => (item.campusId ?? '') !== campusId)
  classHourClassRows.value = classHourClassRows.value.filter((item) => item.campusId !== campusId)
  courses.value = courses.value.filter((item) => (item.campusId || '') !== campusId)
  const removedPlanCount = await cleanupWorkbenchDataByCampus(campusId, removedClassIds)

  notify.success(
    removedPlanCount > 0
      ? `校区「${campus.name}」及关联数据已删除，并清理 ${removedPlanCount} 个课表方案数据。`
      : `校区「${campus.name}」及关联数据已删除。`
  )
}

const campusDialogVisible = ref(false)
const campusDialogMode = ref<'create' | 'edit'>('create')
const campusEditingId = ref('')
const campusDialogError = ref('')
const campusForm = reactive<{
  schoolName: string
  name: string
  educationSystem: Campus['educationSystem']
}>({
  schoolName: '',
  name: '',
  educationSystem: '九年一贯制'
})

function openCampusDialog(campus?: Campus): void {
  if (campus) {
    campusDialogMode.value = 'edit'
    campusEditingId.value = campus.id
    campusForm.schoolName = campus.schoolName
    campusForm.name = campus.name
    campusForm.educationSystem = campus.educationSystem
  } else {
    campusDialogMode.value = 'create'
    campusEditingId.value = ''
    campusForm.schoolName = ''
    campusForm.name = ''
    campusForm.educationSystem = '九年一贯制'
  }
  campusDialogError.value = ''
  campusDialogVisible.value = true
}

function closeCampusDialog(): void {
  campusDialogVisible.value = false
}

function submitCampusDialog(): void {
  const schoolName = campusForm.schoolName.trim()
  const name = campusForm.name.trim() || '本校区'
  if (!schoolName) {
    campusDialogError.value = '请填写学校名称。'
    return
  }

  const exists = campuses.value.some((item) => item.name === name && item.id !== campusEditingId.value)
  if (exists) {
    campusDialogError.value = '校区名称已存在，请更换。'
    return
  }

  if (campusDialogMode.value === 'edit') {
    campuses.value = campuses.value.map((item) =>
      item.id === campusEditingId.value
        ? {
            ...item,
            schoolName,
            name,
            educationSystem: campusForm.educationSystem
          }
        : item
    )
  } else {
    campuses.value.unshift({
      id: `${Date.now()}`,
      schoolName,
      name,
      system: false,
      educationSystem: campusForm.educationSystem
    })
  }
  closeCampusDialog()
}

function exportSemesterConfig(): void {
  notify.info('导出功能已预留，后续可接入 Excel 导出。')
}

const semesterEditorVisible = ref(false)
const semesterEditorError = ref('')
const semesterEditorYearId = ref('')
const semesterEditorYearName = ref('')
const semesterEditorDraft = reactive({
  yearStartDate: '',
  yearEndDate: '',
  sem1StartDate: '',
  sem1EndDate: '',
  sem2StartDate: '',
  sem2EndDate: ''
})

function openSemesterEditor(year: SchoolYear): void {
  const latest = schoolYears.value.find((item) => item.id === year.id) ?? year
  semesterEditorYearId.value = latest.id
  semesterEditorYearName.value = latest.yearName
  semesterEditorDraft.yearStartDate = latest.yearStartDate
  semesterEditorDraft.yearEndDate = latest.yearEndDate
  semesterEditorDraft.sem1StartDate = latest.semesters[0]?.startDate ?? ''
  semesterEditorDraft.sem1EndDate = latest.semesters[0]?.endDate ?? ''
  semesterEditorDraft.sem2StartDate = latest.semesters[1]?.startDate ?? ''
  semesterEditorDraft.sem2EndDate = latest.semesters[1]?.endDate ?? ''
  semesterEditorError.value = ''
  semesterEditorVisible.value = true
}

function closeSemesterEditor(): void {
  semesterEditorVisible.value = false
}

function normalizeDateInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pickerDefaultDate(value: unknown): Date {
  const normalized = normalizeDateInput(value)
  if (!DATE_REGEX.test(normalized)) {
    return new Date()
  }
  const parsed = new Date(`${normalized}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return new Date()
  }
  return parsed
}

function confirmSemesterEditor(): void {
  const values = [
    semesterEditorDraft.yearStartDate,
    semesterEditorDraft.yearEndDate,
    semesterEditorDraft.sem1StartDate,
    semesterEditorDraft.sem1EndDate,
    semesterEditorDraft.sem2StartDate,
    semesterEditorDraft.sem2EndDate
  ].map((item) => normalizeDateInput(item))

  if (!values.every((item) => DATE_REGEX.test(item))) {
    semesterEditorError.value = '请填写完整日期，格式为 YYYY-MM-DD'
    return
  }

  const [yearStart, yearEnd, sem1Start, sem1End, sem2Start, sem2End] = values
  if (!(yearStart <= sem1Start && sem1Start <= sem1End && sem1End < sem2Start && sem2Start <= sem2End && sem2End <= yearEnd)) {
    semesterEditorError.value = '日期顺序不正确，请检查学年及上下学期起止日期。'
    return
  }

  const startYear = Number(yearStart.slice(0, 4))
  const endYear = Number(yearEnd.slice(0, 4))
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear - startYear !== 1) {
    semesterEditorError.value = '学年开始和结束年份应连续，例如 2025-2026学年。'
    return
  }

  const nextYearId = `${startYear}-${endYear}`
  const duplicateYearId = schoolYears.value.some(
    (item) => item.id === nextYearId && item.id !== semesterEditorYearId.value
  )
  if (duplicateYearId) {
    semesterEditorError.value = '该学年已存在，请勿重复设置。'
    return
  }

  schoolYears.value = schoolYears.value
    .map((item) =>
      item.id === semesterEditorYearId.value
        ? {
            ...item,
            id: nextYearId,
            yearName: `${startYear}-${endYear}学年`,
            yearStartDate: yearStart,
            yearEndDate: yearEnd,
            semesters: [
              { name: '第一学期', startDate: sem1Start, endDate: sem1End },
              { name: '第二学期', startDate: sem2Start, endDate: sem2End }
            ]
          }
        : item
    )
    .sort((a, b) => {
      const aStart = parseSchoolYearStart(a.yearName) ?? parseSchoolYearStart(a.id) ?? 0
      const bStart = parseSchoolYearStart(b.yearName) ?? parseSchoolYearStart(b.id) ?? 0
      return aStart - bStart
    })

  closeSemesterEditor()
}

function parseDateRange(value: string): { start: string; end: string } {
  const parts = value.split('至').map((item) => item.trim())
  return { start: parts[0] ?? '', end: parts[1] ?? '' }
}

function calculateWeekCountByDateRange(startDate: string, endDate: string): number | null {
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate) || startDate > endDate) {
    return null
  }
  const startTime = new Date(`${startDate}T00:00:00`).getTime()
  const endTime = new Date(`${endDate}T00:00:00`).getTime()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null
  }
  const dayDiff = Math.max(0, Math.floor((endTime - startTime) / 86400000))
  return Math.max(1, Math.ceil((dayDiff + 1) / 7))
}

function createCourse(): void {
  courseDialogMode.value = 'create'
  courseEditingId.value = ''
  courseDialogError.value = ''
  courseForm.name = ''
  courseForm.shortName = ''
  courseForm.subject = ''
  courseForm.scope =
    courseTab.value === '全部'
      ? (enabledCourseScopes.value[0] ?? DEFAULT_REQUIRED_SCOPE)
      : courseTab.value
  courseForm.campusId = courseCampusId.value === '__all__' ? '' : courseCampusId.value
  courseDialogVisible.value = true
}

function editCourse(course: CourseItem): void {
  courseDialogMode.value = 'edit'
  courseEditingId.value = course.id
  courseDialogError.value = ''
  courseForm.name = course.name
  courseForm.shortName = course.shortName
  courseForm.subject = course.subject
  courseForm.scope = normalizeCourseScopeInput(course.scopes[0] ?? DEFAULT_REQUIRED_SCOPE)
  courseForm.campusId = course.campusId || ''
  courseDialogVisible.value = true
}

function closeCourseDialog(): void {
  courseDialogVisible.value = false
}

async function submitCourseDialog(): Promise<void> {
  const name = courseForm.name.trim()
  const subject = courseForm.subject.trim() || name
  const shortName = courseForm.shortName.trim()
  const scope = normalizeCourseScopeInput(courseForm.scope)
  const campusId = String(courseForm.campusId ?? '').trim()

  if (!name) {
    courseDialogError.value = '课程名称为必填项。'
    return
  }

  const duplicate = courses.value.find(
    (item) =>
      item.id !== courseEditingId.value &&
      item.name.trim() === name &&
      (item.scopes[0] ?? DEFAULT_REQUIRED_SCOPE) === scope &&
      String(item.campusId ?? '').trim() === campusId
  )
  if (duplicate) {
    courseDialogError.value = `课程「${name}」在当前校区和「${scope}」已存在。`
    return
  }

  if (courseDialogMode.value === 'create') {
    courses.value.unshift({
      id: `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      shortName,
      subject,
      scopes: [scope],
      campusId
    })
    closeCourseDialog()
    const saved = await persistBasicData(undefined, { silentSuccess: true })
    if (saved) {
      await verifyCoursePersistence('课程已新增。')
    }
  } else {
    courses.value = courses.value.map((item) =>
      item.id === courseEditingId.value
        ? {
            ...item,
            name,
            shortName,
            subject,
            scopes: [scope],
            campusId
          }
        : item
    )
    closeCourseDialog()
    const saved = await persistBasicData(undefined, { silentSuccess: true })
    if (saved) {
      await verifyCoursePersistence('课程已更新。')
    }
  }
}

async function deleteCourse(course: CourseItem): Promise<void> {
  const confirmed = await confirmDelete(`确认删除课程「${course.name}」吗？`)
  if (!confirmed) return
  removeCoursesByIds([course.id])
  const saved = await persistBasicData(undefined, { silentSuccess: true })
  if (saved) {
    await verifyCoursePersistence('课程已删除。')
  }
}

function removeCoursesByIds(ids: string[]): number {
  const idSet = new Set(ids)
  if (idSet.size === 0) return 0
  courses.value = courses.value.filter((item) => !idSet.has(item.id))
  teachingAssignments.value = teachingAssignments.value.filter((item) => !idSet.has(item.courseId))
  selectedCourseIds.value = selectedCourseIds.value.filter((id) => !idSet.has(id))
  return idSet.size
}

function onCourseSelectionChange(rows: CourseItem[]): void {
  selectedCourseIds.value = rows.map((item) => item.id)
}

async function removeCoursesBatch(): Promise<void> {
  const ids = Array.from(new Set(selectedCourseIds.value))
  if (ids.length === 0) {
    notify.warning('请先选择要删除的课程。')
    return
  }
  const confirmed = await confirmDelete(`确认批量删除已选 ${ids.length} 门课程吗？将同步删除其任课关系。`)
  if (!confirmed) return
  const deleted = removeCoursesByIds(ids)
  courseTableRef.value?.clearSelection()
  const saved = await persistBasicData(undefined, { silentSuccess: true })
  if (saved) {
    await verifyCoursePersistence(`已删除 ${deleted} 门课程。`)
  }
}

async function saveCourseData(): Promise<void> {
  const saved = await persistBasicData(undefined, { silentSuccess: true })
  if (saved) {
    await verifyCoursePersistence('课程数据已保存。')
  }
}

async function createRoomType(): Promise<void> {
  const name = await askTextInput('请输入教室类型名称', '新增教室类型')
  if (!name) return
  if (roomTypes.value.some((item) => item.name === name)) {
    notify.warning('该教室类型已存在。')
    return
  }
  roomTypes.value.push({
    id: `room-type-${Date.now()}`,
    name,
    system: false
  })
  await persistBasicData('教室类型已新增。')
}

async function editRoomType(record: RoomTypeRecord): Promise<void> {
  if (record.system) return
  const name = await askTextInput('修改教室类型名称', '编辑教室类型', record.name)
  if (!name) return
  if (roomTypes.value.some((item) => item.id !== record.id && item.name === name)) {
    notify.warning('该教室类型已存在。')
    return
  }
  roomTypes.value = roomTypes.value.map((item) => (item.id === record.id ? { ...item, name } : item))
  await persistBasicData('教室类型已更新。')
}

async function removeRoomType(record: RoomTypeRecord): Promise<void> {
  if (record.system) {
    notify.warning('系统默认教室类型不可删除。')
    return
  }
  const confirmed = await confirmDelete(`确认删除教室类型「${record.name}」吗？`)
  if (!confirmed) return
  roomTypes.value = roomTypes.value.filter((item) => item.id !== record.id)
  await persistBasicData('教室类型已删除。')
}

const roomEntryKeyword = ref('')
const classRoomMapKeyword = ref('')
const classRoomMapCampusId = ref('')
const classRoomMapGrade = ref('')
const classRoomMapImportInput = ref<HTMLInputElement | null>(null)
const classRoomMapImportError = ref('')
const roomImportInput = ref<HTMLInputElement | null>(null)
const roomImportError = ref('')
const roomColumns = ['教室名', '教室类型', '所在校区', '所在楼名', '所在楼层', '容纳人数']
const roomTableRef = ref<TableInstance | null>(null)
const selectedRoomIds = ref<string[]>([])
const roomCreateDialogVisible = ref(false)
const roomCreateDialogError = ref('')
const roomEditDialogVisible = ref(false)
const roomEditDialogError = ref('')
const roomEditingId = ref('')
const roomCreateForm = reactive({
  roomName: '',
  roomTypeId: '',
  campusId: '',
  buildingName: '教学楼',
  floorNo: 1,
  capacity: 60
})
const roomEditForm = reactive({
  roomName: '',
  roomTypeId: '',
  campusId: '',
  buildingName: '教学楼',
  floorNo: 1,
  capacity: 40
})

const roomEntryView = computed(() => {
  const keyword = roomEntryKeyword.value.trim().toLowerCase()
  const roomTypeMap = new Map(roomTypes.value.map((item) => [item.id, item.name] as const))
  const campusMap = new Map(campuses.value.map((item) => [item.id, item.name] as const))
  const rows = roomRecords.value.map((item) => ({
    ...item,
    roomTypeName: roomTypeMap.get(item.roomTypeId) ?? '--',
    campusName: campusMap.get(item.campusId) ?? '本校区'
  }))
  if (!keyword) return rows
  return rows.filter((item) =>
    [item.roomName, item.roomTypeName, item.campusName, item.buildingName, String(item.floorNo), String(item.capacity)]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  )
})

const classroomMapView = computed(() => {
  const campusMap = new Map(campuses.value.map((item) => [item.id, item.name] as const))
  const roomMap = new Map(roomRecords.value.map((item) => [item.id, item] as const))
  const mappingByClassId = new Map(classRoomMappings.value.map((item) => [item.classId, item.roomId] as const))
  return classRecords.value
    .slice()
    .sort((a, b) => (gradeOrderMap[a.grade] ?? 999) - (gradeOrderMap[b.grade] ?? 999) || a.classNo - b.classNo)
    .map((classItem) => {
      const mappedRoomId = mappingByClassId.get(classItem.id) ?? ''
      const room = roomMap.get(mappedRoomId)
      return {
        classId: classItem.id,
        campusId: classItem.campusId,
        campusName: campusMap.get(classItem.campusId) ?? '本校区',
        grade: classItem.grade,
        className: classItem.className,
        roomId: room?.id ?? '',
        roomName: room?.roomName ?? '未设置'
      }
    })
})

const classRoomMapGradeOptions = computed(() =>
  Array.from(
    new Set(
      classRecords.value
        .filter((item) => !classRoomMapCampusId.value || item.campusId === classRoomMapCampusId.value)
        .map((item) => item.grade)
    )
  ).sort((a, b) => (gradeOrderMap[a] ?? 999) - (gradeOrderMap[b] ?? 999))
)

const filteredClassroomMapView = computed(() => {
  const keyword = classRoomMapKeyword.value.trim().toLowerCase()
  return classroomMapView.value.filter((item) => !classRoomMapCampusId.value || item.campusId === classRoomMapCampusId.value)
    .filter((item) => !classRoomMapGrade.value || item.grade === classRoomMapGrade.value)
    .filter((item) => {
      if (!keyword) return true
      return [item.campusName, item.grade, item.className, item.roomName].join(' ').toLowerCase().includes(keyword)
    })
})
const selectedRoomCount = computed(() => selectedRoomIds.value.length)

watch(
  [campuses, roomTypes],
  () => {
    const campusId = campuses.value[0]?.id ?? ''
    const roomTypeId = roomTypes.value[0]?.id ?? ''
    if (!roomCreateForm.campusId || !campuses.value.some((item) => item.id === roomCreateForm.campusId)) {
      roomCreateForm.campusId = campusId
    }
    if (!roomCreateForm.roomTypeId || !roomTypes.value.some((item) => item.id === roomCreateForm.roomTypeId)) {
      roomCreateForm.roomTypeId = roomTypeId
    }
  },
  { deep: true, immediate: true }
)

watch(
  campuses,
  (items) => {
    if (!items.some((item) => item.id === classRoomMapCampusId.value)) {
      classRoomMapCampusId.value = items[0]?.id ?? ''
    }
  },
  { deep: true, immediate: true }
)

watch(
  classRoomMapGradeOptions,
  (items) => {
    if (!items.includes(classRoomMapGrade.value)) {
      classRoomMapGrade.value = items[0] ?? ''
    }
  },
  { immediate: true }
)

function openCreateRoomDialog(): void {
  roomCreateForm.roomName = ''
  roomCreateForm.roomTypeId = roomTypes.value[0]?.id ?? ''
  roomCreateForm.campusId = campuses.value[0]?.id ?? ''
  roomCreateForm.buildingName = '教学楼'
  roomCreateForm.floorNo = 1
  roomCreateForm.capacity = 60
  roomCreateDialogError.value = ''
  roomCreateDialogVisible.value = true
}

function closeCreateRoomDialog(): void {
  roomCreateDialogVisible.value = false
}

async function submitCreateRoomDialog(): Promise<void> {
  const roomName = roomCreateForm.roomName.trim()
  if (!roomName) {
    roomCreateDialogError.value = '教室名为必填项。'
    return
  }
  if (roomRecords.value.some((item) => item.roomName === roomName && item.campusId === roomCreateForm.campusId)) {
    roomCreateDialogError.value = '同校区下教室名已存在。'
    return
  }
  roomRecords.value.unshift({
    id: `room-${Date.now()}`,
    roomName,
    roomTypeId: roomCreateForm.roomTypeId,
    campusId: roomCreateForm.campusId,
    buildingName: roomCreateForm.buildingName.trim() || '教学楼',
    floorNo: Math.max(1, Math.floor(Number(roomCreateForm.floorNo) || 1)),
    capacity: Math.max(1, Math.floor(Number(roomCreateForm.capacity) || 60))
  })
  closeCreateRoomDialog()
  await persistBasicData('教室已新增。')
}

async function saveRoomEntryData(): Promise<void> {
  await persistBasicData('教室数据已保存。')
}

async function downloadRoomTemplate(): Promise<void> {
  try {
    await exportExcel(
      '教室导入模板.xlsx',
      [roomColumns, ['101', '普通教室', '本校区', '教学楼', '1', '60']],
      '教室模板'
    )
  } catch (error) {
    notify.error(error instanceof Error ? error.message : '下载模板失败，请稍后重试。')
  }
}

async function exportRoomData(): Promise<void> {
  const rows = roomEntryView.value.map((item) => [
    item.roomName,
    item.roomTypeName,
    item.campusName,
    item.buildingName,
    String(item.floorNo),
    String(item.capacity)
  ])
  try {
    await exportExcel('教室数据导出.xlsx', [roomColumns, ...rows], '教室数据')
  } catch (error) {
    notify.error(error instanceof Error ? error.message : '导出失败，请稍后重试。')
  }
}

function triggerRoomImport(): void {
  roomImportError.value = ''
  roomImportInput.value?.click()
}

function handleRoomImport(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  void (async () => {
    try {
      const rows = await parseSpreadsheetRows(file)
      if (rows.length <= 1) {
        roomImportError.value = '未识别到有效教室数据，请检查模板格式。'
        return
      }

      const header = rows[0].map((item) => String(item || '').trim())
      const headerMap = new Map(header.map((name, index) => [name, index] as const))
      const idxRoomName = headerMap.get('教室名') ?? 0
      const idxRoomType = headerMap.get('教室类型') ?? 1
      const idxCampus = headerMap.get('所在校区') ?? 2
      const idxBuilding = headerMap.get('所在楼名') ?? 3
      const idxFloor = headerMap.get('所在楼层') ?? 4
      const idxCapacity = headerMap.get('容纳人数') ?? 5

      const roomTypeByName = new Map(roomTypes.value.map((item) => [item.name, item.id] as const))
      const roomTypeById = new Set(roomTypes.value.map((item) => item.id))
      const campusByName = new Map(campuses.value.map((item) => [item.name, item.id] as const))
      const campusById = new Set(campuses.value.map((item) => item.id))
      const existingKeys = new Set(roomRecords.value.map((item) => `${item.campusId}::${item.roomName}`))

      const append: RoomRecord[] = []
      let invalidCount = 0
      let duplicateCount = 0

      rows.slice(1).forEach((row, index) => {
        const roomName = String(row[idxRoomName] || '').trim()
        const roomTypeRaw = String(row[idxRoomType] || '').trim()
        const campusRaw = String(row[idxCampus] || '').trim()
        const buildingName = String(row[idxBuilding] || '').trim() || '教学楼'
        const floorNo = Math.max(1, Math.floor(Number(row[idxFloor] || 1)))
        const capacity = Math.max(1, Math.floor(Number(row[idxCapacity] || 60)))

        const roomTypeId = roomTypeByName.get(roomTypeRaw) || (roomTypeById.has(roomTypeRaw) ? roomTypeRaw : '')
        const campusId = campusByName.get(campusRaw) || (campusById.has(campusRaw) ? campusRaw : '')

        if (!roomName || !roomTypeId || !campusId) {
          invalidCount += 1
          return
        }

        const key = `${campusId}::${roomName}`
        if (existingKeys.has(key)) {
          duplicateCount += 1
          return
        }
        existingKeys.add(key)
        append.push({
          id: `room-import-${Date.now()}-${index}`,
          roomName,
          roomTypeId,
          campusId,
          buildingName,
          floorNo,
          capacity
        })
      })

      if (append.length <= 0) {
        roomImportError.value = '导入失败：未匹配到有效数据（请检查校区/教室类型/教室名）。'
        return
      }

      roomRecords.value = [...append, ...roomRecords.value]
      roomImportError.value = ''
      await persistBasicData(`已导入 ${append.length} 间教室。重复 ${duplicateCount} 条，异常 ${invalidCount} 条。`)
    } catch (error) {
      roomImportError.value = error instanceof Error ? error.message : '读取文件失败，请检查文件格式。'
    } finally {
      target.value = ''
    }
  })()
}

function openEditRoomDialog(record: RoomRecord): void {
  roomEditingId.value = record.id
  roomEditForm.roomName = record.roomName
  roomEditForm.roomTypeId = record.roomTypeId
  roomEditForm.campusId = record.campusId
  roomEditForm.buildingName = record.buildingName
  roomEditForm.floorNo = record.floorNo
  roomEditForm.capacity = record.capacity
  roomEditDialogError.value = ''
  roomEditDialogVisible.value = true
}

function closeEditRoomDialog(): void {
  roomEditDialogVisible.value = false
}

async function submitEditRoomDialog(): Promise<void> {
  const roomName = roomEditForm.roomName.trim()
  if (!roomName) {
    roomEditDialogError.value = '教室名为必填项。'
    return
  }
  if (
    roomRecords.value.some(
      (item) => item.id !== roomEditingId.value && item.roomName === roomName && item.campusId === roomEditForm.campusId
    )
  ) {
    roomEditDialogError.value = '同校区下教室名已存在。'
    return
  }
  roomRecords.value = roomRecords.value.map((item) =>
    item.id === roomEditingId.value
      ? {
          ...item,
          roomName,
          roomTypeId: roomEditForm.roomTypeId,
          campusId: roomEditForm.campusId,
          buildingName: roomEditForm.buildingName.trim() || '教学楼',
          floorNo: Math.max(1, Math.floor(Number(roomEditForm.floorNo) || 1)),
          capacity: Math.max(1, Math.floor(Number(roomEditForm.capacity) || 40))
        }
      : item
  )
  closeEditRoomDialog()
  await persistBasicData('教室信息已更新。')
}

async function removeRoom(record: RoomRecord): Promise<void> {
  const confirmed = await confirmDelete(`确认删除教室「${record.roomName}」吗？`)
  if (!confirmed) return
  roomRecords.value = roomRecords.value.filter((item) => item.id !== record.id)
  classRoomMappings.value = classRoomMappings.value.filter((item) => item.roomId !== record.id)
  selectedRoomIds.value = selectedRoomIds.value.filter((id) => id !== record.id)
  await persistBasicData('教室已删除。')
}

function onRoomSelectionChange(rows: RoomRecord[]): void {
  selectedRoomIds.value = rows.map((item) => item.id)
}

async function removeRoomsBatch(): Promise<void> {
  const ids = Array.from(new Set(selectedRoomIds.value))
  if (ids.length === 0) {
    notify.warning('请先选择要删除的教室。')
    return
  }
  const confirmed = await confirmDelete(`确认批量删除已选 ${ids.length} 间教室吗？将同步清除相关班级教室映射。`)
  if (!confirmed) return
  const idSet = new Set(ids)
  roomRecords.value = roomRecords.value.filter((item) => !idSet.has(item.id))
  classRoomMappings.value = classRoomMappings.value.filter((item) => !idSet.has(item.roomId))
  selectedRoomIds.value = []
  roomTableRef.value?.clearSelection()
  await persistBasicData(`已删除 ${ids.length} 间教室。`)
}

function getClassRoomOptions(classId: string): RoomRecord[] {
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return []
  const sameCampus = roomRecords.value
    .filter((item) => item.campusId === classInfo.campusId)
    .slice()
    .sort((a, b) => a.roomName.localeCompare(b.roomName, 'zh-Hans-CN'))
  return sameCampus
}

async function updateClassRoomSelection(classId: string, roomId: string): Promise<void> {
  const sanitizedRoomId = String(roomId ?? '').trim()
  const nextMappings =
    sanitizedRoomId.length > 0
      ? [...classRoomMappings.value.filter((item) => item.classId !== classId), { classId, roomId: sanitizedRoomId }]
      : classRoomMappings.value.filter((item) => item.classId !== classId)
  const normalized = normalizeClassRoomMappings(
    nextMappings,
    classRecords.value,
    roomRecords.value
  )
  classRoomMappings.value = normalized
  await persistBasicData(sanitizedRoomId ? '班级教室映射已更新。' : '班级教室映射已清空。')
}

async function saveClassRoomMapData(): Promise<void> {
  await persistBasicData('班级教室映射已保存。')
}

function downloadClassRoomMapTemplate(): void {
  exportCsv('班级教室导入模板.csv', [['校区', '年级', '班级', '教室'], ['本校区', '一年级', '一年级1班', '101']])
}

function exportClassRoomMapData(): void {
  const rows = filteredClassroomMapView.value.map((item) => [item.campusName, item.grade, item.className, item.roomName])
  exportCsv('班级教室导出.csv', [['校区', '年级', '班级', '教室'], ...rows])
}

function triggerClassRoomMapImport(): void {
  classRoomMapImportError.value = ''
  classRoomMapImportInput.value?.click()
}

function handleClassRoomMapImport(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = async () => {
    const content = String(reader.result ?? '')
    const lines = content
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length <= 1) {
      classRoomMapImportError.value = '未识别到有效数据，请检查模板。'
      target.value = ''
      return
    }

    const classByKey = new Map(
      classRecords.value.map((item) => [`${item.campusId}::${item.grade}::${item.className}`, item.id] as const)
    )
    const campusByName = new Map(campuses.value.map((item) => [item.name, item.id] as const))
    const roomByCampusAndName = new Map(
      roomRecords.value.map((item) => [`${item.campusId}::${item.roomName}`, item.id] as const)
    )
    const nextMappings = [...classRoomMappings.value]
    let success = 0

    lines.slice(1).forEach((line) => {
      const cols = parseCsvLine(line)
      const campusName = (cols[0] ?? '').trim()
      const grade = (cols[1] ?? '').trim()
      const className = (cols[2] ?? '').trim()
      const roomName = (cols[3] ?? '').trim()
      const campusId = campusByName.get(campusName) ?? ''
      const classId = classByKey.get(`${campusId}::${grade}::${className}`) ?? ''
      const roomId = roomByCampusAndName.get(`${campusId}::${roomName}`) ?? ''
      if (!classId || !roomId) return
      const idx = nextMappings.findIndex((item) => item.classId === classId)
      if (idx >= 0) {
        nextMappings[idx] = { classId, roomId }
      } else {
        nextMappings.push({ classId, roomId })
      }
      success += 1
    })

    if (success === 0) {
      classRoomMapImportError.value = '导入失败：未匹配到有效的校区/班级/教室。'
      target.value = ''
      return
    }

    classRoomMappings.value = normalizeClassRoomMappings(nextMappings, classRecords.value, roomRecords.value)
    classRoomMapImportError.value = ''
    target.value = ''
    await persistBasicData(`已导入 ${success} 条班级教室映射。`)
  }
  reader.onerror = () => {
    classRoomMapImportError.value = '读取文件失败，请重试。'
    target.value = ''
  }
  reader.readAsText(file, 'utf-8')
}

const teacherImportInput = ref<HTMLInputElement | null>(null)
const teacherImportError = ref('')
const teacherColumns = ['教师ID', '姓名', '学科', '教研与活动分组', '校区']
const studentImportInput = ref<HTMLInputElement | null>(null)
const studentImportError = ref('')
const studentColumns = ['学生ID', '年级', '班级', '姓名', '性别', '班内学号']
const teacherSearchKeyword = ref('')
const teacherPage = ref(1)
const teacherPageSize = ref(15)
const teacherPageSizeOptions = [15, 30, 50, 100]
const teacherTableRef = ref<TableInstance | null>(null)
const selectedTeacherIds = ref<string[]>([])
const teacherCreateDialogVisible = ref(false)
const teacherCreateDialogError = ref('')
const teacherEditDialogVisible = ref(false)
const teacherEditDialogError = ref('')
const teacherEditingId = ref('')
const teacherCreateForm = reactive({
  name: '',
  campusId: ''
})
const teacherEditForm = reactive({
  name: '',
  campusId: ''
})

const teacherDerivedInfoMap = computed(() => {
  const courseMap = new Map(courses.value.map((item) => [item.id, item] as const))
  const teacherSubjectMap = new Map<string, string[]>()

  teachingAssignments.value.forEach((item) => {
    const course = courseMap.get(item.courseId)
    if (!course) return
    const subject = (course.name || course.subject || '').trim()
    if (!subject) return
    if (!teacherSubjectMap.has(item.teacherId)) {
      teacherSubjectMap.set(item.teacherId, [])
    }
    teacherSubjectMap.get(item.teacherId)!.push(subject)
  })

  const result = new Map<string, { subject: string; subjectGroup: string }>()
  teacherSubjectMap.forEach((subjectList, teacherId) => {
    const uniqueSubjects = Array.from(new Set(subjectList.map((item) => item.trim()).filter(Boolean)))
    const subject = uniqueSubjects.join('、')
    const subjectGroup = Array.from(new Set(uniqueSubjects.map((item) => getDefaultSubjectGroup(item)))).join('、')
    result.set(teacherId, { subject, subjectGroup })
  })
  return result
})

const teacherRecordView = computed<TeacherRecordView[]>(() =>
  teacherRecords.value.map((item) => {
    const derived = teacherDerivedInfoMap.value.get(item.id)
    return {
      ...item,
      subject: derived?.subject ?? '',
      subjectGroup: derived?.subjectGroup ?? ''
    }
  })
)

const filteredTeacherRecords = computed(() => {
  const keyword = teacherSearchKeyword.value.trim().toLowerCase()
  if (!keyword) return teacherRecordView.value

  return teacherRecordView.value.filter((item) => {
    const campusName = campuses.value.find((campus) => campus.id === item.campusId)?.name ?? '本校区'
    return [item.id, item.name, item.subject, item.subjectGroup, campusName].some((field) =>
      field.toLowerCase().includes(keyword)
    )
  })
})

const pagedTeacherRecords = computed(() => {
  const start = (teacherPage.value - 1) * teacherPageSize.value
  const end = start + teacherPageSize.value
  return filteredTeacherRecords.value.slice(start, end)
})

const selectedTeacherCount = computed(() => selectedTeacherIds.value.length)

watch(
  [filteredTeacherRecords, teacherPageSize],
  () => {
    const total = filteredTeacherRecords.value.length
    const maxPage = Math.max(1, Math.ceil(total / teacherPageSize.value))
    if (teacherPage.value > maxPage) {
      teacherPage.value = maxPage
    }
  },
  { immediate: true }
)

watch(
  teacherSearchKeyword,
  () => {
    teacherPage.value = 1
  }
)

const studentEntryCampusId = ref('')
const studentEntryGrade = ref('')
const studentEntryClassId = ref('')
const studentPage = ref(1)
const studentPageSize = ref(15)
const studentPageSizeOptions = [15, 30, 50, 100]
const studentCreateDialogVisible = ref(false)
const studentCreateDialogError = ref('')
const studentEditDialogVisible = ref(false)
const studentEditDialogError = ref('')
const studentEditingId = ref('')
const studentCreateForm = reactive({
  grade: '',
  classId: '',
  name: '',
  gender: '男' as '男' | '女',
  classStudentNo: 1
})
const studentEditForm = reactive({
  grade: '',
  classId: '',
  name: '',
  gender: '男' as '男' | '女',
  classStudentNo: 1
})

const studentGradeOptions = computed(() =>
  Array.from(
    new Set(
      classRecords.value
        .filter((item) => !studentEntryCampusId.value || item.campusId === studentEntryCampusId.value)
        .map((item) => item.grade)
    )
  ).sort((a, b) => (gradeOrderMap[a] ?? 999) - (gradeOrderMap[b] ?? 999))
)

const studentClassOptions = computed(() =>
  classRecords.value
    .filter((item) => !studentEntryCampusId.value || item.campusId === studentEntryCampusId.value)
    .filter((item) => !studentEntryGrade.value || item.grade === studentEntryGrade.value)
    .sort((a, b) => (gradeOrderMap[a.grade] ?? 999) - (gradeOrderMap[b.grade] ?? 999) || a.classNo - b.classNo)
)

const studentFormGradeOptions = computed(() =>
  Array.from(
    new Set(
      classRecords.value
        .filter((item) => !studentEntryCampusId.value || item.campusId === studentEntryCampusId.value)
        .map((item) => item.grade)
    )
  ).sort((a, b) => (gradeOrderMap[a] ?? 999) - (gradeOrderMap[b] ?? 999))
)

function getStudentFormClassOptions(grade: string): ClassRecord[] {
  return classRecords.value
    .filter((item) => !studentEntryCampusId.value || item.campusId === studentEntryCampusId.value)
    .filter((item) => !grade || item.grade === grade)
    .sort((a, b) => a.classNo - b.classNo)
}

const studentCreateClassOptions = computed(() => getStudentFormClassOptions(studentCreateForm.grade))
const studentEditClassOptions = computed(() => getStudentFormClassOptions(studentEditForm.grade))

const studentRecordView = computed(() => {
  const classMap = new Map(classRecords.value.map((item) => [item.id, item] as const))
  return studentRecords.value
    .filter((item) => !studentEntryCampusId.value || item.campusId === studentEntryCampusId.value)
    .filter((item) => !studentEntryGrade.value || item.grade === studentEntryGrade.value)
    .filter((item) => !studentEntryClassId.value || item.classId === studentEntryClassId.value)
    .map((item) => {
      const classInfo = classMap.get(item.classId)
      return {
        ...item,
        classNo: classInfo?.classNo ?? 999,
        className: classInfo?.className ?? '--'
      }
    })
    .sort(
      (a, b) =>
        (gradeOrderMap[a.grade] ?? 999) - (gradeOrderMap[b.grade] ?? 999) ||
        a.classNo - b.classNo ||
        a.classStudentNo - b.classStudentNo
    )
})

const pagedStudentRecordView = computed(() => {
  const start = (studentPage.value - 1) * studentPageSize.value
  const end = start + studentPageSize.value
  return studentRecordView.value.slice(start, end)
})

watch(
  campuses,
  (items) => {
    if (!items.some((item) => item.id === studentEntryCampusId.value)) {
      studentEntryCampusId.value = items[0]?.id ?? ''
    }
  },
  { deep: true, immediate: true }
)

watch(
  studentGradeOptions,
  (items) => {
    if (!items.includes(studentEntryGrade.value)) {
      studentEntryGrade.value = items[0] ?? ''
    }
  },
  { immediate: true }
)

watch(
  studentClassOptions,
  (items) => {
    if (!items.some((item) => item.id === studentEntryClassId.value)) {
      studentEntryClassId.value = ''
    }
  },
  { immediate: true }
)

watch(
  [studentRecordView, studentPageSize],
  () => {
    const total = studentRecordView.value.length
    const maxPage = Math.max(1, Math.ceil(total / studentPageSize.value))
    if (studentPage.value > maxPage) {
      studentPage.value = maxPage
    }
  },
  { immediate: true }
)

watch(
  () => [studentEntryCampusId.value, studentEntryGrade.value, studentEntryClassId.value] as const,
  () => {
    studentPage.value = 1
  }
)

watch(
  () => studentCreateForm.grade,
  () => {
    if (!studentCreateClassOptions.value.some((item) => item.id === studentCreateForm.classId)) {
      studentCreateForm.classId = studentCreateClassOptions.value[0]?.id ?? ''
    }
  }
)

watch(
  () => studentEditForm.grade,
  () => {
    if (!studentEditClassOptions.value.some((item) => item.id === studentEditForm.classId)) {
      studentEditForm.classId = studentEditClassOptions.value[0]?.id ?? ''
    }
  }
)

function openCreateStudentDialog(): void {
  const grade = studentEntryGrade.value || studentFormGradeOptions.value[0] || ''
  const classes = getStudentFormClassOptions(grade)
  studentCreateForm.grade = grade
  studentCreateForm.classId = classes[0]?.id ?? ''
  studentCreateForm.name = ''
  studentCreateForm.gender = '男'
  studentCreateForm.classStudentNo = 1
  studentCreateDialogError.value = ''
  studentCreateDialogVisible.value = true
}

function closeCreateStudentDialog(): void {
  studentCreateDialogVisible.value = false
}

async function submitCreateStudentDialog(): Promise<void> {
  const name = studentCreateForm.name.trim()
  if (!name) {
    studentCreateDialogError.value = '姓名为必填项。'
    return
  }
  const classInfo = classRecords.value.find((item) => item.id === studentCreateForm.classId)
  if (!classInfo) {
    studentCreateDialogError.value = '请选择班级。'
    return
  }
  const classStudentNo = Number(studentCreateForm.classStudentNo)
  if (!Number.isFinite(classStudentNo) || classStudentNo <= 0) {
    studentCreateDialogError.value = '班内学号必须大于 0。'
    return
  }

  studentRecords.value.unshift({
    id: generateStudentId(studentRecords.value.map((item) => item.id)),
    campusId: classInfo.campusId,
    grade: classInfo.grade,
    classId: classInfo.id,
    name,
    gender: studentCreateForm.gender,
    classStudentNo: Math.floor(classStudentNo)
  })
  closeCreateStudentDialog()
  await persistBasicData('学生已新增。')
}

function openEditStudentDialog(row: StudentRecord): void {
  studentEditingId.value = row.id
  studentEditForm.grade = row.grade
  studentEditForm.classId = row.classId
  studentEditForm.name = row.name
  studentEditForm.gender = row.gender
  studentEditForm.classStudentNo = row.classStudentNo
  studentEditDialogError.value = ''
  studentEditDialogVisible.value = true
}

function closeEditStudentDialog(): void {
  studentEditDialogVisible.value = false
}

async function submitEditStudentDialog(): Promise<void> {
  const name = studentEditForm.name.trim()
  if (!name) {
    studentEditDialogError.value = '姓名为必填项。'
    return
  }
  const classInfo = classRecords.value.find((item) => item.id === studentEditForm.classId)
  if (!classInfo) {
    studentEditDialogError.value = '请选择班级。'
    return
  }
  const classStudentNo = Number(studentEditForm.classStudentNo)
  if (!Number.isFinite(classStudentNo) || classStudentNo <= 0) {
    studentEditDialogError.value = '班内学号必须大于 0。'
    return
  }

  studentRecords.value = studentRecords.value.map((item) =>
    item.id === studentEditingId.value
      ? {
          ...item,
          campusId: classInfo.campusId,
          grade: classInfo.grade,
          classId: classInfo.id,
          name,
          gender: studentEditForm.gender,
          classStudentNo: Math.floor(classStudentNo)
        }
      : item
  )
  closeEditStudentDialog()
  await persistBasicData('学生信息已更新。')
}

async function removeStudent(row: StudentRecord): Promise<void> {
  const confirmed = await confirmDelete(`确认删除学生「${row.name}」吗？`)
  if (!confirmed) return
  studentRecords.value = studentRecords.value.filter((item) => item.id !== row.id)
  await persistBasicData('学生已删除。')
}

async function generateVirtualStudentsPerClass(count = 50): Promise<void> {
  const campusId = studentEntryCampusId.value || campuses.value[0]?.id || ''
  if (!campusId) {
    notify.warning('请先配置校区。')
    return
  }
  const classes = classRecords.value
    .filter((item) => item.campusId === campusId)
    .sort((a, b) => (gradeOrderMap[a.grade] ?? 999) - (gradeOrderMap[b.grade] ?? 999) || a.classNo - b.classNo)

  if (classes.length === 0) {
    notify.warning('当前校区暂无班级，请先在班级设置中生成班级。')
    return
  }

  const existingIds = studentRecords.value.map((item) => item.id)
  const classIdSet = new Set(classes.map((item) => item.id))
  const kept = studentRecords.value.filter((item) => !classIdSet.has(item.classId))
  const generated: StudentRecord[] = []

  classes.forEach((classInfo) => {
    for (let no = 1; no <= count; no += 1) {
      const id = generateStudentId(existingIds)
      existingIds.push(id)
      generated.push({
        id,
        campusId: classInfo.campusId,
        grade: classInfo.grade,
        classId: classInfo.id,
        name: `学生${classInfo.grade}${classInfo.classNo}班${String(no).padStart(2, '0')}`,
        gender: Math.random() < 0.5 ? '男' : '女',
        classStudentNo: no
      })
    }
  })

  studentRecords.value = [...kept, ...generated]
  await persistBasicData(`已生成虚拟学生：${classes.length} 个班级，每班 ${count} 人。`)
}

async function clearVirtualStudents(): Promise<void> {
  const virtualPattern = /^学生.+班\d{2}$/
  const targets = studentRecords.value.filter((item) => virtualPattern.test(item.name))
  if (targets.length === 0) {
    notify.info('当前没有可清除的虚拟学生。')
    return
  }

  const confirmed = await confirmDelete(`确认清除 ${targets.length} 名虚拟学生吗？`)
  if (!confirmed) return

  const removeIds = new Set(targets.map((item) => item.id))
  studentRecords.value = studentRecords.value.filter((item) => !removeIds.has(item.id))
  await persistBasicData(`已清除 ${targets.length} 名虚拟学生。`)
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function exportCsv(filename: string, rows: string[][]): void {
  const content = `\uFEFF${rows.map((line) => line.map(csvEscape).join(',')).join('\n')}`
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function exportExcel(filename: string, rows: string[][], sheetName = 'Sheet1'): Promise<void> {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, filename)
}

async function parseSpreadsheetRows(file: File): Promise<string[][]> {
  const fileBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(fileBuffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames?.[0]
  if (!firstSheetName) return []
  const firstSheet = workbook.Sheets[firstSheetName]
  if (!firstSheet) return []
  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: '',
    blankrows: false
  }) as Array<Array<string | number | boolean | null | undefined>>
  return rows.map((row) => row.map((value) => String(value ?? '').trim())).filter((row) => row.some(Boolean))
}

async function downloadTeacherTemplate(): Promise<void> {
  try {
    await exportExcel('教师导入模板.xlsx', [teacherColumns, ['', '王老师', '语文', '语文组', '本校区']], '教师模板')
  } catch (error) {
    notify.error(error instanceof Error ? error.message : '下载模板失败，请稍后重试。')
  }
}

async function exportTeacherData(): Promise<void> {
  const rows = teacherRecordView.value.map((item) => [
    item.id,
    item.name,
    item.subject,
    item.subjectGroup,
    campuses.value.find((campus) => campus.id === item.campusId)?.name ?? '本校区'
  ])
  try {
    await exportExcel('教师数据导出.xlsx', [teacherColumns, ...rows], '教师数据')
  } catch (error) {
    notify.error(error instanceof Error ? error.message : '导出失败，请稍后重试。')
  }
}

function downloadStudentTemplate(): void {
  exportCsv('学生导入模板.csv', [studentColumns, ['', '一年级', '一年级1班', '张三', '男', '1']])
}

function exportStudentData(): void {
  const classMap = new Map(classRecords.value.map((item) => [item.id, item] as const))
  const rows = studentRecordView.value.map((item) => [
    item.id,
    item.grade,
    classMap.get(item.classId)?.className ?? '',
    item.name,
    item.gender,
    String(item.classStudentNo)
  ])
  exportCsv('学生数据导出.csv', [studentColumns, ...rows])
}

async function downloadCourseTemplate(): Promise<void> {
  try {
    await exportExcel('学科导入模板.xlsx', [COURSE_COLUMNS, ['语文', '', '语文', '小学', '本校区']], '学科模板')
  } catch (error) {
    notify.error(error instanceof Error ? error.message : '下载模板失败，请稍后重试。')
  }
}

async function exportCourseData(): Promise<void> {
  const campusNameById = new Map(campuses.value.map((item) => [item.id, item.name] as const))
  const rows = courses.value.map((item) => [
    item.name,
    item.shortName,
    item.subject,
    item.scopes[0] ?? '小学',
    item.campusId ? (campusNameById.get(item.campusId) ?? item.campusId) : '全部校区'
  ])
  try {
    await exportExcel('学科数据导出.xlsx', [COURSE_COLUMNS, ...rows], '学科数据')
  } catch (error) {
    notify.error(error instanceof Error ? error.message : '导出失败，请稍后重试。')
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuote = !inQuote
      }
      continue
    }

    if (char === ',' && !inQuote) {
      result.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  result.push(current.trim())
  return result
}

function parseTeacherRows(rows: string[][]): TeacherRecord[] {
  if (rows.length <= 1) return []

  const fallbackCampusId = campuses.value[0]?.id ?? ''
  const allocatedIds = teacherRecords.value.map((item) => item.id)
  const header = rows[0] ?? []
  const hasIdColumn = String(header[0] ?? '').includes('教师ID')

  return rows
    .slice(1)
    .map((columns) => {
      const idRaw = hasIdColumn ? String(columns[0] ?? '').trim() : ''
      const name = hasIdColumn ? String(columns[1] ?? '').trim() : String(columns[0] ?? '').trim()
      const maybeSubject = hasIdColumn
        ? String(columns.length >= 5 ? columns[2] ?? '' : '').trim()
        : String(columns.length >= 4 ? columns[1] ?? '' : '').trim()
      const maybeSubjectGroup = hasIdColumn
        ? String(columns.length >= 5 ? columns[3] ?? '' : '').trim()
        : String(columns.length >= 4 ? columns[2] ?? '' : '').trim()
      const campusNameOrId = hasIdColumn
        ? String(columns.length >= 5 ? columns[4] ?? '' : columns[2] ?? '').trim()
        : String(columns.length >= 4 ? columns[3] ?? '' : columns[1] ?? '').trim()

      if (!name) return null

      const matchedCampusByName = campuses.value.find((campus) => campus.name === campusNameOrId)
      const matchedCampusById = campuses.value.find((campus) => campus.id === campusNameOrId)
      const campusId = matchedCampusByName?.id ?? matchedCampusById?.id ?? fallbackCampusId
      const id = idRaw || generateNextTeacherId(allocatedIds)
      allocatedIds.push(id)

      return {
        id,
        name,
        subject: maybeSubject || '未设置',
        subjectGroup: maybeSubjectGroup || getDefaultSubjectGroup(maybeSubject || '未设置'),
        campusId
      } as TeacherRecord
    })
    .filter((item): item is TeacherRecord => Boolean(item))
}

function parseStudentCsv(content: string, campusId: string): StudentRecord[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length <= 1) return []

  const header = parseCsvLine(lines[0] ?? '')
  const hasIdColumn = (header[0] ?? '').includes('学生ID')
  const classPool = classRecords.value.filter((item) => item.campusId === campusId)
  const classFallbackPool = classPool.length > 0 ? classPool : classRecords.value
  const allocatedIds = studentRecords.value.map((item) => item.id)

  return lines
    .slice(1)
    .map((line, index) => {
      const columns = parseCsvLine(line)
      const idRaw = hasIdColumn ? (columns[0] ?? '').trim() : ''
      const grade = (hasIdColumn ? columns[1] : columns[0] ?? '').trim()
      const className = (hasIdColumn ? columns[2] : columns[1] ?? '').trim()
      const name = (hasIdColumn ? columns[3] : columns[2] ?? '').trim()
      const genderInput = (hasIdColumn ? columns[4] : columns[3] ?? '').trim()
      const noInput = (hasIdColumn ? columns[5] : columns[4] ?? '').trim()
      if (!grade || !className || !name) return null

      const classInfo = classFallbackPool.find((item) => item.grade === grade && item.className === className)
      if (!classInfo) return null

      const classStudentNoRaw = Number(noInput)
      const classStudentNo =
        Number.isFinite(classStudentNoRaw) && classStudentNoRaw > 0 ? Math.floor(classStudentNoRaw) : index + 1
      const id = idRaw || generateStudentId(allocatedIds)
      allocatedIds.push(id)

      return {
        id,
        campusId: classInfo.campusId,
        grade: classInfo.grade,
        classId: classInfo.id,
        name,
        gender: genderInput === '女' ? '女' : '男',
        classStudentNo
      } as StudentRecord
    })
    .filter((item): item is StudentRecord => Boolean(item))
}

function parseCourseRows(rows: string[][]): CourseItem[] {
  if (rows.length <= 1) return []
  const campusByName = new Map(campuses.value.map((item) => [item.name, item.id] as const))
  const campusIdSet = new Set(campuses.value.map((item) => item.id))

  return rows.slice(1).map((columns, index) => {
    const name = columns[0] ?? ''
    const shortName = columns[1] ?? ''
    const subject = columns[2] ?? name
    const rawScope = columns[3] ?? ''
    const rawCampus = columns[4] ?? ''
    const mappedCampusId = campusByName.get(rawCampus.trim()) ?? ''
    const campusId = mappedCampusId || (campusIdSet.has(rawCampus.trim()) ? rawCampus.trim() : '')
    const normalizedScope = normalizeCourseScopeInput(rawScope)
    const scope: CourseScope = normalizedScope === '初中' ? '初中' : '小学'
    return {
      id: `course-import-${Date.now()}-${index}`,
      name: name || `未命名学科${index + 1}`,
      shortName: shortName.trim(),
      subject: subject.trim() || name || '未设置',
      scopes: [scope],
      campusId
    }
  })
}

function triggerTeacherImport(): void {
  teacherImportError.value = ''
  teacherImportInput.value?.click()
}

function triggerStudentImport(): void {
  studentImportError.value = ''
  studentImportInput.value?.click()
}

const courseImportInput = ref<HTMLInputElement | null>(null)
const courseImportError = ref('')

function triggerCourseImport(): void {
  courseImportError.value = ''
  courseImportInput.value?.click()
}

function handleCourseImport(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  void (async () => {
    try {
      const rows = await parseSpreadsheetRows(file)
      const imported = parseCourseRows(rows)
      if (imported.length === 0) {
        courseImportError.value = '未识别到有效学科数据，请检查模板格式。'
        return
      }

      const existingKey = new Set(
        courses.value.map((item) => `${item.name}::${item.scopes[0] ?? '小学'}::${item.campusId || ''}`)
      )
      const append = imported.filter(
        (item) => !existingKey.has(`${item.name}::${item.scopes[0] ?? '小学'}::${item.campusId || ''}`)
      )
      if (append.length === 0) {
        courseImportError.value = '导入完成：未新增数据（重复记录已自动跳过）。'
        return
      }
      courses.value = normalizeCourseRecords([...courses.value, ...append])
      courseImportError.value = ''
      const saved = await persistBasicData(undefined, { silentSuccess: true })
      if (saved) {
        await verifyCoursePersistence(`已新增 ${append.length} 条学科数据。`)
      }
    } catch (error) {
      courseImportError.value =
        error instanceof Error ? error.message : '读取文件失败，请检查文件格式后重试。'
    } finally {
      target.value = ''
    }
  })()
}

function handleTeacherImport(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  void (async () => {
    try {
      const rows = await parseSpreadsheetRows(file)
      const imported = parseTeacherRows(rows)
      if (imported.length === 0) {
        teacherImportError.value = '未识别到有效教师数据，请检查模板格式。'
        return
      }
      teacherRecords.value = normalizeTeacherRecords(imported)
      teacherImportError.value = ''
      await persistBasicData(`已导入 ${imported.length} 条教师数据。`)
    } catch (error) {
      teacherImportError.value =
        error instanceof Error ? error.message : '读取文件失败，请检查文件格式后重试。'
    } finally {
      target.value = ''
    }
  })()
}

function handleStudentImport(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    const content = String(reader.result ?? '')
    const campusId = studentEntryCampusId.value || campuses.value[0]?.id || ''
    const imported = parseStudentCsv(content, campusId)
    if (imported.length === 0) {
      studentImportError.value = '未识别到有效学生数据，请检查年级/班级是否已存在。'
      target.value = ''
      return
    }

    studentRecords.value = normalizeStudentRecords([...studentRecords.value, ...imported], classRecords.value)
    studentImportError.value = ''
    target.value = ''
    notify.success(`已导入 ${imported.length} 条学生数据（Mock）。`)
  }
  reader.onerror = () => {
    studentImportError.value = '读取文件失败，请重试。'
    target.value = ''
  }
  reader.readAsText(file, 'utf-8')
}

async function removeTeacher(record: TeacherRecord): Promise<void> {
  const confirmed = await confirmDelete(`确认删除教师「${record.name}」吗？`)
  if (!confirmed) return
  teachingAssignments.value = teachingAssignments.value.filter((item) => item.teacherId !== record.id)
  teacherRecords.value = teacherRecords.value.filter((item) => item.id !== record.id)
  selectedTeacherIds.value = selectedTeacherIds.value.filter((id) => id !== record.id)
}

function onTeacherSelectionChange(rows: TeacherRecordView[]): void {
  selectedTeacherIds.value = rows.map((item) => item.id)
}

async function removeTeachersBatch(): Promise<void> {
  const ids = Array.from(new Set(selectedTeacherIds.value))
  if (ids.length === 0) {
    notify.warning('请先选择要删除的教师。')
    return
  }
  const confirmed = await confirmDelete(`确认批量删除已选 ${ids.length} 名教师吗？将同步删除其任课信息。`)
  if (!confirmed) return

  const idSet = new Set(ids)
  teachingAssignments.value = teachingAssignments.value.filter((item) => !idSet.has(item.teacherId))
  teacherRecords.value = teacherRecords.value.filter((item) => !idSet.has(item.id))
  selectedTeacherIds.value = []
  teacherTableRef.value?.clearSelection()
  notify.success(`已删除 ${ids.length} 名教师。`)
}

function openCreateTeacherDialog(): void {
  teacherCreateForm.name = ''
  teacherCreateForm.campusId = campuses.value[0]?.id ?? ''
  teacherCreateDialogError.value = ''
  teacherCreateDialogVisible.value = true
}

function closeCreateTeacherDialog(): void {
  teacherCreateDialogVisible.value = false
}

function submitCreateTeacherDialog(): void {
  const name = teacherCreateForm.name.trim()
  if (!name) {
    teacherCreateDialogError.value = '姓名为必填项。'
    return
  }

  const campusId = teacherCreateForm.campusId || campuses.value[0]?.id || ''

  teacherRecords.value.unshift({
    id: generateNextTeacherId(teacherRecords.value.map((item) => item.id)),
    name,
    subject: '',
    subjectGroup: '',
    campusId
  })
  teacherCreateDialogVisible.value = false
  notify.success('教师已新增。')
}

function openEditTeacherDialog(record: TeacherRecord): void {
  teacherEditingId.value = record.id
  teacherEditForm.name = record.name
  teacherEditForm.campusId = record.campusId
  teacherEditDialogError.value = ''
  teacherEditDialogVisible.value = true
}

function closeEditTeacherDialog(): void {
  teacherEditDialogVisible.value = false
}

function submitEditTeacherDialog(): void {
  const name = teacherEditForm.name.trim()
  const campusId = teacherEditForm.campusId || campuses.value[0]?.id || ''

  if (!name) {
    teacherEditDialogError.value = '姓名为必填项。'
    return
  }

  teacherRecords.value = teacherRecords.value.map((item) =>
        item.id === teacherEditingId.value
      ? {
          ...item,
          name,
          campusId
        }
      : item
  )
  closeEditTeacherDialog()
  notify.success('教师信息已更新。')
}

const groupTableRef = ref<TableInstance | null>(null)
const selectedGroupIds = ref<string[]>([])
const DEFAULT_GROUP_TYPES = ['教研与活动分组', '会议组', '协作组']
const groupTypeOptions = computed<string[]>(() =>
  Array.from(new Set([...DEFAULT_GROUP_TYPES, ...groupRecords.value.map((item) => item.type).filter(Boolean)]))
)
const groupSearchKeyword = ref('')
const groupFilterCampusId = ref('')
const groupFilterType = ref('全部类型')
const groupDialogVisible = ref(false)
const groupDialogMode = ref<'create' | 'edit'>('create')
const groupEditingId = ref('')
const groupDialogError = ref('')
const groupForm = reactive<{
  name: string
  type: string
  campusId: string
  memberNames: string[]
  remark: string
}>({
  name: '',
  type: '教研与活动分组',
  campusId: '',
  memberNames: [],
  remark: ''
})

function parseMemberNames(raw: string): string[] {
  return raw
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const groupCampusOptions = computed(() => campuses.value.map((item) => ({ id: item.id, name: item.name })))
const groupMemberOptions = computed(() => {
  const campusId = groupForm.campusId || campuses.value[0]?.id || ''
  return Array.from(
    new Set(
      teacherRecords.value
        .filter((item) => !campusId || item.campusId === campusId)
        .map((item) => item.name)
        .filter(Boolean)
    )
  )
})
const groupRecordView = computed(() => {
  const keyword = groupSearchKeyword.value.trim().toLowerCase()
  return groupRecords.value.filter((item) => {
    if (groupFilterCampusId.value && item.campusId !== groupFilterCampusId.value) return false
    if (groupFilterType.value !== '全部类型' && item.type !== groupFilterType.value) return false
    if (!keyword) return true
    const campusName = campuses.value.find((campus) => campus.id === item.campusId)?.name ?? ''
    return [item.name, item.type, campusName, item.memberNames.join('、'), item.remark || '']
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })
})

watch(
  groupCampusOptions,
  (items) => {
    if (!items.some((item) => item.id === groupForm.campusId)) {
      groupForm.campusId = items[0]?.id ?? ''
    }
  },
  { immediate: true }
)

function openGroupDialog(record?: GroupRecord): void {
  if (record) {
    groupDialogMode.value = 'edit'
    groupEditingId.value = record.id
    groupForm.name = record.name
    groupForm.type = record.type
    groupForm.campusId = record.campusId
    groupForm.memberNames = [...record.memberNames]
    groupForm.remark = record.remark || ''
  } else {
    groupDialogMode.value = 'create'
    groupEditingId.value = ''
    groupForm.name = ''
    groupForm.type = '教研与活动分组'
    groupForm.campusId = campuses.value[0]?.id ?? ''
    groupForm.memberNames = []
    groupForm.remark = ''
  }
  groupDialogError.value = ''
  groupDialogVisible.value = true
}

function closeGroupDialog(): void {
  groupDialogVisible.value = false
}

const selectedGroupCount = computed(() => selectedGroupIds.value.length)

function createGroupRecord(): void {
  openGroupDialog()
}

function editGroupRecord(record: GroupRecord): void {
  openGroupDialog(record)
}

async function submitGroupDialog(): Promise<void> {
  const name = groupForm.name.trim()
  const campusId = groupForm.campusId || campuses.value[0]?.id || ''
  const type = groupForm.type.trim() || '教研与活动分组'
  const remark = groupForm.remark.trim()
  const memberNames = Array.from(new Set(groupForm.memberNames.map((item) => item.trim()).filter(Boolean)))

  if (!name) {
    groupDialogError.value = '请填写分组名称。'
    return
  }
  if (!campusId) {
    groupDialogError.value = '请先设置校区后再维护分组。'
    return
  }
  const duplicated = groupRecords.value.some(
    (item) =>
      item.id !== groupEditingId.value && item.campusId === campusId && item.type === type && item.name.trim() === name
  )
  if (duplicated) {
    groupDialogError.value = '同校区下已存在同名同类型分组，请更换名称。'
    return
  }

  const previous = [...groupRecords.value]
  if (groupDialogMode.value === 'create') {
    groupRecords.value = [
      {
        id: `group-${Date.now()}`,
        name,
        type,
        campusId,
        memberNames,
        remark
      },
      ...groupRecords.value
    ]
  } else {
    groupRecords.value = groupRecords.value.map((item) =>
      item.id === groupEditingId.value
        ? {
            ...item,
            name,
            type,
            campusId,
            memberNames,
            remark
          }
        : item
    )
  }

  const success = await persistBasicData(undefined, { silentSuccess: true })
  if (!success) {
    groupRecords.value = previous
    return
  }
  closeGroupDialog()
  notify.success(groupDialogMode.value === 'create' ? '分组已新增。' : '分组已更新。')
}

async function removeGroupRecord(record: GroupRecord): Promise<void> {
  const confirmed = await confirmDelete(`确认删除分组「${record.name}」吗？`)
  if (!confirmed) return
  const previous = [...groupRecords.value]
  groupRecords.value = groupRecords.value.filter((item) => item.id !== record.id)
  const success = await persistBasicData(undefined, { silentSuccess: true })
  if (!success) {
    groupRecords.value = previous
    return
  }
  notify.success('分组已删除。')
}

function onGroupSelectionChange(rows: GroupRecord[]): void {
  selectedGroupIds.value = rows.map((item) => item.id)
}

async function removeGroupsBatch(): Promise<void> {
  const ids = Array.from(new Set(selectedGroupIds.value))
  if (ids.length === 0) {
    notify.warning('请先选择要删除的分组。')
    return
  }
  const confirmed = await confirmDelete(`确认批量删除已选 ${ids.length} 个分组吗？`)
  if (!confirmed) return
  const previous = [...groupRecords.value]
  const idSet = new Set(ids)
  groupRecords.value = groupRecords.value.filter((item) => !idSet.has(item.id))
  const success = await persistBasicData(undefined, { silentSuccess: true })
  if (!success) {
    groupRecords.value = previous
    return
  }
  selectedGroupIds.value = []
  groupTableRef.value?.clearSelection()
  notify.success(`已删除 ${ids.length} 个分组。`)
}

const teachingInfoCampusId = ref('')
const teachingInfoGrade = ref('')
const teachingInfoCycleId = ref('')
const teachingAssignmentDialogVisible = ref(false)
const teachingAssignmentDialogError = ref('')
const teachingBatchDialogVisible = ref(false)
const teachingBatchDialogError = ref('')
const teachingBatchCampusId = ref('')
const teachingBatchGrade = ref('')
const teachingBatchRows = ref<Array<Record<string, string>>>([])
const teachingBatchDragSelecting = ref(false)
const teachingBatchDragMoved = ref(false)
const teachingBatchSelectionAnchor = ref<{ rowIndex: number; field: string } | null>(null)
const teachingBatchSelectionFocus = ref<{ rowIndex: number; field: string } | null>(null)
const teachingBatchEditingCell = ref<{ rowIndex: number; field: string } | null>(null)
const teachingBatchClickMemory = ref<{ rowIndex: number; field: string; at: number } | null>(null)
const TEACHING_BATCH_EDIT_CLICK_INTERVAL = 900
const teachingAssignmentForm = reactive<{
  campusId: string
  grade: string
  classId: string
  teacherId: string
  courseId: string
  weeklyLessons: number
}>({
  campusId: '',
  grade: '',
  classId: '',
  teacherId: '',
  courseId: '',
  weeklyLessons: 1
})

const teachingInfoGradeOptions = computed(() =>
  Array.from(
    new Set(
      classRecords.value
        .filter((item) => !teachingInfoCampusId.value || item.campusId === teachingInfoCampusId.value)
        .map((item) => item.grade)
    )
  ).sort(
    (a, b) => (gradeOrderMap[a] ?? 999) - (gradeOrderMap[b] ?? 999)
  )
)

const teachingInfoCycleOptions = computed(() => {
  return teachingCycles.value.map((item, index) => ({
    value: item.id,
    label: index === 0 ? `${item.weekRange}(当前)` : item.weekRange
  }))
})

const teachingAssignmentClassOptions = computed(() =>
  classRecords.value
    .filter(
      (item) =>
        item.campusId === teachingAssignmentForm.campusId &&
        item.grade === teachingAssignmentForm.grade
    )
    .sort((a, b) => a.classNo - b.classNo)
)

const teachingAssignmentTeacherOptions = computed(() => {
  const inCampus = teacherRecords.value.filter((item) => item.campusId === teachingAssignmentForm.campusId)
  return inCampus.length > 0 ? inCampus : teacherRecords.value
})

const teachingAssignmentCourseOptions = computed(() => {
  const classInfo = classRecords.value.find((item) => item.id === teachingAssignmentForm.classId)
  if (!classInfo) {
    return courses.value.filter((item) => isCourseVisibleInCampus(item, teachingAssignmentForm.campusId))
  }
  return courses.value.filter(
    (item) => item.scopes.includes(classInfo.stage) && isCourseVisibleInCampus(item, classInfo.campusId)
  )
})

const teachingInfoMatrixClasses = computed(() =>
  classRecords.value
    .filter((item) => item.campusId === teachingInfoCampusId.value && item.grade === teachingInfoGrade.value)
    .sort((a, b) => a.classNo - b.classNo)
)

const teachingInfoMatrixStage = computed(() => teachingInfoMatrixClasses.value[0]?.stage ?? null)

const teachingInfoMatrixCourses = computed(() => {
  const stage = teachingInfoMatrixStage.value
  if (!stage) return []
  return courses.value.filter(
    (item) => item.scopes.includes(stage) && isCourseVisibleInCampus(item, teachingInfoCampusId.value)
  )
})

const teachingInfoTeacherNameMap = computed(() => new Map(teacherRecords.value.map((item) => [item.id, item.name] as const)))

const teachingInfoCellMap = computed(() => {
  const map = new Map<string, string[]>()
  teachingAssignments.value.forEach((item) => {
    if (item.campusId !== teachingInfoCampusId.value || item.grade !== teachingInfoGrade.value) return
    const teacherName = teachingInfoTeacherNameMap.value.get(item.teacherId)
    if (!teacherName) return
    const key = `${item.classId}::${item.courseId}`
    if (!map.has(key)) {
      map.set(key, [])
    }
    map.get(key)!.push(teacherName)
  })
  return map
})

const teachingBatchClasses = computed(() =>
  classRecords.value
    .filter((item) => item.campusId === teachingBatchCampusId.value && item.grade === teachingBatchGrade.value)
    .sort((a, b) => a.classNo - b.classNo)
)

const teachingBatchStage = computed(() => teachingBatchClasses.value[0]?.stage ?? null)
const TEACHING_BATCH_HEAD_TEACHER_FIELD = '__headTeacher__'

const teachingBatchCourses = computed(() => {
  const stage = teachingBatchStage.value
  if (!stage) return []
  return courses.value.filter(
    (item) => item.scopes.includes(stage) && isCourseVisibleInCampus(item, teachingBatchCampusId.value)
  )
})

const teachingBatchEditableFields = computed(() => [
  { id: TEACHING_BATCH_HEAD_TEACHER_FIELD, label: '班主任' },
  ...teachingBatchCourses.value.map((course) => ({ id: course.id, label: course.name }))
])

const teachingBatchCampusName = computed(
  () => campuses.value.find((item) => item.id === teachingBatchCampusId.value)?.name ?? '本校区'
)

const teachingBatchMissingTeacherMap = computed(() => {
  const map = new Map<string, string[]>()
  const campusId = teachingBatchCampusId.value || resolveTeachingInfoCampusId()
  if (!campusId) return map

  teachingBatchRows.value.forEach((row, rowIndex) => {
    teachingBatchEditableFields.value.forEach((field) => {
      const names = parseMemberNames(row[field.id] ?? '')
      if (names.length === 0) return
      const missing = Array.from(
        new Set(names.filter((name) => findTeacherIdsByName(campusId, name).length === 0))
      )
      if (missing.length > 0) {
        map.set(`${rowIndex}::${field.id}`, missing)
      }
    })
  })

  return map
})

const teachingAssignmentRowView = computed(() => {
  const teacherMap = new Map(teacherRecords.value.map((item) => [item.id, item.name] as const))
  const courseMap = new Map(courses.value.map((item) => [item.id, item.name] as const))
  const classMap = new Map(classRecords.value.map((item) => [item.id, item.className] as const))
  const campusMap = new Map(campuses.value.map((item) => [item.id, item.name] as const))
  return teachingAssignments.value
    .filter((item) => !teachingInfoCampusId.value || item.campusId === teachingInfoCampusId.value)
    .filter((item) => !teachingInfoGrade.value || item.grade === teachingInfoGrade.value)
    .map((item, index) => ({
      ...item,
      orderNo: index + 1,
      campusName: campusMap.get(item.campusId) ?? '本校区',
      className: classMap.get(item.classId) ?? '--',
      teacherName: teacherMap.get(item.teacherId) ?? '--',
      courseName: courseMap.get(item.courseId) ?? '--'
    }))
})

watch(
  campuses,
  (items) => {
    if (!items.some((item) => item.id === teachingInfoCampusId.value)) {
      teachingInfoCampusId.value = items[0]?.id ?? ''
    }
  },
  { deep: true, immediate: true }
)

watch(
  teachingInfoGradeOptions,
  (items) => {
    if (!items.includes(teachingInfoGrade.value)) {
      teachingInfoGrade.value = items[0] ?? ''
    }
  },
  { immediate: true }
)

watch(
  teachingInfoCycleOptions,
  (items) => {
    if (!items.some((item) => item.value === teachingInfoCycleId.value)) {
      teachingInfoCycleId.value = items[0]?.value ?? ''
    }
  },
  { immediate: true }
)

function openTeachingAssignmentDialog(): void {
  const firstCampusId = teachingInfoCampusId.value || campuses.value[0]?.id || ''
  const firstGrade = teachingInfoGrade.value || teachingInfoGradeOptions.value[0] || ''
  const firstClass = classRecords.value.find((item) => item.campusId === firstCampusId && item.grade === firstGrade)
  const firstTeacher = teacherRecords.value.find((item) => item.campusId === firstCampusId) ?? teacherRecords.value[0]
  const classStage = firstClass?.stage
  const firstCourse = classStage ? courses.value.find((item) => item.scopes.includes(classStage)) : courses.value[0]

  teachingAssignmentForm.campusId = firstCampusId
  teachingAssignmentForm.grade = firstGrade
  teachingAssignmentForm.classId = firstClass?.id ?? ''
  teachingAssignmentForm.teacherId = firstTeacher?.id ?? ''
  teachingAssignmentForm.courseId = firstCourse?.id ?? ''
  teachingAssignmentForm.weeklyLessons = 1
  teachingAssignmentDialogError.value = ''
  teachingAssignmentDialogVisible.value = true
}

function markTeachingInfoDirty(): void {
  teachingInfoDirty.value = true
}

async function saveTeachingInfo(): Promise<void> {
  await persistBasicData('任课信息已保存。')
}

function resolveTeachingInfoCampusId(): string {
  return teachingInfoCampusId.value || campuses.value[0]?.id || ''
}

function resolveTeachingInfoGrade(): string {
  return teachingInfoGrade.value || teachingInfoGradeOptions.value[0] || ''
}

function getTeachingInfoCellText(classId: string, courseId: string): string {
  const names = teachingInfoCellMap.value.get(`${classId}::${courseId}`) ?? []
  return names.length > 0 ? names.join('、') : '设置'
}

function hasTeachingInfoCellTeachers(classId: string, courseId: string): boolean {
  return (teachingInfoCellMap.value.get(`${classId}::${courseId}`) ?? []).length > 0
}

function classHeadTeacherName(classId: string): string {
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo?.headTeacherId) return '未设置'
  return teachingInfoTeacherNameMap.value.get(classInfo.headTeacherId) || '未设置'
}

function findTeacherIdsByName(campusId: string, name: string): string[] {
  const candidate = teacherRecords.value.filter((item) => item.campusId === campusId && item.name === name).map((item) => item.id)
  if (candidate.length > 0) return candidate
  return teacherRecords.value.filter((item) => item.name === name).map((item) => item.id)
}

async function ensureTeachersExist(
  teacherNames: string[],
  campusId: string
): Promise<{ ok: true } | { ok: false }> {
  const unknownNames = Array.from(
    new Set(teacherNames.map((item) => item.trim()).filter(Boolean).filter((name) => findTeacherIdsByName(campusId, name).length === 0))
  )

  if (unknownNames.length === 0) {
    return { ok: true }
  }

  try {
    await ElMessageBox.confirm(
      `以下教师在系统中不存在：${unknownNames.join('、')}。是否快速创建教师账号并继续？`,
      '教师不存在',
      {
        type: 'warning',
        confirmButtonText: '快速创建并继续',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return { ok: false }
  }

  const allocatedIds = [...teacherRecords.value.map((item) => item.id)]
  const created = unknownNames.map((name) => {
    const id = generateNextTeacherId(allocatedIds)
    allocatedIds.push(id)
    return {
      id,
      name,
      subject: '',
      subjectGroup: '',
      campusId
    }
  })
  teacherRecords.value = [...created, ...teacherRecords.value]
  notify.success(`已快速创建 ${created.length} 名教师账号。`)
  return { ok: true }
}

async function editTeachingInfoCell(classRow: ClassRecord, course: CourseItem): Promise<void> {
  const current = (teachingInfoCellMap.value.get(`${classRow.id}::${course.id}`) ?? []).join('，')
  const value = await askTextInput(
    `请输入「${classRow.className} - ${course.name}」任课教师，多个请用逗号分隔`,
    '设置任课教师',
    current
  )
  if (value === null) return

  const names = parseMemberNames(value)
  const ensureResult = await ensureTeachersExist(names, classRow.campusId)
  if (!ensureResult.ok) return

  const nextTeacherIds: string[] = []

  names.forEach((name) => {
    const matched = findTeacherIdsByName(classRow.campusId, name)
    if (matched.length > 0) {
      nextTeacherIds.push(matched[0])
    }
  })

  const existed = teachingAssignments.value.filter((item) => item.classId === classRow.id && item.courseId === course.id)
  const kept = teachingAssignments.value.filter((item) => !(item.classId === classRow.id && item.courseId === course.id))
  const weeklyByTeacher = new Map(existed.map((item) => [item.teacherId, item.weeklyLessons] as const))
  const created = nextTeacherIds.map((teacherId, index) => ({
    id: `ta-cell-${Date.now()}-${index}`,
    campusId: classRow.campusId,
    grade: classRow.grade,
    classId: classRow.id,
    teacherId,
    courseId: course.id,
    weeklyLessons: weeklyByTeacher.get(teacherId) ?? 1
  }))

  teachingAssignments.value = [...kept, ...created]
  markTeachingInfoDirty()
  notify.success('任课信息已更新，请点击“保存任课信息”。')
}

async function editClassHeadTeacher(classRow: ClassRecord): Promise<void> {
  const currentName = classHeadTeacherName(classRow.id)
  const value = await askTextInput(
    `请输入「${classRow.className}」班主任姓名（多个教师请用逗号分隔，将使用第一个）`,
    '设置班主任',
    currentName === '未设置' ? '' : currentName
  )
  if (value === null) return
  const targetNameList = parseMemberNames(String(value || ''))
  const targetName = targetNameList[0] || ''
  let nextTeacherId = ''
  if (targetName) {
    const ensureResult = await ensureTeachersExist([targetName], classRow.campusId)
    if (!ensureResult.ok) return
    const teacherIds = findTeacherIdsByName(classRow.campusId, targetName)
    if (teacherIds.length <= 0) {
      notify.warning('未找到该教师，请重新输入。')
      return
    }
    nextTeacherId = teacherIds[0]
  }

  classRecords.value = classRecords.value.map((item) =>
    item.id === classRow.id
      ? {
          ...item,
          headTeacherId: nextTeacherId || undefined
        }
      : item
  )
  markTeachingInfoDirty()
  notify.success('班主任已更新，请点击“保存任课信息”。')
}

function openTeachingBatchDialog(): void {
  const campusId = resolveTeachingInfoCampusId()
  const grade = resolveTeachingInfoGrade()
  if (!campusId || !grade) {
    notify.warning('请先选择校区和年级。')
    return
  }

  const classes = classRecords.value
    .filter((item) => item.campusId === campusId && item.grade === grade)
    .sort((a, b) => a.classNo - b.classNo)
  if (classes.length === 0) {
    notify.warning('当前校区和年级下没有班级，请先完成班级设置。')
    return
  }

  const stage = classes[0].stage
  const courseList = courses.value.filter(
    (item) => item.scopes.includes(stage) && isCourseVisibleInCampus(item, campusId)
  )
  if (courseList.length === 0) {
    notify.warning('当前学段暂无课程，请先在课程管理中维护课程。')
    return
  }

  const teacherNameById = new Map(teacherRecords.value.map((item) => [item.id, item.name] as const))
  const classIdSet = new Set(classes.map((item) => item.id))
  const courseIdSet = new Set(courseList.map((item) => item.id))
  const existing = new Map<string, string[]>()

  teachingAssignments.value.forEach((item) => {
    if (
      item.campusId !== campusId ||
      item.grade !== grade ||
      !classIdSet.has(item.classId) ||
      !courseIdSet.has(item.courseId)
    ) {
      return
    }
    const teacherName = teacherNameById.get(item.teacherId)
    if (!teacherName) return
    const key = `${item.classId}::${item.courseId}`
    if (!existing.has(key)) {
      existing.set(key, [])
    }
    existing.get(key)!.push(teacherName)
  })

  teachingBatchRows.value = classes.map((item) => {
    const row: Record<string, string> = {
      classId: item.id,
      className: item.className,
      [TEACHING_BATCH_HEAD_TEACHER_FIELD]: item.headTeacherId ? teacherNameById.get(item.headTeacherId) || '' : ''
    }
    courseList.forEach((course) => {
      row[course.id] = (existing.get(`${item.id}::${course.id}`) ?? []).join('，')
    })
    return row
  })

  teachingBatchCampusId.value = campusId
  teachingBatchGrade.value = grade
  teachingBatchDialogError.value = ''
  teachingBatchDialogVisible.value = true
}

function closeTeachingBatchDialog(): void {
  teachingBatchDialogVisible.value = false
  teachingBatchDialogError.value = ''
  teachingBatchSelectionAnchor.value = null
  teachingBatchSelectionFocus.value = null
  teachingBatchEditingCell.value = null
  teachingBatchClickMemory.value = null
}

function getTeachingBatchRowClassId(row: Record<string, string>): string {
  return row.classId ?? ''
}

function getTeachingBatchFieldIndex(field: string): number {
  return teachingBatchEditableFields.value.findIndex((item) => item.id === field)
}

function getTeachingBatchSelectionRange() {
  const anchor = teachingBatchSelectionAnchor.value
  const focus = teachingBatchSelectionFocus.value
  if (!anchor || !focus) return null
  const anchorCol = getTeachingBatchFieldIndex(anchor.field)
  const focusCol = getTeachingBatchFieldIndex(focus.field)
  if (anchorCol < 0 || focusCol < 0) return null
  return {
    rowStart: Math.min(anchor.rowIndex, focus.rowIndex),
    rowEnd: Math.max(anchor.rowIndex, focus.rowIndex),
    colStart: Math.min(anchorCol, focusCol),
    colEnd: Math.max(anchorCol, focusCol)
  }
}

function handleTeachingBatchCellMousedown(params: {
  rowIndex: number
  fieldIndex: number
  event: MouseEvent
}): void {
  params.event.preventDefault()
  const field = teachingBatchEditableFields.value[params.fieldIndex]?.id ?? ''
  if (!field) return
  if (isTeachingBatchCellEditing(params.rowIndex, field)) return
  teachingBatchSelectionAnchor.value = { rowIndex: params.rowIndex, field }
  teachingBatchSelectionFocus.value = { rowIndex: params.rowIndex, field }
  teachingBatchDragSelecting.value = true
  teachingBatchDragMoved.value = false
}

function handleTeachingBatchCellMouseenter(params: {
  rowIndex: number
  fieldIndex: number
}): void {
  if (!teachingBatchDragSelecting.value) return
  const field = teachingBatchEditableFields.value[params.fieldIndex]?.id ?? ''
  if (!field) return
  teachingBatchSelectionFocus.value = { rowIndex: params.rowIndex, field }
  teachingBatchDragMoved.value = true
}

function handleTeachingBatchMouseup(): void {
  teachingBatchDragSelecting.value = false
}

function isTeachingBatchCellEditing(rowIndex: number, field: string): boolean {
  return teachingBatchEditingCell.value?.rowIndex === rowIndex && teachingBatchEditingCell.value?.field === field
}

async function closeTeachingBatchCellEditor(rowIndex?: number, field?: string, force = false): Promise<boolean> {
  const editing = teachingBatchEditingCell.value
  if (!editing) return true

  const targetRowIndex = rowIndex ?? editing.rowIndex
  const targetField = field ?? editing.field

  if (!force) {
    const row = teachingBatchRows.value[targetRowIndex]
    const raw = row?.[targetField] ?? ''
    const names = parseMemberNames(raw)
    const campusId = teachingBatchCampusId.value || resolveTeachingInfoCampusId()
    const ensureResult = await ensureTeachersExist(names, campusId)
    if (!ensureResult.ok) {
      return false
    }
  }

  teachingBatchEditingCell.value = null
  return true
}

async function handleTeachingBatchCellClick(params: {
  rowIndex: number
  fieldIndex: number
}): Promise<void> {
  const field = teachingBatchEditableFields.value[params.fieldIndex]?.id ?? ''
  if (!field) return
  if (teachingBatchDragMoved.value) return
  if (isTeachingBatchCellEditing(params.rowIndex, field)) return

  if (teachingBatchEditingCell.value && !isTeachingBatchCellEditing(params.rowIndex, field)) {
    const closed = await closeTeachingBatchCellEditor()
    if (!closed) return
  }

  const now = Date.now()
  const last = teachingBatchClickMemory.value
  if (last && last.rowIndex === params.rowIndex && last.field === field && now - last.at <= TEACHING_BATCH_EDIT_CLICK_INTERVAL) {
    teachingBatchEditingCell.value = { rowIndex: params.rowIndex, field }
    teachingBatchClickMemory.value = null
    return
  }

  teachingBatchEditingCell.value = null
  teachingBatchClickMemory.value = { rowIndex: params.rowIndex, field, at: now }
}

function isTeachingBatchCellInSelection(rowIndex: number, field: string): boolean {
  const range = getTeachingBatchSelectionRange()
  if (!range) return false
  const colIndex = getTeachingBatchFieldIndex(field)
  if (colIndex < 0) return false
  return rowIndex >= range.rowStart && rowIndex <= range.rowEnd && colIndex >= range.colStart && colIndex <= range.colEnd
}

function getTeachingBatchMissingTeachers(rowIndex: number, field: string): string[] {
  return teachingBatchMissingTeacherMap.value.get(`${rowIndex}::${field}`) ?? []
}

function isTeachingBatchCellInvalid(rowIndex: number, field: string): boolean {
  return getTeachingBatchMissingTeachers(rowIndex, field).length > 0
}

function getTeachingBatchCellTitle(rowIndex: number, field: string, value: string): string {
  const missing = getTeachingBatchMissingTeachers(rowIndex, field)
  if (missing.length === 0) return value ?? ''
  return `${value ?? ''}${value ? ' ' : ''}(不存在：${missing.join('、')})`
}

function updateTeachingBatchCell(row: Record<string, string>, courseId: string, value: string): void {
  row[courseId] = value
}

function updateTeachingBatchCellByIndex(rowIndex: number, fieldIndex: number, value: string): void {
  const row = teachingBatchRows.value[rowIndex]
  const field = teachingBatchEditableFields.value[fieldIndex]
  if (!row || !field) return
  row[field.id] = value
}

function parsePastedTableText(raw: string): string[][] {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((line, index, arr) => !(index === arr.length - 1 && line === ''))
    .map((line) => line.split('\t'))
}

function pasteToTeachingBatchFrom(rowIndex: number, fieldIndex: number, event: ClipboardEvent): void {
  const raw = event.clipboardData?.getData('text/plain') ?? ''
  if (!raw) return
  event.preventDefault()
  const matrix = parsePastedTableText(raw)
  if (matrix.length === 0) return

  matrix.forEach((rowValues, rowOffset) => {
    rowValues.forEach((cellValue, colOffset) => {
      const targetRowIndex = rowIndex + rowOffset
      const targetFieldIndex = fieldIndex + colOffset
      updateTeachingBatchCellByIndex(targetRowIndex, targetFieldIndex, cellValue.trim())
    })
  })

  const endRow = Math.min(teachingBatchRows.value.length - 1, rowIndex + matrix.length - 1)
  const maxCols = Math.max(...matrix.map((row) => row.length), 1)
  const endCol = Math.min(teachingBatchEditableFields.value.length - 1, fieldIndex + maxCols - 1)
  const startField = teachingBatchEditableFields.value[fieldIndex]?.id
  const endField = teachingBatchEditableFields.value[endCol]?.id
  if (startField && endField) {
    teachingBatchSelectionAnchor.value = { rowIndex, field: startField }
    teachingBatchSelectionFocus.value = { rowIndex: endRow, field: endField }
  }
}

function handleTeachingBatchPaste(startRowIndex: number, startFieldIndex: number, event: ClipboardEvent): void {
  pasteToTeachingBatchFrom(startRowIndex, startFieldIndex, event)
}

function clearSelectedTeachingBatchCells(): boolean {
  const range = getTeachingBatchSelectionRange()
  if (!range) return false
  for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
    const row = teachingBatchRows.value[rowIndex]
    if (!row) continue
    for (let colIndex = range.colStart; colIndex <= range.colEnd; colIndex += 1) {
      const field = teachingBatchEditableFields.value[colIndex]?.id
      if (!field) continue
      row[field] = ''
    }
  }
  return true
}

function handleTeachingBatchDeleteHotkey(event: KeyboardEvent): void {
  if (!teachingBatchDialogVisible.value) return
  if (event.key !== 'Delete' && event.key !== 'Backspace') return

  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return

  if (teachingBatchEditingCell.value) {
    return
  }

  const handled = clearSelectedTeachingBatchCells()
  if (handled) {
    event.preventDefault()
  }
}

function handleTeachingBatchGlobalPaste(event: ClipboardEvent): void {
  if (!teachingBatchDialogVisible.value) return
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
  const range = getTeachingBatchSelectionRange()
  if (!range) return
  pasteToTeachingBatchFrom(range.rowStart, range.colStart, event)
}

function buildTeachingBatchSelectionText(): string {
  const range = getTeachingBatchSelectionRange()
  if (!range) return ''
  const lines: string[] = []
  for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
    const row = teachingBatchRows.value[rowIndex]
    if (!row) continue
    const cols: string[] = []
    for (let colIndex = range.colStart; colIndex <= range.colEnd; colIndex += 1) {
      const field = teachingBatchEditableFields.value[colIndex]?.id
      cols.push(field ? String(row[field] ?? '') : '')
    }
    lines.push(cols.join('\t'))
  }
  return lines.join('\n')
}

function handleTeachingBatchGlobalCopy(event: ClipboardEvent): void {
  if (!teachingBatchDialogVisible.value) return
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
  const text = buildTeachingBatchSelectionText()
  if (!text) return
  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', handleTeachingBatchDeleteHotkey)
  window.addEventListener('mouseup', handleTeachingBatchMouseup)
  window.addEventListener('copy', handleTeachingBatchGlobalCopy)
  window.addEventListener('paste', handleTeachingBatchGlobalPaste)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleTeachingBatchDeleteHotkey)
  window.removeEventListener('mouseup', handleTeachingBatchMouseup)
  window.removeEventListener('copy', handleTeachingBatchGlobalCopy)
  window.removeEventListener('paste', handleTeachingBatchGlobalPaste)
})

function clearTeachingBatchDialog(): void {
  teachingBatchRows.value = teachingBatchRows.value.map((row) => ({
    ...row,
    ...Object.fromEntries(teachingBatchEditableFields.value.map((field) => [field.id, '']))
  }))
}

function exportTeachingBatchTemplate(): void {
  if (teachingBatchRows.value.length === 0 || teachingBatchEditableFields.value.length === 0) {
    notify.warning('暂无可导出的批量编辑数据。')
    return
  }
  const headers = ['班级', ...teachingBatchEditableFields.value.map((field) => field.label)]
  const rows = teachingBatchRows.value.map((row) => [row.className ?? '', ...teachingBatchEditableFields.value.map(() => '')])
  exportCsv(`任课批量模板-${teachingBatchCampusName.value}-${teachingBatchGrade.value}.csv`, [headers, ...rows])
}

async function submitTeachingBatchDialog(): Promise<void> {
  const campusId = teachingBatchCampusId.value
  const grade = teachingBatchGrade.value
  if (!campusId || !grade) {
    teachingBatchDialogError.value = '当前批量编辑范围无效，请关闭后重试。'
    return
  }

  const classIdSet = new Set(teachingBatchRows.value.map((item) => getTeachingBatchRowClassId(item)))
  const courseIdSet = new Set(teachingBatchCourses.value.map((item) => item.id))
  const allInputTeacherNames = new Set<string>()
  teachingBatchRows.value.forEach((row) => {
    teachingBatchEditableFields.value.forEach((field) => {
      parseMemberNames(row[field.id] ?? '').forEach((name) => allInputTeacherNames.add(name))
    })
  })

  const ensureResult = await ensureTeachersExist(Array.from(allInputTeacherNames), campusId)
  if (!ensureResult.ok) {
    teachingBatchDialogError.value = '已取消提交。'
    return
  }

  const candidateTeachers = teacherRecords.value.filter((item) => item.campusId === campusId)
  const teacherPool = candidateTeachers.length > 0 ? candidateTeachers : teacherRecords.value
  const teacherMap = new Map<string, TeacherRecord[]>()
  teacherPool.forEach((item) => {
    const key = item.name.trim()
    if (!key) return
    if (!teacherMap.has(key)) {
      teacherMap.set(key, [])
    }
    teacherMap.get(key)!.push(item)
  })

  const existingWeeklyMap = new Map<string, number>()
  teachingAssignments.value.forEach((item) => {
    existingWeeklyMap.set(`${item.classId}::${item.teacherId}::${item.courseId}`, item.weeklyLessons || 1)
  })

  const created: TeachingAssignmentRecord[] = []
  const headTeacherByClass = new Map<string, string>()
  let seed = 0
  teachingBatchRows.value.forEach((row) => {
    const classId = getTeachingBatchRowClassId(row)
    if (!classId) return

    const headTeacherNames = parseMemberNames(row[TEACHING_BATCH_HEAD_TEACHER_FIELD] ?? '')
    if (headTeacherNames.length > 0) {
      const matched = teacherMap.get(headTeacherNames[0]) ?? []
      headTeacherByClass.set(classId, matched[0]?.id || '')
    } else {
      headTeacherByClass.set(classId, '')
    }

    teachingBatchCourses.value.forEach((course) => {
      const raw = row[course.id] ?? ''
      const teacherNames = parseMemberNames(raw)
      teacherNames.forEach((teacherName) => {
        const matched = teacherMap.get(teacherName) ?? []
        if (matched.length === 0) return
        const teacher = matched[0]
        const weeklyKey = `${classId}::${teacher.id}::${course.id}`
        created.push({
          id: `ta-batch-${Date.now()}-${seed}`,
          campusId,
          grade,
          classId,
          teacherId: teacher.id,
          courseId: course.id,
          weeklyLessons: existingWeeklyMap.get(weeklyKey) ?? 1
        })
        seed += 1
      })
    })
  })

  classRecords.value = classRecords.value.map((item) => {
    if (!classIdSet.has(item.id)) return item
    if (!headTeacherByClass.has(item.id)) return item
    const teacherId = headTeacherByClass.get(item.id) || ''
    return {
      ...item,
      headTeacherId: teacherId || undefined
    }
  })

  teachingAssignments.value = [
    ...teachingAssignments.value.filter(
      (item) =>
        !(
          item.campusId === campusId &&
          item.grade === grade &&
          classIdSet.has(item.classId) &&
          courseIdSet.has(item.courseId)
        )
    ),
    ...created
  ]
  markTeachingInfoDirty()
  notify.success('批量编辑已应用，请点击“保存任课信息”。')
  closeTeachingBatchDialog()
}

function closeTeachingAssignmentDialog(): void {
  teachingAssignmentDialogVisible.value = false
}

watch(
  () => [teachingAssignmentForm.campusId, teachingAssignmentForm.grade] as const,
  () => {
    const classCandidate = teachingAssignmentClassOptions.value[0]
    if (classCandidate) {
      teachingAssignmentForm.classId = classCandidate.id
    } else {
      teachingAssignmentForm.classId = ''
    }

    const teacherCandidate = teachingAssignmentTeacherOptions.value[0]
    if (teacherCandidate && !teachingAssignmentTeacherOptions.value.some((item) => item.id === teachingAssignmentForm.teacherId)) {
      teachingAssignmentForm.teacherId = teacherCandidate.id
    }
  }
)

watch(
  teachingAssignmentCourseOptions,
  (items) => {
    if (items.length === 0) {
      teachingAssignmentForm.courseId = ''
      return
    }
    if (!items.some((item) => item.id === teachingAssignmentForm.courseId)) {
      teachingAssignmentForm.courseId = items[0].id
    }
  }
)

function submitTeachingAssignmentDialog(): void {
  if (
    !teachingAssignmentForm.campusId ||
    !teachingAssignmentForm.grade ||
    !teachingAssignmentForm.classId ||
    !teachingAssignmentForm.teacherId ||
    !teachingAssignmentForm.courseId
  ) {
    teachingAssignmentDialogError.value = '请完整选择校区、年级、班级、教师和课程。'
    return
  }

  teachingAssignments.value.unshift({
    id: `ta-${Date.now()}`,
    campusId: teachingAssignmentForm.campusId,
    grade: teachingAssignmentForm.grade,
    classId: teachingAssignmentForm.classId,
    teacherId: teachingAssignmentForm.teacherId,
    courseId: teachingAssignmentForm.courseId,
    weeklyLessons: Math.max(0, Math.floor(teachingAssignmentForm.weeklyLessons || 0))
  })
  markTeachingInfoDirty()
  notify.success('任课信息已新增，请点击“保存任课信息”。')
  teachingAssignmentDialogVisible.value = false
}

async function removeTeachingAssignment(record: TeachingAssignmentRecord): Promise<void> {
  const confirmed = await confirmDelete('确认删除该任课信息吗？')
  if (!confirmed) return
  teachingAssignments.value = teachingAssignments.value.filter((item) => item.id !== record.id)
  markTeachingInfoDirty()
  notify.success('任课信息已删除，请点击“保存任课信息”。')
}

function resetClassHours(): void {
  const campusId = selectedHoursCampusId.value
  if (!campusId) return

  const targetGrade = resetGradeTarget.value
  const shouldReset = (grade: string) => targetGrade === '__all__' || targetGrade === grade

  classHourRows.value = classHourRows.value.map((item) =>
    item.campusId === campusId &&
    shouldReset(item.grade) &&
    isGradeInEducationSystem(item.grade, selectedHoursEducationSystem.value)
      ? {
          ...item,
          weeklyDays: 0,
          morningStudy: 0,
          morningLessons: 0,
          afternoonLessons: 0,
          eveningStudy: 0
        }
      : item
  )

  classHourClassRows.value = classHourClassRows.value.map((item) =>
    item.campusId === campusId &&
    shouldReset(item.grade) &&
    isGradeInEducationSystem(item.grade, selectedHoursEducationSystem.value)
      ? {
          ...item,
          weeklyDays: 0,
          morningStudy: 0,
          morningLessons: 0,
          afternoonLessons: 0,
          eveningStudy: 0
        }
      : item
  )
}

function applyBatchClassHours(): void {
  const campusId = selectedHoursCampusId.value
  if (!campusId) return
  if (!isClassHoursBatchFormReady()) {
    notify.warning('请先完整设置批量课时后再应用。')
    return
  }
  const weeklyDays = classHoursBatchForm.weeklyDays as number
  const morningStudy = classHoursBatchForm.morningStudy as number
  const morningLessons = classHoursBatchForm.morningLessons as number
  const afternoonLessons = classHoursBatchForm.afternoonLessons as number
  const eveningStudy = classHoursBatchForm.eveningStudy as number
  const breakSlot = classHoursBatchForm.breakSlot ?? ''

  classHourRows.value = classHourRows.value.map((item) =>
    item.campusId === campusId && isGradeInEducationSystem(item.grade, selectedHoursEducationSystem.value)
      ? {
          ...item,
          weeklyDays,
          morningStudy,
          morningLessons,
          afternoonLessons,
          eveningStudy,
          breakSlot
        }
      : item
  )

  classHourClassRows.value = classHourClassRows.value.map((item) =>
    item.campusId === campusId && isGradeInEducationSystem(item.grade, selectedHoursEducationSystem.value)
      ? {
          ...item,
          weeklyDays,
          morningStudy,
          morningLessons,
          afternoonLessons,
          eveningStudy,
          breakSlot
        }
      : item
  )
  rememberClassHoursBatchDraft()
}

function openResetClassHoursDialog(): void {
  classHoursResetDialogVisible.value = true
  classHoursResetFinalVisible.value = false
}

function closeResetClassHoursDialog(): void {
  classHoursResetDialogVisible.value = false
  classHoursResetFinalVisible.value = false
}

function requestResetClassHoursConfirm(): void {
  classHoursResetFinalVisible.value = true
}

function confirmResetClassHoursDialog(): void {
  resetClassHours()
  closeResetClassHoursDialog()
}

async function saveClassHours(): Promise<void> {
  rememberClassHoursBatchDraft()
  const gradeMap = new Map(
    classHourRows.value
      .filter(
        (item) =>
          item.campusId === selectedHoursCampusId.value &&
          isGradeInEducationSystem(item.grade, selectedHoursEducationSystem.value)
      )
      .map((item) => [item.grade, item] as const)
  )

  classHourClassRows.value = classHourClassRows.value.map((item) => {
    if (item.campusId !== selectedHoursCampusId.value) return item
    if (!isGradeInEducationSystem(item.grade, selectedHoursEducationSystem.value)) return item
    const gradeRow = gradeMap.get(item.grade)
    if (!gradeRow) return item
    return {
      ...item,
      weeklyDays: gradeRow.weeklyDays,
      morningStudy: gradeRow.morningStudy,
      morningLessons: gradeRow.morningLessons,
      afternoonLessons: gradeRow.afternoonLessons,
      eveningStudy: gradeRow.eveningStudy,
      breakSlot: gradeRow.breakSlot
    }
  })

  await persistBasicData('班级课时配置已保存。')
}

const classHoursByClassVisible = ref(false)
const classHoursByClassCampusId = ref('')
const classHoursByClassGrade = ref('')
const classHoursByClassRows = ref<ClassHourClassRow[]>([])

function closeClassHoursByClassDialog(): void {
  classHoursByClassVisible.value = false
  classHoursByClassCampusId.value = ''
  classHoursByClassGrade.value = ''
  classHoursByClassRows.value = []
}

function saveClassHoursByClassDialog(): void {
  const campusId = classHoursByClassCampusId.value
  const grade = classHoursByClassGrade.value
  classHourClassRows.value = [
    ...classHourClassRows.value.filter((item) => !(item.campusId === campusId && item.grade === grade)),
    ...classHoursByClassRows.value.map((item) => ({ ...item }))
  ]
  closeClassHoursByClassDialog()
  notify.success(`已保存「${grade}」按班课时设置。`)
}

function setByClass(row: ClassHourRow): void {
  const classes = classRecords.value
    .filter((item) => item.campusId === row.campusId && item.grade === row.grade)
    .sort((a, b) => a.classNo - b.classNo)
  if (classes.length === 0) {
    notify.warning(`「${row.grade}」暂无班级，请先在班级设置中生成。`)
    return
  }

  const existing = new Map(
    classHourClassRows.value
      .filter((item) => item.campusId === row.campusId && item.grade === row.grade)
      .map((item) => [item.classId, item] as const)
  )

  classHoursByClassRows.value = classes.map((item) => {
    const cached = existing.get(item.id)
    if (cached) {
      return { ...cached, className: item.className }
    }
    return {
      id: `${row.campusId}-${row.grade}-${item.id}`,
      campusId: row.campusId,
      grade: row.grade,
      classId: item.id,
      className: item.className,
      weeklyDays: row.weeklyDays,
      morningStudy: row.morningStudy,
      morningLessons: row.morningLessons,
      afternoonLessons: row.afternoonLessons,
      eveningStudy: row.eveningStudy,
      breakSlot: row.breakSlot
    }
  })
  classHoursByClassCampusId.value = row.campusId
  classHoursByClassGrade.value = row.grade
  classHoursByClassVisible.value = true
}

function toNumericOrNull(raw: string): number | null {
  if (raw.trim() === '') return 0
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return Math.floor(numeric)
}

function getEventInputValue(event: Event): string {
  const target = event.target as HTMLInputElement | null
  return target?.value ?? ''
}

function updateArrangementCell(rowId: string, courseId: string, raw: string): void {
  const value = toNumericOrNull(raw)
  arrangementRows.value = arrangementRows.value.map((row) =>
    row.id === rowId
      ? {
          ...row,
          values: {
            ...row.values,
            [courseId]: value
          }
        }
      : row
  )
  persistCurrentArrangementScope()
}

function updateArrangementBatch(courseId: string, raw: string): void {
  arrangementBatchValues.value = {
    ...arrangementBatchValues.value,
    [courseId]: toNumericOrNull(raw)
  }
  persistCurrentArrangementScope()
}

function updateArrangementCellByNumber(rowId: string, courseId: string, value?: number | null): void {
  updateArrangementCell(rowId, courseId, value == null ? '' : String(value))
}

function updateArrangementBatchByNumber(courseId: string, value?: number | null): void {
  updateArrangementBatch(courseId, value == null ? '' : String(value))
}

function getArrangementTotalByValues(values: Record<string, number | null>): number {
  return arrangementCourses.value.reduce((sum, course) => {
    const value = values[course.id]
    return sum + (typeof value === 'number' ? value : 0)
  }, 0)
}

async function saveArrangementSettings(): Promise<void> {
  await persistBasicData('课程安排已保存。')
}

function resetArrangementSettings(): void {
  arrangementBatchValues.value = Object.fromEntries(arrangementCourses.value.map((course) => [course.id, 0]))
  arrangementRows.value = arrangementRows.value.map((row) => ({
    ...row,
    values: Object.fromEntries(arrangementCourses.value.map((course) => [course.id, 0]))
  }))
  persistCurrentArrangementScope()
}

function openResetArrangementDialog(): void {
  arrangementResetDialogVisible.value = true
  arrangementResetFinalVisible.value = false
}

function closeResetArrangementDialog(): void {
  arrangementResetDialogVisible.value = false
  arrangementResetFinalVisible.value = false
}

function requestResetArrangementConfirm(): void {
  arrangementResetFinalVisible.value = true
}

function confirmResetArrangementDialog(): void {
  resetArrangementSettings()
  closeResetArrangementDialog()
}

function applyBatchToAllClasses(): void {
  arrangementRows.value = arrangementRows.value.map((row) => {
    const nextValues = { ...row.values }
    arrangementCourses.value.forEach((course) => {
      const batchValue = arrangementBatchValues.value[course.id]
      if (typeof batchValue === 'number') {
        nextValues[course.id] = batchValue
      }
    })
    return { ...row, values: nextValues }
  })
  persistCurrentArrangementScope()
}

function clearArrangementRow(rowId: string): void {
  arrangementRows.value = arrangementRows.value.map((row) =>
    row.id === rowId
      ? {
          ...row,
          values: Object.fromEntries(arrangementCourses.value.map((course) => [course.id, 0]))
        }
      : row
  )
  persistCurrentArrangementScope()
}

function arrangementActionTip(action: string): void {
  notify.info(`${action}功能已预留。`)
}

function handleArrangementModeChange(mode: '课程课时' | '教室类型'): void {
  if (mode === '教室类型') {
    arrangementActionTip('教室类型')
    arrangementMode.value = '课程课时'
  }
}
</script>

<template>
  <section class="base-data-page">
    <aside class="base-side">
      <h2>基础数据</h2>
      <div v-for="group in groups" :key="group.key" class="menu-group">
        <p class="group-title">{{ group.label }}</p>
        <ul>
          <li
            v-for="menu in group.children"
            :key="menu.key"
            :class="{ active: activeMenu === menu.key }"
            @click="activeMenu = menu.key"
          >
            <span>{{ menu.label }}</span>
            <em v-if="resolveMenuStatus(menu) === 'done'" class="state done">●</em>
            <em v-else-if="resolveMenuStatus(menu) === 'required'" class="state required">●</em>
            <em v-else-if="resolveMenuStatus(menu) === 'pending'" class="state pending">●</em>
            <em v-else-if="resolveMenuStatus(menu) === 'none'" class="state pending">●</em>
          </li>
        </ul>
      </div>
    </aside>

    <article class="panel base-main">
      <header class="base-main-head">
        <h1>{{ activeTitle }}</h1>
        <div class="base-main-head-actions">
          <el-button v-if="activeMenu === 'campus'" type="primary" @click="createCampus">新增校区</el-button>
          <el-button v-if="activeMenu === 'semester'" type="primary" @click="exportSemesterConfig">导出</el-button>
          <el-button v-if="activeMenu === 'course-manage'" type="primary" @click="createCourse">新增课程</el-button>
          <template v-if="activeMenu === 'teaching-info'">
            <el-button type="primary" plain @click="openTeachingAssignmentDialog">新增任课</el-button>
            <el-button type="primary" :disabled="!teachingInfoDirty" @click="saveTeachingInfo">保存任课信息</el-button>
          </template>
        </div>
      </header>

      <template v-if="activeMenu === 'campus'">
        <el-table class="campus-el-table" :data="campuses" border>
          <el-table-column prop="schoolName" label="学校名称" min-width="180" />
          <el-table-column prop="name" label="校区名称" min-width="180" />
          <el-table-column prop="educationSystem" label="学段学制" min-width="140" />
          <el-table-column label="操作" min-width="220">
            <template #default="{ row }">
              <div class="op-cell">
                <el-button type="primary" link @click="renameCampus(row)">修改</el-button>
                <span v-if="row.system" class="system-tip">（系统校区）</span>
                <el-button v-else type="danger" link @click="removeCampus(row)">删除</el-button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <div class="campus-empty">暂无校区数据。必填项，请先新增校区。</div>
          </template>
        </el-table>

        <el-dialog
          v-model="campusDialogVisible"
          class="campus-el-dialog"
          :title="campusDialogMode === 'create' ? '新增校区' : '修改校区'"
          width="760px"
          destroy-on-close
        >
          <el-form label-position="top" class="campus-el-form">
            <div class="campus-editor-grid">
              <el-form-item label="学校名称" required>
                <el-input v-model="campusForm.schoolName" placeholder="请输入学校名称" />
              </el-form-item>
              <el-form-item label="校区名称">
                <el-input v-model="campusForm.name" placeholder="不输入则默认使用“本校区”" />
              </el-form-item>
              <el-form-item label="学段学制">
                <el-select v-model="campusForm.educationSystem" placeholder="请选择学段学制">
                  <el-option v-for="item in EDUCATION_SYSTEM_OPTIONS" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
            </div>
          </el-form>
          <p v-if="campusDialogError" class="error">{{ campusDialogError }}</p>
          <template #footer>
            <div class="dialog-actions campus-editor-actions">
              <el-button @click="closeCampusDialog">取消</el-button>
              <el-button type="primary" @click="submitCampusDialog">保存</el-button>
            </div>
          </template>
        </el-dialog>
      </template>

      <template v-else-if="activeMenu === 'semester'">
        <p v-if="currentSchoolYearLabel" class="current-semester-tip">当前学年：{{ currentSchoolYearLabel }}</p>
        <el-table :data="semesterTableRows" border :span-method="semesterSpanMethod" :row-class-name="semesterRowClassName">
          <el-table-column prop="yearName" label="学年" min-width="150" />
          <el-table-column prop="yearStartDate" label="学年开始日期" min-width="140" />
          <el-table-column prop="yearEndDate" label="学年结束日期" min-width="140" />
          <el-table-column prop="semesterName" label="学期名称" min-width="140" />
          <el-table-column prop="semesterStartDate" label="起始日期" min-width="130" />
          <el-table-column prop="semesterEndDate" label="截至日期" min-width="130" />
          <el-table-column label="操作" min-width="110">
            <template #default="{ row }">
              <el-button v-if="row._semesterIndex === 0" type="primary" link @click="openSemesterEditor(row._yearRef)">
                修改
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-dialog
          v-model="semesterEditorVisible"
          class="semester-el-dialog"
          :title="`${semesterEditorYearName} 日期设置`"
          width="760px"
        >
          <div class="semester-editor-card year-card">
            <div class="semester-card-title">学年日期</div>
            <div class="semester-year-editor">
              <label>
                学年开始日期
                <el-date-picker
                  v-model="semesterEditorDraft.yearStartDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  :default-value="pickerDefaultDate(semesterEditorDraft.yearStartDate)"
                />
              </label>
              <label>
                学年结束日期
                <el-date-picker
                  v-model="semesterEditorDraft.yearEndDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  :default-value="pickerDefaultDate(semesterEditorDraft.yearEndDate)"
                />
              </label>
            </div>
          </div>

          <div class="semester-cards-grid">
            <div class="semester-editor-card">
              <div class="semester-card-title">第一学期</div>
              <div class="semester-card-fields">
                <label>
                  起始日期
                  <el-date-picker
                    v-model="semesterEditorDraft.sem1StartDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    :default-value="pickerDefaultDate(semesterEditorDraft.sem1StartDate)"
                  />
                </label>
                <label>
                  截至日期
                  <el-date-picker
                    v-model="semesterEditorDraft.sem1EndDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    :default-value="pickerDefaultDate(semesterEditorDraft.sem1EndDate)"
                  />
                </label>
              </div>
            </div>

            <div class="semester-editor-card">
              <div class="semester-card-title">第二学期</div>
              <div class="semester-card-fields">
                <label>
                  起始日期
                  <el-date-picker
                    v-model="semesterEditorDraft.sem2StartDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    :default-value="pickerDefaultDate(semesterEditorDraft.sem2StartDate)"
                  />
                </label>
                <label>
                  截至日期
                  <el-date-picker
                    v-model="semesterEditorDraft.sem2EndDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    :default-value="pickerDefaultDate(semesterEditorDraft.sem2EndDate)"
                  />
                </label>
              </div>
            </div>
          </div>
          <p class="dialog-tip">日期可选择，也可直接输入 YYYY-MM-DD。</p>
          <p v-if="semesterEditorError" class="error">{{ semesterEditorError }}</p>
          <template #footer>
            <div class="dialog-actions">
              <el-button @click="closeSemesterEditor">取消</el-button>
              <el-button type="primary" @click="confirmSemesterEditor">保存</el-button>
            </div>
          </template>
        </el-dialog>
      </template>

      <template v-else-if="activeMenu === 'class-setting'">
        <section class="class-setting-panel">
          <div class="class-setting-toolbar">
            <el-form label-position="top" class="class-setting-form-inline">
              <el-form-item label="校区">
                <el-select v-model="classSettingForm.campusId" placeholder="请选择校区">
                  <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
                </el-select>
              </el-form-item>

              <el-form-item label="学段">
                <el-select v-model="classSettingForm.stage" placeholder="请选择学段">
                  <el-option v-for="stage in stageOptions" :key="stage" :label="stage" :value="stage" />
                </el-select>
              </el-form-item>

              <el-form-item label="班级数">
                <el-input-number v-model="classSettingForm.batchCount" :min="1" controls-position="right" />
              </el-form-item>

              <el-form-item label="起始班号">
                <el-input-number v-model="classSettingForm.startNo" :min="1" controls-position="right" />
              </el-form-item>

              <el-form-item class="class-setting-generate-item">
                <el-button type="primary" @click="batchCreateClasses">批量生成班级</el-button>
                <el-button type="danger" plain :disabled="selectedClassCount === 0" @click="removeClassesBatch">
                  批量删除（{{ selectedClassCount }}）
                </el-button>
              </el-form-item>
            </el-form>
          </div>

          <div class="grade-select">
            <p>年级</p>
            <div class="grade-check-row">
              <el-checkbox
                class="grade-select-all"
                :model-value="isAllGradesChecked"
                :indeterminate="isGradePartiallyChecked"
                @change="toggleAllGrades($event as boolean)"
              >
                全选
              </el-checkbox>
              <el-checkbox-group v-model="classSettingForm.grades" class="grade-checks">
                <el-checkbox v-for="grade in gradeOptions" :key="grade" :label="grade">{{ grade }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </div>

          <div class="class-grade-stats">
            <span class="class-grade-stats-title">班级统计</span>
            <div class="class-grade-stats-list">
              <el-tag v-for="item in gradeClassStats.stats" :key="`stat-${item.grade}`" effect="light">
                {{ item.grade }} {{ item.count }} 个班
              </el-tag>
              <el-tag type="primary" effect="light">合计 {{ gradeClassStats.total }} 个班</el-tag>
            </div>
          </div>

          <el-table
            ref="classTableRef"
            :data="currentClassRecords"
            row-key="id"
            border
            @selection-change="onClassSelectionChange"
          >
            <el-table-column type="selection" width="46" />
            <el-table-column label="校区" min-width="140">
              <template #default="{ row }">{{ campuses.find((c) => c.id === row.campusId)?.name }}</template>
            </el-table-column>
            <el-table-column prop="stage" label="学段" min-width="100" />
            <el-table-column prop="grade" label="年级" min-width="120" />
            <el-table-column prop="classNo" label="班号" min-width="90" />
            <el-table-column prop="className" label="班级名称" min-width="140" />
            <el-table-column label="操作" min-width="120">
              <template #default="{ row }">
                <el-button type="primary" link @click="renameClass(row)">编辑</el-button>
                <el-button type="danger" link @click="removeClass(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div>暂无班级，请先批量生成。</div>
            </template>
          </el-table>

          <p class="class-setting-tip">
            当前配置：{{ campuses.find((c) => c.id === classSettingForm.campusId)?.name }} / {{ classSettingForm.stage }} /
            {{ classSettingForm.grades.join('、') }}
          </p>
        </section>
      </template>

      <template v-else-if="activeMenu === 'group-manage'">
        <section class="group-manage-panel">
          <div class="teacher-entry-actions">
            <el-input
              v-model="groupSearchKeyword"
              clearable
              placeholder="搜索分组名称/成员/备注"
              style="max-width: 280px"
            />
            <el-select v-model="groupFilterCampusId" clearable placeholder="全部校区" style="width: 160px">
              <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
            </el-select>
            <el-select v-model="groupFilterType" style="width: 180px">
              <el-option label="全部类型" value="全部类型" />
              <el-option v-for="type in groupTypeOptions" :key="type" :label="type" :value="type" />
            </el-select>
            <span class="teaching-info-actions-spacer" />
            <el-button type="danger" plain :disabled="selectedGroupCount === 0" @click="removeGroupsBatch">
              批量删除（{{ selectedGroupCount }}）
            </el-button>
            <el-button type="primary" @click="createGroupRecord">新增分组</el-button>
          </div>

          <el-table ref="groupTableRef" :data="groupRecordView" border @selection-change="onGroupSelectionChange">
            <el-table-column type="selection" width="46" align="center" />
            <el-table-column prop="name" label="分组名称" min-width="140" />
            <el-table-column prop="type" label="分组类型" min-width="110" />
            <el-table-column label="所属校区" min-width="120">
              <template #default="{ row }">{{ campuses.find((campus) => campus.id === row.campusId)?.name ?? '本校区' }}</template>
            </el-table-column>
            <el-table-column label="成员" min-width="220">
              <template #default="{ row }">{{ row.memberNames.length > 0 ? row.memberNames.join('、') : '--' }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="180">
              <template #default="{ row }">{{ row.remark || '--' }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="120">
              <template #default="{ row }">
                <el-button type="primary" link @click="editGroupRecord(row)">编辑</el-button>
                <el-button type="danger" link @click="removeGroupRecord(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div>暂无分组，请先新增。</div>
            </template>
          </el-table>
          <p class="dialog-tip">共{{ groupRecordView.length }}条记录</p>
        </section>

        <el-dialog
          v-model="groupDialogVisible"
          :title="groupDialogMode === 'create' ? '新增分组' : '编辑分组'"
          width="560px"
          destroy-on-close
        >
          <el-form label-position="top">
            <el-form-item label="分组名称">
              <el-input v-model="groupForm.name" placeholder="请输入分组名称" />
            </el-form-item>
            <el-form-item label="分组类型">
              <el-select
                v-model="groupForm.type"
                filterable
                allow-create
                default-first-option
                placeholder="请选择或输入分组类型"
              >
                <el-option v-for="type in groupTypeOptions" :key="type" :label="type" :value="type" />
              </el-select>
            </el-form-item>
            <el-form-item label="所属校区">
              <el-select v-model="groupForm.campusId" placeholder="请选择校区">
                <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="成员">
              <el-select
                v-model="groupForm.memberNames"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="请选择或输入成员姓名"
              >
                <el-option v-for="name in groupMemberOptions" :key="name" :label="name" :value="name" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="groupForm.remark" type="textarea" :rows="3" placeholder="可选" />
            </el-form-item>
          </el-form>
          <p v-if="groupDialogError" class="error">{{ groupDialogError }}</p>
          <template #footer>
            <div class="dialog-actions">
              <el-button @click="closeGroupDialog">取消</el-button>
              <el-button type="primary" @click="submitGroupDialog">保存</el-button>
            </div>
          </template>
        </el-dialog>
      </template>

      <template v-else-if="activeMenu === 'room-type'">
        <section class="teacher-entry-panel">
          <div class="teacher-entry-actions">
            <span class="teaching-info-actions-spacer" />
            <el-button type="primary" @click="createRoomType">新增</el-button>
          </div>

          <el-table :data="roomTypes" border>
            <el-table-column prop="name" label="教室类型" min-width="220" />
            <el-table-column label="操作" min-width="160">
              <template #default="{ row }">
                <span v-if="row.system" class="text-muted-inline">（系统默认）</span>
                <template v-else>
                  <el-button type="primary" link @click="editRoomType(row)">编辑</el-button>
                  <el-button type="danger" link @click="removeRoomType(row)">删除</el-button>
                </template>
              </template>
            </el-table-column>
            <template #empty>
              <div>暂无教室类型，请先新增。</div>
            </template>
          </el-table>
          <p class="dialog-tip">共{{ roomTypes.length }}条记录</p>
        </section>
      </template>

      <template v-else-if="activeMenu === 'teacher-entry'">
        <section class="teacher-entry-panel">
          <div class="teacher-entry-actions">
            <el-input
              v-model="teacherSearchKeyword"
              clearable
              placeholder="搜索教师ID/姓名/学科/教研与活动分组/校区"
              style="width: 300px"
            />
            <el-button type="primary" @click="openCreateTeacherDialog">新增教师</el-button>
            <el-button type="danger" plain :disabled="selectedTeacherCount === 0" @click="removeTeachersBatch">
              批量删除（{{ selectedTeacherCount }}）
            </el-button>
            <el-button @click="downloadTeacherTemplate">下载模板</el-button>
            <el-button @click="triggerTeacherImport">上传 Excel</el-button>
            <el-button type="primary" @click="exportTeacherData">导出数据</el-button>
            <input
              ref="teacherImportInput"
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              class="hidden-input"
              @change="handleTeacherImport"
            />
          </div>
          <p class="dialog-tip">支持上传 Excel（.xlsx/.xls），按模板列顺序导入教师数据。</p>
          <p v-if="teacherImportError" class="error">{{ teacherImportError }}</p>

          <el-table
            ref="teacherTableRef"
            :data="pagedTeacherRecords"
            row-key="id"
            border
            @selection-change="onTeacherSelectionChange"
          >
            <el-table-column type="selection" width="46" reserve-selection />
            <el-table-column prop="id" label="教师ID" min-width="130" />
            <el-table-column prop="name" label="姓名" min-width="120" />
            <el-table-column prop="subject" label="学科" min-width="120" />
            <el-table-column prop="subjectGroup" label="教研与活动分组" min-width="140" />
            <el-table-column label="校区" min-width="130">
              <template #default="{ row }">{{ campuses.find((campus) => campus.id === row.campusId)?.name ?? '本校区' }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="100">
              <template #default="{ row }">
                <el-button type="primary" link @click="openEditTeacherDialog(row)">编辑</el-button>
                <el-button type="danger" link @click="removeTeacher(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div>暂无教师数据，请上传模板数据。</div>
            </template>
          </el-table>
          <div class="teacher-pagination">
            <el-pagination
              v-model:current-page="teacherPage"
              v-model:page-size="teacherPageSize"
              :page-sizes="teacherPageSizeOptions"
              layout="total, sizes, prev, pager, next, jumper"
              :total="filteredTeacherRecords.length"
            />
          </div>

          <el-dialog v-model="teacherCreateDialogVisible" title="新增教师" width="560px">
            <el-form label-position="top">
              <el-form-item label="姓名" required>
                <el-input v-model="teacherCreateForm.name" placeholder="请输入教师姓名" />
              </el-form-item>
              <el-form-item label="校区（可选）">
                <el-select v-model="teacherCreateForm.campusId" clearable placeholder="不选则默认第一个校区">
                  <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
                </el-select>
              </el-form-item>
            </el-form>
            <p v-if="teacherCreateDialogError" class="error">{{ teacherCreateDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeCreateTeacherDialog">取消</el-button>
                <el-button type="primary" @click="submitCreateTeacherDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>

          <el-dialog v-model="teacherEditDialogVisible" title="编辑教师信息" width="560px">
            <el-form label-position="top">
              <el-form-item label="姓名" required>
                <el-input v-model="teacherEditForm.name" placeholder="请输入教师姓名" />
              </el-form-item>
              <el-form-item label="校区（可选）">
                <el-select v-model="teacherEditForm.campusId" clearable placeholder="不选则默认第一个校区">
                  <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
                </el-select>
              </el-form-item>
            </el-form>
            <p v-if="teacherEditDialogError" class="error">{{ teacherEditDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeEditTeacherDialog">取消</el-button>
                <el-button type="primary" @click="submitEditTeacherDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeMenu === 'room-entry'">
        <section class="teacher-entry-panel">
          <div class="teacher-entry-actions">
            <el-input v-model="roomEntryKeyword" clearable placeholder="请输入教室名或者教室类型" style="width: 320px" />
            <span class="teaching-info-actions-spacer" />
            <el-button plain @click="downloadRoomTemplate">下载模板</el-button>
            <el-button plain @click="triggerRoomImport">上传 Excel</el-button>
            <el-button type="info" @click="exportRoomData">导出数据</el-button>
            <el-button type="primary" @click="openCreateRoomDialog">新增</el-button>
            <el-button type="success" @click="saveRoomEntryData">保存</el-button>
            <el-button type="danger" plain :disabled="selectedRoomCount === 0" @click="removeRoomsBatch">
              批量删除（{{ selectedRoomCount }}）
            </el-button>
            <input
              ref="roomImportInput"
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              class="hidden-input"
              @change="handleRoomImport"
            />
          </div>
          <p class="dialog-tip">批量新增请使用 Excel 模板导入。</p>
          <p v-if="roomImportError" class="error">{{ roomImportError }}</p>

          <el-table
            ref="roomTableRef"
            :data="roomEntryView"
            row-key="id"
            border
            @selection-change="onRoomSelectionChange"
          >
            <el-table-column type="selection" width="46" />
            <el-table-column type="index" label="序号" width="70" />
            <el-table-column prop="roomName" label="教室名" min-width="160" />
            <el-table-column prop="roomTypeName" label="教室类型" min-width="140" />
            <el-table-column prop="campusName" label="所在校区" min-width="120" />
            <el-table-column prop="buildingName" label="所在楼名" min-width="130" />
            <el-table-column prop="floorNo" label="所在楼层" min-width="100" />
            <el-table-column prop="capacity" label="容纳人数" min-width="100" />
            <el-table-column label="操作" min-width="120">
              <template #default="{ row }">
                <el-button type="primary" link @click="openEditRoomDialog(row)">编辑</el-button>
                <el-button type="danger" link @click="removeRoom(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div>暂无教室数据，请先新增。</div>
            </template>
          </el-table>

          <el-dialog v-model="roomCreateDialogVisible" title="新增教室" width="560px">
            <el-form label-position="top">
              <el-form-item label="教室名" required>
                <el-input v-model="roomCreateForm.roomName" placeholder="请输入教室名" />
              </el-form-item>
              <el-form-item label="教室类型" required>
                <el-select v-model="roomCreateForm.roomTypeId" placeholder="选择教室类型">
                  <el-option v-for="item in roomTypes" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="所在校区" required>
                <el-select v-model="roomCreateForm.campusId" placeholder="选择校区">
                  <el-option v-for="item in campuses" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="所在楼名">
                <el-input v-model="roomCreateForm.buildingName" placeholder="如：教学楼" />
              </el-form-item>
              <el-form-item label="所在楼层">
                <el-input-number v-model="roomCreateForm.floorNo" :min="1" controls-position="right" />
              </el-form-item>
              <el-form-item label="容纳人数">
                <el-input-number v-model="roomCreateForm.capacity" :min="1" controls-position="right" />
              </el-form-item>
            </el-form>
            <p v-if="roomCreateDialogError" class="error">{{ roomCreateDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeCreateRoomDialog">取消</el-button>
                <el-button type="primary" @click="submitCreateRoomDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>

          <el-dialog v-model="roomEditDialogVisible" title="编辑教室" width="560px">
            <el-form label-position="top">
              <el-form-item label="教室名" required>
                <el-input v-model="roomEditForm.roomName" placeholder="请输入教室名" />
              </el-form-item>
              <el-form-item label="教室类型" required>
                <el-select v-model="roomEditForm.roomTypeId" placeholder="选择教室类型">
                  <el-option v-for="item in roomTypes" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="所在校区" required>
                <el-select v-model="roomEditForm.campusId" placeholder="选择校区">
                  <el-option v-for="item in campuses" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="所在楼名">
                <el-input v-model="roomEditForm.buildingName" />
              </el-form-item>
              <el-form-item label="所在楼层">
                <el-input-number v-model="roomEditForm.floorNo" :min="1" controls-position="right" />
              </el-form-item>
              <el-form-item label="容纳人数">
                <el-input-number v-model="roomEditForm.capacity" :min="1" controls-position="right" />
              </el-form-item>
            </el-form>
            <p v-if="roomEditDialogError" class="error">{{ roomEditDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeEditRoomDialog">取消</el-button>
                <el-button type="primary" @click="submitEditRoomDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeMenu === 'classroom-map'">
        <section class="teacher-entry-panel">
          <div class="teacher-entry-actions">
            <el-select v-model="classRoomMapCampusId" class="arrangement-filter-select" placeholder="选择校区">
              <el-option v-for="item in campuses" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
            <el-select v-model="classRoomMapGrade" class="arrangement-filter-select" placeholder="选择年级">
              <el-option v-for="item in classRoomMapGradeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-input v-model="classRoomMapKeyword" clearable placeholder="搜索班级/教室" style="width: 240px" />
            <span class="teaching-info-actions-spacer" />
            <el-button @click="downloadClassRoomMapTemplate">下载模板</el-button>
            <el-button @click="triggerClassRoomMapImport">上传 Excel</el-button>
            <el-button type="primary" @click="exportClassRoomMapData">导出数据</el-button>
            <el-button type="success" @click="saveClassRoomMapData">保存</el-button>
            <input
              ref="classRoomMapImportInput"
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              class="hidden-input"
              @change="handleClassRoomMapImport"
            />
          </div>
          <p class="dialog-tip">支持 Excel 批量导入，支持逐班手动选择或清空教室。</p>
          <p v-if="classRoomMapImportError" class="error">{{ classRoomMapImportError }}</p>

          <el-table :data="filteredClassroomMapView" border>
            <el-table-column prop="campusName" label="所在校区" min-width="120" />
            <el-table-column prop="grade" label="年级" min-width="100" />
            <el-table-column prop="className" label="班级" min-width="120" />
            <el-table-column label="教室" min-width="180">
              <template #default="{ row }">
                <el-select
                  :model-value="row.roomId"
                  class="class-hours-cell-select"
                  clearable
                  placeholder="可不选择"
                  @change="updateClassRoomSelection(row.classId, String($event || ''))"
                >
                  <el-option v-for="item in getClassRoomOptions(row.classId)" :key="item.id" :label="item.roomName" :value="item.id" />
                </el-select>
              </template>
            </el-table-column>
            <template #empty>
              <div>暂无班级数据，请先在班级设置中生成班级。</div>
            </template>
          </el-table>
          <p class="dialog-tip">班级教室支持留空，留空表示该班级未设置固定教室。</p>
        </section>
      </template>

      <template v-else-if="activeMenu === 'student-entry'">
        <section class="teacher-entry-panel">
          <div class="teacher-entry-actions">
            <el-select v-model="studentEntryCampusId" placeholder="选择校区" class="arrangement-filter-select">
              <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
            </el-select>
            <el-select v-model="studentEntryGrade" placeholder="选择年级" class="arrangement-filter-select">
              <el-option v-for="grade in studentGradeOptions" :key="grade" :label="grade" :value="grade" />
            </el-select>
            <el-select v-model="studentEntryClassId" clearable placeholder="全部班级" class="arrangement-filter-select">
              <el-option v-for="item in studentClassOptions" :key="item.id" :label="item.className" :value="item.id" />
            </el-select>
            <span class="teaching-info-actions-spacer" />
            <el-button @click="downloadStudentTemplate">下载模板</el-button>
            <el-button @click="triggerStudentImport">上传 Excel（Mock）</el-button>
            <el-button type="primary" @click="exportStudentData">导出数据</el-button>
            <el-button @click="generateVirtualStudentsPerClass(50)">生成每班50名虚拟学生</el-button>
            <el-button @click="clearVirtualStudents">清除虚拟学生</el-button>
            <el-button type="primary" plain @click="openCreateStudentDialog">新增学生</el-button>
            <input
              ref="studentImportInput"
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              class="hidden-input"
              @change="handleStudentImport"
            />
          </div>
          <p class="dialog-tip">当前为 Mock 流程：建议使用 CSV 模板上传，后续可替换为真实 Excel 解析。</p>
          <p v-if="studentImportError" class="error">{{ studentImportError }}</p>

          <el-table :data="pagedStudentRecordView" border>
            <el-table-column label="学生ID" min-width="140" class-name="student-id-cell">
              <template #default="{ row }">
                <span class="student-id-text">{{ row.id }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="grade" label="年级" min-width="100" />
            <el-table-column prop="className" label="班级" min-width="120" />
            <el-table-column prop="name" label="姓名" min-width="120" />
            <el-table-column prop="gender" label="性别" min-width="80" />
            <el-table-column prop="classStudentNo" label="班内学号" min-width="100" />
            <el-table-column label="操作" min-width="110">
              <template #default="{ row }">
                <el-button type="primary" link @click="openEditStudentDialog(row)">编辑</el-button>
                <el-button type="danger" link @click="removeStudent(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div>暂无学生数据，请先新增。</div>
            </template>
          </el-table>
          <div class="teacher-pagination">
            <el-pagination
              v-model:current-page="studentPage"
              v-model:page-size="studentPageSize"
              :page-sizes="studentPageSizeOptions"
              layout="total, sizes, prev, pager, next, jumper"
              :total="studentRecordView.length"
            />
          </div>

          <el-dialog v-model="studentCreateDialogVisible" title="新增学生" width="560px">
            <el-form label-position="top">
              <el-form-item label="年级" required>
                <el-select v-model="studentCreateForm.grade" placeholder="选择年级">
                  <el-option v-for="grade in studentFormGradeOptions" :key="grade" :label="grade" :value="grade" />
                </el-select>
              </el-form-item>
              <el-form-item label="班级" required>
                <el-select v-model="studentCreateForm.classId" placeholder="选择班级">
                  <el-option v-for="item in studentCreateClassOptions" :key="item.id" :label="item.className" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="姓名" required>
                <el-input v-model="studentCreateForm.name" placeholder="请输入学生姓名" />
              </el-form-item>
              <el-form-item label="性别" required>
                <el-radio-group v-model="studentCreateForm.gender">
                  <el-radio label="男">男</el-radio>
                  <el-radio label="女">女</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="班内学号" required>
                <el-input-number v-model="studentCreateForm.classStudentNo" :min="1" controls-position="right" />
              </el-form-item>
            </el-form>
            <p v-if="studentCreateDialogError" class="error">{{ studentCreateDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeCreateStudentDialog">取消</el-button>
                <el-button type="primary" @click="submitCreateStudentDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>

          <el-dialog v-model="studentEditDialogVisible" title="编辑学生信息" width="560px">
            <el-form label-position="top">
              <el-form-item label="年级" required>
                <el-select v-model="studentEditForm.grade" placeholder="选择年级">
                  <el-option v-for="grade in studentFormGradeOptions" :key="grade" :label="grade" :value="grade" />
                </el-select>
              </el-form-item>
              <el-form-item label="班级" required>
                <el-select v-model="studentEditForm.classId" placeholder="选择班级">
                  <el-option v-for="item in studentEditClassOptions" :key="item.id" :label="item.className" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="姓名" required>
                <el-input v-model="studentEditForm.name" placeholder="请输入学生姓名" />
              </el-form-item>
              <el-form-item label="性别" required>
                <el-radio-group v-model="studentEditForm.gender">
                  <el-radio label="男">男</el-radio>
                  <el-radio label="女">女</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="班内学号" required>
                <el-input-number v-model="studentEditForm.classStudentNo" :min="1" controls-position="right" />
              </el-form-item>
            </el-form>
            <p v-if="studentEditDialogError" class="error">{{ studentEditDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeEditStudentDialog">取消</el-button>
                <el-button type="primary" @click="submitEditStudentDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeMenu === 'teaching-info'">
        <section class="teacher-entry-panel">
          <div class="teaching-info-topbar">
            <div class="teaching-info-top-filters">
              <span>选择校区：</span>
              <el-select v-model="teachingInfoCampusId" placeholder="选择校区" class="arrangement-filter-select">
                <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
              </el-select>
              <span>教学周期：</span>
              <el-select v-model="teachingInfoCycleId" placeholder="选择教学周期" class="arrangement-filter-select">
                <el-option v-for="item in teachingInfoCycleOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </div>
          </div>

          <el-tabs v-model="teachingInfoGrade" class="teaching-info-grade-tabs" type="card">
            <el-tab-pane v-for="grade in teachingInfoGradeOptions" :key="grade" :label="grade" :name="grade" />
          </el-tabs>

          <div class="teacher-entry-actions">
            <el-button>行政班</el-button>
            <span class="teaching-info-actions-spacer" />
            <el-button link type="primary" @click="openTeachingBatchDialog">在线批量编辑</el-button>
          </div>
          <p class="table-tip">提示：单击任课教师单元格可编辑。</p>

          <div class="arrangement-table-wrap">
            <table class="arrangement-table teaching-info-matrix">
              <thead>
                <tr>
                  <th class="sticky-col">班级</th>
                  <th>班主任</th>
                  <th v-for="course in teachingInfoMatrixCourses" :key="course.id">{{ course.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="classRow in teachingInfoMatrixClasses" :key="classRow.id">
                  <td class="sticky-col">{{ classRow.className }}</td>
                  <td class="teaching-info-editable-cell" @click="editClassHeadTeacher(classRow)">
                    <span
                      class="teaching-info-cell-text"
                      :class="{
                        'is-empty': classHeadTeacherName(classRow.id) === '未设置',
                        'is-filled': classHeadTeacherName(classRow.id) !== '未设置'
                      }"
                    >
                      {{ classHeadTeacherName(classRow.id) === '未设置' ? '设置' : classHeadTeacherName(classRow.id) }}
                    </span>
                  </td>
                  <td
                    v-for="course in teachingInfoMatrixCourses"
                    :key="`${classRow.id}-${course.id}`"
                    class="teaching-info-editable-cell"
                    @click="editTeachingInfoCell(classRow, course)"
                  >
                    <span
                      class="teaching-info-cell-text"
                      :class="{
                        'is-empty': !hasTeachingInfoCellTeachers(classRow.id, course.id),
                        'is-filled': hasTeachingInfoCellTeachers(classRow.id, course.id)
                      }"
                    >
                      {{ getTeachingInfoCellText(classRow.id, course.id) }}
                    </span>
                  </td>
                </tr>
                <tr v-if="teachingInfoMatrixClasses.length === 0">
                  <td class="sticky-col">--</td>
                  <td :colspan="Math.max(2, teachingInfoMatrixCourses.length + 1)">暂无班级数据，请先在班级设置中生成班级。</td>
                </tr>
              </tbody>
            </table>
          </div>

          <el-dialog v-model="teachingAssignmentDialogVisible" title="新增任课信息" width="680px">
            <el-form label-position="top">
              <div class="campus-editor-grid">
                <el-form-item label="校区" required>
                  <el-select v-model="teachingAssignmentForm.campusId" placeholder="选择校区">
                    <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="年级" required>
                  <el-select v-model="teachingAssignmentForm.grade" placeholder="选择年级">
                    <el-option v-for="grade in teachingInfoGradeOptions" :key="grade" :label="grade" :value="grade" />
                  </el-select>
                </el-form-item>
                <el-form-item label="班级" required>
                  <el-select v-model="teachingAssignmentForm.classId" placeholder="选择班级">
                    <el-option
                      v-for="item in teachingAssignmentClassOptions"
                      :key="item.id"
                      :label="item.className"
                      :value="item.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="教师" required>
                  <el-select v-model="teachingAssignmentForm.teacherId" placeholder="选择教师">
                    <el-option
                      v-for="item in teachingAssignmentTeacherOptions"
                      :key="item.id"
                      :label="item.name"
                      :value="item.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="课程" required>
                  <el-select v-model="teachingAssignmentForm.courseId" placeholder="选择课程">
                    <el-option
                      v-for="item in teachingAssignmentCourseOptions"
                      :key="item.id"
                      :label="item.name"
                      :value="item.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="周课时">
                  <el-input-number v-model="teachingAssignmentForm.weeklyLessons" :min="0" />
                </el-form-item>
              </div>
            </el-form>
            <p v-if="teachingAssignmentDialogError" class="error">{{ teachingAssignmentDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeTeachingAssignmentDialog">取消</el-button>
                <el-button type="primary" @click="submitTeachingAssignmentDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>

          <el-dialog
            v-model="teachingBatchDialogVisible"
            title="在线批量编辑任课教师"
            width="96vw"
            class="teaching-batch-dialog"
          >
            <div class="dialog-tip">
              操作说明：双击单元格可编辑教师姓名，多个教师用逗号分隔；支持 Excel 复制粘贴与框选区域删除。
            </div>
            <div class="teaching-batch-header">
              <p class="teaching-batch-range">{{ teachingBatchCampusName }} - {{ teachingBatchStage ?? '--' }} - {{ teachingBatchGrade }}</p>
              <div class="teaching-batch-actions">
                <el-button @click="exportTeachingBatchTemplate">导出模板</el-button>
                <el-button type="primary" @click="submitTeachingBatchDialog">提交</el-button>
                <el-button @click="clearTeachingBatchDialog">清空</el-button>
              </div>
            </div>

            <div class="arrangement-table-wrap teaching-batch-grid-wrap">
              <table class="arrangement-table teaching-batch-table">
                <thead>
                  <tr>
                    <th class="sticky-col">班级</th>
                    <th v-for="field in teachingBatchEditableFields" :key="field.id">{{ field.label }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in teachingBatchRows" :key="row.classId">
                    <td class="sticky-col">{{ row.className }}</td>
                    <td
                      v-for="(field, fieldIndex) in teachingBatchEditableFields"
                      :key="`${row.classId}-${field.id}`"
                      :class="{
                        'is-selected': isTeachingBatchCellInSelection(rowIndex, field.id),
                        'is-invalid': isTeachingBatchCellInvalid(rowIndex, field.id)
                      }"
                      @mousedown="handleTeachingBatchCellMousedown({ rowIndex, fieldIndex, event: $event as MouseEvent })"
                      @mouseenter="handleTeachingBatchCellMouseenter({ rowIndex, fieldIndex })"
                      @click="handleTeachingBatchCellClick({ rowIndex, fieldIndex })"
                    >
                      <input
                        v-if="isTeachingBatchCellEditing(rowIndex, field.id)"
                        :class="[
                          'teaching-batch-cell-input',
                          { 'is-invalid-input': isTeachingBatchCellInvalid(rowIndex, field.id) }
                        ]"
                        type="text"
                        :value="row[field.id]"
                        :title="getTeachingBatchCellTitle(rowIndex, field.id, row[field.id] ?? '')"
                        @mousedown.stop
                        @input="updateTeachingBatchCell(row, field.id, String(($event.target as HTMLInputElement)?.value ?? ''))"
                        @blur="closeTeachingBatchCellEditor(rowIndex, field.id)"
                        @paste="handleTeachingBatchPaste(rowIndex, fieldIndex, $event as ClipboardEvent)"
                        @keydown.enter.prevent="closeTeachingBatchCellEditor(rowIndex, field.id)"
                        @keydown.esc.prevent="closeTeachingBatchCellEditor(rowIndex, field.id, true)"
                      />
                      <div
                        v-else
                        class="teaching-batch-cell-view"
                        :title="getTeachingBatchCellTitle(rowIndex, field.id, row[field.id] ?? '')"
                      >
                        <span>{{ row[field.id] }}</span>
                        <span v-if="isTeachingBatchCellInvalid(rowIndex, field.id)" class="teaching-batch-cell-error">不存在</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="teachingBatchDialogError" class="error">{{ teachingBatchDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeTeachingBatchDialog">关闭</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeMenu === 'lesson-cycle'">
        <section class="lesson-cycle-panel">
          <div class="lesson-cycle-toolbar">
            <el-select v-model="selectedTerm" class="lesson-cycle-term-select" placeholder="选择学期">
              <el-option v-for="term in termOptions" :key="term.value" :label="term.label" :value="term.value" />
            </el-select>
          </div>

          <el-table :data="teachingCycles" border>
            <el-table-column prop="orderNo" label="序号" width="90" align="center" header-align="center" />
            <el-table-column prop="cycleName" label="周期名称" min-width="140" align="center" header-align="center" />
            <el-table-column prop="weekRange" label="起止周次" min-width="120" align="center" header-align="center" />
            <el-table-column prop="dateRange" label="起止日期" min-width="180" align="center" header-align="center" />
          </el-table>
        </section>
      </template>

      <template v-else-if="activeMenu === 'course-manage'">
        <section class="course-panel">
          <div class="teacher-entry-actions">
            <el-select v-model="courseCampusId" class="arrangement-filter-select" placeholder="选择校区">
              <el-option label="全部校区" value="__all__" />
              <el-option v-for="item in courseCampusOptions" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
            <el-select v-model="courseTab" class="arrangement-filter-select" placeholder="选择应用范围">
              <el-option v-for="tab in courseTabs" :key="tab" :label="tab" :value="tab" />
            </el-select>
            <el-input v-model="courseKeyword" clearable placeholder="搜索课程名称/简称/学科/校区" style="width: 260px" />
            <el-button @click="downloadCourseTemplate">下载模板</el-button>
            <el-button @click="triggerCourseImport">上传 Excel</el-button>
            <el-button type="primary" @click="exportCourseData">导出学科</el-button>
            <el-button type="success" @click="saveCourseData">保存</el-button>
            <el-button type="danger" plain :disabled="selectedCourseCount === 0" @click="removeCoursesBatch">
              批量删除（{{ selectedCourseCount }}）
            </el-button>
            <input
              ref="courseImportInput"
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              class="hidden-input"
              @change="handleCourseImport"
            />
          </div>
          <p class="dialog-tip">支持上传 Excel/CSV，按模板列顺序导入课程。</p>
          <p v-if="courseImportError" class="error">{{ courseImportError }}</p>

          <el-table
            ref="courseTableRef"
            :data="filteredCourses"
            row-key="id"
            border
            @selection-change="onCourseSelectionChange"
          >
            <el-table-column type="selection" width="46" />
            <el-table-column label="序号" width="80" align="center" header-align="center">
              <template #default="{ row }">{{ filteredCourseIndexMap[row.id] ?? '-' }}</template>
            </el-table-column>
            <el-table-column prop="name" label="课程名称" min-width="140" />
            <el-table-column prop="shortName" label="课程简称" min-width="120" />
            <el-table-column prop="subject" label="所属学科" min-width="120" />
            <el-table-column label="所属校区" min-width="120">
              <template #default="{ row }">
                {{ campuses.find((campus) => campus.id === row.campusId)?.name ?? '全部校区' }}
              </template>
            </el-table-column>
            <el-table-column label="应用范围" min-width="120">
              <template #default="{ row }">{{ row.scopes.join('、') }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="120">
              <template #default="{ row }">
                <el-button type="primary" link @click="editCourse(row)">编辑</el-button>
                <el-button type="danger" link @click="deleteCourse(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <el-dialog
            v-model="courseDialogVisible"
            :title="courseDialogMode === 'create' ? '新增课程' : '编辑课程'"
            width="620px"
            destroy-on-close
          >
            <el-form label-position="top">
              <el-form-item label="课程名称" required>
                <el-input v-model="courseForm.name" placeholder="请输入课程名称（如：语文）" clearable />
              </el-form-item>
              <el-form-item label="课程简称">
                <el-input v-model="courseForm.shortName" placeholder="可选，例如：语" clearable />
              </el-form-item>
              <el-form-item label="所属学科">
                <el-select
                  v-model="courseForm.subject"
                  filterable
                  allow-create
                  default-first-option
                  clearable
                  placeholder="可选：请选择或输入所属学科"
                >
                  <el-option v-for="subject in courseSubjectOptions" :key="subject" :label="subject" :value="subject" />
                </el-select>
              </el-form-item>
              <el-form-item label="应用范围" required>
                <el-select v-model="courseForm.scope" placeholder="请选择应用范围">
                  <el-option v-for="scope in enabledCourseScopes" :key="scope" :label="scope" :value="scope" />
                </el-select>
              </el-form-item>
              <el-form-item label="所属校区">
                <el-select v-model="courseForm.campusId" clearable placeholder="不选则为全部校区">
                  <el-option v-for="item in campuses" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
            </el-form>
            <p v-if="courseDialogError" class="error">{{ courseDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeCourseDialog">取消</el-button>
                <el-button type="primary" @click="submitCourseDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeMenu === 'class-hours'">
        <section class="class-hours-panel">
          <div class="class-hours-topbar">
            <el-select v-model="selectedTerm" class="class-hours-term-select" placeholder="选择学期">
              <el-option v-for="term in termOptions" :key="term.value" :label="term.label" :value="term.value" />
            </el-select>

            <div class="class-hours-campus">
              <label for="hours-campus">选择校区：</label>
              <el-select id="hours-campus" v-model="selectedHoursCampusId" class="class-hours-campus-select" placeholder="选择校区">
                <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
              </el-select>
            </div>

            <div class="class-hours-campus">
              <label for="hours-system">学制：</label>
              <el-select
                id="hours-system"
                v-model="selectedHoursEducationSystem"
                class="class-hours-system-select"
                placeholder="选择学制"
              >
                <el-option v-for="item in EDUCATION_SYSTEM_OPTIONS" :key="`hours-system-${item}`" :label="item" :value="item" />
              </el-select>
            </div>
          </div>

          <div class="class-hours-batch">
            <div class="class-hours-batch-head">
              <span class="class-hours-batch-title">批量设置所有年级</span>
              <el-button type="primary" link @click="applyBatchClassHours">应用到所有年级</el-button>
            </div>
            <div class="class-hours-batch-grid">
              <div class="class-hours-batch-item">
                <label>每周上课天数</label>
                <el-select v-model="classHoursBatchForm.weeklyDays" clearable placeholder="未设置" class="class-hours-cell-select">
                  <el-option v-for="item in hourDayOptions" :key="`batch-weekly-${item}`" :label="String(item)" :value="item" />
                </el-select>
              </div>
              <div class="class-hours-batch-item">
                <label>早自习课时</label>
                <el-select
                  v-model="classHoursBatchForm.morningStudy"
                  clearable
                  placeholder="未设置"
                  class="class-hours-cell-select"
                >
                  <el-option v-for="item in hourCountOptions" :key="`batch-ms-${item}`" :label="String(item)" :value="item" />
                </el-select>
              </div>
              <div class="class-hours-batch-item">
                <label>上午课时</label>
                <el-select
                  v-model="classHoursBatchForm.morningLessons"
                  clearable
                  placeholder="未设置"
                  class="class-hours-cell-select"
                >
                  <el-option v-for="item in hourCountOptions" :key="`batch-ml-${item}`" :label="String(item)" :value="item" />
                </el-select>
              </div>
              <div class="class-hours-batch-item">
                <label>下午课时</label>
                <el-select
                  v-model="classHoursBatchForm.afternoonLessons"
                  clearable
                  placeholder="未设置"
                  class="class-hours-cell-select"
                >
                  <el-option v-for="item in hourCountOptions" :key="`batch-al-${item}`" :label="String(item)" :value="item" />
                </el-select>
              </div>
              <div class="class-hours-batch-item">
                <label>晚自习课时</label>
                <el-select
                  v-model="classHoursBatchForm.eveningStudy"
                  clearable
                  placeholder="未设置"
                  class="class-hours-cell-select"
                >
                  <el-option v-for="item in hourCountOptions" :key="`batch-es-${item}`" :label="String(item)" :value="item" />
                </el-select>
              </div>
              <div class="class-hours-batch-item">
                <label>课间操时间（可选）</label>
                <el-select v-model="classHoursBatchForm.breakSlot" clearable placeholder="未设置" class="class-hours-cell-select">
                  <el-option
                    v-for="item in breakSlotOptions"
                    :key="`batch-break-${item || 'none'}`"
                    :label="item || '不设置'"
                    :value="item"
                  />
                </el-select>
              </div>
            </div>
          </div>

          <el-table :data="currentClassHourRows" border>
            <el-table-column prop="grade" label="年级" min-width="110" />
            <el-table-column label="每周上课天数" min-width="130">
              <template #default="{ row }">
                <el-select v-model.number="row.weeklyDays" class="class-hours-cell-select">
                  <el-option v-for="item in hourDayOptions" :key="item" :label="String(item)" :value="item" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="早自习课时" min-width="120">
              <template #default="{ row }">
                <el-select v-model.number="row.morningStudy" class="class-hours-cell-select">
                  <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="上午课时" min-width="110">
              <template #default="{ row }">
                <el-select v-model.number="row.morningLessons" class="class-hours-cell-select">
                  <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="下午课时" min-width="110">
              <template #default="{ row }">
                <el-select v-model.number="row.afternoonLessons" class="class-hours-cell-select">
                  <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="晚自习课时" min-width="120">
              <template #default="{ row }">
                <el-select v-model.number="row.eveningStudy" class="class-hours-cell-select">
                  <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="课间操时间（可选）" min-width="140">
              <template #default="{ row }">
                <el-select v-model="row.breakSlot" class="class-hours-cell-select">
                  <el-option
                    v-for="item in breakSlotOptions"
                    :key="`row-break-${item || 'none'}`"
                    :label="item || '不设置'"
                    :value="item"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="单班总课时" min-width="110" align="center" header-align="center">
              <template #default="{ row }">{{ getClassHourTotalLessons(row) }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="110">
              <template #default="{ row }">
                <el-button type="primary" link @click="setByClass(row)">按班设置</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="class-hours-actions class-hours-actions-bottom">
            <el-button type="primary" size="small" @click="saveClassHours">保存</el-button>
            <el-button size="small" @click="openResetClassHoursDialog">重置</el-button>
          </div>

          <el-dialog v-model="classHoursByClassVisible" :title="`${classHoursByClassGrade} 按班课时设置`" width="980px">
            <el-table :data="classHoursByClassRows" border>
              <el-table-column prop="className" label="班级" min-width="120" />
              <el-table-column label="每周上课天数" min-width="130">
                <template #default="{ row }">
                  <el-select v-model.number="row.weeklyDays" class="class-hours-cell-select">
                    <el-option v-for="item in hourDayOptions" :key="item" :label="String(item)" :value="item" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="早自习课时" min-width="120">
                <template #default="{ row }">
                  <el-select v-model.number="row.morningStudy" class="class-hours-cell-select">
                    <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="上午课时" min-width="110">
                <template #default="{ row }">
                  <el-select v-model.number="row.morningLessons" class="class-hours-cell-select">
                    <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="下午课时" min-width="110">
                <template #default="{ row }">
                  <el-select v-model.number="row.afternoonLessons" class="class-hours-cell-select">
                    <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="晚自习课时" min-width="120">
                <template #default="{ row }">
                  <el-select v-model.number="row.eveningStudy" class="class-hours-cell-select">
                    <el-option v-for="item in hourCountOptions" :key="item" :label="String(item)" :value="item" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="课间操时间（可选）" min-width="150">
                <template #default="{ row }">
                  <el-select v-model="row.breakSlot" class="class-hours-cell-select">
                    <el-option
                      v-for="item in breakSlotOptions"
                      :key="`class-break-${item || 'none'}`"
                      :label="item || '不设置'"
                      :value="item"
                    />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="班级总课时" min-width="110" align="center" header-align="center">
                <template #default="{ row }">{{ getClassHourTotalLessons(row) }}</template>
              </el-table-column>
            </el-table>

            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeClassHoursByClassDialog">取消</el-button>
                <el-button type="primary" @click="saveClassHoursByClassDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>

          <el-dialog v-model="classHoursResetDialogVisible" title="重置课时" width="420px">
            <el-form label-position="top">
              <el-form-item label="选择重置年级">
                <el-select v-model="resetGradeTarget" class="class-hours-reset-grade-select">
                  <el-option label="全部年级" value="__all__" />
                  <el-option v-for="grade in classHourResetGradeOptions" :key="grade" :label="grade" :value="grade" />
                </el-select>
              </el-form-item>
            </el-form>
            <p class="dialog-tip">确认后将目标年级课时全部重置为 0。</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeResetClassHoursDialog">取消</el-button>
                <el-button type="primary" @click="requestResetClassHoursConfirm">确认重置</el-button>
              </div>
            </template>
          </el-dialog>

          <el-dialog v-model="classHoursResetFinalVisible" title="二次确认" width="420px">
            <p class="dialog-tip">
              你将把「{{ resetGradeTargetLabel }}」的课时重置为 0。此操作会同时影响按班设置，是否继续？
            </p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="classHoursResetFinalVisible = false">取消</el-button>
                <el-button type="danger" @click="confirmResetClassHoursDialog">最终确认重置</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeMenu === 'time-slot'">
        <section class="arrangement-panel">
          <div class="arrangement-hero">
            <div class="arrangement-hero-top">
              <el-radio-group
                v-model="arrangementMode"
                class="arrangement-mode-tabs"
                @change="handleArrangementModeChange($event as '课程课时' | '教室类型')"
              >
                <el-radio-button label="课程课时" />
                <el-radio-button label="教室类型" />
              </el-radio-group>

              <div class="arrangement-kpis">
                <div class="arrangement-kpi">
                  <span class="kpi-label">班级数</span>
                  <strong class="kpi-value">{{ arrangementSummary.classCount }}</strong>
                </div>
                <div class="arrangement-kpi">
                  <span class="kpi-label">课程数</span>
                  <strong class="kpi-value">{{ arrangementSummary.courseCount }}</strong>
                </div>
                <div class="arrangement-kpi">
                  <span class="kpi-label">预计课时</span>
                  <strong class="kpi-value">{{ arrangementSummary.estimatedLessons }}</strong>
                </div>
              </div>
            </div>

            <div class="arrangement-toolbar">
              <div class="arrangement-left">
                <el-select v-model="arrangementCampusId" class="arrangement-filter-select" placeholder="选择校区">
                  <el-option v-for="campus in campuses" :key="campus.id" :label="campus.name" :value="campus.id" />
                </el-select>
                <el-select v-model="arrangementGrade" class="arrangement-filter-select" placeholder="选择年级">
                  <el-option v-for="grade in arrangementGradeOptions" :key="grade" :label="grade" :value="grade" />
                </el-select>
              </div>

              <div class="arrangement-right">
                <el-button @click="arrangementActionTip('下载模板')">下载模板</el-button>
                <el-button @click="arrangementActionTip('上传数据')">上传数据</el-button>
              </div>
            </div>
          </div>

          <div v-if="arrangementHasClasses" class="arrangement-table-wrap">
            <table class="arrangement-table">
              <thead>
                <tr>
                  <th class="sticky-col">班级</th>
                  <th>总课时</th>
                  <th v-for="course in arrangementCourses" :key="`head-${course.id}`">{{ course.name }}</th>
                  <th class="sticky-right operation-col">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr class="batch-row">
                  <td class="sticky-col">批量设置</td>
                  <td>{{ getArrangementTotalByValues(arrangementBatchValues) }}</td>
                  <td v-for="course in arrangementCourses" :key="`batch-${course.id}`">
                    <el-input-number
                      class="arrangement-cell-number"
                      :model-value="arrangementBatchValues[course.id] ?? undefined"
                      :min="0"
                      controls-position="right"
                      @update:model-value="updateArrangementBatchByNumber(course.id, $event as number | null | undefined)"
                    />
                  </td>
                  <td class="sticky-right operation-col">
                    <el-button type="primary" link @click="applyBatchToAllClasses">应用</el-button>
                  </td>
                </tr>

                <tr v-for="row in arrangementRows" :key="row.id">
                  <td class="sticky-col">{{ row.className }}</td>
                  <td>{{ getArrangementTotalByValues(row.values) }}</td>
                  <td v-for="course in arrangementCourses" :key="`${row.id}-${course.id}`">
                    <el-input-number
                      class="arrangement-cell-number"
                      :model-value="row.values[course.id] ?? undefined"
                      :min="0"
                      controls-position="right"
                      @update:model-value="updateArrangementCellByNumber(row.id, course.id, $event as number | null | undefined)"
                    />
                  </td>
                  <td class="sticky-right operation-col">
                    <el-button type="primary" link @click="clearArrangementRow(row.id)">清空</el-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <el-empty
            v-else
            class="arrangement-empty"
            description="当前年级没有班级，请先在班级设置中生成班级。"
            :image-size="84"
          />
          <div class="arrangement-actions arrangement-actions-bottom">
            <el-button type="primary" size="small" @click="saveArrangementSettings">保存</el-button>
            <el-button size="small" @click="openResetArrangementDialog">重置</el-button>
          </div>

          <el-dialog v-model="arrangementResetDialogVisible" title="重置课时" width="420px">
            <p class="dialog-tip">确认后将当前课程安排页面的课时全部重置为 0。</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeResetArrangementDialog">取消</el-button>
                <el-button type="primary" @click="requestResetArrangementConfirm">确认重置</el-button>
              </div>
            </template>
          </el-dialog>

          <el-dialog v-model="arrangementResetFinalVisible" title="二次确认" width="420px">
            <p class="dialog-tip">该操作将把当前页面所有班级课时清零，是否继续？</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="arrangementResetFinalVisible = false">取消</el-button>
                <el-button type="danger" @click="confirmResetArrangementDialog">最终确认重置</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <p v-else class="coming-soon">当前模块正在配置中。</p>
    </article>
  </section>
</template>
