<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { notify } from '../../utils/notify'
import { sortGradeLabels } from '../../utils/gradeOrder'
import AppContentSkeleton from '../../components/AppContentSkeleton.vue'
import {
  cloneCourseDefaultConfig,
  defaultCourseDefaultConfig,
  defaultRuleWeightConfig,
  hydrateRuleSettingsSnapshotFromApi,
  loadRuleSettingsSnapshot,
  saveRuleSettingsSnapshot,
  type CombineCourseRuleRecord,
  type ConsecutiveRuleValue,
  type ConsecutiveSetting,
  type ConsecutiveSettingMap,
  type CourseAreaRuleRecord,
  type CourseBanRuleRecord,
  type CourseDefaultConfig,
  type CourseDefaultRuleKey,
  type CourseRelationRuleRecord,
  type GlobalFixedPointRecord,
  type MainSecondaryRuleRecord,
  type OddEvenRuleRecord,
  type TeacherHourRuleRecord,
  type TeacherMutualRuleRecord,
  type RuleWeightConfig,
  type RuleWeightRule,
  type RuleWeightRuleKey,
  type RuleWeightConfigRecord,
  type RuleWeightHardKey,
  type RuleWeightSoftKey,
  type RuleSettingsSnapshot
} from '../../services/ruleSettings'
import {
  basicDataRepository,
  type Campus,
  type ClassHourClassRow,
  type ClassHourRow,
  type ClassRecord,
  type CourseItem,
  type GroupRecord,
  type StudentRecord,
  type TeacherRecord
} from '../../services/basicDataRepository'

type RuleStep = {
  id: string
  label: string
}

type RuleNavCard = {
  id: string
  title: string
  desc: string
}

type CommonRuleGuide = RuleNavCard & {
  usage: string[]
}
type CommonRuleTab = {
  id: string
  title: string
  closable: boolean
}

type TeacherHourRule = {
  id: string
  teacherId: string
  teacherName: string
  maxDailyLessons: number | null
  maxConsecutiveLessons: number | null
  weekDistribution: '周分散' | '周集中' | null
  dayDistribution: '日分散' | '日集中' | null
  isAllTeachers?: boolean
  hasOwnRule?: boolean
}

type CourseCombineRule = CombineCourseRuleRecord

type OddEvenRule = OddEvenRuleRecord
type AdminBaseSnapshot = {
  selectedTerm: string
  campuses: Campus[]
  classRecords: ClassRecord[]
  classHourRows: ClassHourRow[]
  classHourClassRows: ClassHourClassRow[]
  teachingAssignments: Array<{
    id: string
    campusId: string
    grade: string
    classId: string
    teacherId: string
    courseId: string
    weeklyLessons: number
  }>
  courses: CourseItem[]
  teacherRecords: TeacherRecord[]
  studentRecords: StudentRecord[]
  groupRecords: GroupRecord[]
}

const steps: RuleStep[] = [
  { id: 'course-common', label: '课程规则' },
  { id: 'teacher-rules', label: '教师规则' },
  { id: 'advanced', label: '高级设置' }
]

const commonRuleCards: CommonRuleGuide[] = [
  {
    id: 'course-main',
    title: '主副科',
    desc: '设置主科与副科。',
    usage: ['用于区分主科和副科，便于后续规则按学科类型生效。', '建议先完成此项，再配置默认规则。']
  },
  {
    id: 'course-fixed',
    title: '全局固定点',
    desc: '配置固定节次不可排课程。',
    usage: ['设置后，该节次会作为固定占用点，普通课程不再进入该时段。', '常用于班会、社团、校级活动等时段。']
  },
  {
    id: 'course-combine',
    title: '合班课',
    desc: '配置多班同节次上课。',
    usage: ['用于多个班级在同一时间统一上课的场景。', '可指定校区、年级、班级和课程范围。']
  },
  {
    id: 'course-odd-even',
    title: '单双周',
    desc: '设置单双周课程配对。',
    usage: ['单周课程与双周课程在同一节次交替出现。', '适合实验课、专题课等隔周上课场景。']
  },
  {
    id: 'course-consecutive',
    title: '连堂课',
    desc: '设置每周连堂课次数与优先连堂日。',
    usage: ['可设置每周连堂次数，并指定希望安排连堂课的星期。', '支持默认生效并按班级进行特殊覆盖。']
  },
  {
    id: 'course-slot',
    title: '课程时段设置',
    desc: '按课程、班级设置允许排课或禁止排课的节次。',
    usage: ['切换设置状态后，在同一张节次表格中完成配置。', '允许排课限定可排节次；禁止排课则阻止课程进入指定节次。']
  },
  {
    id: 'course-relation',
    title: '课程关系',
    desc: '配置前后互斥与同天互斥。',
    usage: ['前后互斥：两个课程不能相邻节次安排。', '同天互斥：两个课程不能安排在同一天。']
  }
]
const teacherRuleCards: CommonRuleGuide[] = [
  {
    id: 'teacher-ban',
    title: '教师不排课',
    desc: '配置单个教师或教研活动组在指定节次禁排。',
    usage: ['支持按教师或教研活动组配置禁排时段。', '禁排节次会作为硬约束，不参与自动排课。']
  },
  {
    id: 'teacher-hours',
    title: '教师课时',
    desc: '设置教师每天最大课时、连上课时以及周/日分布偏好。',
    usage: ['可限制单日最大课时与最大连续课时。', '支持周分布和日分布偏好，影响求解器排课方向。']
  },
  {
    id: 'teacher-mutual',
    title: '教师互斥',
    desc: '配置师徒带教与互斥关系，避免同节次冲突。',
    usage: ['可维护需要互斥排课的教师组合。', '可用于师徒带教、同组教研等冲突约束。']
  }
]

const activeStep = ref('course-common')
const selectedCommonRuleId = ref('course-main')
const selectedTeacherRuleId = ref('teacher-ban')
const adminBaseLoading = ref(false)
const adminBaseLoadedAt = ref(0)
const rulesReady = ref(false)
const adminBaseSnapshot = ref<AdminBaseSnapshot>({
  selectedTerm: '',
  campuses: [],
  classRecords: [],
  classHourRows: [],
  classHourClassRows: [],
  teachingAssignments: [],
  courses: [],
  teacherRecords: [],
  studentRecords: [],
  groupRecords: []
})

const campusOptions = computed(() => adminBaseSnapshot.value.campuses.map((item) => item.name).filter(Boolean))
const campusIdByName = computed(() => new Map(adminBaseSnapshot.value.campuses.map((item) => [item.name, item.id] as const)))
const gradeOptions = computed(() => {
  const set = new Set(adminBaseSnapshot.value.classRecords.map((item) => item.grade).filter(Boolean))
  return ['全部年级', ...sortGradeLabels(set)]
})

const selectedCampus = ref('')
const selectedGrade = ref('全部年级')
const fixedPointSelecting = ref(false)
const fixedPointSelectionStart = ref<{ period: number; day: string } | null>(null)
const fixedPointSelectedSlots = ref<string[]>([])
const fixedPointContextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  slots: [] as string[],
  anchorPeriod: 1,
  anchorDay: '周一'
})
const selectedTeacherHourCampus = ref('')
const selectedTeacherHourGrade = ref('')
const selectedTeacherHourSubject = ref('语文')

const allWeekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function resolveTimetableShape(
  campusName: string,
  grade: string
): {
  dayCount: number
  periodCount: number
} {
  const campusId = campusIdByName.value.get(campusName)
  const matchCampus = (value: { campusId: string }) => !campusId || value.campusId === campusId
  const matchGrade = <T extends { grade: string }>(value: T) => grade === '全部年级' || !grade || value.grade === grade

  const gradeRows = adminBaseSnapshot.value.classHourRows.filter((item) => matchCampus(item) && matchGrade(item))
  const classRows = adminBaseSnapshot.value.classHourClassRows.filter((item) => matchCampus(item) && matchGrade(item))
  const allRows = [...gradeRows, ...classRows]

  const dayCandidates = allRows.map((item) => Math.floor(Number(item.weeklyDays) || 0)).filter((item) => item > 0)
  const periodCandidates = allRows
    .map((item) =>
      Math.floor(
        Number(item.morningStudy || 0) +
          Number(item.morningLessons || 0) +
          Number(item.afternoonLessons || 0) +
          Number(item.eveningStudy || 0)
      )
    )
    .filter((item) => item > 0)

  const dayCount = Math.max(1, Math.min(7, dayCandidates.length ? Math.max(...dayCandidates) : 5))
  const periodCount = Math.max(1, Math.min(12, periodCandidates.length ? Math.max(...periodCandidates) : 8))
  return { dayCount, periodCount }
}

function resolveConfiguredTimetableShape(campusName: string, grade: string): { dayCount: number; periodCount: number } | null {
  const campusId = campusIdByName.value.get(campusName)
  if (!campusId) return null

  const matchesGrade = <T extends { grade: string }>(item: T) => grade === '全部年级' || item.grade === grade
  const rows = [
    ...adminBaseSnapshot.value.classHourRows.filter((item) => item.campusId === campusId && matchesGrade(item)),
    ...adminBaseSnapshot.value.classHourClassRows.filter((item) => item.campusId === campusId && matchesGrade(item))
  ]

  const configuredRows = rows
    .map((item) => ({
      weeklyDays: Math.floor(Number(item.weeklyDays) || 0),
      periodCount: Math.floor(
        Number(item.morningStudy || 0) +
          Number(item.morningLessons || 0) +
          Number(item.afternoonLessons || 0) +
          Number(item.eveningStudy || 0)
      )
    }))
    .filter((item) => item.weeklyDays > 0 && item.periodCount > 0)

  if (configuredRows.length === 0) return null

  return {
    dayCount: Math.min(7, Math.max(...configuredRows.map((item) => item.weeklyDays))),
    periodCount: Math.min(12, Math.max(...configuredRows.map((item) => item.periodCount)))
  }
}

const fixedPointTimetableShape = computed(() => resolveConfiguredTimetableShape(selectedCampus.value, selectedGrade.value))
const hasFixedPointTimetable = computed(() => fixedPointTimetableShape.value !== null)
const fixedPointDays = computed(() => allWeekDays.slice(0, fixedPointTimetableShape.value?.dayCount ?? 0))
const fixedPointPeriods = computed(() =>
  Array.from({ length: fixedPointTimetableShape.value?.periodCount ?? 0 }, (_, idx) => idx + 1)
)
const teacherBanDays = computed(() => allWeekDays.slice(0, resolveTimetableShape('', '全部年级').dayCount))
const teacherBanPeriods = computed(() =>
  Array.from({ length: resolveTimetableShape('', '全部年级').periodCount }, (_, idx) => idx + 1)
)

function cloneFixedPointRules(list: GlobalFixedPointRecord[] | undefined): GlobalFixedPointRecord[] {
  return Array.isArray(list) ? list.map((item) => ({ ...item })) : []
}

function cloneConsecutiveSettingMap(map: ConsecutiveSettingMap | undefined): ConsecutiveSettingMap {
  if (!map || typeof map !== 'object') return {}
  const result: ConsecutiveSettingMap = {}
  Object.entries(map).forEach(([key, setting]) => {
    if (!setting || typeof setting !== 'object') return
    const classOverrides: Record<string, ConsecutiveRuleValue> = {}
    Object.entries(setting.classOverrides || {}).forEach(([className, value]) => {
      classOverrides[className] = {
        weeklyConsecutiveCount: value?.weeklyConsecutiveCount ?? null,
        preferredDays: Array.isArray(value?.preferredDays) ? [...value.preferredDays] : []
      }
    })
    result[key] = {
      defaultRule: {
        weeklyConsecutiveCount: setting.defaultRule?.weeklyConsecutiveCount ?? null,
        preferredDays: Array.isArray(setting.defaultRule?.preferredDays) ? [...setting.defaultRule.preferredDays] : []
      },
      classOverrides
    }
  })
  return result
}

const ruleSettingsSnapshot = loadRuleSettingsSnapshot()
function cloneRuleSettingsValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const persistedRuleSettingsSnapshot = ref<RuleSettingsSnapshot>(cloneRuleSettingsValue(ruleSettingsSnapshot))

function persistRuleSettingsSections(patch: Partial<RuleSettingsSnapshot>): void {
  if (!rulesReady.value || !adminBaseSnapshot.value.selectedTerm) {
    notify.warning('当前学年学期尚未准备完成，规则暂未保存。')
    return
  }
  const nextSnapshot = {
    ...cloneRuleSettingsValue(persistedRuleSettingsSnapshot.value),
    ...cloneRuleSettingsValue(patch),
    version: persistedRuleSettingsSnapshot.value.version || 2,
    _termId: adminBaseSnapshot.value.selectedTerm
  } as RuleSettingsSnapshot
  persistedRuleSettingsSnapshot.value = cloneRuleSettingsValue(nextSnapshot)
  saveRuleSettingsSnapshot(nextSnapshot, adminBaseSnapshot.value.selectedTerm)
}

const fixedPointRules = ref<GlobalFixedPointRecord[]>(cloneFixedPointRules(ruleSettingsSnapshot.globalFixedPoints))
const fixedPointDraftRules = ref<GlobalFixedPointRecord[]>(cloneFixedPointRules(ruleSettingsSnapshot.globalFixedPoints))
const fallbackBanSubjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '政治', '地理', '音乐', '美术', '信息']
const defaultMainSubjects = ['语文', '数学', '英语', '科学']
const activeBanSubject = ref('语文')
const courseSlotMode = ref<'area' | 'ban'>('area')
const selectedConsecutiveType = ref('正课')
const activeConsecutiveSubject = ref('语文')
const selectedConsecutiveCampus = ref('')
const selectedConsecutiveGrade = ref('')
const selectedConsecutiveClass = ref('全部班级')
const consecutiveWeekdays = ['周一', '周二', '周三', '周四', '周五']
const consecutiveSettingMap = ref<ConsecutiveSettingMap>(cloneConsecutiveSettingMap(ruleSettingsSnapshot.consecutiveSettings))
const teacherBanMode = ref<'single' | 'group'>('single')
const selectedTeacherId = ref('')
const selectedGroupId = ref('')
const teacherBanMap = ref<Record<string, Record<string, boolean>>>(ruleSettingsSnapshot.teacherBanRules || {})

const teacherHourCampusOptions = computed(() => campusOptions.value)
const teacherHourGradeOptions = computed(() => gradeOptions.value)
const teacherHourRuleStore = ref<TeacherHourRuleRecord[]>(ruleSettingsSnapshot.teacherHourRules || [])
const teacherHourInlineEditorMap = ref<
  Record<
    string,
    {
      maxDailyLessons: number | null
      maxConsecutiveLessons: number | null
      weekDistribution: '' | '周分散' | '周集中'
      dayDistribution: '' | '日分散' | '日集中'
    }
  >
>({})
const teacherHourDistributionOptions = ['周分散', '周集中'] as const
const teacherHourDayDistributionOptions = ['日分散', '日集中'] as const

const teacherHourSubjectOptions = computed(() => {
  const selectedCampusId = campusIdByName.value.get(selectedTeacherHourCampus.value)
  const stageSet = new Set(
    adminBaseSnapshot.value.classRecords
      .filter(
        (item) =>
          (!selectedCampusId || item.campusId === selectedCampusId) &&
          (selectedTeacherHourGrade.value === '全部年级' || item.grade === selectedTeacherHourGrade.value)
      )
      .map((item) => item.stage)
  )

  const subjects = adminBaseSnapshot.value.courses
    .filter((item) => stageSet.size === 0 || item.scopes.some((scope) => stageSet.has(scope)))
    .map((item) => item.name)
    .filter(Boolean)
  return Array.from(new Set(subjects))
})

const teacherHourRows = computed<TeacherHourRule[]>(() => {
  const selectedCampus = selectedTeacherHourCampus.value
  const selectedGrade = selectedTeacherHourGrade.value
  const selectedSubject = selectedTeacherHourSubject.value
  const selectedCampusId = campusIdByName.value.get(selectedCampus)
  if (!selectedCampus || !selectedGrade || !selectedSubject || !selectedCampusId) return []

  const subjectCourseIds = new Set(
    adminBaseSnapshot.value.courses.filter((item) => item.name === selectedSubject).map((item) => item.id)
  )
  const teacherIds = new Set(
    adminBaseSnapshot.value.teachingAssignments
      .filter(
        (item) =>
          item.campusId === selectedCampusId &&
          (selectedGrade === '全部年级' || item.grade === selectedGrade) &&
          subjectCourseIds.has(item.courseId)
      )
      .map((item) => item.teacherId)
  )

  const byId = new Map(adminBaseSnapshot.value.teacherRecords.map((item) => [item.id, item] as const))
  const teacherList = Array.from(teacherIds)
    .map((id) => byId.get(id))
    .filter((item): item is TeacherRecord => Boolean(item))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  const allRule =
    teacherHourRuleStore.value.find(
      (item) =>
        item.campus === selectedCampus &&
        item.grade === selectedGrade &&
        item.subject === selectedSubject &&
        item.teacherId === ''
    ) ||
    (selectedGrade === '全部年级'
      ? undefined
      : teacherHourRuleStore.value.find(
          (item) =>
            item.campus === selectedCampus &&
            item.grade === '全部年级' &&
            item.subject === selectedSubject &&
            item.teacherId === ''
        ))

  const rows: TeacherHourRule[] = [
    {
      id: allRule?.id || `thr-all-${selectedCampus}-${selectedGrade}-${selectedSubject}`,
      teacherId: '',
      teacherName: '全部教师',
      maxDailyLessons: allRule?.maxDailyLessons ?? null,
      maxConsecutiveLessons: allRule?.maxConsecutiveLessons ?? null,
      weekDistribution: allRule?.weekDistribution ?? null,
      dayDistribution: allRule?.dayDistribution ?? null,
      isAllTeachers: true
    }
  ]

  teacherList.forEach((teacher) => {
    const ownRule = teacherHourRuleStore.value.find(
      (item) =>
        item.campus === selectedCampus &&
        item.grade === selectedGrade &&
        item.subject === selectedSubject &&
        item.teacherId === teacher.id
    )
    const matched =
      ownRule ||
      (selectedGrade === '全部年级'
        ? undefined
        : teacherHourRuleStore.value.find(
            (item) =>
              item.campus === selectedCampus &&
              item.grade === '全部年级' &&
              item.subject === selectedSubject &&
              item.teacherId === teacher.id
          )) ||
      allRule
    rows.push({
      id: matched?.id || `thr-${selectedCampus}-${selectedGrade}-${selectedSubject}-${teacher.id}`,
      teacherId: teacher.id,
      teacherName: teacher.name,
      maxDailyLessons: matched?.maxDailyLessons ?? null,
      maxConsecutiveLessons: matched?.maxConsecutiveLessons ?? null,
      weekDistribution: matched?.weekDistribution ?? null,
      dayDistribution: matched?.dayDistribution ?? null,
      hasOwnRule: Boolean(ownRule)
    })
  })

  return rows
})

const combineCampusOptions = computed(() => ['全部校区', ...campusOptions.value])
const combineGradeOptions = computed(() => {
  const classList = adminBaseSnapshot.value.classRecords.filter((item) => {
    if (selectedCombineCampus.value === '全部校区') return true
    const campusId = campusIdByName.value.get(selectedCombineCampus.value)
    if (!campusId) return false
    return item.campusId === campusId
  })
  const grades = sortGradeLabels(classList.map((item) => item.grade))
  return ['全部年级', ...grades]
})
const combineCourseOptions = computed(() => [
  '全部课程',
  ...Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
])
const selectedCombineCampus = ref('全部校区')
const selectedCombineGrade = ref('全部年级')
const selectedCombineClass = ref('全部班级')
const selectedCombineCourse = ref('全部课程')
const combineRules = ref<CourseCombineRule[]>(ruleSettingsSnapshot.combineRules || [])
const selectedCombineRuleIds = ref<string[]>([])
const combineDialogVisible = ref(false)
const combineDialogMode = ref<'create' | 'edit'>('create')
const combineEditingId = ref('')
const combineDialogError = ref('')
const combineForm = reactive({
  campus: '本校区',
  grade: '',
  classNames: [] as string[],
  course: ''
})

const combineClassOptions = computed(() => {
  const classList = adminBaseSnapshot.value.classRecords.filter((item) => {
    if (selectedCombineCampus.value !== '全部校区') {
      const campusId = campusIdByName.value.get(selectedCombineCampus.value)
      if (!campusId || item.campusId !== campusId) return false
    }
    if (selectedCombineGrade.value !== '全部年级' && item.grade !== selectedCombineGrade.value) return false
    return true
  })
  const unique = Array.from(new Set(classList.map((item) => item.className).filter(Boolean)))
  return ['全部班级', ...unique]
})

const combineDialogCampusOptions = computed(() => campusOptions.value)
const combineDialogGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(combineForm.campus)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})
const combineDialogClassOptions = computed(() => {
  const campusId = campusIdByName.value.get(combineForm.campus)
  if (!campusId || !combineForm.grade) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId && item.grade === combineForm.grade)
        .map((item) => item.className)
        .filter(Boolean)
    )
  )
})
const combineDialogCourseOptions = computed(() => combineCourseOptions.value.filter((item) => item !== '全部课程'))

const filteredCombineRules = computed(() =>
  combineRules.value.filter((item) => {
    if (selectedCombineCampus.value !== '全部校区' && item.campus !== selectedCombineCampus.value) return false
    if (selectedCombineGrade.value !== '全部年级' && item.grade !== selectedCombineGrade.value) return false
    if (selectedCombineClass.value !== '全部班级' && !item.classNames.includes(selectedCombineClass.value)) return false
    if (selectedCombineCourse.value !== '全部课程' && item.course !== selectedCombineCourse.value) return false
    return true
  })
)

const selectedCombineRuleIdSet = computed(() => new Set(selectedCombineRuleIds.value))
const allFilteredCombineRulesSelected = computed(
  () =>
    filteredCombineRules.value.length > 0 &&
    filteredCombineRules.value.every((item) => selectedCombineRuleIdSet.value.has(item.id))
)
const someFilteredCombineRulesSelected = computed(
  () =>
    !allFilteredCombineRulesSelected.value &&
    filteredCombineRules.value.some((item) => selectedCombineRuleIdSet.value.has(item.id))
)

watch(
  () => filteredCombineRules.value.map((item) => item.id),
  (visibleIds) => {
    const visibleIdSet = new Set(visibleIds)
    selectedCombineRuleIds.value = selectedCombineRuleIds.value.filter((id) => visibleIdSet.has(id))
  }
)

const oddEvenCampusOptions = computed(() => ['全部校区', ...campusOptions.value])
const oddEvenGradeOptions = computed(() => {
  const classes = adminBaseSnapshot.value.classRecords.filter((item) => {
    if (selectedOddEvenCampus.value === '全部校区') return true
    const campusId = campusIdByName.value.get(selectedOddEvenCampus.value)
    if (!campusId) return false
    return item.campusId === campusId
  })
  const grades = sortGradeLabels(classes.map((item) => item.grade))
  return ['全部年级', ...grades]
})
const oddEvenCourseOptions = computed(() => [
  '全部课程',
  ...Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name)))
])
const selectedOddEvenCampus = ref('全部校区')
const selectedOddEvenGrade = ref('全部年级')
const selectedOddEvenClass = ref('全部班级')
const selectedOddEvenCourse = ref('全部课程')
const oddEvenRules = ref<OddEvenRule[]>(ruleSettingsSnapshot.oddEvenRules)
const courseAreaRules = ref<CourseAreaRuleRecord[]>(ruleSettingsSnapshot.courseAreaRules || [])
const courseBanRules = ref<CourseBanRuleRecord[]>(ruleSettingsSnapshot.courseBanRules || [])
const mainSecondaryRules = ref<MainSecondaryRuleRecord[]>(ruleSettingsSnapshot.mainSecondaryRules || [])
const courseRelationRules = ref<CourseRelationRuleRecord[]>(ruleSettingsSnapshot.courseRelationRules || [])
const teacherMutualRules = ref<TeacherMutualRuleRecord[]>(ruleSettingsSnapshot.teacherMutualRules || [])
const courseDefaultConfig = ref<CourseDefaultConfig>(
  cloneCourseDefaultConfig(ruleSettingsSnapshot.courseDefaultConfig || defaultCourseDefaultConfig)
)
const ruleWeightConfig = ref<RuleWeightConfig>(JSON.parse(JSON.stringify(defaultRuleWeightConfig)))
const ruleWeightConfigs = ref<RuleWeightConfigRecord[]>(ruleSettingsSnapshot.ruleWeightConfigs || [])
const selectedWeightCampus = ref('')
const selectedWeightGrade = ref('')
const selectedMainCampus = ref('')
const selectedMainGrade = ref('')
const selectedMainSubjects = ref<string[]>([])
const checkedMainSubjects = ref<string[]>([])
const selectedRelationCampus = ref('全部校区')
const selectedRelationGrade = ref('全部年级')
const selectedRelationType = ref<'全部关系' | '前后互斥' | '同天互斥'>('全部关系')
const relationDialogVisible = ref(false)
const relationDialogMode = ref<'create' | 'edit'>('create')
const relationEditingId = ref('')
const relationDialogError = ref('')
const relationForm = reactive({
  campus: '',
  grade: '',
  courseA: '',
  courseB: '',
  relationType: '前后互斥' as '前后互斥' | '同天互斥'
})
const courseDefaultRows: Array<{ key: CourseDefaultRuleKey; label: string; options: string[] }> = [
  { key: 'syncStart', label: '教案齐头', options: ['必须一致', '尽量一致', '无特殊要求'] },
  {
    key: 'distribution',
    label: '课程周分布',
    options: ['尽量分散到不同天', '尽量集中在较少天', '优先安排在周中', '无特殊要求']
  },
  {
    key: 'differentDayPeriod',
    label: '不同天节次分散',
    options: ['尽量不同节次', '无特殊要求']
  },
  { key: 'noCrossNoon', label: '教师午间连上', options: ['不能让老师在上午末节和下午首节连上', '可允许上午末节和下午首节连上'] },
  { key: 'sameClassNoConsecutive', label: '同课程连堂', options: ['优先不连堂', '无特殊要求'] },
  { key: 'twoLessonsGap', label: '每周2节课程间隔', options: ['是', '否'] }
]

function applyRuleSettingsSnapshot(snapshot: RuleSettingsSnapshot): void {
  persistedRuleSettingsSnapshot.value = cloneRuleSettingsValue(snapshot)
  fixedPointRules.value = cloneFixedPointRules(snapshot.globalFixedPoints)
  fixedPointDraftRules.value = cloneFixedPointRules(snapshot.globalFixedPoints)
  oddEvenRules.value = Array.isArray(snapshot.oddEvenRules) ? [...snapshot.oddEvenRules] : []
  combineRules.value = Array.isArray(snapshot.combineRules) ? [...snapshot.combineRules] : []
  courseAreaRules.value = Array.isArray(snapshot.courseAreaRules) ? [...snapshot.courseAreaRules] : []
  courseBanRules.value = Array.isArray(snapshot.courseBanRules) ? [...snapshot.courseBanRules] : []
  mainSecondaryRules.value = Array.isArray(snapshot.mainSecondaryRules) ? [...snapshot.mainSecondaryRules] : []
  courseRelationRules.value = Array.isArray(snapshot.courseRelationRules) ? [...snapshot.courseRelationRules] : []
  teacherMutualRules.value = Array.isArray(snapshot.teacherMutualRules) ? [...snapshot.teacherMutualRules] : []
  teacherBanMap.value = snapshot.teacherBanRules ? { ...snapshot.teacherBanRules } : {}
  teacherHourRuleStore.value = Array.isArray(snapshot.teacherHourRules) ? [...snapshot.teacherHourRules] : []
  consecutiveSettingMap.value = cloneConsecutiveSettingMap(snapshot.consecutiveSettings)
  courseDefaultConfig.value = snapshot.courseDefaultConfig
    ? {
        ...defaultCourseDefaultConfig,
        ...snapshot.courseDefaultConfig,
        rules: {
          ...defaultCourseDefaultConfig.rules,
          ...(snapshot.courseDefaultConfig.rules || {})
        },
        ruleEnabled: {
          ...defaultCourseDefaultConfig.ruleEnabled,
          ...(snapshot.courseDefaultConfig.ruleEnabled || {})
        }
      }
    : cloneCourseDefaultConfig()
  ruleWeightConfigs.value = Array.isArray(snapshot.ruleWeightConfigs) ? [...snapshot.ruleWeightConfigs] : []
}
const hardRuleMeta: Record<RuleWeightHardKey, { label: string; desc: string }> = {
  teacherConflict: { label: '教师冲突', desc: '同一教师同节次不可在多个班上课。' },
  teacherBan: { label: '教师不排课', desc: '教师禁排节次作为硬约束，不得安排课程。' },
  teacherHourLimit: { label: '教师课时上限', desc: '教师每天最大课时、最大连上课时必须满足。' },
  teacherMutual: { label: '教师互斥', desc: '互斥教师组同节次不可同时上课。' },
  classConflict: { label: '班级冲突', desc: '同一班级同节次不可安排多门课程。' },
  globalFixedPoint: { label: '全局固定点', desc: '固定点节次不可安排普通课程。' },
  courseArea: { label: '课程允许排课', desc: '课程必须落在允许排课节次内。' },
  courseBan: { label: '课程禁止排课', desc: '禁止课程进入禁排节次。' },
  combineCourse: { label: '合班课一致性', desc: '合班课程需保持同节次同步安排。' },
  courseRelation: { label: '课程关系', desc: '前后互斥与同天互斥作为硬约束，不得违反。' }
}
const softRuleMeta: Record<RuleWeightSoftKey, { label: string; desc: string }> = {
  teacherWeekDistribution: { label: '教师周分布', desc: '控制教师课程在一周内分散或集中的偏好强度。' },
  teacherDayDistribution: { label: '教师日分布', desc: '控制教师课程在上午、下午分散或集中的偏好强度。' },
  consecutive: { label: '连堂优选日', desc: '连堂次数属于硬约束；此权重只决定优选日期的满足程度。' },
  oddEven: { label: '单双周匹配', desc: '启用后将单双周课程合并为同一节次需求。' },
  mainSecondary: { label: '主副科分类', desc: '启用后按照主副科配置应用课程默认规则。' },
  courseDefault: { label: '课程默认规则', desc: '启用后应用教案齐头、分散方式等默认规则。' }
}
const ruleWeightMeta: Record<RuleWeightRuleKey, { label: string; desc: string }> = {
  ...hardRuleMeta,
  ...softRuleMeta
}
const hardPriorityLevels = [1, 2, 3, 4] as const
const hardPriorityLabels: Record<number, string> = {
  1: '基础冲突',
  2: '教师限制',
  3: '固定安排',
  4: '课程限制'
}
const lockedHardRuleKeys = new Set<RuleWeightHardKey>(['teacherConflict', 'classConflict'])
const scoringSoftRuleKeys: RuleWeightSoftKey[] = ['teacherWeekDistribution', 'teacherDayDistribution', 'consecutive']
const featureRuleKeys: RuleWeightSoftKey[] = ['oddEven', 'mainSecondary', 'courseDefault']
const scoringSoftRuleKeySet = new Set<RuleWeightSoftKey>(scoringSoftRuleKeys)
const featureRuleKeySet = new Set<RuleWeightSoftKey>(featureRuleKeys)

function normalizeHardRuleLevel(priority: number): number {
  return Math.max(1, Math.min(4, Math.floor(Number(priority) || 1)))
}

const hardRuleRows = computed(() =>
  ruleWeightConfig.value.rules
    .filter((item) => item.mode === 'hard')
    .map((item) => ({
      ...item,
      label: ruleWeightMeta[item.key].label,
      desc: ruleWeightMeta[item.key].desc,
      level: normalizeHardRuleLevel(item.priority)
    }))
)
const hardRuleBuckets = computed(() =>
  hardPriorityLevels.map((level) => ({
    level,
    label: hardPriorityLabels[level],
    items: hardRuleRows.value.filter((item) => item.level === level)
  }))
)
const softRuleRows = computed(() =>
  ruleWeightConfig.value.rules
    .filter((item) => item.mode === 'soft' && scoringSoftRuleKeySet.has(item.key as RuleWeightSoftKey))
    .map((item) => ({
      ...item,
      label: ruleWeightMeta[item.key].label,
      desc: ruleWeightMeta[item.key].desc
    }))
)
const featureRuleRows = computed(() =>
  ruleWeightConfig.value.rules
    .filter((item) => item.mode === 'soft' && featureRuleKeySet.has(item.key as RuleWeightSoftKey))
    .map((item) => ({
      ...item,
      label: ruleWeightMeta[item.key].label,
      desc: ruleWeightMeta[item.key].desc,
      available: true
    }))
)
const enabledSoftWeightTotal = computed(() =>
  ruleWeightConfig.value.rules
    .filter((item) => item.mode === 'soft' && scoringSoftRuleKeySet.has(item.key as RuleWeightSoftKey))
    .filter((item) => item.enabled)
    .reduce((sum, item) => sum + item.weight, 0)
)
const enabledSoftRuleCount = computed(() =>
  ruleWeightConfig.value.rules.filter(
    (item) => item.mode === 'soft' && scoringSoftRuleKeySet.has(item.key as RuleWeightSoftKey) && item.enabled
  ).length
)
const weightCampusOptions = computed(() => campusOptions.value)
const weightGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedWeightCampus.value)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})

function setHardRuleEnabled(key: RuleWeightRuleKey, enabled: boolean): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.enabled = lockedHardRuleKeys.has(key as RuleWeightHardKey) ? true : enabled
  target.mode = 'hard'
  if (target.weight > 0) target.weight = 0
}

function setSoftRuleEnabled(key: RuleWeightRuleKey, enabled: boolean): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.enabled = enabled
  target.mode = 'soft'
  if (!enabled) target.weight = 0
  if (enabled && target.weight <= 0) {
    target.weight = defaultRuleWeightConfig.rules.find((item) => item.key === key)?.weight || 10
  }
}

function setSoftRuleWeight(key: RuleWeightRuleKey, weight: number): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.mode = 'soft'
  target.weight = Math.max(0, Math.min(100, Math.floor(Number(weight) || 0)))
}

function setFeatureRuleEnabled(key: RuleWeightRuleKey, enabled: boolean): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.mode = 'soft'
  target.enabled = enabled
  target.weight = 0
}

function hardRuleLocked(key: RuleWeightRuleKey): boolean {
  return lockedHardRuleKeys.has(key as RuleWeightHardKey)
}

const mainCampusOptions = computed(() => campusOptions.value)
const mainGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedMainCampus.value)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})
const mainSubjectOptions = computed(() => {
  const fromCourses = Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
  return fromCourses.length > 0 ? fromCourses : fallbackBanSubjects
})
const mainTransferData = computed(() =>
  mainSubjectOptions.value.map((subject) => ({
    key: subject,
    label: subject
  }))
)
const currentSecondarySubjects = computed(() => mainSubjectOptions.value.filter((item) => !selectedMainSubjects.value.includes(item)))
const relationTypeOptions = ['全部关系', '前后互斥', '同天互斥'] as const
const relationCampusOptions = computed(() => ['全部校区', ...campusOptions.value])
const relationGradeOptions = computed(() => {
  const classes = adminBaseSnapshot.value.classRecords.filter((item) => {
    if (selectedRelationCampus.value === '全部校区') return true
    const campusId = campusIdByName.value.get(selectedRelationCampus.value)
    if (!campusId) return false
    return item.campusId === campusId
  })
  return ['全部年级', ...sortGradeLabels(classes.map((item) => item.grade))]
})
const relationCourseOptions = computed(() => {
  const list = Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
  return list.length > 0 ? list : fallbackBanSubjects
})
const relationDialogGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(relationForm.campus)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})
const filteredCourseRelationRules = computed(() =>
  courseRelationRules.value.filter((item) => {
    if (selectedRelationCampus.value !== '全部校区' && item.campus !== selectedRelationCampus.value) return false
    if (selectedRelationGrade.value !== '全部年级' && item.grade !== selectedRelationGrade.value) return false
    if (selectedRelationType.value !== '全部关系' && item.relationType !== selectedRelationType.value) return false
    return true
  })
)
const mutualTeacherOptions = computed(() => {
  return Array.from(new Set(adminBaseSnapshot.value.teacherRecords.map((item) => item.name).filter(Boolean)))
})
const campusNameById = computed(
  () => new Map(adminBaseSnapshot.value.campuses.map((item) => [item.id, item.name || item.id] as const))
)
const teacherBanTeacherOptions = computed(() =>
  adminBaseSnapshot.value.teacherRecords
    .filter((item) => item.id && item.name)
    .filter((item) => {
      const hasAssignment = adminBaseSnapshot.value.teachingAssignments.some((assignment) => assignment.teacherId === item.id)
      if (hasAssignment) return true
      return adminBaseSnapshot.value.teachingAssignments.length === 0
    })
    .map((item) => ({ id: item.id, name: item.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
)
const teacherBanGroupOptions = computed(() =>
  adminBaseSnapshot.value.groupRecords
    .filter((item) => item.type === '教研与活动分组')
    .filter((item) => Array.isArray(item.memberNames) && item.memberNames.some((name) => Boolean(String(name || '').trim())))
    .filter((item) => {
      const teacherNameSet = new Set(adminBaseSnapshot.value.teacherRecords.map((t) => (t.name || '').trim()).filter(Boolean))
      return item.memberNames.some((name) => teacherNameSet.has(String(name || '').trim()))
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      memberNames: Array.isArray(item.memberNames) ? item.memberNames.filter(Boolean) : [],
      campusName: campusNameById.value.get(item.campusId) || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
)
const mentoringRules = computed(() => teacherMutualRules.value.filter((item) => item.type === 'mentoring'))
const mutualRules = computed(() => teacherMutualRules.value.filter((item) => item.type === 'mutual'))
const teacherMutualDialogVisible = ref(false)
const teacherMutualDialogMode = ref<'create' | 'edit'>('create')
const teacherMutualEditingId = ref('')
const teacherMutualDialogError = ref('')
const teacherMutualForm = reactive({
  type: 'mutual' as 'mutual' | 'mentoring',
  teacherGroupA: [] as string[],
  teacherGroupB: [] as string[]
})

function mainRuleKey(campus: string, grade: string): string {
  return `${campus}::${grade}`
}

function getDefaultMainSubjects(): string[] {
  const availableSubjects = new Set(mainSubjectOptions.value)
  return defaultMainSubjects.filter((subject) => availableSubjects.has(subject))
}

function loadCurrentMainSecondarySelection(): void {
  checkedMainSubjects.value = []
  if (!selectedMainCampus.value || !selectedMainGrade.value) {
    selectedMainSubjects.value = getDefaultMainSubjects()
    return
  }
  const key = mainRuleKey(selectedMainCampus.value, selectedMainGrade.value)
  const current = mainSecondaryRules.value.find((item) => mainRuleKey(item.campus, item.grade) === key)
  if (!current) {
    selectedMainSubjects.value = getDefaultMainSubjects()
    return
  }
  const set = new Set(mainSubjectOptions.value)
  selectedMainSubjects.value = current.mainSubjects.filter((item) => set.has(item))
}

function clearCurrentMainSecondary(): void {
  if (checkedMainSubjects.value.length === 0) return
  const checkedSet = new Set(checkedMainSubjects.value)
  selectedMainSubjects.value = selectedMainSubjects.value.filter((item) => !checkedSet.has(item))
  checkedMainSubjects.value = []
  notify.info('已清空勾选的主科草稿，点击保存后生效。')
}

function handleMainSubjectsCheckedChange(checkedValues: Array<string | number>): void {
  const selectedSet = new Set(selectedMainSubjects.value)
  checkedMainSubjects.value = checkedValues
    .map((item) => String(item))
    .filter((item) => selectedSet.has(item))
}

function saveCurrentMainSecondary(): void {
  if (!selectedMainCampus.value || !selectedMainGrade.value) {
    notify.warning('请先选择校区和年级。')
    return
  }
  const key = mainRuleKey(selectedMainCampus.value, selectedMainGrade.value)
  const allSubjects = mainSubjectOptions.value
  const mainSubjects = allSubjects.filter((item) => selectedMainSubjects.value.includes(item))
  const secondarySubjects = allSubjects.filter((item) => !mainSubjects.includes(item))
  const rest = mainSecondaryRules.value.filter((item) => mainRuleKey(item.campus, item.grade) !== key)
  const nextRule: MainSecondaryRuleRecord = {
    id: `ms-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    campus: selectedMainCampus.value,
    grade: selectedMainGrade.value,
    mainSubjects,
    secondarySubjects
  }
  mainSecondaryRules.value = [
    ...rest,
    nextRule
  ]
  persistRuleSettingsSections({
    mainSecondaryRules: [
      ...(persistedRuleSettingsSnapshot.value.mainSecondaryRules || [])
        .filter((item) => mainRuleKey(item.campus, item.grade) !== key),
      nextRule
    ]
  })
  notify.success('主副科设置已保存。')
}

function resetCourseDefaultConfig(): void {
  courseDefaultConfig.value = cloneCourseDefaultConfig()
  notify.info('已恢复默认规则草稿，点击保存后生效。')
}

function saveCourseDefaultConfig(): void {
  persistRuleSettingsSections({ courseDefaultConfig: courseDefaultConfig.value })
  notify.success('默认规则已保存。')
}

function resetRuleWeightConfig(): void {
  ruleWeightConfig.value = JSON.parse(JSON.stringify(defaultRuleWeightConfig)) as RuleWeightConfig
  notify.info('已恢复默认权重草稿，点击保存后生效。')
}

function ruleWeightKey(campus: string, grade: string): string {
  return `${campus}::${grade}`
}

function loadCurrentRuleWeightConfig(): void {
  if (!selectedWeightCampus.value || !selectedWeightGrade.value) {
    ruleWeightConfig.value = JSON.parse(JSON.stringify(defaultRuleWeightConfig))
    return
  }
  const key = ruleWeightKey(selectedWeightCampus.value, selectedWeightGrade.value)
  const current = ruleWeightConfigs.value.find((item) => ruleWeightKey(item.campus, item.grade) === key)
  ruleWeightConfig.value = JSON.parse(JSON.stringify(current?.config || defaultRuleWeightConfig))
}

function normalizeSoftWeights(): void {
  const enabled = ruleWeightConfig.value.rules.filter(
    (item) => item.mode === 'soft' && scoringSoftRuleKeySet.has(item.key as RuleWeightSoftKey) && item.enabled
  )
  if (enabled.length === 0) return
  const currentTotal = enabled.reduce((sum, item) => sum + item.weight, 0)

  if (currentTotal <= 0) {
    const base = Math.floor(100 / enabled.length)
    let remain = 100 - base * enabled.length
    ruleWeightConfig.value.rules = ruleWeightConfig.value.rules.map((item) => {
      if (item.mode !== 'soft' || !scoringSoftRuleKeySet.has(item.key as RuleWeightSoftKey)) return item
      if (!item.enabled) return { ...item, weight: 0 }
      const next = base + (remain > 0 ? 1 : 0)
      if (remain > 0) remain -= 1
      return { ...item, weight: next }
    })
    return
  }

  const mapped = enabled.map((item) => ({
    key: item.key,
    raw: (item.weight / currentTotal) * 100
  }))
  const floorMap = new Map<RuleWeightRuleKey, number>()
  let allocated = 0
  mapped.forEach((item) => {
    const floorValue = Math.floor(item.raw)
    floorMap.set(item.key, floorValue)
    allocated += floorValue
  })
  let remain = 100 - allocated
  const remainderOrder = [...mapped]
    .sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)))
    .map((item) => item.key)
  let cursor = 0
  while (remain > 0 && remainderOrder.length > 0) {
    const key = remainderOrder[cursor % remainderOrder.length]
    floorMap.set(key, (floorMap.get(key) || 0) + 1)
    remain -= 1
    cursor += 1
  }
  ruleWeightConfig.value.rules = ruleWeightConfig.value.rules.map((item) => {
    if (item.mode !== 'soft' || !scoringSoftRuleKeySet.has(item.key as RuleWeightSoftKey)) return item
    return item.enabled ? { ...item, weight: floorMap.get(item.key) || 0 } : { ...item, weight: 0 }
  })
}

function saveRuleWeightConfig(): void {
  if (!selectedWeightCampus.value || !selectedWeightGrade.value) {
    notify.warning('请先选择校区和年级。')
    return
  }
  if (ruleWeightConfig.value.autoNormalize) {
    normalizeSoftWeights()
  }
  const key = ruleWeightKey(selectedWeightCampus.value, selectedWeightGrade.value)
  const rest = ruleWeightConfigs.value.filter((item) => ruleWeightKey(item.campus, item.grade) !== key)
  ruleWeightConfigs.value = [
    ...rest,
    {
      id: `rw-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      campus: selectedWeightCampus.value,
      grade: selectedWeightGrade.value,
      config: JSON.parse(JSON.stringify(ruleWeightConfig.value))
    }
  ]
  persistRuleSettingsSections({ ruleWeightConfigs: ruleWeightConfigs.value })
  notify.success(`规则权重已保存（${selectedWeightCampus.value} / ${selectedWeightGrade.value}）。`)
}

function openCreateRelationDialog(): void {
  relationDialogMode.value = 'create'
  relationEditingId.value = ''
  relationDialogError.value = ''
  relationForm.campus = selectedRelationCampus.value === '全部校区' ? campusOptions.value[0] || '' : selectedRelationCampus.value
  const campusId = campusIdByName.value.get(relationForm.campus)
  relationForm.grade = selectedRelationGrade.value === '全部年级'
    ? (campusId
        ? sortGradeLabels(
          adminBaseSnapshot.value.classRecords
            .filter((item) => item.campusId === campusId)
            .map((item) => item.grade)
        )[0] || ''
        : '')
    : selectedRelationGrade.value
  relationForm.courseA = relationCourseOptions.value[0] || ''
  relationForm.courseB = relationCourseOptions.value[1] || relationCourseOptions.value[0] || ''
  relationForm.relationType = '前后互斥'
  relationDialogVisible.value = true
}

function openEditRelationDialog(rule: CourseRelationRuleRecord): void {
  relationDialogMode.value = 'edit'
  relationEditingId.value = rule.id
  relationDialogError.value = ''
  relationForm.campus = rule.campus
  relationForm.grade = rule.grade
  relationForm.courseA = rule.courseA
  relationForm.courseB = rule.courseB
  relationForm.relationType = rule.relationType
  relationDialogVisible.value = true
}

function closeRelationDialog(): void {
  relationDialogVisible.value = false
}

function saveRelationRule(): void {
  const campus = relationForm.campus.trim()
  const grade = relationForm.grade.trim()
  const courseA = relationForm.courseA.trim()
  const courseB = relationForm.courseB.trim()
  const relationType = relationForm.relationType

  if (!campus || !grade || !courseA || !courseB) {
    relationDialogError.value = '请完整填写所有字段。'
    return
  }
  if (courseA === courseB) {
    relationDialogError.value = '两门课程不能相同。'
    return
  }

  const duplicate = courseRelationRules.value.find((item) => {
    if (relationDialogMode.value === 'edit' && item.id === relationEditingId.value) return false
    const sameScope = item.campus === campus && item.grade === grade && item.relationType === relationType
    if (!sameScope) return false
    return (
      (item.courseA === courseA && item.courseB === courseB) ||
      (item.courseA === courseB && item.courseB === courseA)
    )
  })
  if (duplicate) {
    relationDialogError.value = '该课程关系已存在。'
    return
  }

  if (relationDialogMode.value === 'create') {
    const nextRule: CourseRelationRuleRecord = {
      id: `cr-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      campus,
      grade,
      courseA,
      courseB,
      relationType
    }
    courseRelationRules.value = [
      ...courseRelationRules.value,
      nextRule
    ]
    persistRuleSettingsSections({
      courseRelationRules: [...(persistedRuleSettingsSnapshot.value.courseRelationRules || []), nextRule]
    })
    relationDialogVisible.value = false
    notify.success('课程关系已添加。')
    return
  }

  const nextRule: CourseRelationRuleRecord = {
    id: relationEditingId.value,
    campus,
    grade,
    courseA,
    courseB,
    relationType
  }
  courseRelationRules.value = courseRelationRules.value.map((item) =>
    item.id === relationEditingId.value
      ? nextRule
      : item
  )
  const savedRules = persistedRuleSettingsSnapshot.value.courseRelationRules || []
  persistRuleSettingsSections({
    courseRelationRules: savedRules.some((item) => item.id === relationEditingId.value)
      ? savedRules.map((item) => item.id === relationEditingId.value ? nextRule : item)
      : [...savedRules, nextRule]
  })
  relationDialogVisible.value = false
  notify.success('课程关系已更新。')
}

async function removeRelationRule(ruleId: string): Promise<void> {
  const target = courseRelationRules.value.find((item) => item.id === ruleId)
  if (!target) return
  try {
    await ElMessageBox.confirm(
      `确认删除规则「${target.courseA} / ${target.courseB}（${target.relationType}）」吗？`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  courseRelationRules.value = courseRelationRules.value.filter((item) => item.id !== ruleId)
  const nextSavedRules = (persistedRuleSettingsSnapshot.value.courseRelationRules || [])
    .filter((item) => item.id !== ruleId)
  persistRuleSettingsSections({ courseRelationRules: nextSavedRules })
}

function clearRelationRules(): void {
  courseRelationRules.value = courseRelationRules.value.filter((item) => {
    if (selectedRelationCampus.value !== '全部校区' && item.campus !== selectedRelationCampus.value) return true
    if (selectedRelationGrade.value !== '全部年级' && item.grade !== selectedRelationGrade.value) return true
    if (selectedRelationType.value !== '全部关系' && item.relationType !== selectedRelationType.value) return true
    return false
  })
  notify.info('已清空当前筛选范围的课程关系草稿，点击保存后生效。')
}

function saveRelationRules(): void {
  const matchesCurrentScope = (item: CourseRelationRuleRecord) => {
    if (selectedRelationCampus.value !== '全部校区' && item.campus !== selectedRelationCampus.value) return false
    if (selectedRelationGrade.value !== '全部年级' && item.grade !== selectedRelationGrade.value) return false
    if (selectedRelationType.value !== '全部关系' && item.relationType !== selectedRelationType.value) return false
    return true
  }
  const savedRules = persistedRuleSettingsSnapshot.value.courseRelationRules || []
  const nextRules = [
    ...savedRules.filter((item) => !matchesCurrentScope(item)),
    ...courseRelationRules.value.filter(matchesCurrentScope)
  ]
  persistRuleSettingsSections({ courseRelationRules: nextRules })
  notify.success('课程关系规则已保存。')
}

function openCreateTeacherMutualDialog(type: 'mutual' | 'mentoring' = 'mutual'): void {
  teacherMutualDialogMode.value = 'create'
  teacherMutualEditingId.value = ''
  teacherMutualDialogError.value = ''
  teacherMutualForm.type = type
  teacherMutualForm.teacherGroupA = []
  teacherMutualForm.teacherGroupB = []
  teacherMutualDialogVisible.value = true
}

function openEditTeacherMutualDialog(rule: TeacherMutualRuleRecord): void {
  teacherMutualDialogMode.value = 'edit'
  teacherMutualEditingId.value = rule.id
  teacherMutualDialogError.value = ''
  teacherMutualForm.type = rule.type
  teacherMutualForm.teacherGroupA = [...rule.teacherGroupA]
  teacherMutualForm.teacherGroupB = [...rule.teacherGroupB]
  teacherMutualDialogVisible.value = true
}

function saveTeacherMutualRule(): void {
  const teacherGroupA = Array.from(new Set(teacherMutualForm.teacherGroupA.filter(Boolean)))
  const teacherGroupB = Array.from(new Set(teacherMutualForm.teacherGroupB.filter(Boolean)))
  if (teacherGroupA.length === 0 || teacherGroupB.length === 0) {
    teacherMutualDialogError.value = '请在两侧至少各选择一位教师。'
    return
  }
  const cross = teacherGroupA.some((item) => teacherGroupB.includes(item))
  if (cross) {
    teacherMutualDialogError.value = '两侧教师不能重复。'
    return
  }

  if (teacherMutualDialogMode.value === 'create') {
    teacherMutualRules.value = [
      {
        id: `tm-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        type: teacherMutualForm.type,
        teacherGroupA,
        teacherGroupB
      },
      ...teacherMutualRules.value
    ]
    persistRuleSettingsSections({ teacherMutualRules: teacherMutualRules.value })
    teacherMutualDialogVisible.value = false
    notify.success('教师关系已添加。')
    return
  }

  teacherMutualRules.value = teacherMutualRules.value.map((item) =>
    item.id === teacherMutualEditingId.value
      ? {
          ...item,
          type: teacherMutualForm.type,
          teacherGroupA,
          teacherGroupB
        }
      : item
  )
  persistRuleSettingsSections({ teacherMutualRules: teacherMutualRules.value })
  teacherMutualDialogVisible.value = false
  notify.success('教师关系已更新。')
}

async function deleteTeacherMutualRule(ruleId: string): Promise<void> {
  const target = teacherMutualRules.value.find((item) => item.id === ruleId)
  if (!target) return
  try {
    await ElMessageBox.confirm('确认删除这条教师关系规则吗？', '删除确认', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  teacherMutualRules.value = teacherMutualRules.value.filter((item) => item.id !== ruleId)
  persistRuleSettingsSections({ teacherMutualRules: teacherMutualRules.value })
}

const oddEvenDialogVisible = ref(false)
const oddEvenDialogMode = ref<'create' | 'edit'>('create')
const oddEvenEditingId = ref('')
const oddEvenDialogError = ref('')
const oddEvenForm = reactive({
  campus: '本校区',
  grade: '',
  classNames: [] as string[],
  oddCourse: '',
  evenCourse: ''
})

const oddEvenDialogCampusOptions = computed(() => campusOptions.value)
const oddEvenDialogGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(oddEvenForm.campus)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})
const oddEvenDialogClassOptions = computed(() => {
  const campusId = campusIdByName.value.get(oddEvenForm.campus)
  if (!campusId || !oddEvenForm.grade) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId && item.grade === oddEvenForm.grade)
        .map((item) => item.className)
        .filter(Boolean)
    )
  )
})
const oddEvenDialogCourseOptions = computed(() => oddEvenCourseOptions.value.filter((item) => item !== '全部课程'))
const allAreaDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const selectedAreaCampus = ref('')
const selectedAreaGrade = ref('')
const activeAreaSubject = ref('语文')
const selectedAreaClassRanges = ref<string[]>([])
const lastEditedAreaClassName = ref('')
const selectedBanCampus = ref('')
const selectedBanGrade = ref('')
const selectedBanClassRanges = ref<string[]>([])
const lastEditedBanClassName = ref('')

watch(courseSlotMode, (mode) => {
  if (mode === 'ban') {
    activeBanSubject.value = activeAreaSubject.value
    selectedBanCampus.value = selectedAreaCampus.value
    selectedBanGrade.value = selectedAreaGrade.value
    return
  }
  activeAreaSubject.value = activeBanSubject.value
  selectedAreaCampus.value = selectedBanCampus.value
  selectedAreaGrade.value = selectedBanGrade.value
})

const areaCampusOptions = computed(() => campusOptions.value)
const areaGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedAreaCampus.value)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})
const areaSubjectOptions = computed(() => {
  const list = Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
  return list.length > 0 ? list : fallbackBanSubjects
})
const areaClassOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedAreaCampus.value)
  if (!campusId || !selectedAreaGrade.value) return [] as ClassRecord[]
  return adminBaseSnapshot.value.classRecords
    .filter((item) => item.campusId === campusId && item.grade === selectedAreaGrade.value)
    .slice()
    .sort((a, b) => a.classNo - b.classNo)
})

const areaClassHourBase = computed(() => {
  const campusId = campusIdByName.value.get(selectedAreaCampus.value)
  if (!campusId || !selectedAreaGrade.value) return null
  const row = adminBaseSnapshot.value.classHourRows.find(
    (item) => item.campusId === campusId && item.grade === selectedAreaGrade.value
  )
  return row ?? null
})

const areaDaysCount = computed(() => {
  const count = areaClassHourBase.value?.weeklyDays ?? 5
  return Math.max(1, Math.min(7, Math.floor(Number(count) || 5)))
})

const areaLessonCount = computed(() => {
  const row = areaClassHourBase.value
  if (!row) return 8
  const total = (row.morningStudy || 0) + (row.morningLessons || 0) + (row.afternoonLessons || 0) + (row.eveningStudy || 0)
  return Math.max(1, Math.min(12, Math.floor(Number(total) || 8)))
})

const areaDays = computed(() => allAreaDays.slice(0, areaDaysCount.value))
const areaPeriods = computed(() => Array.from({ length: areaLessonCount.value }, (_, idx) => idx + 1))

const areaClassRanges = computed(() => {
  const classes = areaClassOptions.value
  if (classes.length <= 0) return [] as Array<{ id: string; label: string; classNames: string[] }>
  const ranges: Array<{ id: string; label: string; classNames: string[] }> = []
  for (const classItem of classes) {
    ranges.push({
      id: classItem.id,
      label: classItem.className,
      classNames: [classItem.className]
    })
  }
  return ranges
})

const visibleAreaClasses = computed(() => {
  const classes = areaClassOptions.value
  if (selectedAreaClassRanges.value.length === 0) return classes
  const selected = areaClassRanges.value.filter((item) => selectedAreaClassRanges.value.includes(item.id))
  if (selected.length === 0) return classes
  const set = new Set(selected.flatMap((item) => item.classNames))
  return classes.filter((item) => set.has(item.className))
})

const areaAllClassIds = computed(() => areaClassRanges.value.map((item) => item.id))
const selectedAreaClassFilter = computed<string>({
  get: () => {
    const selected = selectedAreaClassRanges.value.filter((id) => areaAllClassIds.value.includes(id))
    return selected.length === 1 ? selected[0] : '全部班级'
  },
  set: (value) => {
    selectedAreaClassRanges.value = value === '全部班级' ? [...areaAllClassIds.value] : [value]
  }
})

const selectedAreaTemplateClass = computed(() => {
  if (selectedAreaClassFilter.value !== '全部班级') {
    return areaClassOptions.value.find((item) => item.id === selectedAreaClassFilter.value) ?? null
  }
  return areaClassOptions.value.find((item) => item.className === lastEditedAreaClassName.value)
    ?? areaClassOptions.value[0]
    ?? null
})

function applyAreaRuleToAllClasses(): void {
  const sourceClass = selectedAreaTemplateClass.value
  if (!sourceClass) {
    notify.warning('请先选择一个班级作为应用模板。')
    return
  }

  const sourceKey = buildAreaRuleKey(
    selectedAreaCampus.value,
    selectedAreaGrade.value,
    activeAreaSubject.value,
    sourceClass.className
  )
  const sourceSlots = courseAreaRuleMap.value.get(sourceKey)?.allowedSlots?.slice() ?? []
  const targetClassNames = new Set(areaClassOptions.value.map((item) => item.className))
  const retained = courseAreaRules.value.filter((item) => {
    if (item.campus !== selectedAreaCampus.value) return true
    if (item.grade !== selectedAreaGrade.value) return true
    if (item.subject !== activeAreaSubject.value) return true
    return !targetClassNames.has(item.className)
  })
  const copied = sourceSlots.length === 0
    ? []
    : areaClassOptions.value.map((classItem, index) => ({
        id: `ca-${Date.now()}-${index}-${Math.floor(Math.random() * 100000)}`,
        campus: selectedAreaCampus.value,
        grade: selectedAreaGrade.value,
        subject: activeAreaSubject.value,
        className: classItem.className,
        allowedSlots: [...sourceSlots]
      }))

  courseAreaRules.value = [...retained, ...copied]
  notify.success(`已将${sourceClass.className}的允许排课设置同步到全部班级。`)
}

function normalizeAreaClassSelection(next: string[]): void {
  const validIds = new Set(areaAllClassIds.value)
  const normalizedBase = Array.from(new Set((next || []).filter((id) => validIds.has(id))))
  const normalized = normalizedBase.length === 0 && areaAllClassIds.value.length > 0
    ? [...areaAllClassIds.value]
    : normalizedBase
  const changed = normalized.length !== selectedAreaClassRanges.value.length
    || normalized.some((item, index) => item !== selectedAreaClassRanges.value[index])
  if (!changed) return
  selectedAreaClassRanges.value = normalized
}

function ensureAreaSelectionValid(): void {
  if (areaAllClassIds.value.length === 0) {
    selectedAreaClassRanges.value = []
    return
  }
  if (selectedAreaClassRanges.value.length === 0) {
    selectedAreaClassRanges.value = [...areaAllClassIds.value]
    return
  }
  normalizeAreaClassSelection(selectedAreaClassRanges.value)
}

function buildBanRuleKey(campus: string, grade: string, subject: string, className: string): string {
  return `${campus}::${grade}::${subject}::${className}`
}

const courseBanRuleMap = computed(() => {
  const map = new Map<string, CourseBanRuleRecord>()
  courseBanRules.value.forEach((item) => {
    map.set(buildBanRuleKey(item.campus, item.grade, item.subject, item.className), item)
  })
  return map
})

const configuredCourseBanRows = computed(() =>
  courseBanRules.value
    .filter((item) => {
      if (selectedBanCampus.value && item.campus !== selectedBanCampus.value) return false
      if (selectedBanGrade.value && item.grade !== selectedBanGrade.value) return false
      if (activeBanSubject.value && item.subject !== activeBanSubject.value) return false
      if (selectedBanClassFilter.value !== '全部班级') {
        const selectedClass = banClassOptions.value.find((classItem) => classItem.id === selectedBanClassFilter.value)
        if (selectedClass && item.className !== selectedClass.className) return false
      }
      return true
    })
    .slice()
    .sort((a, b) =>
      a.campus.localeCompare(b.campus, 'zh-CN')
        || a.grade.localeCompare(b.grade, 'zh-CN')
        || a.className.localeCompare(b.className, 'zh-CN')
        || a.subject.localeCompare(b.subject, 'zh-CN')
    )
)

const configuredCourseBanSlotTotal = computed(() =>
  configuredCourseBanRows.value.reduce((total, item) => total + item.bannedSlots.length, 0)
)

function formatCourseSlots(slots: string[]): string {
  const grouped = new Map<string, number[]>()
  slots.forEach((slot) => {
    const separatorIndex = slot.indexOf('-')
    if (separatorIndex <= 0) return
    const period = Number(slot.slice(0, separatorIndex))
    const day = slot.slice(separatorIndex + 1)
    if (!Number.isFinite(period) || !day) return
    const periods = grouped.get(day) ?? []
    periods.push(period)
    grouped.set(day, periods)
  })
  return Array.from(grouped.entries())
    .sort((a, b) => allAreaDays.indexOf(a[0]) - allAreaDays.indexOf(b[0]))
    .map(([day, periods]) => `${day}：第${Array.from(new Set(periods)).sort((a, b) => a - b).join('、')}节`)
    .join('；') || '--'
}

async function deleteCourseBanRule(rule: CourseBanRuleRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除「${rule.campus} / ${rule.grade} / ${rule.className} / ${rule.subject}」的禁止排课设置吗？`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  courseBanRules.value = courseBanRules.value.filter((item) => item.id !== rule.id)
  persistRuleSettingsSections({
    courseBanRules: (persistedRuleSettingsSnapshot.value.courseBanRules || [])
      .filter((item) => item.id !== rule.id)
  })
  notify.success('禁止排课设置已删除。')
}

const banCampusOptions = computed(() => campusOptions.value)
const banGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedBanCampus.value)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})
const banSubjectOptions = computed(() => {
  const list = Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
  return list.length > 0 ? list : fallbackBanSubjects
})
const banClassOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedBanCampus.value)
  if (!campusId || !selectedBanGrade.value) return [] as ClassRecord[]
  return adminBaseSnapshot.value.classRecords
    .filter((item) => item.campusId === campusId && item.grade === selectedBanGrade.value)
    .slice()
    .sort((a, b) => a.classNo - b.classNo)
})

const banClassHourBase = computed(() => {
  const campusId = campusIdByName.value.get(selectedBanCampus.value)
  if (!campusId || !selectedBanGrade.value) return null
  const row = adminBaseSnapshot.value.classHourRows.find(
    (item) => item.campusId === campusId && item.grade === selectedBanGrade.value
  )
  return row ?? null
})

const banDaysCount = computed(() => {
  const count = banClassHourBase.value?.weeklyDays ?? 5
  return Math.max(1, Math.min(7, Math.floor(Number(count) || 5)))
})

const banLessonCount = computed(() => {
  const row = banClassHourBase.value
  if (!row) return 8
  const total = (row.morningStudy || 0) + (row.morningLessons || 0) + (row.afternoonLessons || 0) + (row.eveningStudy || 0)
  return Math.max(1, Math.min(12, Math.floor(Number(total) || 8)))
})

const banDays = computed(() => allAreaDays.slice(0, banDaysCount.value))
const banPeriods = computed(() => Array.from({ length: banLessonCount.value }, (_, idx) => idx + 1))

const banClassRanges = computed(() => {
  const classes = banClassOptions.value
  if (classes.length <= 0) return [] as Array<{ id: string; label: string; classNames: string[] }>
  return classes.map((classItem) => ({
    id: classItem.id,
    label: classItem.className,
    classNames: [classItem.className]
  }))
})

const visibleBanClasses = computed(() => {
  const classes = banClassOptions.value
  if (selectedBanClassRanges.value.length === 0) return classes
  const selected = banClassRanges.value.filter((item) => selectedBanClassRanges.value.includes(item.id))
  if (selected.length === 0) return classes
  const set = new Set(selected.flatMap((item) => item.classNames))
  return classes.filter((item) => set.has(item.className))
})

const banAllClassIds = computed(() => banClassRanges.value.map((item) => item.id))
const selectedBanClassFilter = computed<string>({
  get: () => {
    const selected = selectedBanClassRanges.value.filter((id) => banAllClassIds.value.includes(id))
    return selected.length === 1 ? selected[0] : '全部班级'
  },
  set: (value) => {
    selectedBanClassRanges.value = value === '全部班级' ? [...banAllClassIds.value] : [value]
  }
})

const selectedBanTemplateClass = computed(() => {
  if (selectedBanClassFilter.value !== '全部班级') {
    return banClassOptions.value.find((item) => item.id === selectedBanClassFilter.value) ?? null
  }
  return banClassOptions.value.find((item) => item.className === lastEditedBanClassName.value)
    ?? banClassOptions.value[0]
    ?? null
})

function applyBanRuleToAllClasses(): void {
  const sourceClass = selectedBanTemplateClass.value
  if (!sourceClass) {
    notify.warning('请先选择一个班级作为应用模板。')
    return
  }

  const sourceKey = buildBanRuleKey(
    selectedBanCampus.value,
    selectedBanGrade.value,
    activeBanSubject.value,
    sourceClass.className
  )
  const sourceSlots = courseBanRuleMap.value.get(sourceKey)?.bannedSlots?.slice() ?? []
  const targetClassNames = new Set(banClassOptions.value.map((item) => item.className))
  const retained = courseBanRules.value.filter((item) => {
    if (item.campus !== selectedBanCampus.value) return true
    if (item.grade !== selectedBanGrade.value) return true
    if (item.subject !== activeBanSubject.value) return true
    return !targetClassNames.has(item.className)
  })
  const copied = sourceSlots.length === 0
    ? []
    : banClassOptions.value.map((classItem, index) => ({
        id: `cbn-${Date.now()}-${index}-${Math.floor(Math.random() * 100000)}`,
        campus: selectedBanCampus.value,
        grade: selectedBanGrade.value,
        subject: activeBanSubject.value,
        className: classItem.className,
        bannedSlots: [...sourceSlots]
      }))

  courseBanRules.value = [...retained, ...copied]
  notify.success(`已将${sourceClass.className}的禁止排课设置同步到全部班级。`)
}

function normalizeBanClassSelection(next: string[]): void {
  const validIds = new Set(banAllClassIds.value)
  const normalizedBase = Array.from(new Set((next || []).filter((id) => validIds.has(id))))
  const normalized = normalizedBase.length === 0 && banAllClassIds.value.length > 0
    ? [...banAllClassIds.value]
    : normalizedBase
  const changed = normalized.length !== selectedBanClassRanges.value.length
    || normalized.some((item, index) => item !== selectedBanClassRanges.value[index])
  if (!changed) return
  selectedBanClassRanges.value = normalized
}

function ensureBanSelectionValid(): void {
  if (banAllClassIds.value.length === 0) {
    selectedBanClassRanges.value = []
    return
  }
  if (selectedBanClassRanges.value.length === 0) {
    selectedBanClassRanges.value = [...banAllClassIds.value]
    return
  }
  normalizeBanClassSelection(selectedBanClassRanges.value)
}

function classBanCellEnabled(className: string, period: number, day: string): boolean {
  const key = buildBanRuleKey(selectedBanCampus.value, selectedBanGrade.value, activeBanSubject.value, className)
  const rule = courseBanRuleMap.value.get(key)
  if (!rule) return false
  return rule.bannedSlots.includes(`${period}-${day}`)
}

function toggleClassBanCell(className: string, period: number, day: string): void {
  if (!selectedBanCampus.value || !selectedBanGrade.value || !activeBanSubject.value) return
  lastEditedBanClassName.value = className
  const slot = `${period}-${day}`
  const key = buildBanRuleKey(selectedBanCampus.value, selectedBanGrade.value, activeBanSubject.value, className)
  const existing = courseBanRuleMap.value.get(key)
  const fullSlots = banPeriods.value.flatMap((p) => banDays.value.map((d) => `${p}-${d}`))
  const base = existing?.bannedSlots?.slice() || []
  const next = base.includes(slot) ? base.filter((item) => item !== slot) : [...base, slot]
  const normalized = fullSlots.filter((item) => next.includes(item))

  const rest = courseBanRules.value.filter((item) => buildBanRuleKey(item.campus, item.grade, item.subject, item.className) !== key)
  if (normalized.length === 0) {
    courseBanRules.value = rest
    return
  }
  courseBanRules.value = [
    ...rest,
    {
      id: existing?.id || `cbn-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      campus: selectedBanCampus.value,
      grade: selectedBanGrade.value,
      subject: activeBanSubject.value,
      className,
      bannedSlots: normalized
    }
  ]
}

function clearCurrentBanRule(): void {
  const rest = courseBanRules.value.filter((item) => {
    if (item.campus !== selectedBanCampus.value) return true
    if (item.grade !== selectedBanGrade.value) return true
    if (item.subject !== activeBanSubject.value) return true
    return false
  })
  courseBanRules.value = rest
  notify.info('已清空当前课程禁止排课草稿，点击保存后生效。')
}

function saveCurrentBanRule(): void {
  const matchesCurrentScope = (item: CourseBanRuleRecord) =>
    item.campus === selectedBanCampus.value
    && item.grade === selectedBanGrade.value
    && item.subject === activeBanSubject.value
  const nextRules = [
    ...(persistedRuleSettingsSnapshot.value.courseBanRules || []).filter((item) => !matchesCurrentScope(item)),
    ...courseBanRules.value.filter(matchesCurrentScope)
  ]
  persistRuleSettingsSections({ courseBanRules: nextRules })
  notify.success('课程禁止排课规则已保存。')
}

const oddEvenClassOptions = computed(() => {
  const campusName = selectedOddEvenCampus.value
  const gradeName = selectedOddEvenGrade.value
  const visible = adminBaseSnapshot.value.classRecords.filter((item) => {
    if (campusName !== '全部校区') {
      const campusId = campusIdByName.value.get(campusName)
      if (!campusId || item.campusId !== campusId) return false
    }
    if (gradeName !== '全部年级' && item.grade !== gradeName) return false
    return true
  })
  const unique = Array.from(new Set(visible.map((item) => item.className)))
  return ['全部班级', ...unique]
})

const filteredOddEvenRules = computed(() =>
  oddEvenRules.value.filter((item) => {
    if (selectedOddEvenCampus.value !== '全部校区' && item.campus !== selectedOddEvenCampus.value) return false
    if (selectedOddEvenGrade.value !== '全部年级' && item.grade !== selectedOddEvenGrade.value) return false
    if (selectedOddEvenClass.value !== '全部班级' && !item.classNames.includes(selectedOddEvenClass.value)) return false
    if (selectedOddEvenCourse.value !== '全部课程') {
      const matchOdd = item.oddCourse === selectedOddEvenCourse.value
      const matchEven = item.evenCourse === selectedOddEvenCourse.value
      if (!matchOdd && !matchEven) return false
    }
    return true
  })
)

const consecutiveCampusOptions = computed(() => campusOptions.value)
const consecutiveGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedConsecutiveCampus.value)
  if (!campusId) return [] as string[]
  return sortGradeLabels(
    adminBaseSnapshot.value.classRecords
      .filter((item) => item.campusId === campusId)
      .map((item) => item.grade)
  )
})
const consecutiveClassOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedConsecutiveCampus.value)
  if (!campusId || !selectedConsecutiveGrade.value) return ['全部班级']
  const classNames = Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId && item.grade === selectedConsecutiveGrade.value)
        .map((item) => item.className)
        .filter(Boolean)
      )
  )
  return ['全部班级', ...classNames]
})
const consecutiveSubjectOptions = computed(() => {
  const list = Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
  return list.length > 0 ? list : fallbackBanSubjects
})

function normalizeLimitedInt(value: number | null, min: number, max: number): number | null {
  if (value == null) return null
  const normalized = Math.floor(Number(value))
  if (!Number.isFinite(normalized)) return null
  return Math.max(min, Math.min(max, normalized))
}

function consecutiveSettingKey(): string {
  return [
    selectedConsecutiveCampus.value || '-',
    selectedConsecutiveGrade.value || '-',
    activeConsecutiveSubject.value || '-',
    selectedConsecutiveType.value || '-'
  ].join('::')
}

const consecutiveDraftWeeklyCount = ref<number | null>(null)
const consecutiveDraftPreferredDays = ref<string[]>([])

function loadCurrentConsecutiveDraft(): void {
  const setting = consecutiveSettingMap.value[consecutiveSettingKey()]
  const className = selectedConsecutiveClass.value
  const rule = className === '全部班级'
    ? setting?.defaultRule
    : setting?.classOverrides[className] ?? setting?.defaultRule

  consecutiveDraftWeeklyCount.value = rule?.weeklyConsecutiveCount ?? null
  consecutiveDraftPreferredDays.value = Array.isArray(rule?.preferredDays) ? [...rule.preferredDays] : []
}
const configuredConsecutiveRows = computed(() => {
  const rows: Array<{
    id: string
    settingKey: string
    campus: string
    grade: string
    subject: string
    className: string
    weeklyConsecutiveCount: number | null
    preferredDays: string[]
  }> = []
  const appendRule = (
    settingKey: string,
    campus: string,
    grade: string,
    subject: string,
    className: string,
    rule: ConsecutiveRuleValue
  ) => {
    const preferredDays = Array.isArray(rule.preferredDays) ? rule.preferredDays : []
    if (rule.weeklyConsecutiveCount == null && preferredDays.length === 0) return
    rows.push({
      id: `${settingKey}::${className}`,
      settingKey,
      campus,
      grade,
      subject,
      className,
      weeklyConsecutiveCount: rule.weeklyConsecutiveCount,
      preferredDays
    })
  }
  Object.entries(consecutiveSettingMap.value).forEach(([settingKey, setting]) => {
    const [campus = '-', grade = '-', subject = '-'] = settingKey.split('::')
    appendRule(settingKey, campus, grade, subject, '全部班级', setting.defaultRule)
    Object.entries(setting.classOverrides).forEach(([className, rule]) => {
      appendRule(settingKey, campus, grade, subject, className, rule)
    })
  })
  return rows.sort((a, b) =>
    a.campus.localeCompare(b.campus, 'zh-CN')
      || a.grade.localeCompare(b.grade, 'zh-CN')
      || a.subject.localeCompare(b.subject, 'zh-CN')
      || a.className.localeCompare(b.className, 'zh-CN')
  )
})
const configuredConsecutiveWeeklyTotal = computed(() =>
  configuredConsecutiveRows.value.reduce((total, row) => total + (row.weeklyConsecutiveCount ?? 0), 0)
)
const consecutiveDefaultWeeklyCount = computed<number | undefined>({
  get: () => consecutiveDraftWeeklyCount.value ?? undefined,
  set: (value) => {
    consecutiveDraftWeeklyCount.value = normalizeLimitedInt(value ?? null, 0, 5)
  }
})
const consecutiveDefaultPreferredDays = computed<string[]>({
  get: () => [...consecutiveDraftPreferredDays.value],
  set: (value) => {
    consecutiveDraftPreferredDays.value = Array.from(
      new Set((value || []).map((item) => String(item || '')).filter((day) => consecutiveWeekdays.includes(day)))
    )
  }
})

function clearCurrentConsecutiveSetting(): void {
  consecutiveDraftWeeklyCount.value = null
  consecutiveDraftPreferredDays.value = []
  notify.info('已清空当前连堂课草稿，点击保存后生效。')
}

function saveCurrentConsecutiveSetting(): void {
  if (!selectedConsecutiveCampus.value || !selectedConsecutiveGrade.value || !activeConsecutiveSubject.value) {
    notify.warning('请先选择校区、年级和课程。')
    return
  }

  const key = consecutiveSettingKey()
  const existing = consecutiveSettingMap.value[key]
  const nextSetting: ConsecutiveSetting = {
    defaultRule: {
      weeklyConsecutiveCount: existing?.defaultRule.weeklyConsecutiveCount ?? null,
      preferredDays: [...(existing?.defaultRule.preferredDays || [])]
    },
    classOverrides: Object.fromEntries(
      Object.entries(existing?.classOverrides || {}).map(([className, rule]) => [
        className,
        {
          weeklyConsecutiveCount: rule.weeklyConsecutiveCount,
          preferredDays: [...(rule.preferredDays || [])]
        }
      ])
    )
  }
  const nextRule: ConsecutiveRuleValue = {
    weeklyConsecutiveCount: normalizeLimitedInt(consecutiveDraftWeeklyCount.value, 0, 5),
    preferredDays: [...consecutiveDraftPreferredDays.value]
  }
  const className = selectedConsecutiveClass.value
  const hasRuleValue = nextRule.weeklyConsecutiveCount != null || nextRule.preferredDays.length > 0

  if (className === '全部班级') {
    nextSetting.defaultRule = nextRule
  } else if (hasRuleValue) {
    nextSetting.classOverrides[className] = nextRule
  } else {
    delete nextSetting.classOverrides[className]
  }

  const hasDefaultRule = nextSetting.defaultRule.weeklyConsecutiveCount != null
    || nextSetting.defaultRule.preferredDays.length > 0
  const nextMap = { ...consecutiveSettingMap.value }
  if (!hasDefaultRule && Object.keys(nextSetting.classOverrides).length === 0) {
    delete nextMap[key]
  } else {
    nextMap[key] = nextSetting
  }
  consecutiveSettingMap.value = nextMap
  persistRuleSettingsSections({ consecutiveSettings: consecutiveSettingMap.value })
  notify.success(hasRuleValue ? '连堂课规则已保存。' : '连堂课规则已清除。')
}

async function removeConfiguredConsecutiveRule(row: (typeof configuredConsecutiveRows.value)[number]): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除「${row.campus} / ${row.grade} / ${row.className} / ${row.subject}」的连堂课设置吗？`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  const setting = consecutiveSettingMap.value[row.settingKey]
  if (!setting) return
  const nextSetting: ConsecutiveSetting = {
    defaultRule: {
      weeklyConsecutiveCount: setting.defaultRule.weeklyConsecutiveCount,
      preferredDays: [...(setting.defaultRule.preferredDays || [])]
    },
    classOverrides: { ...setting.classOverrides }
  }
  if (row.className === '全部班级') {
    nextSetting.defaultRule = { weeklyConsecutiveCount: null, preferredDays: [] }
  } else {
    delete nextSetting.classOverrides[row.className]
  }
  const hasDefaultRule = nextSetting.defaultRule.weeklyConsecutiveCount != null
    || nextSetting.defaultRule.preferredDays.length > 0
  const nextMap = { ...consecutiveSettingMap.value }
  if (!hasDefaultRule && Object.keys(nextSetting.classOverrides).length === 0) {
    delete nextMap[row.settingKey]
  } else {
    nextMap[row.settingKey] = nextSetting
  }
  consecutiveSettingMap.value = nextMap
  persistRuleSettingsSections({ consecutiveSettings: consecutiveSettingMap.value })
  notify.success('连堂课设置已删除。')
}

function buildAreaRuleKey(campus: string, grade: string, subject: string, className: string): string {
  return `${campus}::${grade}::${subject}::${className}`
}

const courseAreaRuleMap = computed(() => {
  const map = new Map<string, CourseAreaRuleRecord>()
  courseAreaRules.value.forEach((item) => {
    map.set(buildAreaRuleKey(item.campus, item.grade, item.subject, item.className), item)
  })
  return map
})

const configuredCourseAreaRows = computed(() =>
  courseAreaRules.value
    .filter((item) => {
      if (selectedAreaCampus.value && item.campus !== selectedAreaCampus.value) return false
      if (selectedAreaGrade.value && item.grade !== selectedAreaGrade.value) return false
      if (activeAreaSubject.value && item.subject !== activeAreaSubject.value) return false
      if (selectedAreaClassFilter.value !== '全部班级') {
        const selectedClass = areaClassOptions.value.find((classItem) => classItem.id === selectedAreaClassFilter.value)
        if (selectedClass && item.className !== selectedClass.className) return false
      }
      return true
    })
    .slice()
    .sort((a, b) =>
      a.campus.localeCompare(b.campus, 'zh-CN')
        || a.grade.localeCompare(b.grade, 'zh-CN')
        || a.className.localeCompare(b.className, 'zh-CN')
        || a.subject.localeCompare(b.subject, 'zh-CN')
    )
)

const configuredCourseAreaSlotTotal = computed(() =>
  configuredCourseAreaRows.value.reduce((total, item) => total + item.allowedSlots.length, 0)
)

async function deleteCourseAreaRule(rule: CourseAreaRuleRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除「${rule.campus} / ${rule.grade} / ${rule.className} / ${rule.subject}」的允许排课设置吗？`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  courseAreaRules.value = courseAreaRules.value.filter((item) => item.id !== rule.id)
  persistRuleSettingsSections({
    courseAreaRules: (persistedRuleSettingsSnapshot.value.courseAreaRules || [])
      .filter((item) => item.id !== rule.id)
  })
  notify.success('允许排课设置已删除。')
}

function classAreaCellEnabled(className: string, period: number, day: string): boolean {
  const key = buildAreaRuleKey(selectedAreaCampus.value, selectedAreaGrade.value, activeAreaSubject.value, className)
  const rule = courseAreaRuleMap.value.get(key)
  if (!rule) return false
  return rule.allowedSlots.includes(`${period}-${day}`)
}

function toggleClassAreaCell(className: string, period: number, day: string): void {
  if (!selectedAreaCampus.value || !selectedAreaGrade.value || !activeAreaSubject.value) return
  lastEditedAreaClassName.value = className
  const slot = `${period}-${day}`
  const key = buildAreaRuleKey(selectedAreaCampus.value, selectedAreaGrade.value, activeAreaSubject.value, className)
  const existing = courseAreaRuleMap.value.get(key)
  const fullSlots = areaPeriods.value.flatMap((p) => areaDays.value.map((d) => `${p}-${d}`))
  const base = existing?.allowedSlots?.slice() || []
  const next = base.includes(slot) ? base.filter((item) => item !== slot) : [...base, slot]
  const normalized = fullSlots.filter((item) => next.includes(item))

  const rest = courseAreaRules.value.filter((item) => buildAreaRuleKey(item.campus, item.grade, item.subject, item.className) !== key)
  if (normalized.length === 0) {
    courseAreaRules.value = rest
    return
  }
  courseAreaRules.value = [
    ...rest,
    {
      id: existing?.id || `ca-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      campus: selectedAreaCampus.value,
      grade: selectedAreaGrade.value,
      subject: activeAreaSubject.value,
      className,
      allowedSlots: normalized
    }
  ]
}

function clearCurrentAreaRule(): void {
  const rest = courseAreaRules.value.filter((item) => {
    if (item.campus !== selectedAreaCampus.value) return true
    if (item.grade !== selectedAreaGrade.value) return true
    if (item.subject !== activeAreaSubject.value) return true
    return false
  })
  courseAreaRules.value = rest
  notify.info('已清空当前课程允许排课草稿，点击保存后生效。')
}

function saveCurrentAreaRule(): void {
  const matchesCurrentScope = (item: CourseAreaRuleRecord) =>
    item.campus === selectedAreaCampus.value
    && item.grade === selectedAreaGrade.value
    && item.subject === activeAreaSubject.value
  const nextRules = [
    ...(persistedRuleSettingsSnapshot.value.courseAreaRules || []).filter((item) => !matchesCurrentScope(item)),
    ...courseAreaRules.value.filter(matchesCurrentScope)
  ]
  persistRuleSettingsSections({ courseAreaRules: nextRules })
  notify.success('课程允许排课规则已保存。')
}

function fixedPointScopeFilter(item: GlobalFixedPointRecord): boolean {
  if (item.campus !== selectedCampus.value) return false
  if (selectedGrade.value !== '全部年级' && item.grade !== selectedGrade.value && item.grade !== '全部年级') return false
  return true
}

function findFixedPoint(period: number, day: string): GlobalFixedPointRecord | undefined {
  return fixedPointDraftRules.value.find((item) => item.period === period && item.day === day && fixedPointScopeFilter(item))
}

function cellValue(period: number, day: string): string {
  return findFixedPoint(period, day)?.label ?? ''
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

async function setCellValue(period: number, day: string): Promise<void> {
  const targetSlots = fixedPointSelectedSlots.value.includes(`${period}-${day}`)
    ? [...fixedPointSelectedSlots.value]
    : [`${period}-${day}`]
  await setFixedPointForSlots(targetSlots, period, day)
}

async function setSelectedFixedPoints(): Promise<void> {
  const slots = [...fixedPointSelectedSlots.value]
  if (slots.length === 0) {
    notify.warning('请先框选要设置的固定点格子。')
    return
  }
  const [periodRaw, day] = slots[0].split('-', 2)
  await setFixedPointForSlots(slots, Number(periodRaw) || 1, day || fixedPointDays.value[0] || '周一')
}

async function setFixedPointForSlots(targetSlots: string[], fallbackPeriod: number, fallbackDay: string): Promise<void> {
  if (!selectedCampus.value) {
    notify.warning('请先选择校区。')
    return
  }
  const scopedSlots = targetSlots.filter((slot) => {
    const [periodRaw, dayRaw] = String(slot || '').split('-', 2)
    const periodValue = Number(periodRaw)
    return Number.isFinite(periodValue) && fixedPointPeriods.value.includes(periodValue) && fixedPointDays.value.includes(dayRaw)
  })
  if (scopedSlots.length <= 0) return
  const [firstPeriodRaw, firstDayRaw] = scopedSlots[0].split('-', 2)
  const firstPeriod = Number(firstPeriodRaw) || fallbackPeriod
  const firstDay = firstDayRaw || fallbackDay
  const currentRule = findFixedPoint(firstPeriod, firstDay)
  const current = currentRule?.label ?? ''
  const next = await askTextInput(`请输入固定课程名称（将应用到 ${scopedSlots.length} 个格子）`, '设置固定点', current)
  if (next === null) return

  const gradeValue = selectedGrade.value || '全部年级'

  if (!next) {
    deleteFixedPointsBySlots(scopedSlots)
    return
  }

  const bySlot = new Map<string, GlobalFixedPointRecord>()
  fixedPointDraftRules.value.forEach((item) => {
    if (!fixedPointScopeFilter(item)) return
    bySlot.set(`${item.period}-${item.day}`, item)
  })
  const nextRules = fixedPointDraftRules.value.slice()
  scopedSlots.forEach((slot) => {
    const [periodRaw, day] = slot.split('-', 2)
    const period = Number(periodRaw)
    if (!day || !Number.isFinite(period)) return
    const existing = bySlot.get(`${period}-${day}`)
    if (existing) {
      const idx = nextRules.findIndex((item) => item.id === existing.id)
      if (idx >= 0) {
        nextRules[idx] = { ...nextRules[idx], label: next, type: '固定点' }
      }
      return
    }
    nextRules.push({
      id: `fp-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      campus: selectedCampus.value,
      grade: gradeValue,
      type: '固定点',
      period,
      day,
      label: next
    })
  })
  fixedPointDraftRules.value = nextRules
}

function clearFixedPoints(): void {
  fixedPointDraftRules.value = fixedPointDraftRules.value.filter((item) => !fixedPointScopeFilter(item))
  notify.info('已清空当前范围固定点草稿，点击保存后生效。')
}

function onFixedGradeCheckChange(grade: string, checked: boolean): void {
  if (checked) {
    selectedGrade.value = grade
    return
  }
  if (selectedGrade.value === grade) {
    selectedGrade.value = '全部年级'
  }
}

function fixedSlotKey(period: number, day: string): string {
  return `${period}-${day}`
}

function isFixedCellSelected(period: number, day: string): boolean {
  return fixedPointSelectedSlots.value.includes(fixedSlotKey(period, day))
}

function onFixedCellMouseDown(event: MouseEvent, period: number, day: string): void {
  if (event.button !== 0) return
  fixedPointSelecting.value = true
  if (!event.shiftKey || !fixedPointSelectionStart.value) {
    fixedPointSelectionStart.value = { period, day }
  }
  fixedPointSelectedSlots.value = [fixedSlotKey(period, day)]
  if (event.shiftKey && fixedPointSelectionStart.value) {
    onFixedCellMouseEnter(period, day)
  }
}

function onFixedCellMouseEnter(period: number, day: string): void {
  if (!fixedPointSelecting.value || !fixedPointSelectionStart.value) return
  const start = fixedPointSelectionStart.value
  const dayStartIdx = fixedPointDays.value.indexOf(start.day)
  const dayEndIdx = fixedPointDays.value.indexOf(day)
  if (dayStartIdx < 0 || dayEndIdx < 0) return
  const dayFrom = Math.min(dayStartIdx, dayEndIdx)
  const dayTo = Math.max(dayStartIdx, dayEndIdx)
  const periodFrom = Math.min(start.period, period)
  const periodTo = Math.max(start.period, period)
  const slots: string[] = []
  for (let p = periodFrom; p <= periodTo; p += 1) {
    if (!fixedPointPeriods.value.includes(p)) continue
    for (let d = dayFrom; d <= dayTo; d += 1) {
      slots.push(fixedSlotKey(p, fixedPointDays.value[d]))
    }
  }
  fixedPointSelectedSlots.value = slots
}

function onFixedCellMouseUp(): void {
  fixedPointSelecting.value = false
}

function deleteFixedPointsBySlots(slots: string[]): void {
  if (slots.length <= 0) return
  const slotSet = new Set(slots)
  fixedPointDraftRules.value = fixedPointDraftRules.value.filter((item) => {
    if (!fixedPointScopeFilter(item)) return true
    return !slotSet.has(fixedSlotKey(item.period, item.day))
  })
}

function onFixedCellContextMenu(event: MouseEvent, period: number, day: string): void {
  event.preventDefault()
  const key = fixedSlotKey(period, day)
  const targets = isFixedCellSelected(period, day) ? [...fixedPointSelectedSlots.value] : [key]
  fixedPointContextMenu.visible = true
  fixedPointContextMenu.x = event.clientX
  fixedPointContextMenu.y = event.clientY
  fixedPointContextMenu.slots = targets
  fixedPointContextMenu.anchorPeriod = period
  fixedPointContextMenu.anchorDay = day
}

function closeFixedPointContextMenu(): void {
  fixedPointContextMenu.visible = false
}

async function onFixedContextSet(): Promise<void> {
  const targets = [...fixedPointContextMenu.slots]
  const period = fixedPointContextMenu.anchorPeriod
  const day = fixedPointContextMenu.anchorDay
  closeFixedPointContextMenu()
  await setFixedPointForSlots(targets, period, day)
}

function onFixedContextDelete(): void {
  const targets = [...fixedPointContextMenu.slots]
  closeFixedPointContextMenu()
  deleteFixedPointsBySlots(targets)
  notify.info(`已从草稿删除 ${targets.length} 个固定点格子，点击保存后生效。`)
}

const handleCloseFixedPointContextMenu = () => closeFixedPointContextMenu()

function saveFixedPoints(): void {
  const savedRules = persistedRuleSettingsSnapshot.value.globalFixedPoints || []
  const nextRules = [
    ...savedRules.filter((item) => !fixedPointScopeFilter(item)),
    ...fixedPointDraftRules.value.filter(fixedPointScopeFilter)
  ]
  fixedPointRules.value = cloneFixedPointRules(nextRules)
  persistRuleSettingsSections({ globalFixedPoints: nextRules })
  notify.success('全局固定点规则已保存。')
}

function banKey(period: number, day: string): string {
  return `${period}-${day}`
}

function currentTeacherTargetKey(): string {
  if (teacherBanMode.value === 'single') {
    if (!selectedTeacherId.value) return ''
    return `single:${selectedTeacherId.value}`
  }
  if (!selectedGroupId.value) return ''
  return `group:${selectedGroupId.value}`
}

function isTeacherBanned(period: number, day: string): boolean {
  const key = currentTeacherTargetKey()
  return Boolean(teacherBanMap.value[key]?.[banKey(period, day)])
}

function toggleTeacherBan(period: number, day: string): void {
  const target = currentTeacherTargetKey()
  if (!target) {
    notify.warning(teacherBanMode.value === 'single' ? '请先选择老师。' : '请先选择教研与活动分组。')
    return
  }
  const slot = banKey(period, day)
  const current = Boolean(teacherBanMap.value[target]?.[slot])
  const next = { ...(teacherBanMap.value[target] ?? {}) }

  if (current) {
    delete next[slot]
  } else {
    next[slot] = true
  }

  teacherBanMap.value = { ...teacherBanMap.value, [target]: next }
}

function clearTeacherBan(): void {
  const target = currentTeacherTargetKey()
  if (!target) {
    notify.warning(teacherBanMode.value === 'single' ? '请先选择老师。' : '请先选择教研与活动分组。')
    return
  }
  teacherBanMap.value = {
    ...teacherBanMap.value,
    [target]: {}
  }
}

function saveTeacherBanRules(): void {
  const target = currentTeacherTargetKey()
  if (!target) {
    notify.warning(teacherBanMode.value === 'single' ? '请先选择老师。' : '请先选择教研与活动分组。')
    return
  }
  const nextRules = {
    ...(persistedRuleSettingsSnapshot.value.teacherBanRules || {}),
    [target]: { ...(teacherBanMap.value[target] || {}) }
  }
  persistRuleSettingsSections({ teacherBanRules: nextRules })
  notify.success('教师不排课规则已保存。')
}

const currentGroupMemberText = computed(() => {
  const group = teacherBanGroupOptions.value.find((item) => item.id === selectedGroupId.value)
  if (!group) return ''
  return group.memberNames.join('、')
})

function normalizePositiveOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(1, Math.floor(value))
}

function upsertTeacherHourRule(
  campus: string,
  grade: string,
  subject: string,
  teacherId: string,
  teacherName: string,
  values: {
    maxDailyLessons: number | null
    maxConsecutiveLessons: number | null
    weekDistribution: '周分散' | '周集中' | null
    dayDistribution: '日分散' | '日集中' | null
  }
): void {
  const matchedIndex = teacherHourRuleStore.value.findIndex(
    (item) =>
      item.campus === campus &&
      item.grade === grade &&
      item.subject === subject &&
      item.teacherId === teacherId
  )

  const nextRule: TeacherHourRuleRecord = {
    id: matchedIndex >= 0 ? teacherHourRuleStore.value[matchedIndex].id : `thr-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    campus,
    grade,
    subject,
    teacherId,
    teacherName,
    maxDailyLessons: values.maxDailyLessons,
    maxConsecutiveLessons: values.maxConsecutiveLessons,
    weekDistribution: values.weekDistribution,
    dayDistribution: values.dayDistribution
  }

  if (matchedIndex >= 0) {
    teacherHourRuleStore.value = teacherHourRuleStore.value.map((item, index) => (index === matchedIndex ? nextRule : item))
  } else {
    teacherHourRuleStore.value = [nextRule, ...teacherHourRuleStore.value]
  }
}

function ensureTeacherHourInlineEditor(rule: TeacherHourRule): {
  maxDailyLessons: number | null
  maxConsecutiveLessons: number | null
  weekDistribution: '' | '周分散' | '周集中'
  dayDistribution: '' | '日分散' | '日集中'
} {
  if (!teacherHourInlineEditorMap.value[rule.id]) {
    teacherHourInlineEditorMap.value[rule.id] = {
      maxDailyLessons: rule.maxDailyLessons ?? null,
      maxConsecutiveLessons: rule.maxConsecutiveLessons ?? null,
      weekDistribution: rule.weekDistribution ?? '',
      dayDistribution: rule.dayDistribution ?? ''
    }
  }
  return teacherHourInlineEditorMap.value[rule.id]
}

function applyTeacherHourRuleForTeacher(rule: TeacherHourRule): void {
  const campus = selectedTeacherHourCampus.value
  const grade = selectedTeacherHourGrade.value
  const subject = selectedTeacherHourSubject.value
  if (!campus || !grade || !subject) {
    notify.warning('请先选择校区、年级和学科。')
    return
  }
  const editor = ensureTeacherHourInlineEditor(rule)
  const values = {
    maxDailyLessons: normalizePositiveOrNull(editor.maxDailyLessons),
    maxConsecutiveLessons: normalizePositiveOrNull(editor.maxConsecutiveLessons),
    weekDistribution: editor.weekDistribution || null,
    dayDistribution: editor.dayDistribution || null
  }

  upsertTeacherHourRule(campus, grade, subject, rule.teacherId, rule.teacherName, values)
  persistRuleSettingsSections({ teacherHourRules: teacherHourRuleStore.value })
  notify.success(rule.isAllTeachers ? '默认规则已保存。' : `已保存「${rule.teacherName}」个人设置。`)
}

async function applyTeacherHourRuleToSubjectTeachers(): Promise<void> {
  const campus = selectedTeacherHourCampus.value
  const grade = selectedTeacherHourGrade.value
  const subject = selectedTeacherHourSubject.value
  if (!campus || !grade || !subject) {
    notify.warning('请先选择校区、年级和学科。')
    return
  }

  const allRow = teacherHourRows.value.find((item) => item.isAllTeachers)
  if (!allRow) return
  const editor = ensureTeacherHourInlineEditor(allRow)
  const values = {
    maxDailyLessons: normalizePositiveOrNull(editor.maxDailyLessons),
    maxConsecutiveLessons: normalizePositiveOrNull(editor.maxConsecutiveLessons),
    weekDistribution: editor.weekDistribution || null,
    dayDistribution: editor.dayDistribution || null
  }

  const targets = teacherHourRows.value.filter((item) => !item.isAllTeachers)
  if (targets.length === 0) {
    notify.warning('当前筛选范围内没有可应用的教师。')
    return
  }

  // 应用到全部：仅更新“全部教师”默认规则，并移除当前范围教师个人覆盖，避免重复规则。
  const targetTeacherIdSet = new Set(targets.map((item) => item.teacherId))
  teacherHourRuleStore.value = teacherHourRuleStore.value.filter(
    (item) =>
      !(
        item.campus === campus &&
        item.grade === grade &&
        item.subject === subject &&
        item.teacherId &&
        targetTeacherIdSet.has(item.teacherId)
      )
  )
  upsertTeacherHourRule(campus, grade, subject, '', '全部教师', values)
  persistRuleSettingsSections({ teacherHourRules: teacherHourRuleStore.value })
  notify.success(`已保存全部教师规则（${targets.length}位教师）。`)
}

function clearTeacherHourBatchRule(): void {
  const campus = selectedTeacherHourCampus.value
  const grade = selectedTeacherHourGrade.value
  const subject = selectedTeacherHourSubject.value
  if (!campus || !grade || !subject) return

  teacherHourRuleStore.value = teacherHourRuleStore.value.filter(
    (item) => !(item.campus === campus && item.grade === grade && item.subject === subject && item.teacherId === '')
  )
  persistRuleSettingsSections({ teacherHourRules: teacherHourRuleStore.value })
  notify.success('已清空当前范围批量设置。')
}

async function clearTeacherHourRule(rule: TeacherHourRule): Promise<void> {
  if (rule.teacherName === '全部教师') return
  if (!rule.hasOwnRule) {
    notify.info('当前教师已是默认状态，无需清空。')
    return
  }
  try {
    await ElMessageBox.confirm(`确认清空教师「${rule.teacherName}」的个人课时设置吗？`, '清空确认', {
      type: 'warning',
      confirmButtonText: '确认清空',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  const campus = selectedTeacherHourCampus.value
  const grade = selectedTeacherHourGrade.value
  const subject = selectedTeacherHourSubject.value
  teacherHourRuleStore.value = teacherHourRuleStore.value.filter(
    (item) =>
      !(
        item.campus === campus &&
        item.grade === grade &&
        item.subject === subject &&
        item.teacherId === rule.teacherId
      )
  )
  persistRuleSettingsSections({ teacherHourRules: teacherHourRuleStore.value })
  notify.success('已清空个人设置，恢复继承默认规则。')
}

function subjectHasBan(subject: string): boolean {
  return courseBanRules.value.some((item) => item.subject === subject && item.bannedSlots.length > 0)
}

function toggleCombineRuleSelection(ruleId: string, checked: boolean): void {
  if (checked) {
    selectedCombineRuleIds.value = Array.from(new Set([...selectedCombineRuleIds.value, ruleId]))
    return
  }
  selectedCombineRuleIds.value = selectedCombineRuleIds.value.filter((id) => id !== ruleId)
}

function toggleAllFilteredCombineRules(checked: boolean): void {
  selectedCombineRuleIds.value = checked ? filteredCombineRules.value.map((item) => item.id) : []
}

async function deleteSelectedCombineRules(): Promise<void> {
  const ids = Array.from(new Set(selectedCombineRuleIds.value))
  if (ids.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确认删除已选的 ${ids.length} 条合班课规则吗？删除后无法撤销。`,
      '批量删除确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  const idSet = new Set(ids)
  combineRules.value = combineRules.value.filter((item) => !idSet.has(item.id))
  selectedCombineRuleIds.value = []
  normalizeCombineRuleOrder()
  persistRuleSettingsSections({ combineRules: combineRules.value })
  notify.success(`已删除 ${ids.length} 条合班课规则。`)
}

function normalizeCombineRuleOrder(): void {
  combineRules.value = combineRules.value.map((item, index) => ({
    ...item,
    orderNo: index + 1
  }))
}

function openCreateCombineDialog(): void {
  combineDialogMode.value = 'create'
  combineEditingId.value = ''
  combineDialogError.value = ''
  combineForm.campus = selectedCombineCampus.value === '全部校区' ? campusOptions.value[0] || '本校区' : selectedCombineCampus.value
  combineForm.grade = selectedCombineGrade.value === '全部年级' ? combineGradeOptions.value[1] || '' : selectedCombineGrade.value
  combineForm.classNames = []
  combineForm.course = selectedCombineCourse.value === '全部课程' ? combineCourseOptions.value[1] || '' : selectedCombineCourse.value
  combineDialogVisible.value = true
}

function openEditCombineDialog(rule: CourseCombineRule): void {
  combineDialogMode.value = 'edit'
  combineEditingId.value = rule.id
  combineDialogError.value = ''
  combineForm.campus = rule.campus
  combineForm.grade = rule.grade
  combineForm.classNames = [...rule.classNames]
  combineForm.course = rule.course
  combineDialogVisible.value = true
}

function closeCombineDialog(): void {
  combineDialogVisible.value = false
}

function submitCombineDialog(): void {
  const campus = combineForm.campus.trim()
  const grade = combineForm.grade.trim()
  const course = combineForm.course.trim()
  const classNames = combineForm.classNames.map((item) => item.trim()).filter(Boolean)

  if (!campus || !grade || !course) {
    combineDialogError.value = '请完整填写所有字段。'
    return
  }
  if (classNames.length === 0) {
    combineDialogError.value = '请至少选择一个班级。'
    return
  }

  if (combineDialogMode.value === 'create') {
    combineRules.value.unshift({
      id: `cb-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      orderNo: 1,
      campus,
      grade,
      classNames,
      course
    })
    normalizeCombineRuleOrder()
    persistRuleSettingsSections({ combineRules: combineRules.value })
    closeCombineDialog()
    notify.success('合班课规则已保存。')
    return
  }

  combineRules.value = combineRules.value.map((item) =>
    item.id === combineEditingId.value
      ? {
          ...item,
          campus,
          grade,
          classNames,
          course
        }
      : item
  )
  normalizeCombineRuleOrder()
  persistRuleSettingsSections({ combineRules: combineRules.value })
  closeCombineDialog()
  notify.success('合班课规则已保存。')
}

async function deleteCombineRule(ruleId: string): Promise<void> {
  const target = combineRules.value.find((item) => item.id === ruleId)
  if (!target) return
  try {
    await ElMessageBox.confirm(`确认删除规则「${target.grade} / ${target.classNames.join('、')}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  combineRules.value = combineRules.value.filter((item) => item.id !== ruleId)
  normalizeCombineRuleOrder()
  persistRuleSettingsSections({ combineRules: combineRules.value })
}

function addCombineRule(): void {
  openCreateCombineDialog()
}

function openCreateOddEvenDialog(): void {
  oddEvenDialogMode.value = 'create'
  oddEvenEditingId.value = ''
  oddEvenDialogError.value = ''
  oddEvenForm.campus = selectedOddEvenCampus.value === '全部校区' ? campusOptions.value[0] || '本校区' : selectedOddEvenCampus.value
  oddEvenForm.grade = selectedOddEvenGrade.value === '全部年级' ? oddEvenGradeOptions.value[1] || '' : selectedOddEvenGrade.value
  oddEvenForm.classNames = []
  oddEvenForm.oddCourse = selectedOddEvenCourse.value === '全部课程' ? oddEvenCourseOptions.value[1] || '' : selectedOddEvenCourse.value
  oddEvenForm.evenCourse = oddEvenCourseOptions.value.find((item) => item !== '全部课程' && item !== oddEvenForm.oddCourse) || ''
  oddEvenDialogVisible.value = true
}

function openEditOddEvenDialog(rule: OddEvenRule): void {
  oddEvenDialogMode.value = 'edit'
  oddEvenEditingId.value = rule.id
  oddEvenDialogError.value = ''
  oddEvenForm.campus = rule.campus
  oddEvenForm.grade = rule.grade
  oddEvenForm.classNames = [...rule.classNames]
  oddEvenForm.oddCourse = rule.oddCourse
  oddEvenForm.evenCourse = rule.evenCourse
  oddEvenDialogVisible.value = true
}

function closeOddEvenDialog(): void {
  oddEvenDialogVisible.value = false
}

function submitOddEvenDialog(): void {
  const campus = oddEvenForm.campus.trim()
  const grade = oddEvenForm.grade.trim()
  const oddCourse = oddEvenForm.oddCourse.trim()
  const evenCourse = oddEvenForm.evenCourse.trim()
  const classNames = oddEvenForm.classNames.map((item) => item.trim()).filter(Boolean)

  if (!campus || !grade || !oddCourse || !evenCourse) {
    oddEvenDialogError.value = '请完整填写所有字段。'
    return
  }

  if (classNames.length === 0) {
    oddEvenDialogError.value = '请至少填写一个班级。'
    return
  }

  if (oddCourse === evenCourse) {
    oddEvenDialogError.value = '单周课程和双周课程不能相同。'
    return
  }

  if (oddEvenDialogMode.value === 'create') {
    oddEvenRules.value.unshift({
      id: `oe-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      campus,
      grade,
      classNames,
      oddCourse,
      evenCourse
    })
    persistRuleSettingsSections({ oddEvenRules: oddEvenRules.value })
    closeOddEvenDialog()
    notify.success('单双周规则已保存。')
    return
  }

  oddEvenRules.value = oddEvenRules.value.map((item) =>
    item.id === oddEvenEditingId.value
      ? {
          ...item,
          campus,
          grade,
          classNames,
          oddCourse,
          evenCourse
        }
      : item
  )

  persistRuleSettingsSections({ oddEvenRules: oddEvenRules.value })
  closeOddEvenDialog()
  notify.success('单双周规则已保存。')
}

async function deleteOddEvenRule(ruleId: string): Promise<void> {
  const target = oddEvenRules.value.find((item) => item.id === ruleId)
  if (!target) return
  try {
    await ElMessageBox.confirm(`确认删除规则「${target.grade} / ${target.classNames.join('、')}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  oddEvenRules.value = oddEvenRules.value.filter((item) => item.id !== ruleId)
  persistRuleSettingsSections({ oddEvenRules: oddEvenRules.value })
}

async function clearOddEvenRules(): Promise<void> {
  if (oddEvenRules.value.length === 0) return
  try {
    await ElMessageBox.confirm('确认清空当前单双周规则吗？', '危险操作确认', {
      type: 'warning',
      confirmButtonText: '确认清空',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  oddEvenRules.value = []
  persistRuleSettingsSections({ oddEvenRules: oddEvenRules.value })
}

function addOddEvenRule(): void {
  openCreateOddEvenDialog()
}

const commonRuleStepIds = new Set([
  'course-main',
  'course-fixed',
  'course-combine',
  'course-odd-even',
  'course-consecutive',
  'course-slot',
  'course-relation'
])
const teacherRuleStepIds = new Set(['teacher-ban', 'teacher-hours', 'teacher-mutual'])
const advancedRuleStepIds = new Set(['course-default', 'course-weight'])
const isAdvancedRuleStep = computed(() => advancedRuleStepIds.has(activeStep.value))
const menuActiveStep = computed(() => {
  if (commonRuleStepIds.has(activeStep.value)) return 'course-common'
  if (teacherRuleStepIds.has(activeStep.value)) return 'teacher-rules'
  if (advancedRuleStepIds.has(activeStep.value)) return 'advanced'
  return activeStep.value
})

function normalizeAdminBaseSnapshot(payload: unknown): AdminBaseSnapshot {
  if (!payload || typeof payload !== 'object') {
    return {
      selectedTerm: '',
      campuses: [],
      classRecords: [],
      classHourRows: [],
      classHourClassRows: [],
      teachingAssignments: [],
      courses: [],
      teacherRecords: [],
      studentRecords: [],
      groupRecords: []
    }
  }

  const typed = payload as Partial<AdminBaseSnapshot>
  return {
    selectedTerm: String(typed.selectedTerm || '').trim(),
    campuses: Array.isArray(typed.campuses) ? typed.campuses : [],
    classRecords: Array.isArray(typed.classRecords) ? typed.classRecords : [],
    classHourRows: Array.isArray((typed as { classHourRows?: unknown[] }).classHourRows)
      ? ((typed as { classHourRows: ClassHourRow[] }).classHourRows || [])
      : [],
    classHourClassRows: Array.isArray((typed as { classHourClassRows?: unknown[] }).classHourClassRows)
      ? ((typed as { classHourClassRows: ClassHourClassRow[] }).classHourClassRows || [])
      : [],
    teachingAssignments: Array.isArray((typed as { teachingAssignments?: unknown[] }).teachingAssignments)
      ? ((typed as { teachingAssignments: AdminBaseSnapshot['teachingAssignments'] }).teachingAssignments || [])
      : [],
    courses: Array.isArray(typed.courses) ? typed.courses : [],
    teacherRecords: Array.isArray(typed.teacherRecords) ? typed.teacherRecords : [],
    studentRecords: Array.isArray(typed.studentRecords) ? typed.studentRecords : [],
    groupRecords: Array.isArray((typed as { groupRecords?: unknown[] }).groupRecords)
      ? ((typed as { groupRecords: GroupRecord[] }).groupRecords || [])
      : []
  }
}

async function loadAdminBaseOverview(): Promise<void> {
  if (adminBaseLoading.value) return
  adminBaseLoading.value = true
  try {
    const loaded = basicDataRepository.load()
    const parsed = loaded instanceof Promise ? await loaded : loaded
    adminBaseSnapshot.value = normalizeAdminBaseSnapshot(parsed)
    const firstCampus = campusOptions.value[0] ?? ''
    if (!selectedCampus.value || !campusOptions.value.includes(selectedCampus.value)) {
      selectedCampus.value = firstCampus
    }
    if (!selectedTeacherHourCampus.value || !teacherHourCampusOptions.value.includes(selectedTeacherHourCampus.value)) {
      selectedTeacherHourCampus.value = firstCampus
    }

    const availableGrades = gradeOptions.value
    const firstGrade = availableGrades[0] ?? '全部年级'
    if (selectedGrade.value !== '全部年级' && !gradeOptions.value.includes(selectedGrade.value)) {
      selectedGrade.value = '全部年级'
    }
    if (!selectedTeacherHourGrade.value || !availableGrades.includes(selectedTeacherHourGrade.value)) {
      selectedTeacherHourGrade.value = '全部年级'
    }
    if (!selectedTeacherHourSubject.value || !teacherHourSubjectOptions.value.includes(selectedTeacherHourSubject.value)) {
      selectedTeacherHourSubject.value = teacherHourSubjectOptions.value[0] ?? ''
    }

    if (!selectedConsecutiveCampus.value || !consecutiveCampusOptions.value.includes(selectedConsecutiveCampus.value)) {
      selectedConsecutiveCampus.value = firstCampus
    }
    if (!selectedConsecutiveGrade.value || !consecutiveGradeOptions.value.includes(selectedConsecutiveGrade.value)) {
      selectedConsecutiveGrade.value = consecutiveGradeOptions.value[0] ?? ''
    }
    if (!consecutiveSubjectOptions.value.includes(activeConsecutiveSubject.value)) {
      activeConsecutiveSubject.value = consecutiveSubjectOptions.value[0] ?? ''
    }

    if (!selectedAreaCampus.value || !areaCampusOptions.value.includes(selectedAreaCampus.value)) {
      selectedAreaCampus.value = areaCampusOptions.value[0] ?? ''
    }
    if (!selectedAreaGrade.value || !areaGradeOptions.value.includes(selectedAreaGrade.value)) {
      selectedAreaGrade.value = areaGradeOptions.value[0] ?? ''
    }
    if (!areaSubjectOptions.value.includes(activeAreaSubject.value)) {
      activeAreaSubject.value = areaSubjectOptions.value[0] ?? ''
    }
    ensureAreaSelectionValid()

    if (!selectedBanCampus.value || !banCampusOptions.value.includes(selectedBanCampus.value)) {
      selectedBanCampus.value = banCampusOptions.value[0] ?? ''
    }
    if (!selectedBanGrade.value || !banGradeOptions.value.includes(selectedBanGrade.value)) {
      selectedBanGrade.value = banGradeOptions.value[0] ?? ''
    }
    if (!banSubjectOptions.value.includes(activeBanSubject.value)) {
      activeBanSubject.value = banSubjectOptions.value[0] ?? ''
    }
    ensureBanSelectionValid()

    if (!selectedMainCampus.value || !mainCampusOptions.value.includes(selectedMainCampus.value)) {
      selectedMainCampus.value = mainCampusOptions.value[0] ?? ''
    }
    if (!selectedMainGrade.value || !mainGradeOptions.value.includes(selectedMainGrade.value)) {
      selectedMainGrade.value = mainGradeOptions.value[0] ?? ''
    }
    loadCurrentMainSecondarySelection()

    if (!selectedWeightCampus.value || !weightCampusOptions.value.includes(selectedWeightCampus.value)) {
      selectedWeightCampus.value = weightCampusOptions.value[0] ?? ''
    }
    if (!selectedWeightGrade.value || !weightGradeOptions.value.includes(selectedWeightGrade.value)) {
      selectedWeightGrade.value = weightGradeOptions.value[0] ?? ''
    }
    loadCurrentRuleWeightConfig()

    if (!relationCampusOptions.value.includes(selectedRelationCampus.value)) {
      selectedRelationCampus.value = '全部校区'
    }
    if (!relationGradeOptions.value.includes(selectedRelationGrade.value)) {
      selectedRelationGrade.value = '全部年级'
    }
    adminBaseLoadedAt.value = Date.now()
  } finally {
    adminBaseLoading.value = false
  }
}

async function refreshAdminBaseOverviewIfNeeded(force = false): Promise<void> {
  const elapsed = Date.now() - adminBaseLoadedAt.value
  if (!force && elapsed >= 0 && elapsed < 1000) return
  await loadAdminBaseOverview()
}

function handleWindowFocusSyncAdminBase(): void {
  void refreshAdminBaseOverviewIfNeeded()
}

watch(
  teacherHourSubjectOptions,
  (items) => {
    if (!items.includes(selectedTeacherHourSubject.value)) {
      selectedTeacherHourSubject.value = items[0] ?? ''
    }
  },
  { immediate: true }
)

watch(
  teacherBanTeacherOptions,
  (items) => {
    if (!items.some((item) => item.id === selectedTeacherId.value)) {
      selectedTeacherId.value = items[0]?.id ?? ''
    }
  },
  { immediate: true }
)

watch(
  teacherBanGroupOptions,
  (items) => {
    if (!items.some((item) => item.id === selectedGroupId.value)) {
      selectedGroupId.value = items[0]?.id ?? ''
    }
  },
  { immediate: true }
)

watch(
  teacherHourRows,
  (rows) => {
    const nextMap: Record<
      string,
      {
        maxDailyLessons: number | null
        maxConsecutiveLessons: number | null
        weekDistribution: '' | '周分散' | '周集中'
        dayDistribution: '' | '日分散' | '日集中'
      }
    > = {}
    rows.forEach((row) => {
      nextMap[row.id] = {
        maxDailyLessons: row.maxDailyLessons ?? null,
        maxConsecutiveLessons: row.maxConsecutiveLessons ?? null,
        weekDistribution: row.weekDistribution ?? '',
        dayDistribution: row.dayDistribution ?? ''
      }
    })
    teacherHourInlineEditorMap.value = nextMap
  },
  { immediate: true }
)

watch(oddEvenCampusOptions, (items) => {
  if (!items.includes(selectedOddEvenCampus.value)) {
    selectedOddEvenCampus.value = '全部校区'
  }
}, { immediate: true })

watch(oddEvenGradeOptions, (items) => {
  if (!items.includes(selectedOddEvenGrade.value)) {
    selectedOddEvenGrade.value = '全部年级'
  }
}, { immediate: true })

watch(oddEvenClassOptions, (items) => {
  if (!items.includes(selectedOddEvenClass.value)) {
    selectedOddEvenClass.value = '全部班级'
  }
}, { immediate: true })

watch(oddEvenCourseOptions, (items) => {
  if (!items.includes(selectedOddEvenCourse.value)) {
    selectedOddEvenCourse.value = '全部课程'
  }
}, { immediate: true })

watch(consecutiveCampusOptions, (items) => {
  if (!items.includes(selectedConsecutiveCampus.value)) {
    selectedConsecutiveCampus.value = items[0] ?? ''
  }
}, { immediate: true })

watch(consecutiveGradeOptions, (items) => {
  if (!items.includes(selectedConsecutiveGrade.value)) {
    selectedConsecutiveGrade.value = items[0] ?? ''
  }
}, { immediate: true })

watch(consecutiveClassOptions, (items) => {
  if (!items.includes(selectedConsecutiveClass.value)) {
    selectedConsecutiveClass.value = '全部班级'
  }
}, { immediate: true })

watch(consecutiveSubjectOptions, (items) => {
  if (!items.includes(activeConsecutiveSubject.value)) {
    activeConsecutiveSubject.value = items[0] ?? ''
  }
}, { immediate: true })

watch(
  [
    consecutiveSettingMap,
    selectedConsecutiveCampus,
    selectedConsecutiveGrade,
    selectedConsecutiveClass,
    activeConsecutiveSubject,
    selectedConsecutiveType
  ],
  loadCurrentConsecutiveDraft,
  { immediate: true }
)

watch(combineCampusOptions, (items) => {
  if (!items.includes(selectedCombineCampus.value)) {
    selectedCombineCampus.value = '全部校区'
  }
}, { immediate: true })

watch(combineGradeOptions, (items) => {
  if (!items.includes(selectedCombineGrade.value)) {
    selectedCombineGrade.value = '全部年级'
  }
}, { immediate: true })

watch(combineClassOptions, (items) => {
  if (!items.includes(selectedCombineClass.value)) {
    selectedCombineClass.value = '全部班级'
  }
}, { immediate: true })

watch(combineCourseOptions, (items) => {
  if (!items.includes(selectedCombineCourse.value)) {
    selectedCombineCourse.value = '全部课程'
  }
}, { immediate: true })

watch(areaCampusOptions, (items) => {
  if (!items.includes(selectedAreaCampus.value)) {
    selectedAreaCampus.value = items[0] ?? ''
  }
}, { immediate: true })

watch(areaGradeOptions, (items) => {
  if (!items.includes(selectedAreaGrade.value)) {
    selectedAreaGrade.value = items[0] ?? ''
  }
}, { immediate: true })

watch(areaSubjectOptions, (items) => {
  if (!items.includes(activeAreaSubject.value)) {
    activeAreaSubject.value = items[0] ?? ''
  }
}, { immediate: true })

watch(banCampusOptions, (items) => {
  if (!items.includes(selectedBanCampus.value)) {
    selectedBanCampus.value = items[0] ?? ''
  }
}, { immediate: true })

watch(banGradeOptions, (items) => {
  if (!items.includes(selectedBanGrade.value)) {
    selectedBanGrade.value = items[0] ?? ''
  }
}, { immediate: true })

watch(banSubjectOptions, (items) => {
  if (!items.includes(activeBanSubject.value)) {
    activeBanSubject.value = items[0] ?? ''
  }
}, { immediate: true })

watch(
  selectedBanClassRanges,
  (next) => {
    normalizeBanClassSelection(next)
  },
  { deep: false }
)

watch(banClassRanges, () => {
  ensureBanSelectionValid()
}, { immediate: true })

watch(
  selectedAreaClassRanges,
  (next) => {
    normalizeAreaClassSelection(next)
  },
  { deep: false }
)

watch(areaClassRanges, () => {
  ensureAreaSelectionValid()
}, { immediate: true })

watch(mainCampusOptions, (items) => {
  if (!items.includes(selectedMainCampus.value)) {
    selectedMainCampus.value = items[0] ?? ''
  }
}, { immediate: true })

watch(mainGradeOptions, (items) => {
  if (!items.includes(selectedMainGrade.value)) {
    selectedMainGrade.value = items[0] ?? ''
  }
}, { immediate: true })

watch(weightCampusOptions, (items) => {
  if (!items.includes(selectedWeightCampus.value)) {
    selectedWeightCampus.value = items[0] ?? ''
  }
}, { immediate: true })

watch(weightGradeOptions, (items) => {
  if (!items.includes(selectedWeightGrade.value)) {
    selectedWeightGrade.value = items[0] ?? ''
  }
}, { immediate: true })

watch(
  [selectedMainCampus, selectedMainGrade, mainSubjectOptions],
  () => {
    loadCurrentMainSecondarySelection()
  },
  { immediate: true }
)

watch(
  [selectedWeightCampus, selectedWeightGrade, ruleWeightConfigs],
  () => {
    loadCurrentRuleWeightConfig()
  },
  { deep: true, immediate: true }
)

watch(relationCampusOptions, (items) => {
  if (!items.includes(selectedRelationCampus.value)) {
    selectedRelationCampus.value = '全部校区'
  }
}, { immediate: true })

watch(relationGradeOptions, (items) => {
  if (!items.includes(selectedRelationGrade.value)) {
    selectedRelationGrade.value = '全部年级'
  }
}, { immediate: true })

watch(
  () => relationForm.campus,
  () => {
    const campusId = campusIdByName.value.get(relationForm.campus)
    const grades = campusId
      ? sortGradeLabels(
        adminBaseSnapshot.value.classRecords
          .filter((item) => item.campusId === campusId)
          .map((item) => item.grade)
      )
      : []
    if (!grades.includes(relationForm.grade)) {
      relationForm.grade = grades[0] || ''
    }
  },
  { immediate: true }
)

watch(
  () => oddEvenForm.campus,
  () => {
    if (!oddEvenDialogGradeOptions.value.includes(oddEvenForm.grade)) {
      oddEvenForm.grade = oddEvenDialogGradeOptions.value[0] ?? ''
    }
    oddEvenForm.classNames = oddEvenForm.classNames.filter((item) => oddEvenDialogClassOptions.value.includes(item))
  }
)

watch(
  () => oddEvenForm.grade,
  () => {
    oddEvenForm.classNames = oddEvenForm.classNames.filter((item) => oddEvenDialogClassOptions.value.includes(item))
  }
)

watch(
  () => combineForm.campus,
  () => {
    if (!combineDialogGradeOptions.value.includes(combineForm.grade)) {
      combineForm.grade = combineDialogGradeOptions.value[0] ?? ''
    }
    combineForm.classNames = combineForm.classNames.filter((item) => combineDialogClassOptions.value.includes(item))
  }
)

watch(
  () => combineForm.grade,
  () => {
    combineForm.classNames = combineForm.classNames.filter((item) => combineDialogClassOptions.value.includes(item))
  }
)

const adminCampusTotal = computed(() => adminBaseSnapshot.value.campuses.length)
const validCampusIdSet = computed(() => new Set(adminBaseSnapshot.value.campuses.map((item) => item.id)))
const adminOverviewClassRecords = computed(() => {
  const seen = new Set<string>()
  return adminBaseSnapshot.value.classRecords.filter((item) => {
    if (!validCampusIdSet.value.has(item.campusId)) return false
    const dedupeKey =
      item.id?.trim() ||
      [item.campusId, item.stage || '', item.grade || '', String(item.classNo ?? ''), item.className || ''].join('|')
    if (seen.has(dedupeKey)) return false
    seen.add(dedupeKey)
    return true
  })
})
const adminClassTotal = computed(() => adminOverviewClassRecords.value.length)
const adminTeacherTotal = computed(() => adminBaseSnapshot.value.teacherRecords.length)
const adminStudentTotal = computed(() => adminBaseSnapshot.value.studentRecords.length)
const adminHasData = computed(
  () => adminClassTotal.value > 0 || adminTeacherTotal.value > 0 || adminStudentTotal.value > 0
)

const adminCampusSummary = computed(() => {
  type CampusSummary = {
    campusId: string
    campusName: string
    schoolName: string
    classCount: number
    teacherCount: number
    studentCount: number
  }

  const byCampus = new Map<string, CampusSummary>()
  const campusMeta = new Map<string, Campus>()
  adminBaseSnapshot.value.campuses.forEach((campus, index) => {
    void index
    campusMeta.set(campus.id, campus)
    byCampus.set(campus.id, {
      campusId: campus.id,
      campusName: campus.name || '未命名校区',
      schoolName: campus.schoolName || '-',
      classCount: 0,
      teacherCount: 0,
      studentCount: 0
    })
  })

  const ensureCampus = (campusId: string): CampusSummary | null => {
    if (!campusMeta.has(campusId)) return null
    const current = byCampus.get(campusId)
    if (current) return current
    return null
  }

  adminOverviewClassRecords.value.forEach((item) => {
    const campus = ensureCampus(item.campusId)
    if (campus) campus.classCount += 1
  })
  adminBaseSnapshot.value.teacherRecords.forEach((item) => {
    const campus = ensureCampus(item.campusId)
    if (campus) campus.teacherCount += 1
  })
  adminBaseSnapshot.value.studentRecords.forEach((item) => {
    const campus = ensureCampus(item.campusId)
    if (campus) campus.studentCount += 1
  })

  return adminBaseSnapshot.value.campuses
    .map((campus) => byCampus.get(campus.id))
    .filter(
      (item): item is CampusSummary =>
        Boolean(item) && (item.classCount > 0 || item.teacherCount > 0 || item.studentCount > 0)
    )
})

const adminStageSummary = computed(() => {
  const stageClassCount: Record<'小学' | '初中', number> = { 小学: 0, 初中: 0 }
  const stageStudentCount: Record<'小学' | '初中', number> = { 小学: 0, 初中: 0 }

  const classStageById = new Map<string, '小学' | '初中'>()
  adminOverviewClassRecords.value.forEach((item) => {
    classStageById.set(item.id, item.stage)
    stageClassCount[item.stage] += 1
  })

  adminBaseSnapshot.value.studentRecords.forEach((item) => {
    const stage = classStageById.get(item.classId)
    if (stage) {
      stageStudentCount[stage] += 1
    }
  })

  return (['小学', '初中'] as const)
    .map((stage) => ({
      stage,
      classCount: stageClassCount[stage],
      studentCount: stageStudentCount[stage]
    }))
    .filter((item) => item.classCount > 0 || item.studentCount > 0)
})

onMounted(() => {
  window.addEventListener('click', handleCloseFixedPointContextMenu)
  window.addEventListener('scroll', handleCloseFixedPointContextMenu, true)
  window.addEventListener('focus', handleWindowFocusSyncAdminBase)
  void (async () => {
    try {
      await refreshAdminBaseOverviewIfNeeded(true)
      const latestSnapshot = await hydrateRuleSettingsSnapshotFromApi(adminBaseSnapshot.value.selectedTerm)
      applyRuleSettingsSnapshot(latestSnapshot)
    } finally {
      rulesReady.value = true
    }
  })()
})

onActivated(() => {
  void refreshAdminBaseOverviewIfNeeded()
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleCloseFixedPointContextMenu)
  window.removeEventListener('scroll', handleCloseFixedPointContextMenu, true)
  window.removeEventListener('focus', handleWindowFocusSyncAdminBase)
})

const selectedCommonRule = computed(
  () => commonRuleCards.find((item) => item.id === selectedCommonRuleId.value) ?? commonRuleCards[0]
)
const selectedTeacherRule = computed(
  () => teacherRuleCards.find((item) => item.id === selectedTeacherRuleId.value) ?? teacherRuleCards[0]
)

const commonRuleOpenedTabs = ref<CommonRuleTab[]>([{ id: 'course-common', title: '课程规则', closable: false }])
const activeCommonRuleTab = ref('course-common')
const hasExtraCommonRuleTabs = computed(() => commonRuleOpenedTabs.value.length > 1)
const showCommonRuleTabs = computed(
  () =>
    (activeStep.value === 'course-common' || commonRuleStepIds.has(activeStep.value)) &&
    (hasExtraCommonRuleTabs.value || activeCommonRuleTab.value !== 'course-common')
)

function normalizeCommonRuleTabClosability(): void {
  const onlyOneTab = commonRuleOpenedTabs.value.length === 1
  commonRuleOpenedTabs.value = commonRuleOpenedTabs.value.map((item) => ({
    ...item,
    closable: onlyOneTab ? false : item.id !== 'course-common'
  }))
}

function ensureCourseCommonTab(): void {
  if (!commonRuleOpenedTabs.value.some((item) => item.id === 'course-common')) {
    commonRuleOpenedTabs.value.unshift({ id: 'course-common', title: '课程规则', closable: false })
  }
  normalizeCommonRuleTabClosability()
}

function syncCommonRuleStep(stepId: string): void {
  if (!commonRuleStepIds.has(stepId)) return
  const card = commonRuleCards.find((item) => item.id === stepId)
  if (!card) return
  selectedCommonRuleId.value = stepId
  if (!commonRuleOpenedTabs.value.some((item) => item.id === stepId)) {
    commonRuleOpenedTabs.value.push({ id: stepId, title: card.title, closable: true })
    normalizeCommonRuleTabClosability()
  }
}

function openCommonRuleTab(ruleId: string): void {
  syncCommonRuleStep(ruleId)
  activeCommonRuleTab.value = ruleId
  activeStep.value = ruleId
}

function switchCommonRuleTab(tabId: string): void {
  if (tabId === 'course-common') {
    ensureCourseCommonTab()
    activeCommonRuleTab.value = 'course-common'
    activeStep.value = 'course-common'
    return
  }
  if (!commonRuleStepIds.has(tabId)) return
  syncCommonRuleStep(tabId)
  activeCommonRuleTab.value = tabId
  activeStep.value = tabId
}

function removeCommonRuleTab(tabId: string): void {
  if (tabId === 'course-common') return
  const index = commonRuleOpenedTabs.value.findIndex((item) => item.id === tabId)
  if (index < 0) return
  commonRuleOpenedTabs.value.splice(index, 1)
  normalizeCommonRuleTabClosability()
  if (activeCommonRuleTab.value === tabId) {
    const fallback = commonRuleOpenedTabs.value[Math.max(index - 1, 0)]?.id ?? 'course-common'
    switchCommonRuleTab(fallback)
  }
}

function keepOnlyCurrentCommonRuleTab(): void {
  const current =
    commonRuleOpenedTabs.value.find((item) => item.id === activeCommonRuleTab.value) ??
    commonRuleOpenedTabs.value[0]
  if (!current) return
  commonRuleOpenedTabs.value = [{ ...current, closable: false }]
  activeCommonRuleTab.value = current.id
  activeStep.value = current.id
}

function selectCommonRule(ruleId: string) {
  selectedCommonRuleId.value = ruleId
}

function selectTeacherRule(ruleId: string): void {
  selectedTeacherRuleId.value = ruleId
}

function openTeacherRulePage(ruleId: string): void {
  selectedTeacherRuleId.value = ruleId
  activeStep.value = ruleId
}

function openRuleSection(stepId: string): void {
  if (stepId === 'course-common') {
    switchCommonRuleTab('course-common')
    return
  }
  if (stepId === 'advanced') {
    if (!advancedRuleStepIds.has(activeStep.value)) {
      activeStep.value = 'course-default'
    }
    return
  }
  activeStep.value = stepId
}

function openAdvancedRuleStep(stepId: string): void {
  if (!advancedRuleStepIds.has(stepId)) return
  activeStep.value = stepId
}

watch(
  () => activeStep.value,
  (stepId, prevStepId) => {
    if (stepId === 'course-area' || stepId === 'course-ban') {
      courseSlotMode.value = stepId === 'course-ban' ? 'ban' : 'area'
      activeStep.value = 'course-slot'
      return
    }
    if (stepId === 'course-common') {
      ensureCourseCommonTab()
      activeCommonRuleTab.value = 'course-common'
      return
    }
    if (stepId === 'admin-base' && prevStepId !== 'admin-base') {
      void refreshAdminBaseOverviewIfNeeded()
    }
    if (commonRuleStepIds.has(stepId)) {
      syncCommonRuleStep(stepId)
      activeCommonRuleTab.value = stepId
    }
    if (teacherRuleStepIds.has(stepId)) {
      selectedTeacherRuleId.value = stepId
    }
  },
  { immediate: true }
)
</script>

<template>
  <AppContentSkeleton v-if="!rulesReady" variant="form" />
  <article v-else class="panel rule-settings-page">
    <header class="rule-module-head">
      <div>
        <h1>排课规则</h1>
        <p>统一管理课程规则、教师规则和高级设置。</p>
      </div>
    </header>

    <nav class="rule-primary-nav" aria-label="排课规则分类">
      <el-menu
        :default-active="menuActiveStep"
        mode="horizontal"
        class="rule-primary-menu"
        @select="openRuleSection"
      >
        <el-menu-item
          v-for="step in steps"
          :key="step.id"
          :index="step.id"
        >
          {{ step.label }}
        </el-menu-item>
      </el-menu>
    </nav>

    <section class="rule-content">
      <section v-if="isAdvancedRuleStep" class="advanced-settings-nav" aria-label="高级设置分类">
        <div class="advanced-settings-intro">
          <strong>高级设置</strong>
          <span>默认规则和权重会直接影响智能排课结果，建议仅由管理员统一维护。</span>
        </div>
        <div class="advanced-settings-tabs" role="tablist" aria-label="高级设置选项">
          <button
            type="button"
            role="tab"
            :aria-selected="activeStep === 'course-default'"
            :class="['el-advanced-settings-tab', 'advanced-settings-tab', { active: activeStep === 'course-default' }]"
            @click="openAdvancedRuleStep('course-default')"
          >
            默认规则
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeStep === 'course-weight'"
            :class="['el-advanced-settings-tab', 'advanced-settings-tab', { active: activeStep === 'course-weight' }]"
            @click="openAdvancedRuleStep('course-weight')"
          >
            权重分配
          </button>
        </div>
      </section>

      <div v-if="showCommonRuleTabs" class="common-rule-tabs-wrap">
        <el-tabs
          :model-value="activeCommonRuleTab"
          class="common-rule-tabs"
          @tab-click="(tab) => switchCommonRuleTab(String(tab.paneName || 'course-common'))"
          @tab-remove="(name) => removeCommonRuleTab(String(name || ''))"
        >
          <el-tab-pane
            v-for="item in commonRuleOpenedTabs"
            :key="`common-tab-${item.id}`"
            :name="item.id"
            :label="item.title"
            :closable="item.closable"
          />
        </el-tabs>
        <div class="common-rule-tabs-actions">
          <el-button
            v-if="hasExtraCommonRuleTabs"
            size="small"
            type="primary"
            plain
            @click="keepOnlyCurrentCommonRuleTab"
          >
            关闭其他
          </el-button>
        </div>
      </div>

      <template v-if="activeStep === 'course-common'">
        <header class="rule-head">
          <div>
            <h1>课程规则</h1>
            <p>配置课程维度的排课限制、组合关系与时段策略。</p>
          </div>
        </header>

        <section class="rule-section rule-overview-page">
          <div class="rule-directory-layout">
            <nav class="rule-directory-list" aria-label="课程规则目录">
              <button
              v-for="item in commonRuleCards"
              :key="`rc-${item.id}`"
              type="button"
              :class="['rule-directory-item', { active: selectedCommonRuleId === item.id }]"
              @click="selectCommonRule(item.id)"
              >
                <span class="rule-directory-title">{{ item.title }}</span>
                <span class="rule-directory-desc">{{ item.desc }}</span>
              </button>
            </nav>

            <el-card shadow="never" class="rule-guide-card">
              <div class="rule-guide-head">
                <div>
                  <h3>{{ selectedCommonRule.title }}</h3>
                  <p class="rule-guide-desc">{{ selectedCommonRule.desc }}</p>
                </div>
                <el-button type="primary" @click="openCommonRuleTab(selectedCommonRule.id)">进入设置</el-button>
              </div>
              <div class="rule-guide-list">
                <p v-for="(item, index) in selectedCommonRule.usage" :key="`guide-${selectedCommonRule.id}-${index}`">
                  <span>{{ index + 1 }}</span>{{ item }}
                </p>
              </div>
            </el-card>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'teacher-rules'">
        <header class="rule-head">
          <div>
            <h1>教师规则</h1>
            <p>教师规则用于配置教师维度的禁排、课时与互斥策略。</p>
          </div>
        </header>

        <section class="rule-section rule-overview-page">
          <div class="rule-directory-layout rule-directory-layout-teacher">
            <nav class="rule-directory-list" aria-label="教师规则目录">
              <button
                v-for="item in teacherRuleCards"
                :key="`rt-${item.id}`"
                type="button"
                :class="['rule-directory-item', { active: selectedTeacherRuleId === item.id }]"
                @click="selectTeacherRule(item.id)"
              >
                <span class="rule-directory-title">{{ item.title }}</span>
                <span class="rule-directory-desc">{{ item.desc }}</span>
              </button>
            </nav>

            <el-card shadow="never" class="rule-guide-card">
              <div class="rule-guide-head">
                <div>
                  <h3>{{ selectedTeacherRule.title }}</h3>
                  <p class="rule-guide-desc">{{ selectedTeacherRule.desc }}</p>
                </div>
                <el-button type="primary" @click="openTeacherRulePage(selectedTeacherRule.id)">进入设置</el-button>
              </div>
              <div class="rule-guide-list">
                <p v-for="(item, index) in selectedTeacherRule.usage" :key="`guide-${selectedTeacherRule.id}-${index}`">
                  <span>{{ index + 1 }}</span>{{ item }}
                </p>
              </div>
            </el-card>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-main'">
        <header class="rule-head">
          <div>
            <h1>主副科</h1>
            <p>根据当前校区与年级基础数据，设置学科为主科或副科。</p>
          </div>
          <div class="rule-head-actions">
            <el-button
              size="small"
              :disabled="checkedMainSubjects.length === 0"
              @click="clearCurrentMainSecondary"
            >
              清空勾选
            </el-button>
            <el-button type="primary" size="small" @click="saveCurrentMainSecondary">保存</el-button>
          </div>
        </header>

        <section class="rule-section course-main-page">
          <div class="fixed-filters">
            <el-select v-model="selectedMainCampus" class="rule-filter-select" placeholder="选择校区">
              <el-option v-for="item in mainCampusOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedMainGrade" class="rule-filter-select" placeholder="选择年级">
              <el-option v-for="item in mainGradeOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </div>

          <div class="course-main-transfer-wrap">
            <el-transfer
              v-model="selectedMainSubjects"
              :data="mainTransferData"
              filterable
              :titles="['副科', '主科']"
              :button-texts="['移到副科', '移到主科']"
              :props="{ key: 'key', label: 'label' }"
              @right-check-change="handleMainSubjectsCheckedChange"
            />
          </div>

          <div class="course-main-summary">
            <div class="course-main-summary-item">
              <span class="label">主科：</span>
              <el-tag
                v-for="item in selectedMainSubjects"
                :key="`m-${item}`"
                type="primary"
                effect="light"
                class="summary-tag"
              >
                {{ item }}
              </el-tag>
              <span v-if="selectedMainSubjects.length === 0" class="empty">未设置</span>
            </div>
            <div class="course-main-summary-item">
              <span class="label">副科：</span>
              <el-tag
                v-for="item in currentSecondarySubjects"
                :key="`s-${item}`"
                type="info"
                effect="plain"
                class="summary-tag"
              >
                {{ item }}
              </el-tag>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-default'">
        <header class="rule-head">
          <div>
            <h1>默认规则管理</h1>
            <p>规则介绍：管理课程规则的默认行为，减少重复配置。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="resetCourseDefaultConfig">恢复默认</el-button>
            <el-button type="primary" size="small" @click="saveCourseDefaultConfig">保存</el-button>
          </div>
        </header>

        <section class="rule-section course-default-page">
          <el-card shadow="never" class="course-default-card">
            <div class="course-default-head">
              <h3>默认规则</h3>
              <div class="course-default-master-switch">
                <span>规则总开关</span>
                <el-switch v-model="courseDefaultConfig.enabled" />
              </div>
            </div>
            <div class="course-default-grid">
              <div class="grid-head">规则描述</div>
              <div class="grid-head">主科要求</div>
              <div class="grid-head">副科要求</div>
              <div class="grid-head grid-head-toggle">规则启用</div>

              <template v-for="item in courseDefaultRows" :key="`d-${item.key}`">
                <div class="grid-label">{{ item.label }}</div>
                <div class="grid-cell">
                  <el-select
                    v-model="courseDefaultConfig.rules[item.key].main"
                    :disabled="!courseDefaultConfig.enabled || !courseDefaultConfig.ruleEnabled[item.key]"
                  >
                    <el-option v-for="op in item.options" :key="`m-${item.key}-${op}`" :label="op" :value="op" />
                  </el-select>
                </div>
                <div class="grid-cell">
                  <el-select
                    v-model="courseDefaultConfig.rules[item.key].secondary"
                    :disabled="!courseDefaultConfig.enabled || !courseDefaultConfig.ruleEnabled[item.key]"
                  >
                    <el-option v-for="op in item.options" :key="`s-${item.key}-${op}`" :label="op" :value="op" />
                  </el-select>
                </div>
                <div class="grid-cell-toggle">
                  <el-switch
                    class="course-default-row-switch"
                    v-model="courseDefaultConfig.ruleEnabled[item.key]"
                    :disabled="!courseDefaultConfig.enabled"
                  />
                </div>
              </template>
            </div>
          </el-card>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-weight'">
        <header class="rule-head">
          <div>
            <h1>规则权重分配</h1>
            <p>规则介绍：硬约束必须全部满足；评分权重用于决定可行课表之间的优化侧重点。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="resetRuleWeightConfig">恢复默认</el-button>
            <el-button type="primary" size="small" @click="saveRuleWeightConfig">保存</el-button>
          </div>
        </header>

        <section class="rule-section rule-weight-page">
          <div class="fixed-filters">
            <el-select v-model="selectedWeightCampus" class="rule-filter-select" placeholder="选择校区">
              <el-option v-for="item in weightCampusOptions" :key="`wc-${item}`" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedWeightGrade" class="rule-filter-select" placeholder="选择年级">
              <el-option v-for="item in weightGradeOptions" :key="`wg-${item}`" :label="item" :value="item" />
            </el-select>
            <el-tag type="info" effect="plain">当前配置：{{ selectedWeightCampus || '--' }} / {{ selectedWeightGrade || '--' }}</el-tag>
          </div>

          <div class="rule-weight-switches">
            <div class="rule-weight-switch-item">
              <span class="label">启用权重分配</span>
              <el-switch v-model="ruleWeightConfig.enabled" />
            </div>
            <div class="rule-weight-switch-item">
              <span class="label">评分权重归一化(100)</span>
              <el-switch v-model="ruleWeightConfig.autoNormalize" :disabled="!ruleWeightConfig.enabled" />
            </div>
          </div>

          <el-row :gutter="12">
            <el-col :xs="24" :lg="12">
              <el-card shadow="never" class="rule-weight-card">
                <template #header>
                  <div class="rule-weight-card-head hard">
                    <span>硬约束分组（全部必须满足）</span>
                    <el-tag type="danger" effect="light" size="small">必须满足</el-tag>
                  </div>
                </template>
                <div class="rule-weight-hard-transfer">
                  <div v-for="bucket in hardRuleBuckets" :key="`bucket-${bucket.level}`" class="rule-weight-hard-column">
                    <div class="rule-weight-hard-column-head">{{ bucket.label }}</div>
                    <div class="rule-weight-hard-column-body">
                      <div
                        v-for="item in bucket.items"
                        :key="`hard-${item.key}`"
                        :class="['rule-weight-hard-item', { disabled: !item.enabled }]"
                      >
                        <div class="rule-weight-hard-item-title">{{ item.label }}</div>
                        <div class="rule-weight-hard-item-desc">{{ item.desc }}</div>
                        <div class="rule-weight-hard-item-actions">
                          <el-tag v-if="hardRuleLocked(item.key)" type="info" effect="plain" size="small">系统必选</el-tag>
                          <span v-else class="rule-weight-hard-state">{{ item.enabled ? '已启用' : '已停用' }}</span>
                          <el-switch
                            :model-value="item.enabled"
                            :disabled="!ruleWeightConfig.enabled || hardRuleLocked(item.key)"
                            @update:model-value="setHardRuleEnabled(item.key, Boolean($event))"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </el-card>
            </el-col>

            <el-col :xs="24" :lg="12">
              <el-card shadow="never" class="rule-weight-card">
                <template #header>
                  <div class="rule-weight-card-head">优化目标权重（总计 100）</div>
                </template>
                <el-table :data="softRuleRows" border class="admin-element-table">
                  <el-table-column prop="label" label="规则" min-width="120" />
                  <el-table-column prop="desc" label="说明" min-width="220" />
                  <el-table-column label="启用" width="90" align="center">
                    <template #default="{ row }">
                      <el-switch
                        :model-value="row.enabled"
                        :disabled="!ruleWeightConfig.enabled"
                        @update:model-value="setSoftRuleEnabled(row.key, Boolean($event))"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="权重" width="132" align="center" class-name="rule-weight-value-col">
                    <template #default="{ row }">
                      <el-input-number
                        class="rule-weight-soft-input"
                        :model-value="row.weight"
                        :min="0"
                        :max="100"
                        controls-position="right"
                        :disabled="!ruleWeightConfig.enabled || !row.enabled"
                        @update:model-value="setSoftRuleWeight(row.key, Number($event ?? 0))"
                      />
                    </template>
                  </el-table-column>
                </el-table>
                <div class="rule-weight-feature-head">
                  <strong>规则功能开关</strong>
                  <span>控制规则是否参与建模，不计入 100 分。</span>
                </div>
                <el-table :data="featureRuleRows" border class="admin-element-table rule-weight-feature-table">
                  <el-table-column prop="label" label="规则" min-width="120" />
                  <el-table-column prop="desc" label="说明" min-width="240" />
                  <el-table-column label="状态" width="110" align="center">
                    <template #default="{ row }">
                      <el-tag v-if="!row.available" type="info" effect="plain">暂未接入</el-tag>
                      <el-switch
                        v-else
                        :model-value="row.enabled"
                        :disabled="!ruleWeightConfig.enabled"
                        @update:model-value="setFeatureRuleEnabled(row.key, Boolean($event))"
                      />
                    </template>
                  </el-table-column>
                </el-table>
              </el-card>
            </el-col>
          </el-row>

          <div class="rule-weight-summary">
            <el-tag type="info" effect="plain">已启用评分目标：{{ enabledSoftRuleCount }} 项</el-tag>
            <el-tag
              :type="enabledSoftWeightTotal === 100 ? 'success' : 'warning'"
              effect="light"
            >
              当前评分总权重：{{ enabledSoftWeightTotal }}
            </el-tag>
            <span class="rule-weight-tip">
              {{
                ruleWeightConfig.autoNormalize
                  ? '保存时仅对三个评分目标归一化到 100。'
                  : '当前为手动权重模式，三个评分目标建议合计 100。'
              }}
            </span>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-fixed'">
        <header class="rule-head">
          <div>
            <h1>全局固定点</h1>
            <p>规则介绍：可设置固定节次且无教师安排的课程，例如，班会、社团、扫除、自习、选修等。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" :disabled="!hasFixedPointTimetable || fixedPointSelectedSlots.length === 0" @click="setSelectedFixedPoints">
              设置选中格
            </el-button>
            <el-button size="small" :disabled="!hasFixedPointTimetable" @click="clearFixedPoints">清空</el-button>
            <el-button type="primary" size="small" :disabled="!hasFixedPointTimetable" @click="saveFixedPoints">保存</el-button>
          </div>
        </header>

        <section class="rule-section fixed-point-page">
          <div class="fixed-filters">
            <el-select v-model="selectedCampus" class="rule-filter-select">
              <el-option v-for="campus in campusOptions" :key="campus" :label="campus" :value="campus" />
            </el-select>
            <div class="fixed-grade-checks">
              <el-checkbox
                v-for="grade in gradeOptions"
                :key="`fixed-grade-${grade}`"
                :model-value="selectedGrade === grade"
                @update:model-value="(checked:boolean) => onFixedGradeCheckChange(grade, checked)"
              >
                {{ grade }}
              </el-checkbox>
            </div>
          </div>

          <template v-if="hasFixedPointTimetable">
            <p class="fixed-hint">拖拽或 Shift+单击可框选多个格子，点击“设置选中格”可一次输入并应用到全部选区；右键也可设置或删除。</p>

            <div class="fixed-table-wrap" @mouseup="onFixedCellMouseUp" @mouseleave="onFixedCellMouseUp">
              <table class="fixed-table">
                <thead>
                  <tr>
                    <th>节次/周</th>
                    <th v-for="day in fixedPointDays" :key="day">{{ day }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="period in fixedPointPeriods" :key="period">
                    <td>{{ period }}</td>
                    <td
                      v-for="day in fixedPointDays"
                      :key="`${period}-${day}`"
                      :class="['fixed-cell', { 'is-selected': isFixedCellSelected(period, day) }]"
                      @mousedown.prevent="onFixedCellMouseDown($event, period, day)"
                      @mouseenter="onFixedCellMouseEnter(period, day)"
                      @dblclick="setCellValue(period, day)"
                      @contextmenu.prevent="onFixedCellContextMenu($event, period, day)"
                    >
                      {{ cellValue(period, day) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <div v-else class="fixed-empty-state">
            请先在“基础数据”中完成班级课时设置，再配置全局固定点。
          </div>

          <div
            v-if="fixedPointContextMenu.visible"
            class="fixed-context-menu"
            :style="{ left: `${fixedPointContextMenu.x}px`, top: `${fixedPointContextMenu.y}px` }"
            @click.stop
          >
            <el-button text class="fixed-context-item" @click="onFixedContextSet">设置</el-button>
            <el-button text class="fixed-context-item danger" @click="onFixedContextDelete">删除</el-button>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-slot' && courseSlotMode === 'ban'">
        <header class="rule-head">
          <div>
            <div class="course-slot-title-row">
              <h1>课程时段设置</h1>
              <el-radio-group v-model="courseSlotMode" class="course-slot-mode is-ban-mode">
                <el-radio-button value="area">允许排课</el-radio-button>
                <el-radio-button value="ban">禁止排课</el-radio-button>
              </el-radio-group>
            </div>
            <p>当前状态：禁止排课。排课引擎不会将课程安排在标记的节次。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearCurrentBanRule">清空</el-button>
            <el-button type="primary" size="small" @click="saveCurrentBanRule">保存</el-button>
          </div>
        </header>

        <section class="rule-section course-ban-page">
          <div class="course-slot-filter-row">
            <label class="course-slot-filter-item">
              <span class="consecutive-field-label">校区</span>
              <el-select v-model="selectedBanCampus" class="rule-filter-select" placeholder="选择校区">
                <el-option v-for="item in banCampusOptions" :key="`ban-campus-${item}`" :label="item" :value="item" />
              </el-select>
            </label>
            <label class="course-slot-filter-item">
              <span class="consecutive-field-label">年级</span>
              <el-select v-model="selectedBanGrade" class="rule-filter-select" placeholder="选择年级">
                <el-option v-for="item in banGradeOptions" :key="`ban-grade-${item}`" :label="item" :value="item" />
              </el-select>
            </label>
            <label class="course-slot-filter-item">
              <span class="consecutive-field-label">班级</span>
              <el-select v-model="selectedBanClassFilter" class="rule-filter-select" placeholder="选择班级">
                <el-option label="全部班级" value="全部班级" />
                <el-option v-for="item in banClassRanges" :key="`ban-filter-${item.id}`" :label="item.label" :value="item.id" />
              </el-select>
            </label>
            <label class="course-slot-course-filter">
              <span class="consecutive-field-label">课程</span>
              <el-select
                v-model="activeBanSubject"
                filterable
                placeholder="输入课程名称搜索"
              >
                <el-option
                  v-for="subject in banSubjectOptions"
                  :key="`ban-subject-${subject}`"
                  :label="subject"
                  :value="subject"
                >
                  <span>{{ subject }}</span>
                  <span v-if="subjectHasBan(subject)" class="configured-dot" title="已设置禁排"></span>
                </el-option>
              </el-select>
            </label>
            <el-button
              v-if="selectedBanClassFilter === '全部班级'"
              link
              type="primary"
              class="course-slot-apply-all"
              :disabled="!selectedBanTemplateClass"
              @click="applyBanRuleToAllClasses"
            >
              同步所有班级
            </el-button>
          </div>

          <p class="course-area-meta-tip">当前读取基础数据：每周上课 {{ banDaysCount }} 天，日排课节次 {{ banLessonCount }} 节。</p>

          <div class="course-ban-wrap">
            <div v-if="visibleBanClasses.length > 0" class="course-ban-grid-row">
              <div
                v-for="classItem in visibleBanClasses"
                :key="`ban-class-${classItem.id}`"
                class="course-ban-class-card"
              >
                <div class="course-area-class-title">{{ classItem.className }}</div>
                <div class="course-area-head-days" :style="{ gridTemplateColumns: `18px repeat(${banDays.length}, 1fr)` }">
                  <span class="course-area-head-spacer"></span>
                  <span v-for="day in banDays" :key="`ban-head-${classItem.id}-${day}`">{{ day.replace('周', '') }}</span>
                </div>
                <div class="course-area-cells" :style="{ gridTemplateColumns: `18px repeat(${banDays.length}, 1fr)` }">
                  <template v-for="period in banPeriods" :key="`ban-p-${classItem.id}-${period}`">
                    <span class="course-area-period-no">{{ period }}</span>
                    <button
                      v-for="day in banDays"
                      :key="`ban-cell-${classItem.id}-${period}-${day}`"
                      type="button"
                      :class="['course-ban-cell', { active: classBanCellEnabled(classItem.className, period, day) }]"
                      @click="toggleClassBanCell(classItem.className, period, day)"
                    ></button>
                  </template>
                </div>
              </div>
            </div>
            <div v-else class="course-area-empty">当前校区和年级下暂无班级数据。</div>

          </div>

          <section class="course-slot-management-section">
            <div class="course-slot-management-heading">
              <h3>禁止排课规则</h3>
              <p>当前筛选下共 {{ configuredCourseBanRows.length }} 条规则，包含 {{ configuredCourseBanSlotTotal }} 个禁排节次。</p>
            </div>
            <el-table
              :data="configuredCourseBanRows"
              border
              size="small"
              class="admin-element-table course-slot-management-table"
              empty-text="当前筛选下暂无禁止排课设置"
            >
              <el-table-column prop="campus" label="校区" min-width="120" />
              <el-table-column prop="grade" label="年级" min-width="100" />
              <el-table-column prop="className" label="班级" min-width="100" />
              <el-table-column prop="subject" label="课程" min-width="140" />
              <el-table-column label="禁排节次" min-width="320" show-overflow-tooltip>
                <template #default="{ row }">{{ formatCourseSlots(row.bannedSlots) }}</template>
              </el-table-column>
              <el-table-column label="节次数" width="100" align="center">
                <template #default="{ row }">{{ row.bannedSlots.length }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" @click="deleteCourseBanRule(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-slot' && courseSlotMode === 'area'">
        <header class="rule-head">
          <div>
            <div class="course-slot-title-row">
              <h1>课程时段设置</h1>
              <el-radio-group v-model="courseSlotMode" class="course-slot-mode">
                <el-radio-button value="area">允许排课</el-radio-button>
                <el-radio-button value="ban">禁止排课</el-radio-button>
              </el-radio-group>
            </div>
            <p>当前状态：允许排课。勾选的节次是该课程允许排课的范围。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearCurrentAreaRule">清空</el-button>
            <el-button type="primary" size="small" @click="saveCurrentAreaRule">保存</el-button>
          </div>
        </header>

        <section class="rule-section course-area-page">
          <div class="course-slot-filter-row">
            <label class="course-slot-filter-item">
              <span class="consecutive-field-label">校区</span>
              <el-select v-model="selectedAreaCampus" class="rule-filter-select" placeholder="选择校区">
                <el-option v-for="item in areaCampusOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </label>
            <label class="course-slot-filter-item">
              <span class="consecutive-field-label">年级</span>
              <el-select v-model="selectedAreaGrade" class="rule-filter-select" placeholder="选择年级">
                <el-option v-for="item in areaGradeOptions" :key="item" :label="item" :value="item" />
              </el-select>
            </label>
            <label class="course-slot-filter-item">
              <span class="consecutive-field-label">班级</span>
              <el-select v-model="selectedAreaClassFilter" class="rule-filter-select" placeholder="选择班级">
                <el-option label="全部班级" value="全部班级" />
                <el-option v-for="item in areaClassRanges" :key="`area-filter-${item.id}`" :label="item.label" :value="item.id" />
              </el-select>
            </label>
            <label class="course-slot-course-filter">
              <span class="consecutive-field-label">课程</span>
              <el-select
                v-model="activeAreaSubject"
                filterable
                placeholder="输入课程名称搜索"
              >
                <el-option
                  v-for="subject in areaSubjectOptions"
                  :key="`a-${subject}`"
                  :label="subject"
                  :value="subject"
                />
              </el-select>
            </label>
            <el-button
              v-if="selectedAreaClassFilter === '全部班级'"
              link
              type="primary"
              class="course-slot-apply-all"
              :disabled="!selectedAreaTemplateClass"
              @click="applyAreaRuleToAllClasses"
            >
              同步所有班级
            </el-button>
          </div>

          <p class="course-area-meta-tip">当前读取基础数据：每周上课 {{ areaDaysCount }} 天，日排课节次 {{ areaLessonCount }} 节。</p>

          <div class="course-area-wrap">
            <div v-if="visibleAreaClasses.length > 0" class="course-area-grid-row">
              <div
                v-for="classItem in visibleAreaClasses"
                :key="`area-${classItem.id}`"
                class="course-area-class-card"
              >
                <div class="course-area-class-title">{{ classItem.className }}</div>
                <div
                  class="course-area-head-days"
                  :style="{ gridTemplateColumns: `18px repeat(${areaDays.length}, 1fr)` }"
                >
                  <span class="course-area-head-spacer"></span>
                  <span v-for="day in areaDays" :key="`head-${classItem.id}-${day}`">{{ day.replace('周', '') }}</span>
                </div>
                <div
                  class="course-area-cells"
                  :style="{ gridTemplateColumns: `18px repeat(${areaDays.length}, 1fr)` }"
                >
                  <template v-for="period in areaPeriods" :key="`p-${classItem.id}-${period}`">
                    <span class="course-area-period-no">{{ period }}</span>
                    <button
                      v-for="day in areaDays"
                      :key="`cell-${classItem.id}-${period}-${day}`"
                      type="button"
                      :class="['course-area-cell', { active: classAreaCellEnabled(classItem.className, period, day) }]"
                      @click="toggleClassAreaCell(classItem.className, period, day)"
                    />
                  </template>
                </div>
              </div>
            </div>
            <div v-else class="course-area-empty">当前校区和年级下暂无班级数据。</div>

          </div>

          <section class="course-slot-management-section">
            <div class="course-slot-management-heading">
              <h3>允许排课规则</h3>
              <p>当前筛选下共 {{ configuredCourseAreaRows.length }} 条规则，包含 {{ configuredCourseAreaSlotTotal }} 个允许节次。</p>
            </div>
            <el-table
              :data="configuredCourseAreaRows"
              border
              size="small"
              class="admin-element-table course-slot-management-table"
              empty-text="当前筛选下暂无允许排课设置"
            >
              <el-table-column prop="campus" label="校区" min-width="120" />
              <el-table-column prop="grade" label="年级" min-width="100" />
              <el-table-column prop="className" label="班级" min-width="100" />
              <el-table-column prop="subject" label="课程" min-width="140" />
              <el-table-column label="允许节次" min-width="320" show-overflow-tooltip>
                <template #default="{ row }">{{ formatCourseSlots(row.allowedSlots) }}</template>
              </el-table-column>
              <el-table-column label="节次数" width="100" align="center">
                <template #default="{ row }">{{ row.allowedSlots.length }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" @click="deleteCourseAreaRule(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-relation'">
        <header class="rule-head">
          <div>
            <h1>课程关系</h1>
            <p>规则介绍：前后互斥指两个课程不能被安排在相邻节次。同天互斥指所选课程不能被安排在同一天。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearRelationRules">清空草稿</el-button>
            <el-button type="primary" size="small" @click="openCreateRelationDialog">添加</el-button>
            <el-button type="primary" size="small" @click="saveRelationRules">保存</el-button>
          </div>
        </header>

        <section class="rule-section course-relation-page">
          <div class="fixed-filters">
            <el-select v-model="selectedRelationCampus" class="rule-filter-select">
              <el-option v-for="item in relationCampusOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedRelationGrade" class="rule-filter-select">
              <el-option v-for="item in relationGradeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedRelationType" class="rule-filter-select">
              <el-option v-for="item in relationTypeOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </div>

          <div class="fixed-table-wrap">
            <table class="fixed-table">
              <thead>
                <tr>
                  <th>校区</th>
                  <th>年级</th>
                  <th>课程A</th>
                  <th>课程B</th>
                  <th>关系类型</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredCourseRelationRules.length === 0">
                  <td colspan="6">暂无课程关系规则</td>
                </tr>
                <tr v-for="rule in filteredCourseRelationRules" :key="rule.id">
                  <td>{{ rule.campus }}</td>
                  <td>{{ rule.grade }}</td>
                  <td>{{ rule.courseA }}</td>
                  <td>{{ rule.courseB }}</td>
                  <td>
                    <el-tag :type="rule.relationType === '前后互斥' ? 'warning' : 'danger'" effect="light">
                      {{ rule.relationType }}
                    </el-tag>
                  </td>
                  <td class="op-cell-inline">
                    <el-button link type="primary" @click="openEditRelationDialog(rule)">编辑</el-button>
                    <el-button link type="danger" @click="removeRelationRule(rule.id)">删除</el-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <el-dialog
          v-model="relationDialogVisible"
          :title="relationDialogMode === 'create' ? '新增课程关系' : '编辑课程关系'"
          width="720px"
        >
          <el-form label-position="top" class="relation-dialog-grid">
            <el-form-item label="校区">
              <el-select v-model="relationForm.campus" placeholder="选择校区">
                <el-option v-for="item in campusOptions" :key="`rc-${item}`" :label="item" :value="item" />
              </el-select>
            </el-form-item>
            <el-form-item label="年级">
              <el-select v-model="relationForm.grade" placeholder="选择年级">
                <el-option v-for="item in relationDialogGradeOptions" :key="`rg-${item}`" :label="item" :value="item" />
              </el-select>
            </el-form-item>
            <el-form-item label="课程A">
              <el-select v-model="relationForm.courseA" filterable placeholder="选择课程A">
                <el-option v-for="item in relationCourseOptions" :key="`ra-${item}`" :label="item" :value="item" />
              </el-select>
            </el-form-item>
            <el-form-item label="课程B">
              <el-select v-model="relationForm.courseB" filterable placeholder="选择课程B">
                <el-option v-for="item in relationCourseOptions" :key="`rb-${item}`" :label="item" :value="item" />
              </el-select>
            </el-form-item>
            <el-form-item label="关系类型">
              <el-radio-group v-model="relationForm.relationType">
                <el-radio label="前后互斥">前后互斥</el-radio>
                <el-radio label="同天互斥">同天互斥</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-form>
          <p v-if="relationDialogError" class="error">{{ relationDialogError }}</p>
          <template #footer>
            <div class="dialog-actions">
              <el-button @click="closeRelationDialog">取消</el-button>
              <el-button type="primary" @click="saveRelationRule">保存</el-button>
            </div>
          </template>
        </el-dialog>
      </template>

      <template v-else-if="activeStep === 'course-consecutive'">
        <header class="rule-head">
          <div>
            <h1>连堂课</h1>
            <p>规则介绍：设置每周连堂课次数，并指定希望安排连堂课的星期几。</p>
          </div>
        </header>

        <section class="rule-section consecutive-page">
          <section class="consecutive-layout-section consecutive-scope-section">
            <div class="consecutive-section-heading">
              <div>
                <h3>适用范围</h3>
                <p>选择课程及规则生效的校区、年级和班级，班级默认为全部班级。</p>
              </div>
            </div>
            <div class="consecutive-scope-grid">
              <label class="consecutive-field">
                <span class="consecutive-field-label">校区</span>
                <el-select v-model="selectedConsecutiveCampus" class="rule-filter-select" placeholder="选择校区">
                  <el-option v-for="item in consecutiveCampusOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </label>
              <label class="consecutive-field">
                <span class="consecutive-field-label">年级</span>
                <el-select v-model="selectedConsecutiveGrade" class="rule-filter-select" placeholder="选择年级">
                  <el-option v-for="item in consecutiveGradeOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </label>
              <label class="consecutive-field">
                <span class="consecutive-field-label">班级</span>
                <el-select v-model="selectedConsecutiveClass" class="rule-filter-select" placeholder="选择班级">
                  <el-option v-for="item in consecutiveClassOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </label>
              <label class="consecutive-field">
                <span class="consecutive-field-label">课程</span>
                <el-select
                  v-model="activeConsecutiveSubject"
                  class="rule-filter-select"
                  filterable
                  placeholder="输入课程名称搜索"
                >
                  <el-option
                    v-for="subject in consecutiveSubjectOptions"
                    :key="`c-${subject}`"
                    :label="subject"
                    :value="subject"
                  />
                </el-select>
              </label>
            </div>
          </section>

          <section class="consecutive-layout-section consecutive-default-section">
            <div class="consecutive-section-heading consecutive-section-heading--actions">
              <div>
                <h3>{{ selectedConsecutiveClass === '全部班级' ? '默认连堂设置' : `${selectedConsecutiveClass}连堂设置` }}</h3>
                <p>设置每周连堂课次数（0-5），并选择希望优先安排连堂课的星期。</p>
              </div>
              <div class="consecutive-setting-actions">
                <el-button @click="clearCurrentConsecutiveSetting">清空</el-button>
                <el-button type="primary" @click="saveCurrentConsecutiveSetting">保存</el-button>
              </div>
            </div>
            <div class="consecutive-setting-grid">
              <div class="consecutive-setting-column">
                <div class="consecutive-setting-label">每周连堂次数</div>
                <el-input-number
                  class="consecutive-input"
                  v-model="consecutiveDefaultWeeklyCount"
                  :min="0"
                  :max="5"
                  controls-position="right"
                />
              </div>

              <div class="consecutive-setting-column consecutive-setting-column--days">
                <div class="consecutive-setting-label">优先连堂日</div>
                <el-checkbox-group v-model="consecutiveDefaultPreferredDays" class="consecutive-day-checks">
                  <el-checkbox v-for="day in consecutiveWeekdays" :key="day" :value="day" :label="day">
                    {{ day }}
                  </el-checkbox>
                </el-checkbox-group>
              </div>
            </div>
          </section>

          <section class="consecutive-layout-section consecutive-management-section">
            <div class="consecutive-section-heading">
              <h3>连堂课管理</h3>
              <p>
                已配置 {{ configuredConsecutiveRows.length }} 条规则，合计每周 {{ configuredConsecutiveWeeklyTotal }} 次连堂课。
              </p>
            </div>
            <el-table
              :data="configuredConsecutiveRows"
              border
              size="small"
              class="admin-element-table consecutive-management-table"
              empty-text="暂无连堂课设置"
            >
              <el-table-column prop="campus" label="校区" min-width="120" />
              <el-table-column prop="grade" label="年级" min-width="100" />
              <el-table-column prop="className" label="班级范围" min-width="120" />
              <el-table-column prop="subject" label="课程" min-width="120" />
              <el-table-column label="每周连堂次数" width="140" align="center">
                <template #default="{ row }">{{ row.weeklyConsecutiveCount ?? '--' }}</template>
              </el-table-column>
              <el-table-column label="优先连堂日" min-width="200">
                <template #default="{ row }">
                  {{ row.preferredDays.length ? row.preferredDays.join('、') : '--' }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" @click="removeConfiguredConsecutiveRule(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-odd-even'">
        <header class="rule-head">
          <div>
            <h1>单双周</h1>
            <p>规则介绍：单周课程和双周课程会被安排在同一个节次。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearOddEvenRules">清空</el-button>
            <el-button type="primary" size="small" @click="addOddEvenRule">添加</el-button>
          </div>
        </header>

        <section class="rule-section odd-even-page">
          <div class="fixed-filters">
            <el-select v-model="selectedOddEvenCampus" class="rule-filter-select">
              <el-option v-for="item in oddEvenCampusOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedOddEvenGrade" class="rule-filter-select">
              <el-option v-for="item in oddEvenGradeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedOddEvenClass" class="rule-filter-select">
              <el-option v-for="item in oddEvenClassOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedOddEvenCourse" class="rule-filter-select">
              <el-option v-for="item in oddEvenCourseOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </div>

          <div class="fixed-table-wrap">
            <table class="fixed-table odd-even-table">
              <thead>
                <tr>
                  <th>校区</th>
                  <th>年级</th>
                  <th>班级</th>
                  <th>单周课程</th>
                  <th>双周课程</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredOddEvenRules.length === 0">
                  <td colspan="6">暂无单双周规则</td>
                </tr>
                <tr v-for="rule in filteredOddEvenRules" :key="rule.id">
                  <td>{{ rule.campus }}</td>
                  <td>{{ rule.grade }}</td>
                  <td>{{ rule.classNames.join('、') }}</td>
                  <td>{{ rule.oddCourse }}</td>
                  <td>{{ rule.evenCourse }}</td>
                  <td class="op-cell-inline">
                    <el-button link type="primary" @click="openEditOddEvenDialog(rule)">编辑</el-button>
                    <el-button link type="danger" @click="deleteOddEvenRule(rule.id)">删除</el-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <el-dialog
            v-model="oddEvenDialogVisible"
            :title="oddEvenDialogMode === 'create' ? '新增单双周规则' : '编辑单双周规则'"
            width="760px"
          >
            <el-form label-position="top" class="odd-even-dialog-grid">
              <el-form-item label="校区">
                <el-select v-model="oddEvenForm.campus" placeholder="选择校区">
                  <el-option v-for="item in oddEvenDialogCampusOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="年级">
                <el-select v-model="oddEvenForm.grade" placeholder="选择年级">
                  <el-option v-for="item in oddEvenDialogGradeOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="班级">
                <el-select
                  v-model="oddEvenForm.classNames"
                  multiple
                  filterable
                  :collapse-tags="false"
                  :collapse-tags-tooltip="false"
                  placeholder="选择班级"
                >
                  <el-option v-for="item in oddEvenDialogClassOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="单周课程">
                <el-select v-model="oddEvenForm.oddCourse" filterable placeholder="选择单周课程">
                  <el-option v-for="item in oddEvenDialogCourseOptions" :key="`odd-${item}`" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="双周课程">
                <el-select v-model="oddEvenForm.evenCourse" filterable placeholder="选择双周课程">
                  <el-option v-for="item in oddEvenDialogCourseOptions" :key="`even-${item}`" :label="item" :value="item" />
                </el-select>
              </el-form-item>
            </el-form>
            <p v-if="oddEvenDialogError" class="error">{{ oddEvenDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeOddEvenDialog">取消</el-button>
                <el-button type="primary" @click="submitOddEvenDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-combine'">
        <header class="rule-head">
          <div>
            <h1>合班课</h1>
            <p>
              规则介绍：支持设置合班课同时上课。可跨校区、跨年级、跨班级、跨学科进行合班，也可设置不同课程在同一时间同步上课。
            </p>
          </div>
          <div class="rule-head-actions">
            <el-button
              type="danger"
              plain
              size="small"
              :disabled="selectedCombineRuleIds.length === 0"
              @click="deleteSelectedCombineRules"
            >
              批量删除（{{ selectedCombineRuleIds.length }}）
            </el-button>
            <el-button type="primary" size="small" @click="addCombineRule">添加</el-button>
          </div>
        </header>

        <section class="rule-section combine-page">
          <div class="fixed-filters">
            <el-select v-model="selectedCombineCampus" class="rule-filter-select">
              <el-option v-for="item in combineCampusOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedCombineGrade" class="rule-filter-select">
              <el-option v-for="item in combineGradeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedCombineClass" class="rule-filter-select">
              <el-option v-for="item in combineClassOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedCombineCourse" class="rule-filter-select">
              <el-option v-for="item in combineCourseOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </div>

          <div class="fixed-table-wrap">
            <table class="fixed-table combine-table">
              <thead>
                <tr>
                  <th style="width: 52px">
                    <el-checkbox
                      :model-value="allFilteredCombineRulesSelected"
                      :indeterminate="someFilteredCombineRulesSelected"
                      aria-label="全选当前合班课规则"
                      @change="toggleAllFilteredCombineRules(Boolean($event))"
                    />
                  </th>
                  <th>序号</th>
                  <th>校区</th>
                  <th>年级</th>
                  <th>班级</th>
                  <th>课程</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredCombineRules.length === 0">
                  <td colspan="7">暂无合班课规则</td>
                </tr>
                <tr v-for="rule in filteredCombineRules" :key="rule.id">
                  <td>
                    <el-checkbox
                      :model-value="selectedCombineRuleIdSet.has(rule.id)"
                      :aria-label="`选择合班课规则 ${rule.orderNo}`"
                      @change="toggleCombineRuleSelection(rule.id, Boolean($event))"
                    />
                  </td>
                  <td>{{ rule.orderNo }}</td>
                  <td>{{ rule.campus }}</td>
                  <td>{{ rule.grade }}</td>
                  <td>{{ rule.classNames.join('、') }}</td>
                  <td>{{ rule.course }}</td>
                  <td class="op-cell-inline">
                    <el-button link type="primary" @click="openEditCombineDialog(rule)">编辑</el-button>
                    <el-button link type="danger" @click="deleteCombineRule(rule.id)">删除</el-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <el-dialog
            v-model="combineDialogVisible"
            :title="combineDialogMode === 'create' ? '新增合班课规则' : '编辑合班课规则'"
            width="760px"
          >
            <el-form label-position="top" class="odd-even-dialog-grid">
              <el-form-item label="校区">
                <el-select v-model="combineForm.campus" placeholder="选择校区">
                  <el-option v-for="item in combineDialogCampusOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="年级">
                <el-select v-model="combineForm.grade" placeholder="选择年级">
                  <el-option v-for="item in combineDialogGradeOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="班级">
                <el-select
                  v-model="combineForm.classNames"
                  multiple
                  filterable
                  :collapse-tags="false"
                  :collapse-tags-tooltip="false"
                  placeholder="选择班级"
                >
                  <el-option v-for="item in combineDialogClassOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="课程">
                <el-select v-model="combineForm.course" filterable placeholder="选择课程">
                  <el-option v-for="item in combineDialogCourseOptions" :key="`combine-course-${item}`" :label="item" :value="item" />
                </el-select>
              </el-form-item>
            </el-form>
            <p v-if="combineDialogError" class="error">{{ combineDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="closeCombineDialog">取消</el-button>
                <el-button type="primary" @click="submitCombineDialog">保存</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

      <template v-else-if="activeStep === 'teacher-ban'">
        <header class="rule-head">
          <div>
            <h1>教师不排课</h1>
            <p>可设置单个老师在指定节次不排课，也可设置教研与活动在指定节次统一不排课。</p>
          </div>
        </header>

        <section class="rule-section teacher-ban-page">
          <el-tabs v-model="teacherBanMode" class="teacher-ban-tabs">
            <el-tab-pane label="单个老师不排课" name="single" />
            <el-tab-pane label="教研与活动不排课" name="group" />
          </el-tabs>

          <div class="teacher-ban-toolbar">
            <template v-if="teacherBanMode === 'single'">
              <el-select v-model="selectedTeacherId" class="rule-filter-select" filterable clearable placeholder="输入教师姓名搜索">
                <el-option
                  v-for="teacher in teacherBanTeacherOptions"
                  :key="teacher.id"
                  :label="teacher.name"
                  :value="teacher.id"
                />
              </el-select>
            </template>
            <template v-else>
              <el-select v-model="selectedGroupId" class="rule-filter-select" filterable clearable placeholder="输入教研与活动名称搜索">
                <el-option
                  v-for="group in teacherBanGroupOptions"
                  :key="group.id"
                  :label="group.campusName ? `${group.name}（${group.campusName}）` : group.name"
                  :value="group.id"
                />
              </el-select>
              <span class="group-members">成员：{{ currentGroupMemberText }}</span>
            </template>

            <div class="rule-head-actions">
              <el-button link type="primary" @click="clearTeacherBan">清空草稿</el-button>
              <el-button type="primary" size="small" @click="saveTeacherBanRules">保存</el-button>
            </div>
          </div>

          <div class="fixed-table-wrap">
            <table class="fixed-table">
              <thead>
                <tr>
                  <th>节次/周</th>
                  <th v-for="day in teacherBanDays" :key="`tb-${day}`">{{ day }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="period in teacherBanPeriods" :key="`tb-${period}`">
                  <td>{{ period }}</td>
                  <td
                    v-for="day in teacherBanDays"
                    :key="`tb-${period}-${day}`"
                    :class="['fixed-cell', { banned: isTeacherBanned(period, day) }]"
                    @click="toggleTeacherBan(period, day)"
                  >
                    <span v-if="isTeacherBanned(period, day)">禁排</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'teacher-hours'">
        <header class="rule-head">
          <div>
            <h1>教师课时</h1>
            <p>
              规则介绍：设置教师课时安排及课时分布。排课时，将按设置为教师安排课程；当课时安排（每天最大上课课时、最大连上课时）和课时分布（周分布、日分布）冲突时，优先满足课时安排。
            </p>
          </div>
        </header>

        <section class="rule-section teacher-hours-page">
          <div class="teacher-hours-filters">
            <el-select v-model="selectedTeacherHourCampus" class="rule-filter-select">
              <el-option v-for="item in teacherHourCampusOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedTeacherHourGrade" class="rule-filter-select">
              <el-option v-for="item in teacherHourGradeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-select v-model="selectedTeacherHourSubject" class="rule-filter-select">
              <el-option v-for="item in teacherHourSubjectOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </div>

          <div class="fixed-table-wrap">
            <table class="fixed-table teacher-hours-table">
              <thead>
                <tr>
                  <th>教师名</th>
                  <th>每天最大上课课时</th>
                  <th>最大连上课时</th>
                  <th>周分布</th>
                  <th>日分布</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rule in teacherHourRows" :key="rule.id">
                  <td>{{ rule.teacherName }}</td>
                  <td>
                    <el-input-number
                      v-model="ensureTeacherHourInlineEditor(rule).maxDailyLessons"
                      :min="1"
                      controls-position="right"
                    />
                  </td>
                  <td>
                    <el-input-number
                      v-model="ensureTeacherHourInlineEditor(rule).maxConsecutiveLessons"
                      :min="1"
                      controls-position="right"
                    />
                  </td>
                  <td>
                    <el-select v-model="ensureTeacherHourInlineEditor(rule).weekDistribution" clearable placeholder="不设置">
                      <el-option v-for="item in teacherHourDistributionOptions" :key="`th-week-${item}`" :label="item" :value="item" />
                    </el-select>
                  </td>
                  <td>
                    <el-select v-model="ensureTeacherHourInlineEditor(rule).dayDistribution" clearable placeholder="不设置">
                      <el-option v-for="item in teacherHourDayDistributionOptions" :key="`th-day-${item}`" :label="item" :value="item" />
                    </el-select>
                  </td>
                  <td class="op-cell-inline">
                    <el-button
                      v-if="rule.isAllTeachers"
                      link
                      type="primary"
                      @click="applyTeacherHourRuleToSubjectTeachers"
                    >
                      保存
                    </el-button>
                    <el-button
                      v-if="rule.isAllTeachers"
                      link
                      type="danger"
                      @click="clearTeacherHourBatchRule"
                    >
                      清空
                    </el-button>
                    <el-button
                      v-if="!rule.isAllTeachers"
                      link
                      type="primary"
                      @click="applyTeacherHourRuleForTeacher(rule)"
                    >
                      保存
                    </el-button>
                    <el-button
                      v-if="!rule.isAllTeachers"
                      link
                      type="danger"
                      @click="clearTeacherHourRule(rule)"
                    >
                      清空
                    </el-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'teacher-mutual'">
        <header class="rule-head">
          <div>
            <h1>教师互斥</h1>
            <p>规则介绍：设置互斥关系的两位老师，每轮教案至少会错开一节课；完全互斥的两个教师不在同一时间上课。</p>
          </div>
          <div class="rule-head-actions">
            <el-button type="primary" size="small" @click="openCreateTeacherMutualDialog('mutual')">添加</el-button>
          </div>
        </header>

        <section class="rule-section teacher-mutual-page">
          <el-card shadow="never" class="teacher-mutual-card">
            <template #header>
              <div class="teacher-mutual-title-row">
                <span>师徒带教</span>
                <el-button link type="primary" @click="openCreateTeacherMutualDialog('mentoring')">添加</el-button>
              </div>
            </template>
            <el-empty v-if="mentoringRules.length === 0" description="暂无师徒带教设置" :image-size="72" />
            <el-table v-else :data="mentoringRules" border class="admin-element-table">
              <el-table-column label="师傅教师" min-width="220">
                <template #default="{ row }">
                  <div class="name-stack">
                    <span v-for="name in row.teacherGroupA" :key="`ma-${row.id}-${name}`">{{ name }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="徒弟教师" min-width="220">
                <template #default="{ row }">
                  <div class="name-stack">
                    <span v-for="name in row.teacherGroupB" :key="`mb-${row.id}-${name}`">{{ name }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="140" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openEditTeacherMutualDialog(row)">编辑</el-button>
                  <el-button link type="danger" @click="deleteTeacherMutualRule(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card shadow="never" class="teacher-mutual-card">
            <template #header>
              <div class="teacher-mutual-title-row">
                <span>教师互斥</span>
                <el-button link type="primary" @click="openCreateTeacherMutualDialog('mutual')">添加</el-button>
              </div>
            </template>
            <el-empty v-if="mutualRules.length === 0" description="暂无教师互斥设置" :image-size="72" />
            <el-table v-else :data="mutualRules" border class="admin-element-table">
              <el-table-column label="互斥教师1" min-width="220">
                <template #default="{ row }">
                  <div class="name-stack">
                    <span v-for="name in row.teacherGroupA" :key="`ua-${row.id}-${name}`">{{ name }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="互斥教师2" min-width="220">
                <template #default="{ row }">
                  <div class="name-stack">
                    <span v-for="name in row.teacherGroupB" :key="`ub-${row.id}-${name}`">{{ name }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="140" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openEditTeacherMutualDialog(row)">编辑</el-button>
                  <el-button link type="danger" @click="deleteTeacherMutualRule(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-dialog
            v-model="teacherMutualDialogVisible"
            :title="teacherMutualDialogMode === 'create' ? '新增教师关系' : '编辑教师关系'"
            class="teacher-mutual-el-dialog"
            width="720px"
          >
            <div class="teacher-mutual-dialog-body">
              <el-form label-position="top" class="teacher-mutual-dialog-form">
                <el-form-item label="关系类型" class="type-row">
                  <el-radio-group v-model="teacherMutualForm.type" size="default">
                    <el-radio-button label="mutual">教师互斥</el-radio-button>
                    <el-radio-button label="mentoring">师徒带教</el-radio-button>
                  </el-radio-group>
                </el-form-item>

                <div class="teacher-mutual-dialog-panels">
                  <section class="teacher-mutual-select-panel">
                    <h4>{{ teacherMutualForm.type === 'mutual' ? '互斥教师1' : '师傅教师' }}</h4>
                    <el-select
                      v-model="teacherMutualForm.teacherGroupA"
                      multiple
                      filterable
                      :collapse-tags="false"
                      :collapse-tags-tooltip="false"
                      placeholder="请选择教师"
                    >
                      <el-option v-for="item in mutualTeacherOptions" :key="`ta-${item}`" :label="item" :value="item" />
                    </el-select>
                  </section>

                  <section class="teacher-mutual-select-panel">
                    <h4>{{ teacherMutualForm.type === 'mutual' ? '互斥教师2' : '徒弟教师' }}</h4>
                    <el-select
                      v-model="teacherMutualForm.teacherGroupB"
                      multiple
                      filterable
                      :collapse-tags="false"
                      :collapse-tags-tooltip="false"
                      placeholder="请选择教师"
                    >
                      <el-option v-for="item in mutualTeacherOptions" :key="`tb-${item}`" :label="item" :value="item" />
                    </el-select>
                  </section>
                </div>
              </el-form>
            </div>
            <p v-if="teacherMutualDialogError" class="error">{{ teacherMutualDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="teacherMutualDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveTeacherMutualRule">保存</el-button>
              </div>
            </template>
          </el-dialog>
        </section>
      </template>

    </section>
  </article>
</template>
