<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { notify } from '../../utils/notify'
import {
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
  sub?: boolean
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
  { id: 'admin-base', label: '1 行政班基础信息' },
  { id: 'course-rules', label: '2 规则管理' },
  { id: 'course-default', label: '2.1 默认规则', sub: true },
  { id: 'course-common', label: '2.2 课程规则', sub: true },
  { id: 'teacher-rules', label: '2.3 教师规则', sub: true },
  { id: 'course-weight', label: '2.4 规则权重分配', sub: true },
  { id: 'custom-rules', label: '3 个性化规则' }
]

const ruleManageCards: RuleNavCard[] = [
  {
    id: 'course-default',
    title: '默认规则',
    desc: '管理主科/副科默认行为与启用状态，作为年级规则基线。'
  },
  {
    id: 'course-common',
    title: '课程规则',
    desc: '进入常规规则配置，包括主副科、单双周、连堂课、排课区域等。'
  },
  {
    id: 'teacher-rules',
    title: '教师规则',
    desc: '进入教师相关规则配置，包括教师不排课、教师课时、教师互斥。'
  },
  {
    id: 'course-weight',
    title: '规则权重分配',
    desc: '设置硬约束优先级与软约束权重，为智能排课提供评分依据。'
  }
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
    id: 'course-area',
    title: '课程排课区域',
    desc: '限定课程可排课节次区域。',
    usage: ['通过勾选单元格限定可排节次，未勾选节次不参与排课。', '可在全部班级与单班级之间联动配置。']
  },
  {
    id: 'course-ban',
    title: '课程不排课',
    desc: '设置课程禁排节次。',
    usage: ['用于显式禁止某课程在指定时段上课。', '与排课区域配合可更精准限制课程分布。']
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

const activeStep = ref('admin-base')
const selectedCommonRuleId = ref('course-main')
const selectedTeacherRuleId = ref('teacher-ban')
const adminBaseLoading = ref(false)
const adminBaseLoadedAt = ref(0)
const adminBaseSnapshot = ref<AdminBaseSnapshot>({
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
  return ['全部年级', ...Array.from(set)]
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

const fixedPointDays = computed(() => allWeekDays.slice(0, resolveTimetableShape(selectedCampus.value, selectedGrade.value).dayCount))
const fixedPointPeriods = computed(() =>
  Array.from({ length: resolveTimetableShape(selectedCampus.value, selectedGrade.value).periodCount }, (_, idx) => idx + 1)
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
const fixedPointRules = ref<GlobalFixedPointRecord[]>(cloneFixedPointRules(ruleSettingsSnapshot.globalFixedPoints))
const fixedPointDraftRules = ref<GlobalFixedPointRecord[]>(cloneFixedPointRules(ruleSettingsSnapshot.globalFixedPoints))
const fallbackBanSubjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '政治', '地理', '音乐', '美术', '信息']
const activeBanSubject = ref('语文')
const consecutiveTypeOptions = ['正课']
const selectedConsecutiveType = ref('正课')
const activeConsecutiveSubject = ref('语文')
const selectedConsecutiveCampus = ref('')
const selectedConsecutiveGrade = ref('')
const consecutiveWeekdays = ['周一', '周二', '周三', '周四', '周五']
const consecutiveSettingMap = ref<ConsecutiveSettingMap>(cloneConsecutiveSettingMap(ruleSettingsSnapshot.consecutiveSettings))
const consecutiveClassDialogVisible = ref(false)
const consecutiveClassDialogError = ref('')
const consecutiveClassForm = reactive({
  className: '',
  weeklyConsecutiveCount: null as number | null,
  preferredDays: [] as string[]
})
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
  const grades = Array.from(new Set(classList.map((item) => item.grade).filter(Boolean)))
  return ['全部年级', ...grades]
})
const combineCourseOptions = computed(() => [
  '全部课程',
  ...Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
])
const combineScopeOptions = ['全部范围', '正课', '选修', '社团']
const selectedCombineCampus = ref('全部校区')
const selectedCombineGrade = ref('全部年级')
const selectedCombineClass = ref('全部班级')
const selectedCombineCourse = ref('全部课程')
const selectedCombineScope = ref('全部范围')
const combineRules = ref<CourseCombineRule[]>(ruleSettingsSnapshot.combineRules || [])
const combineDialogVisible = ref(false)
const combineDialogMode = ref<'create' | 'edit'>('create')
const combineEditingId = ref('')
const combineDialogError = ref('')
const combineForm = reactive({
  campus: '本校区',
  grade: '',
  classNames: [] as string[],
  course: '',
  scope: '正课'
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
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
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
const combineDialogScopeOptions = computed(() => combineScopeOptions.filter((item) => item !== '全部范围'))

const filteredCombineRules = computed(() =>
  combineRules.value.filter((item) => {
    if (selectedCombineCampus.value !== '全部校区' && item.campus !== selectedCombineCampus.value) return false
    if (selectedCombineGrade.value !== '全部年级' && item.grade !== selectedCombineGrade.value) return false
    if (selectedCombineClass.value !== '全部班级' && !item.classNames.includes(selectedCombineClass.value)) return false
    if (selectedCombineCourse.value !== '全部课程' && item.course !== selectedCombineCourse.value) return false
    if (selectedCombineScope.value !== '全部范围' && item.scope !== selectedCombineScope.value) return false
    return true
  })
)

const oddEvenCampusOptions = computed(() => ['全部校区', ...campusOptions.value])
const oddEvenGradeOptions = computed(() => {
  const classes = adminBaseSnapshot.value.classRecords.filter((item) => {
    if (selectedOddEvenCampus.value === '全部校区') return true
    const campusId = campusIdByName.value.get(selectedOddEvenCampus.value)
    if (!campusId) return false
    return item.campusId === campusId
  })
  const grades = Array.from(new Set(classes.map((item) => item.grade).filter(Boolean)))
  return ['全部年级', ...grades]
})
const oddEvenScopeOptions = ['全部范围', '正课', '选修', '社团']
const oddEvenCourseOptions = computed(() => [
  '全部课程',
  ...Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name)))
])
const selectedOddEvenCampus = ref('全部校区')
const selectedOddEvenGrade = ref('全部年级')
const selectedOddEvenClass = ref('全部班级')
const selectedOddEvenCourse = ref('全部课程')
const selectedOddEvenScope = ref('全部范围')
const oddEvenRules = ref<OddEvenRule[]>(ruleSettingsSnapshot.oddEvenRules)
const courseAreaRules = ref<CourseAreaRuleRecord[]>(ruleSettingsSnapshot.courseAreaRules || [])
const courseBanRules = ref<CourseBanRuleRecord[]>(ruleSettingsSnapshot.courseBanRules || [])
const mainSecondaryRules = ref<MainSecondaryRuleRecord[]>(ruleSettingsSnapshot.mainSecondaryRules || [])
const courseRelationRules = ref<CourseRelationRuleRecord[]>(ruleSettingsSnapshot.courseRelationRules || [])
const teacherMutualRules = ref<TeacherMutualRuleRecord[]>(ruleSettingsSnapshot.teacherMutualRules || [])
const courseDefaultConfig = ref<CourseDefaultConfig>(ruleSettingsSnapshot.courseDefaultConfig || { ...defaultCourseDefaultConfig })
const ruleWeightConfig = ref<RuleWeightConfig>(JSON.parse(JSON.stringify(defaultRuleWeightConfig)))
const ruleWeightConfigs = ref<RuleWeightConfigRecord[]>(ruleSettingsSnapshot.ruleWeightConfigs || [])
const selectedWeightCampus = ref('')
const selectedWeightGrade = ref('')
const selectedMainCampus = ref('')
const selectedMainGrade = ref('')
const selectedMainSubjects = ref<string[]>([])
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
    label: '分散方式',
    options: [
      '尽量当天上下 午都有课',
      '尽量在一上午/一下午集中上完',
      '尽量分散到不同天',
      '尽量均匀分散到整周',
      '优先排在周中时段',
      '无特殊要求'
    ]
  },
  { key: 'noCrossNoon', label: '上下节连续', options: ['不能让老师在上午末节和下午首节连上', '可允许上午末节和下午首节连上'] },
  { key: 'sameClassNoConsecutive', label: '同班无连堂课设置的课程', options: ['无特殊要求', '优先不连堂'] },
  { key: 'twoLessonsGap', label: '同一个班，周课时为2节的课程至少间隔一天', options: ['是', '否'] }
]

function applyRuleSettingsSnapshot(snapshot: RuleSettingsSnapshot): void {
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
    : { ...defaultCourseDefaultConfig }
  ruleWeightConfigs.value = Array.isArray(snapshot.ruleWeightConfigs) ? [...snapshot.ruleWeightConfigs] : []
}
const hardRuleMeta: Record<RuleWeightHardKey, { label: string; desc: string }> = {
  teacherConflict: { label: '教师冲突', desc: '同一教师同节次不可在多个班上课。' },
  teacherBan: { label: '教师不排课', desc: '教师禁排节次作为硬约束，不得安排课程。' },
  teacherHourLimit: { label: '教师课时上限', desc: '教师每天最大课时、最大连上课时必须满足。' },
  teacherMutual: { label: '教师互斥', desc: '互斥教师组同节次不可同时上课。' },
  classConflict: { label: '班级冲突', desc: '同一班级同节次不可安排多门课程。' },
  globalFixedPoint: { label: '全局固定点', desc: '固定点节次不可安排普通课程。' },
  courseArea: { label: '课程排课区域', desc: '课程必须落在允许排课区域内。' },
  courseBan: { label: '课程不排课', desc: '禁止课程进入禁排节次。' },
  combineCourse: { label: '合班课一致性', desc: '合班课程需保持同节次同步安排。' }
}
const softRuleMeta: Record<RuleWeightSoftKey, { label: string; desc: string }> = {
  teacherWeekDistribution: { label: '教师周分布', desc: '按周分散/周集中偏好优化教师周内分布。' },
  teacherDayDistribution: { label: '教师日分布', desc: '按日分散/日集中偏好优化教师上下午分布。' },
  consecutive: { label: '连堂课偏好', desc: '优先满足连堂课次数/日分布偏好。' },
  oddEven: { label: '单双周匹配', desc: '优先满足单双周课程同节次配对。' },
  mainSecondary: { label: '主副科平衡', desc: '优先满足主副科节次分布策略。' },
  courseDefault: { label: '默认规则偏好', desc: '按默认规则中启用项进行优化排序。' },
  courseRelation: { label: '课程关系偏好', desc: '优先满足前后互斥与同天互斥。' }
}
const ruleWeightMeta: Record<RuleWeightRuleKey, { label: string; desc: string }> = {
  ...hardRuleMeta,
  ...softRuleMeta
}
const hardPriorityLevels = [1, 2, 3, 4] as const
const hardPriorityLabels: Record<number, string> = {
  1: '第一优先级',
  2: '第二优先级',
  3: '第三优先级',
  4: '第四优先级'
}

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
    .filter((item) => item.mode === 'soft')
    .map((item) => ({
      ...item,
      label: ruleWeightMeta[item.key].label,
      desc: ruleWeightMeta[item.key].desc
    }))
)
const enabledSoftWeightTotal = computed(() =>
  ruleWeightConfig.value.rules
    .filter((item) => item.mode === 'soft')
    .filter((item) => item.enabled)
    .reduce((sum, item) => sum + item.weight, 0)
)
const enabledSoftRuleCount = computed(() =>
  ruleWeightConfig.value.rules.filter((item) => item.mode === 'soft' && item.enabled).length
)
const weightCampusOptions = computed(() => campusOptions.value)
const weightGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedWeightCampus.value)
  if (!campusId) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
  )
})

function setHardRuleEnabled(key: RuleWeightRuleKey, enabled: boolean): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.enabled = enabled
  target.mode = 'hard'
  if (target.weight > 0) target.weight = 0
}

function moveHardRuleLevel(key: RuleWeightRuleKey, delta: -1 | 1): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.priority = normalizeHardRuleLevel(target.priority + delta)
  target.mode = 'hard'
}

function setRuleMode(key: RuleWeightRuleKey, mode: 'hard' | 'soft'): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.mode = mode
  if (mode === 'hard') {
    target.priority = normalizeHardRuleLevel(target.priority || 4)
    target.weight = 0
  } else {
    target.priority = 4
    if (target.weight <= 0) target.weight = 10
  }
}

function setSoftRuleEnabled(key: RuleWeightRuleKey, enabled: boolean): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.enabled = enabled
  target.mode = 'soft'
  if (!enabled) target.weight = 0
}

function setSoftRuleWeight(key: RuleWeightRuleKey, weight: number): void {
  const target = ruleWeightConfig.value.rules.find((item) => item.key === key)
  if (!target) return
  target.mode = 'soft'
  target.weight = Math.max(0, Math.min(100, Math.floor(Number(weight) || 0)))
}

const mainCampusOptions = computed(() => campusOptions.value)
const mainGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedMainCampus.value)
  if (!campusId) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
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
  return ['全部年级', ...Array.from(new Set(classes.map((item) => item.grade).filter(Boolean)))]
})
const relationCourseOptions = computed(() => {
  const list = Array.from(new Set(adminBaseSnapshot.value.courses.map((item) => item.name).filter(Boolean)))
  return list.length > 0 ? list : fallbackBanSubjects
})
const relationDialogGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(relationForm.campus)
  if (!campusId) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
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

function loadCurrentMainSecondarySelection(): void {
  if (!selectedMainCampus.value || !selectedMainGrade.value) {
    selectedMainSubjects.value = []
    return
  }
  const key = mainRuleKey(selectedMainCampus.value, selectedMainGrade.value)
  const current = mainSecondaryRules.value.find((item) => mainRuleKey(item.campus, item.grade) === key)
  if (!current) {
    selectedMainSubjects.value = []
    return
  }
  const set = new Set(mainSubjectOptions.value)
  selectedMainSubjects.value = current.mainSubjects.filter((item) => set.has(item))
}

function clearCurrentMainSecondary(): void {
  const key = mainRuleKey(selectedMainCampus.value, selectedMainGrade.value)
  mainSecondaryRules.value = mainSecondaryRules.value.filter((item) => mainRuleKey(item.campus, item.grade) !== key)
  selectedMainSubjects.value = []
  notify.success('已清空当前年级主副科设置。')
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
  mainSecondaryRules.value = [
    ...rest,
    {
      id: `ms-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      campus: selectedMainCampus.value,
      grade: selectedMainGrade.value,
      mainSubjects,
      secondarySubjects
    }
  ]
  notify.success('主副科设置已保存。')
}

function resetCourseDefaultConfig(): void {
  courseDefaultConfig.value = { ...defaultCourseDefaultConfig }
}

function saveCourseDefaultConfig(): void {
  notify.success('默认规则已保存。')
}

function resetRuleWeightConfig(): void {
  ruleWeightConfig.value = JSON.parse(JSON.stringify(defaultRuleWeightConfig)) as RuleWeightConfig
  notify.success('规则权重已恢复默认。')
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
  const enabled = ruleWeightConfig.value.rules.filter((item) => item.mode === 'soft' && item.enabled)
  if (enabled.length === 0) return
  const currentTotal = enabled.reduce((sum, item) => sum + item.weight, 0)

  if (currentTotal <= 0) {
    const base = Math.floor(100 / enabled.length)
    let remain = 100 - base * enabled.length
    ruleWeightConfig.value.rules = ruleWeightConfig.value.rules.map((item) => {
      if (item.mode !== 'soft') return item
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
    if (item.mode !== 'soft') return item
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
        ? Array.from(
          new Set(
            adminBaseSnapshot.value.classRecords
              .filter((item) => item.campusId === campusId)
              .map((item) => item.grade)
              .filter(Boolean)
          )
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
    courseRelationRules.value = [
      ...courseRelationRules.value,
      {
        id: `cr-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        campus,
        grade,
        courseA,
        courseB,
        relationType
      }
    ]
    relationDialogVisible.value = false
    notify.success('课程关系已添加。')
    return
  }

  courseRelationRules.value = courseRelationRules.value.map((item) =>
    item.id === relationEditingId.value
      ? { ...item, campus, grade, courseA, courseB, relationType }
      : item
  )
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
}

function clearRelationRules(): void {
  courseRelationRules.value = courseRelationRules.value.filter((item) => {
    if (selectedRelationCampus.value !== '全部校区' && item.campus !== selectedRelationCampus.value) return true
    if (selectedRelationGrade.value !== '全部年级' && item.grade !== selectedRelationGrade.value) return true
    if (selectedRelationType.value !== '全部关系' && item.relationType !== selectedRelationType.value) return true
    return false
  })
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
}

const oddEvenDialogVisible = ref(false)
const oddEvenDialogMode = ref<'create' | 'edit'>('create')
const oddEvenEditingId = ref('')
const oddEvenDialogError = ref('')
const oddEvenForm = reactive({
  campus: '本校区',
  grade: '',
  classNames: [] as string[],
  scope: '正课',
  oddCourse: '',
  evenCourse: ''
})

const oddEvenDialogCampusOptions = computed(() => campusOptions.value)
const oddEvenDialogGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(oddEvenForm.campus)
  if (!campusId) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
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
const selectedBanCampus = ref('')
const selectedBanGrade = ref('')
const selectedBanClassRanges = ref<string[]>([])

const areaCampusOptions = computed(() => campusOptions.value)
const areaGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedAreaCampus.value)
  if (!campusId) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
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

const selectedAreaRangeLabel = computed(() => {
  const selected = areaClassRanges.value.filter((item) => selectedAreaClassRanges.value.includes(item.id))
  if (selected.length === 0 || selected.length === areaClassRanges.value.length) return '全部班级'
  return selected.map((item) => item.label).join('、')
})

const areaAllClassIds = computed(() => areaClassRanges.value.map((item) => item.id))
const areaCheckAll = computed(() => {
  const all = areaAllClassIds.value
  if (all.length === 0) return false
  return all.every((id) => selectedAreaClassRanges.value.includes(id))
})
const areaIndeterminate = computed(() => {
  const all = areaAllClassIds.value
  if (all.length === 0) return false
  const selectedCount = all.filter((id) => selectedAreaClassRanges.value.includes(id)).length
  return selectedCount > 0 && selectedCount < all.length
})

function onAreaCheckAllChange(checked: boolean | string | number): void {
  const isChecked = Boolean(checked)
  selectedAreaClassRanges.value = isChecked ? [...areaAllClassIds.value] : []
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

const banCampusOptions = computed(() => campusOptions.value)
const banGradeOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedBanCampus.value)
  if (!campusId) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
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

const selectedBanRangeLabel = computed(() => {
  const selected = banClassRanges.value.filter((item) => selectedBanClassRanges.value.includes(item.id))
  if (selected.length === 0 || selected.length === banClassRanges.value.length) return '全部班级'
  return selected.map((item) => item.label).join('、')
})

const banAllClassIds = computed(() => banClassRanges.value.map((item) => item.id))
const banCheckAll = computed(() => {
  const all = banAllClassIds.value
  if (all.length === 0) return false
  return all.every((id) => selectedBanClassRanges.value.includes(id))
})
const banIndeterminate = computed(() => {
  const all = banAllClassIds.value
  if (all.length === 0) return false
  const selectedCount = all.filter((id) => selectedBanClassRanges.value.includes(id)).length
  return selectedCount > 0 && selectedCount < all.length
})

function onBanCheckAllChange(checked: boolean | string | number): void {
  const isChecked = Boolean(checked)
  selectedBanClassRanges.value = isChecked ? [...banAllClassIds.value] : []
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
  notify.success('已清空当前课程不排课设置。')
}

function saveCurrentBanRule(): void {
  notify.success('课程不排课规则已保存。')
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
    if (selectedOddEvenScope.value !== '全部范围' && item.scope !== selectedOddEvenScope.value) return false
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
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId)
        .map((item) => item.grade)
        .filter(Boolean)
    )
  )
})
const consecutiveClassOptions = computed(() => {
  const campusId = campusIdByName.value.get(selectedConsecutiveCampus.value)
  if (!campusId || !selectedConsecutiveGrade.value) return [] as string[]
  return Array.from(
    new Set(
      adminBaseSnapshot.value.classRecords
        .filter((item) => item.campusId === campusId && item.grade === selectedConsecutiveGrade.value)
        .map((item) => item.className)
        .filter(Boolean)
    )
  )
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

function ensureCurrentConsecutiveSetting(): ConsecutiveSetting {
  const key = consecutiveSettingKey()
  const existing = consecutiveSettingMap.value[key]
  if (existing) return existing
  const created: ConsecutiveSetting = {
    defaultRule: {
      weeklyConsecutiveCount: null,
      preferredDays: []
    },
    classOverrides: {}
  }
  consecutiveSettingMap.value = {
    ...consecutiveSettingMap.value,
    [key]: created
  }
  return created
}

const currentConsecutiveSetting = computed(() => ensureCurrentConsecutiveSetting())
const currentConsecutiveDefaultRule = computed(() => currentConsecutiveSetting.value.defaultRule)
const currentConsecutiveOverrides = computed(() =>
  Object.entries(currentConsecutiveSetting.value.classOverrides).map(([className, rule]) => ({
    className,
    ...rule
  }))
)
const consecutiveDefaultWeeklyCount = computed<number | undefined>({
  get: () => currentConsecutiveDefaultRule.value.weeklyConsecutiveCount ?? undefined,
  set: (value) => updateWeeklyConsecutiveCount(value ?? null)
})
const consecutiveDefaultPreferredDays = computed<string[]>({
  get: () => [...(currentConsecutiveDefaultRule.value.preferredDays || [])],
  set: (value) => updatePreferredDays((value || []).map((item) => String(item || '')))
})

function updateWeeklyConsecutiveCount(value?: number | null): void {
  const current = ensureCurrentConsecutiveSetting()
  current.defaultRule.weeklyConsecutiveCount = normalizeLimitedInt(value ?? null, 0, 5)
}

function updatePreferredDays(days: string[]): void {
  const current = ensureCurrentConsecutiveSetting()
  const normalized = Array.from(new Set(days.filter((day) => consecutiveWeekdays.includes(day))))
  current.defaultRule.preferredDays = normalized
}

function clearCurrentConsecutiveSetting(): void {
  const key = consecutiveSettingKey()
  consecutiveSettingMap.value = {
    ...consecutiveSettingMap.value,
    [key]: {
      defaultRule: {
        weeklyConsecutiveCount: null,
        preferredDays: []
      },
      classOverrides: {}
    }
  }
}

function saveCurrentConsecutiveSetting(): void {
  ensureCurrentConsecutiveSetting()
  notify.success('连堂课规则已暂存。')
}

function openConsecutiveClassDialog(className = ''): void {
  if (consecutiveClassOptions.value.length === 0) {
    notify.warning('当前年级暂无班级可设置。')
    return
  }
  const defaultRule = currentConsecutiveDefaultRule.value
  const existing = className ? currentConsecutiveSetting.value.classOverrides[className] : undefined
  consecutiveClassDialogError.value = ''
  consecutiveClassForm.className = className || consecutiveClassOptions.value[0] || ''
  consecutiveClassForm.weeklyConsecutiveCount = existing?.weeklyConsecutiveCount ?? defaultRule.weeklyConsecutiveCount
  consecutiveClassForm.preferredDays = [...(existing?.preferredDays ?? defaultRule.preferredDays ?? [])]
  consecutiveClassDialogVisible.value = true
}

function saveConsecutiveClassOverride(): void {
  const className = consecutiveClassForm.className
  if (!className || !consecutiveClassOptions.value.includes(className)) {
    consecutiveClassDialogError.value = '请选择有效班级。'
    return
  }
  const current = ensureCurrentConsecutiveSetting()
  const rule: ConsecutiveRuleValue = {
    weeklyConsecutiveCount: normalizeLimitedInt(consecutiveClassForm.weeklyConsecutiveCount, 0, 5),
    preferredDays: Array.from(new Set(consecutiveClassForm.preferredDays.filter((day) => consecutiveWeekdays.includes(day))))
  }
  current.classOverrides = {
    ...current.classOverrides,
    [className]: rule
  }
  consecutiveClassDialogVisible.value = false
  notify.success(`已保存「${className}」特殊设置。`)
}

function removeConsecutiveClassOverride(className: string): void {
  const current = ensureCurrentConsecutiveSetting()
  const next = { ...current.classOverrides }
  delete next[className]
  current.classOverrides = next
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

function classAreaCellEnabled(className: string, period: number, day: string): boolean {
  const key = buildAreaRuleKey(selectedAreaCampus.value, selectedAreaGrade.value, activeAreaSubject.value, className)
  const rule = courseAreaRuleMap.value.get(key)
  if (!rule) return false
  return rule.allowedSlots.includes(`${period}-${day}`)
}

function toggleClassAreaCell(className: string, period: number, day: string): void {
  if (!selectedAreaCampus.value || !selectedAreaGrade.value || !activeAreaSubject.value) return
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
  notify.success('已清空当前课程排课区域设置。')
}

function saveCurrentAreaRule(): void {
  notify.success('课程排课区域规则已保存。')
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
  fixedPointSelectionStart.value = { period, day }
  fixedPointSelectedSlots.value = [fixedSlotKey(period, day)]
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
  notify.success(`已删除 ${targets.length} 个固定点格子。`)
}

const handleCloseFixedPointContextMenu = () => closeFixedPointContextMenu()

function saveFixedPoints(): void {
  fixedPointRules.value = cloneFixedPointRules(fixedPointDraftRules.value)
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
  notify.success(rule.isAllTeachers ? '默认规则已更新。' : `已应用「${rule.teacherName}」个人设置。`)
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
  notify.success(`已应用到全部（${targets.length}位教师）。`)
}

function clearTeacherHourBatchRule(): void {
  const campus = selectedTeacherHourCampus.value
  const grade = selectedTeacherHourGrade.value
  const subject = selectedTeacherHourSubject.value
  if (!campus || !grade || !subject) return

  teacherHourRuleStore.value = teacherHourRuleStore.value.filter(
    (item) => !(item.campus === campus && item.grade === grade && item.subject === subject && item.teacherId === '')
  )
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
  notify.success('已清空个人设置，恢复继承默认规则。')
}

function subjectHasBan(subject: string): boolean {
  return courseBanRules.value.some((item) => item.subject === subject && item.bannedSlots.length > 0)
}

function clearCombineRules(): void {
  combineRules.value = []
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
  combineForm.scope = selectedCombineScope.value === '全部范围' ? '正课' : selectedCombineScope.value
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
  combineForm.scope = rule.scope
  combineDialogVisible.value = true
}

function closeCombineDialog(): void {
  combineDialogVisible.value = false
}

function submitCombineDialog(): void {
  const campus = combineForm.campus.trim()
  const grade = combineForm.grade.trim()
  const course = combineForm.course.trim()
  const scope = combineForm.scope.trim()
  const classNames = combineForm.classNames.map((item) => item.trim()).filter(Boolean)

  if (!campus || !grade || !course || !scope) {
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
      course,
      scope
    })
    normalizeCombineRuleOrder()
    closeCombineDialog()
    return
  }

  combineRules.value = combineRules.value.map((item) =>
    item.id === combineEditingId.value
      ? {
          ...item,
          campus,
          grade,
          classNames,
          course,
          scope
        }
      : item
  )
  normalizeCombineRuleOrder()
  closeCombineDialog()
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
}

function addCombineRule(): void {
  openCreateCombineDialog()
}

watch(
  [fixedPointRules, oddEvenRules, combineRules, courseAreaRules, courseBanRules, mainSecondaryRules, courseRelationRules, teacherMutualRules, teacherBanMap, teacherHourRuleStore, consecutiveSettingMap, courseDefaultConfig, ruleWeightConfigs],
  ([nextFixedPoints, nextOddEvenRules, nextCombineRules, nextCourseAreaRules, nextCourseBanRules, nextMainSecondaryRules, nextCourseRelationRules, nextTeacherMutualRules, nextTeacherBanRules, nextTeacherHourRules, nextConsecutiveSettings, nextCourseDefaultConfig, nextRuleWeightConfigs]) => {
    saveRuleSettingsSnapshot({
      version: 1,
      globalFixedPoints: nextFixedPoints,
      oddEvenRules: nextOddEvenRules,
      combineRules: nextCombineRules,
      courseAreaRules: nextCourseAreaRules,
      courseBanRules: nextCourseBanRules,
      mainSecondaryRules: nextMainSecondaryRules,
      courseRelationRules: nextCourseRelationRules,
      teacherMutualRules: nextTeacherMutualRules,
      teacherBanRules: nextTeacherBanRules,
      teacherHourRules: nextTeacherHourRules,
      consecutiveSettings: nextConsecutiveSettings,
      courseDefaultConfig: nextCourseDefaultConfig,
      ruleWeightConfigs: nextRuleWeightConfigs
    })
  },
  { deep: true }
)

function openCreateOddEvenDialog(): void {
  oddEvenDialogMode.value = 'create'
  oddEvenEditingId.value = ''
  oddEvenDialogError.value = ''
  oddEvenForm.campus = selectedOddEvenCampus.value === '全部校区' ? campusOptions.value[0] || '本校区' : selectedOddEvenCampus.value
  oddEvenForm.grade = selectedOddEvenGrade.value === '全部年级' ? oddEvenGradeOptions.value[1] || '' : selectedOddEvenGrade.value
  oddEvenForm.classNames = []
  oddEvenForm.scope = selectedOddEvenScope.value === '全部范围' ? '正课' : selectedOddEvenScope.value
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
  oddEvenForm.scope = rule.scope
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
  const scope = oddEvenForm.scope.trim()
  const oddCourse = oddEvenForm.oddCourse.trim()
  const evenCourse = oddEvenForm.evenCourse.trim()
  const classNames = oddEvenForm.classNames.map((item) => item.trim()).filter(Boolean)

  if (!campus || !grade || !scope || !oddCourse || !evenCourse) {
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
      scope,
      oddCourse,
      evenCourse
    })
    closeOddEvenDialog()
    return
  }

  oddEvenRules.value = oddEvenRules.value.map((item) =>
    item.id === oddEvenEditingId.value
      ? {
          ...item,
          campus,
          grade,
          classNames,
          scope,
          oddCourse,
          evenCourse
        }
      : item
  )

  closeOddEvenDialog()
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
}

function addOddEvenRule(): void {
  openCreateOddEvenDialog()
}

const activeStepLabel = computed(() => steps.find((step) => step.id === activeStep.value)?.label ?? '')
const commonRuleStepIds = new Set([
  'course-main',
  'course-fixed',
  'course-combine',
  'course-odd-even',
  'course-consecutive',
  'course-area',
  'course-ban',
  'course-relation'
])
const teacherRuleStepIds = new Set(['teacher-ban', 'teacher-hours', 'teacher-mutual'])
const menuActiveStep = computed(() => {
  if (commonRuleStepIds.has(activeStep.value)) return 'course-common'
  if (teacherRuleStepIds.has(activeStep.value)) return 'teacher-rules'
  return activeStep.value
})

function normalizeAdminBaseSnapshot(payload: unknown): AdminBaseSnapshot {
  if (!payload || typeof payload !== 'object') {
    return {
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

watch(consecutiveSubjectOptions, (items) => {
  if (!items.includes(activeConsecutiveSubject.value)) {
    activeConsecutiveSubject.value = items[0] ?? ''
  }
}, { immediate: true })

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
      ? Array.from(
        new Set(
          adminBaseSnapshot.value.classRecords
            .filter((item) => item.campusId === campusId)
            .map((item) => item.grade)
            .filter(Boolean)
        )
      )
      : []
    if (!grades.includes(relationForm.grade)) {
      relationForm.grade = grades[0] || ''
    }
  }
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
    const latestSnapshot = await hydrateRuleSettingsSnapshotFromApi()
    applyRuleSettingsSnapshot(latestSnapshot)
    await refreshAdminBaseOverviewIfNeeded(true)
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

function jumpToRulePage(stepId: string) {
  activeStep.value = stepId
}

const selectedCommonRule = computed(
  () => commonRuleCards.find((item) => item.id === selectedCommonRuleId.value) ?? commonRuleCards[0]
)
const selectedTeacherRule = computed(
  () => teacherRuleCards.find((item) => item.id === selectedTeacherRuleId.value) ?? teacherRuleCards[0]
)

const showCommonRuleTabs = computed(() => activeStep.value === 'course-common' || commonRuleStepIds.has(activeStep.value))
const commonRuleOpenedTabs = ref<CommonRuleTab[]>([{ id: 'course-common', title: '课程规则', closable: false }])
const activeCommonRuleTab = ref('course-common')
const hasExtraCommonRuleTabs = computed(() => commonRuleOpenedTabs.value.length > 1)

function syncCommonRuleStep(stepId: string): void {
  if (!commonRuleStepIds.has(stepId)) return
  const card = commonRuleCards.find((item) => item.id === stepId)
  if (!card) return
  selectedCommonRuleId.value = stepId
  if (!commonRuleOpenedTabs.value.some((item) => item.id === stepId)) {
    commonRuleOpenedTabs.value.push({ id: stepId, title: card.title, closable: true })
  }
}

function openCommonRuleTab(ruleId: string): void {
  syncCommonRuleStep(ruleId)
  activeCommonRuleTab.value = ruleId
  activeStep.value = ruleId
}

function switchCommonRuleTab(tabId: string): void {
  if (tabId === 'course-common') {
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
  if (activeCommonRuleTab.value !== tabId) return
  const fallback = commonRuleOpenedTabs.value[Math.max(index - 1, 0)]?.id ?? 'course-common'
  switchCommonRuleTab(fallback)
}

function clearExtraCommonRuleTabs(): void {
  commonRuleOpenedTabs.value = [{ id: 'course-common', title: '课程规则', closable: false }]
  switchCommonRuleTab('course-common')
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

watch(
  () => activeStep.value,
  (stepId, prevStepId) => {
    if (stepId === 'course-common') {
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
  }
)
</script>

<template>
  <article class="panel rule-settings-page">
    <aside class="rule-order">
      <h3>设置顺序</h3>
      <el-menu
        :default-active="menuActiveStep"
        class="rule-order-menu"
        @select="(index) => (activeStep = index)"
      >
        <el-menu-item
          v-for="step in steps"
          :key="step.id"
          :index="step.id"
          :class="{ 'is-sub': step.sub }"
        >
          {{ step.label }}
        </el-menu-item>
      </el-menu>
    </aside>

    <section class="rule-content">
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
            @click="clearExtraCommonRuleTabs"
          >
            清空多余 Tabs
          </el-button>
        </div>
      </div>

      <template v-if="activeStep === 'admin-base'">
        <header class="rule-head">
          <div>
            <h1>行政班基础信息</h1>
            <p>数据看板：展示当前学校基础数据中的校区、班级、教师、学生概览。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" :loading="adminBaseLoading" @click="loadAdminBaseOverview">刷新数据</el-button>
          </div>
        </header>

        <section class="rule-section admin-base-dashboard">
          <el-row :gutter="12" class="admin-kpi-row">
            <el-col :xs="12" :sm="12" :md="6">
              <el-card shadow="hover" class="admin-kpi-card">
                <p class="admin-kpi-title">校区数</p>
                <strong>{{ adminCampusTotal }}</strong>
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="12" :md="6">
              <el-card shadow="hover" class="admin-kpi-card">
                <p class="admin-kpi-title">班级数</p>
                <strong>{{ adminClassTotal }}</strong>
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="12" :md="6">
              <el-card shadow="hover" class="admin-kpi-card">
                <p class="admin-kpi-title">教师数</p>
                <strong>{{ adminTeacherTotal }}</strong>
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="12" :md="6">
              <el-card shadow="hover" class="admin-kpi-card">
                <p class="admin-kpi-title">学生数</p>
                <strong>{{ adminStudentTotal }}</strong>
              </el-card>
            </el-col>
          </el-row>

          <div class="admin-panel-grid">
            <el-card shadow="never" class="admin-panel-card">
              <template #header>
                <div class="admin-panel-head">校区数据分布</div>
              </template>
              <el-table :data="adminCampusSummary" stripe border class="admin-element-table" empty-text="暂无校区数据">
                <el-table-column prop="schoolName" label="学校名称" min-width="180" />
                <el-table-column prop="campusName" label="校区" min-width="140" />
                <el-table-column prop="classCount" label="班级数" width="100" align="center" />
                <el-table-column prop="teacherCount" label="教师数" width="100" align="center" />
                <el-table-column prop="studentCount" label="学生数" width="100" align="center" />
              </el-table>
            </el-card>

            <el-card shadow="never" class="admin-panel-card">
              <template #header>
                <div class="admin-panel-head">学段数据分布</div>
              </template>
              <el-table :data="adminStageSummary" stripe border class="admin-element-table" empty-text="暂无学段数据">
                <el-table-column label="学段" min-width="120" align="center">
                  <template #default="{ row }">
                    <el-tag :type="row.stage === '小学' ? 'success' : 'warning'" effect="light">{{ row.stage }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="classCount" label="班级数" min-width="120" align="center" />
                <el-table-column prop="studentCount" label="学生数" min-width="120" align="center" />
              </el-table>
            </el-card>
          </div>

          <p v-if="!adminHasData" class="coming-soon">暂无数据，请先在基础数据模块录入班级、教师、学生信息。</p>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-rules'">
        <header class="rule-head">
          <div>
            <h1>规则管理</h1>
            <p>模块分为默认规则、课程规则、教师规则三部分，按需进入对应配置页。</p>
          </div>
        </header>

        <section class="rule-section rule-overview-page">
          <div class="rule-overview-grid">
            <el-card
              v-for="item in ruleManageCards"
              :key="`rm-${item.id}`"
              shadow="hover"
              class="rule-overview-card"
              @click="jumpToRulePage(item.id)"
            >
              <h3>{{ item.title }}</h3>
              <p>{{ item.desc }}</p>
              <el-button type="primary" link @click.stop="jumpToRulePage(item.id)">进入</el-button>
            </el-card>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-common'">
        <header class="rule-head">
          <div>
            <h1>课程规则</h1>
            <p>课程规则用于配置日常排课限制与策略。</p>
          </div>
        </header>

        <section class="rule-section rule-overview-page">
          <div class="rule-overview-grid rule-overview-grid-common">
            <el-card
              v-for="item in commonRuleCards"
              :key="`rc-${item.id}`"
              shadow="never"
              :class="['rule-overview-card', { active: selectedCommonRuleId === item.id }]"
              @click="selectCommonRule(item.id)"
            >
              <h3>{{ item.title }}</h3>
              <p>{{ item.desc }}</p>
              <div class="rule-overview-card-actions">
                <el-button type="primary" link @click.stop="openCommonRuleTab(item.id)">配置</el-button>
              </div>
            </el-card>
          </div>

          <el-card shadow="never" class="rule-guide-card">
            <h3>{{ selectedCommonRule.title }}</h3>
            <p class="rule-guide-desc">{{ selectedCommonRule.desc }}</p>
            <div class="rule-guide-list">
              <p v-for="(item, index) in selectedCommonRule.usage" :key="`guide-${selectedCommonRule.id}-${index}`">
                {{ index + 1 }}. {{ item }}
              </p>
            </div>
          </el-card>
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
          <div class="rule-overview-grid rule-overview-grid-common">
            <el-card
              v-for="item in teacherRuleCards"
              :key="`rt-${item.id}`"
              shadow="never"
              :class="['rule-overview-card', { active: selectedTeacherRuleId === item.id }]"
              @click="selectTeacherRule(item.id)"
            >
              <h3>{{ item.title }}</h3>
              <p>{{ item.desc }}</p>
              <div class="rule-overview-card-actions">
                <el-button type="primary" link @click.stop="openTeacherRulePage(item.id)">配置</el-button>
              </div>
            </el-card>
          </div>

          <el-card shadow="never" class="rule-guide-card">
            <h3>{{ selectedTeacherRule.title }}</h3>
            <p class="rule-guide-desc">{{ selectedTeacherRule.desc }}</p>
            <div class="rule-guide-list">
              <p v-for="(item, index) in selectedTeacherRule.usage" :key="`guide-${selectedTeacherRule.id}-${index}`">
                {{ index + 1 }}. {{ item }}
              </p>
            </div>
          </el-card>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-main'">
        <header class="rule-head">
          <div>
            <h1>主副科</h1>
            <p>根据当前校区与年级基础数据，设置学科为主科或副科。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearCurrentMainSecondary">清空</el-button>
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
            <p>规则介绍：通过硬约束优先级与软约束权重，定义智能排课时的约束检查顺序和优化目标。</p>
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
              <span class="label">自动归一化(100)</span>
              <el-switch v-model="ruleWeightConfig.autoNormalize" :disabled="!ruleWeightConfig.enabled" />
            </div>
          </div>

          <el-row :gutter="12">
            <el-col :xs="24" :lg="12">
              <el-card shadow="never" class="rule-weight-card">
                <template #header>
                  <div class="rule-weight-card-head hard">
                    <span>硬约束优先级（先检查）</span>
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
                          <el-button
                            text
                            size="small"
                            :disabled="!ruleWeightConfig.enabled || item.level <= 1"
                            @click="moveHardRuleLevel(item.key, -1)"
                          >
                            &lt;
                          </el-button>
                          <el-switch
                            :model-value="item.enabled"
                            :disabled="!ruleWeightConfig.enabled"
                            @update:model-value="setHardRuleEnabled(item.key, Boolean($event))"
                          />
                          <el-button
                            text
                            size="small"
                            :disabled="!ruleWeightConfig.enabled || item.level >= 4"
                            @click="moveHardRuleLevel(item.key, 1)"
                          >
                            &gt;
                          </el-button>
                        </div>
                        <div class="rule-weight-hard-item-extra">
                          <el-button
                            link
                            type="primary"
                            size="small"
                            :disabled="!ruleWeightConfig.enabled"
                            @click="setRuleMode(item.key, 'soft')"
                          >
                            设为软约束
                          </el-button>
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
                  <div class="rule-weight-card-head">软约束权重（评分项）</div>
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
                  <el-table-column label="操作" width="120" align="center">
                    <template #default="{ row }">
                      <el-button
                        link
                        type="primary"
                        :disabled="!ruleWeightConfig.enabled"
                        @click="setRuleMode(row.key, 'hard')"
                      >
                        设为硬约束
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </el-card>
            </el-col>
          </el-row>

          <div class="rule-weight-summary">
            <el-tag type="info" effect="plain">已启用软规则：{{ enabledSoftRuleCount }} 项</el-tag>
            <el-tag
              :type="enabledSoftWeightTotal === 100 ? 'success' : 'warning'"
              effect="light"
            >
              当前软约束总权重：{{ enabledSoftWeightTotal }}
            </el-tag>
            <span class="rule-weight-tip">
              {{
                ruleWeightConfig.autoNormalize
                  ? '保存时会自动归一化到 100。'
                  : '当前为手动权重模式，建议总权重保持 100。'
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
            <el-button size="small" @click="clearFixedPoints">清空</el-button>
            <el-button type="primary" size="small" @click="saveFixedPoints">保存</el-button>
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

          <p class="fixed-hint">拖拽可框选多个格子，右键菜单可设置或删除框选区域。</p>

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

      <template v-else-if="activeStep === 'course-ban'">
        <header class="rule-head">
          <div>
            <h1>课程不排课</h1>
            <p>规则介绍：设置为课程不排课的节次，排课引擎会在设置的节次中不安排该课程。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearCurrentBanRule">清空</el-button>
            <el-button type="primary" size="small" @click="saveCurrentBanRule">保存</el-button>
          </div>
        </header>

        <section class="rule-section course-ban-page">
          <div class="consecutive-topbar">
            <el-select v-model="selectedConsecutiveType" class="rule-select-sm">
              <el-option v-for="item in consecutiveTypeOptions" :key="`ban-type-${item}`" :label="item" :value="item" />
            </el-select>
            <el-radio-group v-model="activeBanSubject" class="subject-tabs">
              <el-radio-button
                v-for="subject in banSubjectOptions"
                :key="`ban-subject-${subject}`"
                :label="subject"
                :class="{ configured: subjectHasBan(subject) }"
              >
                {{ subject }}
                <span v-if="subjectHasBan(subject)" class="configured-dot" title="已设置禁排"></span>
              </el-radio-button>
            </el-radio-group>
          </div>

          <div class="course-ban-meta">
            <div class="meta-item">
              <div class="meta-label">校区</div>
              <div class="meta-value">
                <el-select v-model="selectedBanCampus" class="rule-filter-select" placeholder="选择校区">
                  <el-option v-for="item in banCampusOptions" :key="`ban-campus-${item}`" :label="item" :value="item" />
                </el-select>
              </div>
            </div>
            <div class="meta-item">
              <div class="meta-label">年级</div>
              <div class="meta-value">
                <el-select v-model="selectedBanGrade" class="rule-filter-select" placeholder="选择年级">
                  <el-option v-for="item in banGradeOptions" :key="`ban-grade-${item}`" :label="item" :value="item" />
                </el-select>
              </div>
            </div>
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
                    >
                      <span v-if="classBanCellEnabled(classItem.className, period, day)">禁</span>
                    </button>
                  </template>
                </div>
              </div>
            </div>
            <div v-else class="course-area-empty">当前校区和年级下暂无班级数据。</div>

            <div class="course-area-range-tabs">
              <el-checkbox
                class="course-area-check-all"
                :model-value="banCheckAll"
                :indeterminate="banIndeterminate"
                border
                @change="onBanCheckAllChange($event as boolean)"
              >
                全部班级
              </el-checkbox>
              <el-checkbox-group v-model="selectedBanClassRanges" class="course-area-range-checks">
                <el-checkbox
                  v-for="item in banClassRanges"
                  :key="`ban-range-${item.id}`"
                  :value="item.id"
                  border
                >
                  {{ item.label }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-area'">
        <header class="rule-head">
          <div>
            <h1>课程排课区域</h1>
            <p>规则介绍：设置课程固定安排的区域。若不设置，默认在全部可用节次上安排课程。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearCurrentAreaRule">清空</el-button>
            <el-button type="primary" size="small" @click="saveCurrentAreaRule">保存</el-button>
          </div>
        </header>

        <section class="rule-section course-area-page">
          <div class="consecutive-topbar">
            <el-select v-model="selectedConsecutiveType" class="rule-select-sm">
              <el-option v-for="item in consecutiveTypeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-radio-group v-model="activeAreaSubject" class="subject-tabs">
              <el-radio-button
                v-for="subject in areaSubjectOptions"
                :key="`a-${subject}`"
                :label="subject"
              >
                {{ subject }}
              </el-radio-button>
            </el-radio-group>
          </div>

          <div class="course-area-meta">
            <div class="meta-item">
              <div class="meta-label">校区</div>
              <div class="meta-value">
                <el-select v-model="selectedAreaCampus" class="rule-filter-select" placeholder="选择校区">
                  <el-option v-for="item in areaCampusOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </div>
            </div>
            <div class="meta-item">
              <div class="meta-label">年级</div>
              <div class="meta-value">
                <el-select v-model="selectedAreaGrade" class="rule-filter-select" placeholder="选择年级">
                  <el-option v-for="item in areaGradeOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </div>
            </div>
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

            <div class="course-area-range-tabs">
              <el-checkbox
                class="course-area-check-all"
                :model-value="areaCheckAll"
                :indeterminate="areaIndeterminate"
                border
                @change="onAreaCheckAllChange($event as boolean)"
              >
                全部班级
              </el-checkbox>
              <el-checkbox-group
                v-model="selectedAreaClassRanges"
                class="course-area-range-checks"
              >
                <el-checkbox
                  v-for="item in areaClassRanges"
                  :key="item.id"
                  :label="item.id"
                  border
                >
                  {{ item.label }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeStep === 'course-relation'">
        <header class="rule-head">
          <div>
            <h1>课程关系</h1>
            <p>规则介绍：前后互斥指两个课程不能被安排在相邻节次。同天互斥指所选课程不能被安排在同一天。</p>
          </div>
          <div class="rule-head-actions">
            <el-button size="small" @click="clearRelationRules">清空</el-button>
            <el-button type="primary" size="small" @click="openCreateRelationDialog">添加</el-button>
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
          <div class="consecutive-topbar">
            <el-select v-model="selectedConsecutiveType" class="rule-select-sm">
              <el-option v-for="item in consecutiveTypeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <el-radio-group v-model="activeConsecutiveSubject" class="subject-tabs">
              <el-radio-button
                v-for="subject in consecutiveSubjectOptions"
                :key="`c-${subject}`"
                :label="subject"
              >
                {{ subject }}
              </el-radio-button>
            </el-radio-group>
          </div>

          <div class="consecutive-config-panel">
            <div class="consecutive-meta">
              <div class="consecutive-meta-grid">
                <div class="meta-item">
                  <div class="meta-label">校区</div>
                  <div class="meta-value">
                    <el-select v-model="selectedConsecutiveCampus" class="rule-filter-select" placeholder="选择校区">
                      <el-option v-for="item in consecutiveCampusOptions" :key="item" :label="item" :value="item" />
                    </el-select>
                  </div>
                </div>
                <div class="meta-item">
                  <div class="meta-label">年级</div>
                  <div class="meta-value">
                    <el-select v-model="selectedConsecutiveGrade" class="rule-filter-select" placeholder="选择年级">
                      <el-option v-for="item in consecutiveGradeOptions" :key="item" :label="item" :value="item" />
                    </el-select>
                  </div>
                </div>
                <div class="meta-item">
                  <div class="meta-label">班级</div>
                  <div class="meta-value">
                    全部班级（默认生效）
                    <el-button link type="primary" @click="openConsecutiveClassDialog()">按班级特殊设置</el-button>
                  </div>
                </div>
              </div>
            </div>

            <div class="consecutive-setting">
              <div class="consecutive-setting-head">
                <h3>连堂课次数</h3>
                <h3>优先连堂日</h3>
                <div class="consecutive-setting-actions">
                  <el-button text @click="clearCurrentConsecutiveSetting">清空</el-button>
                  <el-button text type="primary" @click="saveCurrentConsecutiveSetting">保存</el-button>
                </div>
              </div>
              <p class="consecutive-setting-tip">设置每周连堂课次数（0-5），并选择希望优先安排连堂课的星期几。</p>
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

                <div class="consecutive-setting-column">
                  <div class="consecutive-setting-label">希望安排到以下日期</div>
                  <el-checkbox-group v-model="consecutiveDefaultPreferredDays" class="consecutive-day-checks">
                    <el-checkbox v-for="day in consecutiveWeekdays" :key="day" :value="day" :label="day">
                      {{ day }}
                    </el-checkbox>
                  </el-checkbox-group>
                </div>
              </div>

              <div class="consecutive-override-table-wrap">
                <div class="consecutive-override-title">班级特殊设置</div>
                <el-table
                  :data="currentConsecutiveOverrides"
                  border
                  size="small"
                  class="admin-element-table"
                  empty-text="暂无班级特殊设置"
                >
                  <el-table-column prop="className" label="班级" min-width="120" />
                  <el-table-column label="连堂课次数" width="120" align="center">
                    <template #default="{ row }">{{ row.weeklyConsecutiveCount ?? '--' }}</template>
                  </el-table-column>
                  <el-table-column label="优先连堂日" min-width="220">
                    <template #default="{ row }">
                      {{ (row.preferredDays || []).length ? row.preferredDays.join('、') : '--' }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="140" align="center">
                    <template #default="{ row }">
                      <el-button link type="primary" @click="openConsecutiveClassDialog(row.className)">编辑</el-button>
                      <el-button link type="danger" @click="removeConsecutiveClassOverride(row.className)">删除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </div>

          <el-dialog
            v-model="consecutiveClassDialogVisible"
            title="班级特殊设置"
            width="560px"
          >
            <el-form label-position="top">
              <el-form-item label="班级">
                <el-select v-model="consecutiveClassForm.className" placeholder="选择班级">
                  <el-option v-for="item in consecutiveClassOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
              <el-form-item label="连堂课次数（0-5）">
                <el-input-number
                  class="consecutive-input"
                  v-model="consecutiveClassForm.weeklyConsecutiveCount"
                  :min="0"
                  :max="5"
                  controls-position="right"
                />
              </el-form-item>
              <el-form-item label="优先连堂日">
                <el-checkbox-group v-model="consecutiveClassForm.preferredDays" class="consecutive-day-checks">
                  <el-checkbox v-for="day in consecutiveWeekdays" :key="`dlg-${day}`" :value="day" :label="day">
                    {{ day }}
                  </el-checkbox>
                </el-checkbox-group>
              </el-form-item>
            </el-form>
            <p v-if="consecutiveClassDialogError" class="error">{{ consecutiveClassDialogError }}</p>
            <template #footer>
              <div class="dialog-actions">
                <el-button @click="consecutiveClassDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveConsecutiveClassOverride">保存</el-button>
              </div>
            </template>
          </el-dialog>
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
            <el-select v-model="selectedOddEvenScope" class="rule-filter-select">
              <el-option v-for="item in oddEvenScopeOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </div>

          <div class="fixed-table-wrap">
            <table class="fixed-table odd-even-table">
              <thead>
                <tr>
                  <th>校区</th>
                  <th>年级</th>
                  <th>班级</th>
                  <th>范围</th>
                  <th>单周课程</th>
                  <th>双周课程</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredOddEvenRules.length === 0">
                  <td colspan="7">暂无单双周规则</td>
                </tr>
                <tr v-for="rule in filteredOddEvenRules" :key="rule.id">
                  <td>{{ rule.campus }}</td>
                  <td>{{ rule.grade }}</td>
                  <td>{{ rule.classNames.join('、') }}</td>
                  <td>{{ rule.scope }}</td>
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
              <el-form-item label="范围">
                <el-select v-model="oddEvenForm.scope" placeholder="选择范围">
                  <el-option v-for="item in oddEvenScopeOptions.filter((v) => v !== '全部范围')" :key="item" :label="item" :value="item" />
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
            <el-button size="small" @click="clearCombineRules">清空</el-button>
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
            <el-select v-model="selectedCombineScope" class="rule-filter-select">
              <el-option v-for="item in combineScopeOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </div>

          <div class="fixed-table-wrap">
            <table class="fixed-table combine-table">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>校区</th>
                  <th>年级</th>
                  <th>班级</th>
                  <th>课程</th>
                  <th>合班范围</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredCombineRules.length === 0">
                  <td colspan="7">暂无合班课规则</td>
                </tr>
                <tr v-for="rule in filteredCombineRules" :key="rule.id">
                  <td>{{ rule.orderNo }}</td>
                  <td>{{ rule.campus }}</td>
                  <td>{{ rule.grade }}</td>
                  <td>{{ rule.classNames.join('、') }}</td>
                  <td>{{ rule.course }}</td>
                  <td>{{ rule.scope }}</td>
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
              <el-form-item label="范围">
                <el-select v-model="combineForm.scope" placeholder="选择范围">
                  <el-option v-for="item in combineDialogScopeOptions" :key="`combine-scope-${item}`" :label="item" :value="item" />
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

            <el-button link type="primary" @click="clearTeacherBan">清空当前对象设置</el-button>
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
                      应用
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
                      应用
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

      <template v-else>
        <header class="rule-head">
          <h1>{{ activeStepLabel }}</h1>
          <p>该规则页正在开发中，后续继续完善。</p>
        </header>

        <section class="rule-section">
          <p class="coming-soon">当前先完成全局固定点，其他规则稍后补齐。</p>
        </section>
      </template>
    </section>
  </article>
</template>
