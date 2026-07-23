import { withAccountQuery, withAccountStorageKey } from './accountContext'
import { authHeaders } from './auth'

export type Campus = {
  id: string
  schoolName?: string
  name: string
  system: boolean
  educationSystem?: '小学' | '初中' | '九年一贯制'
}

export type SemesterItem = {
  name: string
  startDate: string
  endDate: string
}

export type SchoolYear = {
  id: string
  yearName: string
  yearStartDate: string
  yearEndDate: string
  semesters: SemesterItem[]
}

export type TeachingCycle = {
  id: string
  orderNo: number
  cycleName: string
  weekRange: string
  dateRange: string
}

export type CourseScope = '小学' | '初中' | '高中'

export type CourseItem = {
  id: string
  orderNo: number
  name: string
  shortName: string
  subject: string
  scopes: CourseScope[]
}

export type RoomTypeRecord = {
  id: string
  name: string
  system: boolean
}

export type RoomRecord = {
  id: string
  roomName: string
  roomTypeId: string
  campusId: string
  buildingName: string
  floorNo: number
  capacity: number
}

export type ClassRoomMapRecord = {
  classId: string
  roomId: string
}

export type TeacherRecord = {
  id: string
  name: string
  subject: string
  subjectGroup: string
  weeklyLessonRequirement: number
  campusId: string
}

export type StudentRecord = {
  id: string
  campusId: string
  grade: string
  classId: string
  name: string
  gender: '男' | '女'
  classStudentNo: number
}

export type GroupRecord = {
  id: string
  name: string
  type: string
  campusId: string
  memberNames: string[]
  remark: string
}

export type ClassRecord = {
  id: string
  campusId: string
  stage: '小学' | '初中'
  grade: string
  classNo: number
  className: string
  headTeacherId?: string
}

export type FixedActivity = {
  id: string
  name: string
  anchorPeriod: number
  position: 'before' | 'after'
}

export type ClassHourRow = {
  id: string
  campusId?: string
  grade: string
  weeklyDays: number
  morningStudy: number
  morningLessons: number
  afternoonLessons: number
  eveningStudy: number
  breakSlot: string
  fixedActivities?: FixedActivity[]
}

export type ClassHourClassRow = {
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
  fixedActivities?: FixedActivity[]
}

export type ScheduleWorkbenchEntry = {
  selectedCampus: string
  selectedGrade: string
  selectedClass: string
  scheduleMap: Record<string, Record<string, unknown>>
  savedAt: number
  publishedAt?: number
  version: number
}

export type BasicDataSnapshot = {
  campuses: Campus[]
  schoolYears: SchoolYear[]
  teachingCycles: TeachingCycle[]
  courses: CourseItem[]
  roomTypes?: RoomTypeRecord[]
  roomRecords?: RoomRecord[]
  classRoomMappings?: ClassRoomMapRecord[]
  teacherRecords: TeacherRecord[]
  studentRecords: StudentRecord[]
  groupRecords: GroupRecord[]
  classRecords: ClassRecord[]
  classHourRows: ClassHourRow[]
  classHourClassRows?: ClassHourClassRow[]
  selectedTerm: string
  selectedHoursCampusId: string
  arrangementCampusId: string
  arrangementGrade: string
  arrangementRows?: unknown[]
  arrangementBatchValues?: Record<string, number | null>
  arrangementScopes?: Record<string, unknown>
  scheduleWorkbench?: Record<string, ScheduleWorkbenchEntry>
  termData?: Record<string, Record<string, unknown>>
  _savedAt?: number
}

export type BasicDataRepository = {
  load: () => Partial<BasicDataSnapshot> | null | Promise<Partial<BasicDataSnapshot> | null>
  save: (snapshot: BasicDataSnapshot) => void | Promise<void>
}

const BASIC_DATA_STORAGE_KEY = 'schedule_basic_data_v1'
const apiProfile = (import.meta.env.VITE_API_PROFILE ?? 'test').trim().toLowerCase() || 'test'
const BASIC_DATA_API_PATH = `/api/${apiProfile}/basic-data`
const basicDataSource = (import.meta.env.VITE_BASIC_DATA_SOURCE ?? 'api').toLowerCase()
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
const planId = (import.meta.env.VITE_BASIC_DATA_PLAN_ID ?? 'default').trim() || 'default'
let apiSaveQueue: Promise<void> = Promise.resolve()

function isValidSnapshotPayload(payload: unknown): payload is Partial<BasicDataSnapshot> {
  if (!payload || typeof payload !== 'object') return false
  return Object.keys(payload as Record<string, unknown>).length > 0
}

function snapshotSavedAt(payload: Partial<BasicDataSnapshot> | null): number {
  if (!payload || typeof payload !== 'object') return 0
  const raw = payload._savedAt
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

export const basicDataLocalRepository: BasicDataRepository = {
  load() {
    const raw = localStorage.getItem(withAccountStorageKey(BASIC_DATA_STORAGE_KEY))
    if (!raw) return null

    try {
      return JSON.parse(raw) as Partial<BasicDataSnapshot>
    } catch {
      return null
    }
  },

  save(snapshot) {
    localStorage.setItem(withAccountStorageKey(BASIC_DATA_STORAGE_KEY), JSON.stringify(snapshot))
  }
}

export const basicDataApiRepository: BasicDataRepository = {
  async load() {
    const endpoint = withAccountQuery(`${apiBaseUrl}${BASIC_DATA_API_PATH}?planId=${encodeURIComponent(planId)}`)
    try {
      const response = await fetch(endpoint, { method: 'GET', headers: authHeaders() })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = (await response.json()) as unknown
      if (!isValidSnapshotPayload(payload)) {
        return basicDataLocalRepository.load()
      }
      const apiData = payload as Partial<BasicDataSnapshot>
      return apiData
    } catch (error) {
      console.warn('[BasicDataRepository] API 读取失败。', error)
      return basicDataLocalRepository.load()
    }
  },

  save(snapshot) {
    const immutableSnapshot = JSON.parse(JSON.stringify(snapshot)) as BasicDataSnapshot
    apiSaveQueue = apiSaveQueue
      .catch(() => undefined)
      .then(async () => {
        const enriched: BasicDataSnapshot = {
          ...immutableSnapshot,
          _savedAt: Date.now()
        }

        const endpoint = withAccountQuery(`${apiBaseUrl}${BASIC_DATA_API_PATH}?planId=${encodeURIComponent(planId)}`)
        const response = await fetch(endpoint, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(enriched)
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        // Keep a local mirror after API success so the last confirmed snapshot
        // remains available when the API is temporarily unreachable.
        basicDataLocalRepository.save(enriched)
      })
    return apiSaveQueue
  }
}

export const basicDataRepository: BasicDataRepository =
  basicDataSource === 'api' ? basicDataApiRepository : basicDataLocalRepository
