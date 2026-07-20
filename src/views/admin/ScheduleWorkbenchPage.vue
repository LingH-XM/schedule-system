<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { CircleCheckFilled, Lock, Unlock } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { notify } from '../../utils/notify'
import AppContentSkeleton from '../../components/AppContentSkeleton.vue'
import {
  defaultCourseDefaultConfig,
  defaultRuleWeightConfig,
  hydrateRuleSettingsSnapshotFromApi,
  loadRuleSettingsSnapshot,
  type RuleSettingsSnapshot,
  type RuleWeightConfig,
  type RuleWeightRuleKey
} from '../../services/ruleSettings'
import {
  basicDataRepository,
  type Campus,
  type ClassHourClassRow,
  type ClassHourRow,
  type ClassRecord,
  type GroupRecord
} from '../../services/basicDataRepository'
import {
  loadWorkbenchPersistSnapshot,
  saveWorkbenchPersistSnapshot,
  updateSchedulePlanProgress,
  type WorkbenchPersistSnapshot
} from '../../services/scheduleStateRepository'
import {
  applyDropTarget,
  dropForbiddenLabelFromReason,
  evaluateDropTarget,
  type EngineCoursePoolBlock,
  type EngineDragPayload,
  type EngineLesson
} from '../../services/engines/workbenchEngine'
import {
  buildRemainingCoursePool,
  buildRequiredCourseBlocks,
  findOddEvenCountIssues,
  type BuildRequiredCourseBlocksParams,
  type CoursePoolBlock
} from '../../services/engines/coursePoolEngine'
import {
  buildValidationReport as buildValidationMetrics,
  calcSchedulingProgress
} from '../../services/engines/schedulingMetricsEngine'
import { compileWorkbenchRules } from '../../services/engines/ruleCompiler'
import {
  solveSmartByApi,
  SmartSchedulerApiError,
  type ApiSolveDemand,
  type ApiSmartQueueUpdate,
  type ApiSmartSolveRequest,
  type ApiSmartPlacement,
  type ApiSmartSolveLog
} from '../../services/smartSchedulerApi'

type Lesson = {
  assignmentKey: string
  courseId: string
  courseIds?: string[]
  teacherId: string
  name: string
  teacher: string
  teacherNames?: string[]
  color: string
  isCombined?: boolean
  isOddEven?: boolean
  oddCourseId?: string
  evenCourseId?: string
  oddCourseName?: string
  evenCourseName?: string
  locked?: boolean
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

type TeacherSlotLesson = {
  classId: string
  className: string
  lesson: Lesson
}

type SmartRuleDetailItem = {
  name: string
  status: 'used' | 'unused' | 'not-integrated'
  detail: string
  source?: string
}

type SmartRuleDetailSection = {
  title: string
  items: SmartRuleDetailItem[]
}

type SmartSolveHistoryEntry = {
  id: string
  createdAt: number
  success: boolean
  summary: string
  logs: ApiSmartSolveLog[]
  ruleDetails: SmartRuleDetailSection[]
}

type ArrangementRow = {
  id: string
  className: string
  grade: string
  values: Record<string, number | null>
}

type ArrangementScopeState = {
  rows: ArrangementRow[]
  batchValues: Record<string, number | null>
}

type DragPayload =
  | { source: 'pool'; assignmentKey: string }
  | { source: 'grid'; classId: string; slotKey: string }

type SavedScheduleWorkbenchEntry = {
  selectedCampus: string
  selectedGrade: string
  selectedClass: string
  scheduleMap: Record<string, Record<string, Lesson | null>>
  savedAt: number
  publishedAt?: number
  version: number
}

type WorkbenchLockDraft = {
  updatedAt: number
  locks: Record<string, Record<string, boolean>>
}

type ClearScheduleScope = 'class' | 'grade'

const route = useRoute()
const planName = computed(() => (route.query.planName as string) || '默认方案')
const currentPlanId = computed(() => String(route.query.planId || 'default'))

const allDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const DEFAULT_DAILY_PERIODS = 8
const rangePeriods = (count: number) => Array.from({ length: count }, (_, index) => index + 1)

const campuses = ref<Campus[]>([])
const classRecords = ref<ClassRecord[]>([])
const teacherRecords = ref<Array<{ id: string; name: string }>>([])
const groupRecords = ref<GroupRecord[]>([])
const courses = ref<Array<{ id: string; name: string }>>([])
const teachingAssignments = ref<TeachingAssignmentRecord[]>([])
const classHourRows = ref<ClassHourRow[]>([])
const classHourClassRows = ref<ClassHourClassRow[]>([])
const arrangementScopes = ref<Record<string, ArrangementScopeState>>({})

const selectedCampus = ref('')
const selectedGrade = ref('')
const selectedClass = ref('')
const activePoolAssignmentKey = ref('')
const persistLoading = ref(false)
const workbenchReady = ref(false)
const smartSchedulingLoading = ref(false)
const smartProgressVisible = ref(false)
const smartProgressPercent = ref(0)
const smartProgressText = ref('准备中...')
const smartQueueUpdate = ref<ApiSmartQueueUpdate | null>(null)
const smartLogDialogVisible = ref(false)
const smartSolveLogs = ref<ApiSmartSolveLog[]>([])
const smartRuleDetailSections = ref<SmartRuleDetailSection[]>([])
const selectedSmartLogHistoryId = ref('')
const smartDetailCollapseActive = ref<string[]>([])
const lastPersistedAt = ref(0)
const lastPublishedAt = ref(0)
const publishDialogVisible = ref(false)
const clearSchedulePopoverVisible = ref(false)
const clearScheduleScope = ref<ClearScheduleScope>('class')
const workbenchPersistState = ref<WorkbenchPersistSnapshot>({ entries: {}, meta: {}, drafts: {}, logs: {} })
const progressSyncing = ref(false)
let smartProgressTimer: ReturnType<typeof setInterval> | null = null
let smartProgressStartAt = 0

const smartProgressTitle = computed(() => {
  if (smartQueueUpdate.value?.status === 'queued') return '智能排课排队中'
  if (smartQueueUpdate.value?.status === 'running') return '智能排课进行中'
  return '正在提交智能排课'
})

const scheduleMap = reactive<Record<string, Record<string, Lesson | null>>>({})
const dragging = ref<DragPayload | null>(null)
const lessonContextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  classId: '',
  slotKey: ''
})

const ruleSettingsSnapshotRef = ref<RuleSettingsSnapshot>(loadRuleSettingsSnapshot())
const compiledWorkbenchRules = computed(() => compileWorkbenchRules(ruleSettingsSnapshotRef.value, groupRecords.value))
const publishTypeOptions = [
  { value: 'class', label: '班级课表', description: '按班级查看课程、教师与节次安排' },
  { value: 'teacher', label: '教师课表', description: '按教师汇总本人承担的全部课程' },
  { value: 'course', label: '课程课表', description: '按课程查看各班级的上课分布' },
  { value: 'school', label: '学校课表', description: '汇总校区、年级和班级的整体课表' }
]

function getCurrentRuleWeightConfigForScope(): RuleWeightConfig {
  const snapshot = ruleSettingsSnapshotRef.value
  const campusName = campusNameById(selectedCampus.value)
  const grade = selectedGrade.value
  if (!campusName || !grade) {
    return JSON.parse(JSON.stringify(defaultRuleWeightConfig)) as RuleWeightConfig
  }
  const hit = (snapshot.ruleWeightConfigs || []).find((item) => item.campus === campusName && item.grade === grade)
  return JSON.parse(JSON.stringify(hit?.config || defaultRuleWeightConfig)) as RuleWeightConfig
}

function findRuleWeightRule(config: RuleWeightConfig, key: RuleWeightRuleKey) {
  return config.rules.find((item) => item.key === key)
}

function isHardRuleEnabled(config: RuleWeightConfig, key: RuleWeightRuleKey): boolean {
  if (!config.enabled) return true
  const row = findRuleWeightRule(config, key)
  if (!row) return true
  return row.mode === 'hard' && row.enabled
}

function getSoftRuleWeight(config: RuleWeightConfig, key: RuleWeightRuleKey, fallback: number): number {
  if (!config.enabled) return fallback
  const row = findRuleWeightRule(config, key)
  if (!row || row.mode !== 'soft' || !row.enabled) return 0
  const value = Math.floor(Number(row.weight) || 0)
  return Math.max(0, Math.min(100, value))
}

function isFeatureRuleEnabled(config: RuleWeightConfig, key: RuleWeightRuleKey, fallback = true): boolean {
  if (!config.enabled) return fallback
  const row = findRuleWeightRule(config, key)
  return row ? row.enabled : fallback
}

function keyOf(period: number, day: string): string {
  return `${period}-${day}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatLogTime(raw: string): string {
  const time = new Date(raw)
  if (Number.isNaN(time.getTime())) return raw || '-'
  const h = `${time.getHours()}`.padStart(2, '0')
  const m = `${time.getMinutes()}`.padStart(2, '0')
  const s = `${time.getSeconds()}`.padStart(2, '0')
  return `${h}:${m}:${s}`
}

function extractUnplacedDiagnostic(logs: ApiSmartSolveLog[]): string {
  const rows = Array.isArray(logs) ? logs : []
  const detail = rows.find((item) => String(item.phase || '').trim() === '诊断' && String(item.message || '').includes('未排课'))
  if (detail) return String(detail.message || '').trim()
  const summary = rows.find((item) => String(item.phase || '').trim() === '诊断')
  return summary ? String(summary.message || '').trim() : ''
}

function smartRuleStatusText(status: SmartRuleDetailItem['status']): string {
  if (status === 'used') return '已生效'
  if (status === 'unused') return '本次未命中'
  return '未接入求解'
}

const smartIntegratedRuleSections = computed(() =>
  smartRuleDetailSections.value
    .map((section) => ({
      title: section.title,
      items: section.items.filter((item) => item.status !== 'not-integrated')
    }))
    .filter((section) => section.items.length > 0)
)

const smartNotIntegratedRules = computed(() => {
  const rows: SmartRuleDetailItem[] = []
  smartRuleDetailSections.value.forEach((section) => {
    section.items
      .filter((item) => item.status === 'not-integrated')
      .forEach((item) => rows.push({ ...item, source: section.title }))
  })
  return rows
})

const smartNotIntegratedPriorityOrder = computed(() => {
  const priorityList = ['课程排课区域', '课程不排课', '课程关系', '连堂课', '主副科', '教案齐头', '分散方式', '上下节连续']
  const existing = new Set(smartNotIntegratedRules.value.map((item) => item.name))
  return priorityList.filter((name) => existing.has(name))
})

function cloneSmartRuleDetailSections(sections: SmartRuleDetailSection[] | undefined): SmartRuleDetailSection[] {
  if (!Array.isArray(sections)) return []
  return sections.map((section) => ({
    title: section.title,
    items: Array.isArray(section.items) ? section.items.map((item) => ({ ...item })) : []
  }))
}

function buildSmartRuleDetails(payload: ApiSmartSolveRequest, classIds: string[]): SmartRuleDetailSection[] {
  const snapshot = ruleSettingsSnapshotRef.value
  const campusName = campusNameById(selectedCampus.value)
  const grade = selectedGrade.value
  const classNameSet = new Set(
    classIds
      .map((classId) => classRecords.value.find((item) => item.id === classId)?.className || '')
      .filter(Boolean)
  )
  const activeCourseNames = new Set(
    payload.demands
      .flatMap((demand) => Object.values(demand.lessonsByClass || {}))
      .map((lesson) => lesson?.name || '')
      .filter(Boolean)
  )

  const oddEvenCount = payload.demands.filter((item) => String(item.assignmentKey || '').startsWith('oe:')).length
  const combineCount = payload.demands.filter((item) => (item.targetClassIds || []).length > 1).length
  const fixedCount = payload.fixedSlotKeys?.length || 0
  const ruleOptions = payload.ruleOptions || {}
  const enableGlobalFixedPoint = ruleOptions.enableGlobalFixedPoint !== false
  const enableCombineCourse = ruleOptions.enableCombineCourse !== false
  const enableCourseArea = ruleOptions.enableCourseArea !== false
  const enableCourseBan = ruleOptions.enableCourseBan !== false
  const enableMainSecondary = ruleOptions.enableMainSecondary !== false
  const enableCourseDefault = ruleOptions.enableCourseDefault !== false
  const enableOddEven = ruleOptions.enableOddEven !== false
  const enableCourseRelation = ruleOptions.enableCourseRelation !== false
  const teacherBanSlotCount = payload.demands.reduce((sum, demand) => {
    return (
      sum +
      Object.values(demand.forbiddenSlotsByClass || {}).reduce((s, list) => s + (Array.isArray(list) ? list.length : 0), 0)
    )
  }, 0)
  const teacherHourConstraintCount = payload.teacherHourConstraints?.length || 0
  const teacherMutualConstraintCount = payload.teacherMutualConstraints?.length || 0
  const consecutiveConstraintCount = payload.consecutiveConstraints?.length || 0
  const courseRelationConstraintCount = payload.courseRelationConstraints?.length || 0

  const areaRuleHitCount = (snapshot.courseAreaRules || []).filter((item) => {
    if (item.campus !== campusName) return false
    if (item.grade !== grade) return false
    if (!classNameSet.has(item.className)) return false
    return activeCourseNames.has(item.subject)
  }).length

  const banRuleHitCount = (snapshot.courseBanRules || []).filter((item) => {
    if (item.campus !== campusName) return false
    if (item.grade !== grade) return false
    if (!classNameSet.has(item.className)) return false
    return activeCourseNames.has(item.subject)
  }).length

  const normalRules: SmartRuleDetailItem[] = [
    {
      name: '全局固定点',
      status: !enableGlobalFixedPoint ? 'unused' : fixedCount > 0 ? 'used' : 'unused',
      detail: !enableGlobalFixedPoint ? '已在规则权重中关闭。' : fixedCount > 0 ? `限制了 ${fixedCount} 个节次。` : '当前范围没有命中固定点。'
    },
    {
      name: '教师不排课',
      status: teacherBanSlotCount > 0 ? 'used' : 'unused',
      detail: teacherBanSlotCount > 0 ? `累计限制 ${teacherBanSlotCount} 个教师禁排槽位。` : '当前范围没有命中教师禁排。'
    },
    {
      name: '教师课时',
      status: teacherHourConstraintCount > 0 ? 'used' : 'unused',
      detail: teacherHourConstraintCount > 0 ? `对 ${teacherHourConstraintCount} 位教师启用了课时约束。` : '当前范围没有命中教师课时约束。'
    },
    {
      name: '教师互斥',
      status: teacherMutualConstraintCount > 0 ? 'used' : 'unused',
      detail: teacherMutualConstraintCount > 0 ? `命中 ${teacherMutualConstraintCount} 组教师互斥约束。` : '当前范围没有命中教师互斥约束。'
    },
    {
      name: '合班课',
      status: !enableCombineCourse ? 'unused' : combineCount > 0 ? 'used' : 'unused',
      detail: !enableCombineCourse
        ? '已在规则权重中关闭。'
        : combineCount > 0
          ? `检测到 ${combineCount} 条多班联排需求。`
          : '当前范围没有合班课需求。'
    },
    {
      name: '单双周',
      status: !enableOddEven ? 'unused' : oddEvenCount > 0 ? 'used' : 'unused',
      detail: !enableOddEven
        ? '已在规则权重中关闭。'
        : oddEvenCount > 0
          ? `检测到 ${oddEvenCount} 条单双周合并需求。`
          : '当前范围没有单双周需求。'
    },
    {
      name: '课程排课区域',
      status: !enableCourseArea ? 'unused' : areaRuleHitCount > 0 ? 'used' : 'unused',
      detail: !enableCourseArea
        ? '已在规则权重中关闭。'
        : areaRuleHitCount > 0
          ? `命中 ${areaRuleHitCount} 条课程排课区域规则。`
          : '当前范围没有命中课程排课区域规则。'
    },
    {
      name: '课程不排课',
      status: !enableCourseBan ? 'unused' : banRuleHitCount > 0 ? 'used' : 'unused',
      detail: !enableCourseBan
        ? '已在规则权重中关闭。'
        : banRuleHitCount > 0
          ? `命中 ${banRuleHitCount} 条课程不排课规则。`
          : '当前范围没有命中课程不排课规则。'
    },
    {
      name: '连堂课',
      status: consecutiveConstraintCount > 0 ? 'used' : 'unused',
      detail: consecutiveConstraintCount > 0 ? `命中 ${consecutiveConstraintCount} 条连堂课约束。` : '当前范围没有命中连堂课约束。'
    },
    {
      name: '课程关系',
      status: !enableCourseRelation ? 'unused' : courseRelationConstraintCount > 0 ? 'used' : 'unused',
      detail: !enableCourseRelation
        ? '已在规则权重中关闭。'
        : courseRelationConstraintCount > 0
          ? `命中 ${courseRelationConstraintCount} 条课程关系硬约束。`
          : '当前范围没有命中课程关系。'
    },
    {
      name: '主副科',
      status:
        !enableMainSecondary || !enableCourseDefault
          ? 'unused'
          : ((payload.defaultRules?.mainCourseIds?.length || 0) + (payload.defaultRules?.secondaryCourseIds?.length || 0) > 0
            ? 'used'
            : 'unused'),
      detail:
        !enableCourseDefault
          ? '课程默认规则已在规则权重中关闭。'
          : !enableMainSecondary
            ? '已在规则权重中关闭。'
            : ((payload.defaultRules?.mainCourseIds?.length || 0) + (payload.defaultRules?.secondaryCourseIds?.length || 0) > 0
              ? '主副科已接入默认规则判定。'
              : '当前范围没有命中主副科配置。')
    }
  ]

  const defaultConfig = snapshot.courseDefaultConfig
  const defaultRuleNameMap: Record<string, string> = {
    syncStart: '教案齐头',
    distribution: '分散方式',
    noCrossNoon: '上下节连续',
    sameClassNoConsecutive: '同班无连堂课设置的课程',
    twoLessonsGap: '同一个班，周课时为2节的课程至少间隔一天'
  }

  const defaultRules: SmartRuleDetailItem[] = Object.entries(defaultRuleNameMap).map(([key, label]) => {
    const enabled = Boolean(defaultConfig?.enabled) && Boolean(defaultConfig?.ruleEnabled?.[key as keyof typeof defaultConfig.ruleEnabled])
    const rulePayload = payload.defaultRules?.[key as keyof NonNullable<ApiSmartSolveRequest['defaultRules']>]
    const integrated =
      enableCourseDefault &&
      enabled &&
      Boolean(rulePayload && typeof rulePayload === 'object' && 'enabled' in rulePayload && rulePayload.enabled)
    return {
      name: label,
      status: !enableCourseDefault || !enabled ? 'unused' : integrated ? 'used' : 'unused',
      detail: !enableCourseDefault
        ? '已在规则权重中关闭。'
        : !enabled
          ? '未开启。'
          : integrated
            ? '已开启，求解器按硬约束处理。'
            : '已开启，但本次请求未启用。'
    }
  })

  return [
    { title: '普通规则命中情况', items: normalRules },
    { title: '默认规则命中情况', items: defaultRules }
  ]
}

function stopSmartProgressTimer(): void {
  if (smartProgressTimer) {
    clearInterval(smartProgressTimer)
    smartProgressTimer = null
  }
}

function startSmartProgress(): void {
  stopSmartProgressTimer()
  smartProgressStartAt = Date.now()
  smartQueueUpdate.value = null
  smartProgressVisible.value = true
  smartProgressPercent.value = 4
  smartProgressText.value = '正在提交智能排课任务...'
}

function startSmartSolveProgress(): void {
  if (smartProgressTimer) return
  smartProgressPercent.value = Math.max(18, smartProgressPercent.value)
  smartProgressText.value = '正在构建约束模型并求解...'
  smartProgressTimer = setInterval(() => {
    const current = smartProgressPercent.value
    if (current >= 92) return
    const next = Math.min(92, current + (current < 45 ? 3 : current < 75 ? 2 : 1))
    smartProgressPercent.value = next
    if (next < 35) {
      smartProgressText.value = '正在加载班级与课程数据...'
    } else if (next < 65) {
      smartProgressText.value = '正在构建 OR-Tools 约束模型...'
    } else {
      smartProgressText.value = '求解中，请稍候...'
    }
  }, 800)
}

function handleSmartQueueUpdate(update: ApiSmartQueueUpdate): void {
  const previousStatus = smartQueueUpdate.value?.status
  smartQueueUpdate.value = update
  if (update.status === 'queued') {
    stopSmartProgressTimer()
    smartProgressPercent.value = 8
    smartProgressText.value =
      update.waitingAhead > 0
        ? `正在排队，前方还有 ${update.waitingAhead} 个任务。`
        : '任务已进入队列，等待开始。'
    return
  }
  if (update.status === 'running') {
    if (previousStatus !== 'running') startSmartSolveProgress()
    return
  }
  if (update.status === 'completed') {
    stopSmartProgressTimer()
    smartProgressPercent.value = 96
    smartProgressText.value = '求解完成，正在读取排课结果...'
    return
  }
  if (update.status === 'failed') {
    stopSmartProgressTimer()
    smartProgressText.value = '智能排课未完成，正在读取失败原因...'
  }
}

function formatQueueEstimate(raw: string | null): string {
  if (!raw) return '计算中'
  const time = new Date(raw)
  if (Number.isNaN(time.getTime())) return '计算中'
  const now = new Date()
  const hh = `${time.getHours()}`.padStart(2, '0')
  const mm = `${time.getMinutes()}`.padStart(2, '0')
  const ss = `${time.getSeconds()}`.padStart(2, '0')
  if (time.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}:${ss}`
  return `${time.getMonth() + 1}月${time.getDate()}日 ${hh}:${mm}:${ss}`
}

function formatEstimatedDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.ceil(Number(durationMs || 0) / 1000))
  if (seconds < 60) return `约 ${seconds} 秒`
  const minutes = Math.ceil(seconds / 60)
  return `约 ${minutes} 分钟`
}

async function finishSmartProgress(success: boolean): Promise<void> {
  stopSmartProgressTimer()
  const elapsed = Date.now() - smartProgressStartAt
  const minDisplayMs = 1400
  if (elapsed < minDisplayMs) {
    await sleep(minDisplayMs - elapsed)
  }
  smartProgressPercent.value = 100
  smartProgressText.value = success ? '智能排课完成，正在应用结果...' : '智能排课失败，正在结束...'
  await sleep(320)
  smartProgressVisible.value = false
  smartQueueUpdate.value = null
}

function ensureClassGrid(classId: string): void {
  if (!classId) return
  const dayCount = resolveWeeklyDaysCountByClassId(classId)
  const periodCount = resolveDailyPeriodsCountByClassId(classId)
  if (!scheduleMap[classId]) {
    const grid: Record<string, Lesson | null> = {}
    rangePeriods(periodCount).forEach((period) => {
      allDays.slice(0, dayCount).forEach((day) => {
        grid[keyOf(period, day)] = null
      })
    })
    scheduleMap[classId] = grid
    return
  }
  rangePeriods(periodCount).forEach((period) => {
    allDays.slice(0, dayCount).forEach((day) => {
      const slotKey = keyOf(period, day)
      if (!(slotKey in scheduleMap[classId])) {
        scheduleMap[classId][slotKey] = null
      }
    })
  })
}

const campusOptions = computed(() =>
  campuses.value.map((item) => ({
    id: item.id,
    name: item.name || '未命名校区'
  }))
)

const gradeOptions = computed(() => {
  if (!selectedCampus.value) return []
  const set = new Set<string>()
  classRecords.value.forEach((item) => {
    if (item.campusId === selectedCampus.value) set.add(item.grade)
  })
  return Array.from(set)
})

const classTabs = computed(() =>
  classRecords.value.filter((item) => item.campusId === selectedCampus.value && item.grade === selectedGrade.value)
)

function resolveWeeklyDaysCountByClassId(classId: string): number {
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return 5
  const classHour = classHourClassRows.value.find((item) => item.classId === classInfo.id)
  const gradeHour = classHourRows.value.find((item) => item.campusId === classInfo.campusId && item.grade === classInfo.grade)
  const count = classHour?.weeklyDays ?? gradeHour?.weeklyDays ?? 5
  return Math.max(1, Math.min(7, Math.floor(Number(count) || 5)))
}

function resolveDailyPeriodsCountByClassId(classId: string): number {
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return DEFAULT_DAILY_PERIODS
  const classHour = classHourClassRows.value.find((item) => item.classId === classInfo.id)
  const gradeHour = classHourRows.value.find((item) => item.campusId === classInfo.campusId && item.grade === classInfo.grade)
  const target = classHour ?? gradeHour
  if (!target) return DEFAULT_DAILY_PERIODS
  const total =
    Number(target.morningLessons || 0) +
    Number(target.afternoonLessons || 0)
  return Math.max(1, Math.min(20, Math.floor(Number(total) || DEFAULT_DAILY_PERIODS)))
}

function resolveMorningLessonsCountByClassId(classId: string): number {
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return 0
  const classHour = classHourClassRows.value.find((item) => item.classId === classInfo.id)
  const gradeHour = classHourRows.value.find((item) => item.campusId === classInfo.campusId && item.grade === classInfo.grade)
  const count = Math.floor(Number((classHour ?? gradeHour)?.morningLessons || 0))
  return Math.max(0, Math.min(resolveDailyPeriodsCountByClassId(classId), count))
}

const weeklyDaysCount = computed(() => {
  return resolveWeeklyDaysCountByClassId(selectedClass.value)
})

const days = computed(() => allDays.slice(0, weeklyDaysCount.value))
const dailyPeriodsCount = computed(() => resolveDailyPeriodsCountByClassId(selectedClass.value))
const morningLessonsCount = computed(() => resolveMorningLessonsCountByClassId(selectedClass.value))
const periods = computed(() => rangePeriods(dailyPeriodsCount.value))
const teacherWeeklyDaysCount = computed(() => {
  const campusClassIds = classRecords.value
    .filter((item) => item.campusId === selectedCampus.value)
    .map((item) => item.id)
  if (campusClassIds.length <= 0) return weeklyDaysCount.value
  return Math.max(...campusClassIds.map((classId) => resolveWeeklyDaysCountByClassId(classId)))
})
const teacherDays = computed(() => allDays.slice(0, teacherWeeklyDaysCount.value))
const teacherDailyPeriodsCount = computed(() => {
  const campusClassIds = classRecords.value
    .filter((item) => item.campusId === selectedCampus.value)
    .map((item) => item.id)
  if (campusClassIds.length <= 0) return dailyPeriodsCount.value
  return Math.max(...campusClassIds.map((classId) => resolveDailyPeriodsCountByClassId(classId)))
})
const teacherPeriods = computed(() => rangePeriods(teacherDailyPeriodsCount.value))

function classLabelById(classId: string): string {
  return classRecords.value.find((item) => item.id === classId)?.className || classId
}

function campusNameById(campusId: string): string {
  return campuses.value.find((item) => item.id === campusId)?.name || ''
}

function classIdByName(campusId: string, grade: string, className: string): string | null {
  const hit = classRecords.value.find(
    (item) => item.campusId === campusId && item.grade === grade && item.className === className
  )
  return hit?.id || null
}

function globalFixedPointAt(period: number, day: string): { label: string } | null {
  const campusName = campusNameById(selectedCampus.value)
  if (!campusName) return null
  const label = compiledWorkbenchRules.value.getFixedPointLabel(campusName, selectedGrade.value, period, day)
  if (!label) return null
  return { label }
}

function resolveCampusId(raw: string): string {
  if (!raw) return ''
  const byId = campuses.value.find((item) => item.id === raw)
  if (byId) return byId.id
  const byName = campuses.value.find((item) => item.name === raw)
  return byName?.id || ''
}

function resolveClassId(raw: string): string {
  if (!raw) return ''
  const byId = classRecords.value.find((item) => item.id === raw)
  if (byId) return byId.id
  const byName = classRecords.value.find(
    (item) =>
      item.className === raw &&
      (!selectedCampus.value || item.campusId === selectedCampus.value) &&
      (!selectedGrade.value || item.grade === selectedGrade.value)
  )
  return byName?.id || ''
}

function ensureSelectionValid(): void {
  const firstCampus = campusOptions.value[0]?.id || ''
  if (!selectedCampus.value || !campusOptions.value.some((item) => item.id === selectedCampus.value)) {
    selectedCampus.value = firstCampus
  }

  const firstGrade = gradeOptions.value[0] || ''
  if (!selectedGrade.value || !gradeOptions.value.includes(selectedGrade.value)) {
    selectedGrade.value = firstGrade
  }

  const firstClass = classTabs.value[0]?.id || ''
  if (!selectedClass.value || !classTabs.value.some((item) => item.id === selectedClass.value)) {
    selectedClass.value = firstClass
  }
}

function clearAllScheduleCells(): void {
  Object.values(scheduleMap).forEach((grid) => {
    Object.keys(grid).forEach((slotKey) => {
      grid[slotKey] = null
    })
  })
}

function loadWorkbenchMeta(planId: string): { savedAt: number; publishedAt: number } {
  const item = workbenchPersistState.value.meta?.[planId]
  return {
    savedAt: Number(item?.savedAt || 0),
    publishedAt: Number(item?.publishedAt || 0)
  }
}

function saveWorkbenchMeta(planId: string, savedAt: number, publishedAt: number): void {
  workbenchPersistState.value = {
    ...workbenchPersistState.value,
    meta: {
      ...(workbenchPersistState.value.meta || {}),
      [planId]: { savedAt, publishedAt }
    }
  }
  void saveWorkbenchPersistSnapshot(workbenchPersistState.value)
}

function cloneLesson(lesson: Lesson | null): Lesson | null {
  if (!lesson) return null
  const assignmentKey = String(lesson.assignmentKey || '')
  const isOddEven = Boolean(lesson.isOddEven || assignmentKey.startsWith('oe:'))
  const pairedCourseIds = assignmentKey.startsWith('oe:')
    ? assignmentKey.slice(3).split('|').map((item) => item.trim()).filter(Boolean)
    : Array.isArray(lesson.courseIds)
      ? lesson.courseIds.filter(Boolean)
      : []
  const pairedCourseNames = String(lesson.name || '').split('/').map((item) => item.trim())
  return {
    assignmentKey: lesson.assignmentKey,
    courseId: lesson.courseId,
    courseIds: Array.isArray(lesson.courseIds) ? [...lesson.courseIds] : undefined,
    teacherId: lesson.teacherId,
    name: lesson.name,
    teacher: lesson.teacher,
    teacherNames: Array.isArray(lesson.teacherNames) ? [...lesson.teacherNames] : undefined,
    color: lesson.color,
    isCombined: Boolean(lesson.isCombined),
    isOddEven,
    oddCourseId: lesson.oddCourseId || (isOddEven ? pairedCourseIds[0] : undefined),
    evenCourseId: lesson.evenCourseId || (isOddEven ? pairedCourseIds[1] : undefined),
    oddCourseName: lesson.oddCourseName || (isOddEven ? pairedCourseNames[0] : undefined),
    evenCourseName: lesson.evenCourseName || (isOddEven ? pairedCourseNames[1] : undefined),
    locked: Boolean(lesson.locked)
  }
}

function snapshotScheduleMap(): Record<string, Record<string, Lesson | null>> {
  const result: Record<string, Record<string, Lesson | null>> = {}
  classRecords.value.forEach((item) => {
    ensureClassGrid(item.id)
    const grid = scheduleMap[item.id]
    const nextGrid: Record<string, Lesson | null> = {}
    Object.keys(grid).forEach((slotKey) => {
      nextGrid[slotKey] = cloneLesson(grid[slotKey])
    })
    result[item.id] = nextGrid
  })
  return result
}

function readSavedWorkbenchEntry(): SavedScheduleWorkbenchEntry | null {
  const entry = workbenchPersistState.value.entries?.[currentPlanId.value]
  if (!entry || typeof entry !== 'object') return null
  return entry as SavedScheduleWorkbenchEntry
}

function snapshotLocksOnly(): Record<string, Record<string, boolean>> {
  const result: Record<string, Record<string, boolean>> = {}
  classRecords.value.forEach((classInfo) => {
    ensureClassGrid(classInfo.id)
    const lockMap: Record<string, boolean> = {}
    Object.entries(scheduleMap[classInfo.id] || {}).forEach(([slotKey, lesson]) => {
      if (!lesson) return
      lockMap[slotKey] = Boolean(lesson.locked)
    })
    result[classInfo.id] = lockMap
  })
  return result
}

function readLockDraft(): WorkbenchLockDraft | null {
  const raw = workbenchPersistState.value.drafts?.[currentPlanId.value]
  if (!raw || typeof raw !== 'object') return null
  const draft = raw as Partial<WorkbenchLockDraft>
  const locks = draft.locks && typeof draft.locks === 'object' ? (draft.locks as WorkbenchLockDraft['locks']) : {}
  return {
    updatedAt: Number(draft.updatedAt || 0),
    locks
  }
}

function writeLockDraft(): void {
  workbenchPersistState.value = {
    ...workbenchPersistState.value,
    drafts: {
      ...(workbenchPersistState.value.drafts || {}),
      [currentPlanId.value]: {
        updatedAt: Date.now(),
        locks: snapshotLocksOnly()
      } satisfies WorkbenchLockDraft
    }
  }
  void saveWorkbenchPersistSnapshot(workbenchPersistState.value)
}

function applyLockDraft(): void {
  const draft = readLockDraft()
  if (!draft) return
  classRecords.value.forEach((classInfo) => {
    ensureClassGrid(classInfo.id)
    const classLockMap = draft.locks?.[classInfo.id] || {}
    Object.entries(scheduleMap[classInfo.id] || {}).forEach(([slotKey, lesson]) => {
      if (!lesson) return
      lesson.locked = Boolean(classLockMap[slotKey])
    })
  })
}

function readSmartLogHistory(): SmartSolveHistoryEntry[] {
  const raw = workbenchPersistState.value.logs?.[currentPlanId.value]
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Partial<SmartSolveHistoryEntry>
      return {
        id: String(record.id || `log-${Date.now()}-${Math.floor(Math.random() * 10000)}`),
        createdAt: Number(record.createdAt || 0),
        success: Boolean(record.success),
        summary: String(record.summary || ''),
        logs: Array.isArray(record.logs) ? (record.logs as ApiSmartSolveLog[]) : [],
        ruleDetails: cloneSmartRuleDetailSections(record.ruleDetails)
      } satisfies SmartSolveHistoryEntry
    })
    .filter((item): item is SmartSolveHistoryEntry => Boolean(item))
    .sort((a, b) => b.createdAt - a.createdAt)
}

function writeSmartLogHistory(list: SmartSolveHistoryEntry[]): void {
  workbenchPersistState.value = {
    ...workbenchPersistState.value,
    logs: {
      ...(workbenchPersistState.value.logs || {}),
      [currentPlanId.value]: list
    }
  }
  void saveWorkbenchPersistSnapshot(workbenchPersistState.value)
}

function appendSmartLogHistory(entry: SmartSolveHistoryEntry): void {
  const next = [entry, ...readSmartLogHistory()].slice(0, 80)
  writeSmartLogHistory(next)
}

const smartLogHistory = computed(() => readSmartLogHistory())
const selectedSmartLogRecord = computed(() => {
  if (!smartLogHistory.value.length) return null
  const matched = smartLogHistory.value.find((item) => item.id === selectedSmartLogHistoryId.value)
  return matched || smartLogHistory.value[0]
})

function applyWorkbenchState(state: {
  selectedCampus: string
  selectedGrade: string
  selectedClass: string
  scheduleMap: Record<string, Record<string, Lesson | null>>
}): void {
  selectedCampus.value = resolveCampusId(state.selectedCampus)
  selectedGrade.value = state.selectedGrade || ''
  selectedClass.value = resolveClassId(state.selectedClass)
  ensureSelectionValid()
  classRecords.value.forEach((item) => {
    const classId = item.id
    ensureClassGrid(classId)
    const incoming = state.scheduleMap?.[classId] || {}
    Object.keys(scheduleMap[classId]).forEach((slotKey) => {
      scheduleMap[classId][slotKey] = incoming[slotKey] ? cloneLesson(incoming[slotKey]) : null
    })
  })
}

function loadSnapshot(): void {
  const meta = loadWorkbenchMeta(currentPlanId.value)
  lastPersistedAt.value = meta.savedAt
  lastPublishedAt.value = meta.publishedAt

  const history = readSmartLogHistory()
  selectedSmartLogHistoryId.value = history[0]?.id || ''
  if (history[0]) {
    smartSolveLogs.value = Array.isArray(history[0].logs) ? [...history[0].logs] : []
    smartRuleDetailSections.value = cloneSmartRuleDetailSections(history[0].ruleDetails)
  } else {
    smartSolveLogs.value = []
    smartRuleDetailSections.value = []
  }

  const savedEntry = readSavedWorkbenchEntry()
  const savedUpdatedAt = Number(savedEntry?.savedAt || 0)

  if (savedEntry && savedUpdatedAt > 0) {
    applyWorkbenchState(savedEntry)
    syncScheduledLessonMeta()
    applyLockDraft()
    const publishedAt = Number(savedEntry.publishedAt || 0)
    if (savedUpdatedAt > lastPersistedAt.value) lastPersistedAt.value = savedUpdatedAt
    if (publishedAt > lastPublishedAt.value) lastPublishedAt.value = publishedAt
    saveWorkbenchMeta(currentPlanId.value, lastPersistedAt.value, lastPublishedAt.value)
    return
  }

  classRecords.value.forEach((item) => ensureClassGrid(item.id))
  syncScheduledLessonMeta()
  applyLockDraft()
}

async function hydrateBasicData(): Promise<void> {
  try {
    workbenchPersistState.value = await loadWorkbenchPersistSnapshot()
    const loaded = basicDataRepository.load()
    const parsed = loaded instanceof Promise ? await loaded : loaded
    const safe = parsed && typeof parsed === 'object' ? parsed : {}
    campuses.value = Array.isArray((safe as { campuses?: unknown[] }).campuses)
      ? ((safe as { campuses: Campus[] }).campuses || [])
      : []
    classRecords.value = Array.isArray((safe as { classRecords?: unknown[] }).classRecords)
      ? ((safe as { classRecords: ClassRecord[] }).classRecords || [])
      : []
    teacherRecords.value = Array.isArray((safe as { teacherRecords?: unknown[] }).teacherRecords)
      ? ((safe as { teacherRecords: Array<{ id: string; name: string }> }).teacherRecords || [])
      : []
    groupRecords.value = Array.isArray((safe as { groupRecords?: unknown[] }).groupRecords)
      ? ((safe as { groupRecords: GroupRecord[] }).groupRecords || [])
      : []
    courses.value = Array.isArray((safe as { courses?: unknown[] }).courses)
      ? ((safe as { courses: Array<{ id: string; name: string }> }).courses || [])
      : []
    teachingAssignments.value = Array.isArray((safe as { teachingAssignments?: unknown[] }).teachingAssignments)
      ? ((safe as { teachingAssignments: TeachingAssignmentRecord[] }).teachingAssignments || [])
      : []
    classHourRows.value = Array.isArray((safe as { classHourRows?: unknown[] }).classHourRows)
      ? ((safe as { classHourRows: ClassHourRow[] }).classHourRows || [])
      : []
    classHourClassRows.value = Array.isArray((safe as { classHourClassRows?: unknown[] }).classHourClassRows)
      ? ((safe as { classHourClassRows: ClassHourClassRow[] }).classHourClassRows || [])
      : []
    arrangementScopes.value =
      (safe as { arrangementScopes?: unknown }).arrangementScopes &&
      typeof (safe as { arrangementScopes?: unknown }).arrangementScopes === 'object'
        ? ((safe as { arrangementScopes: Record<string, ArrangementScopeState> }).arrangementScopes || {})
        : {}
    ensureSelectionValid()
    loadSnapshot()
  } finally {
    workbenchReady.value = true
  }
}

void hydrateBasicData()

watch(selectedCampus, () => {
  ensureSelectionValid()
  activePoolAssignmentKey.value = ''
})

watch(selectedGrade, () => {
  ensureSelectionValid()
  activePoolAssignmentKey.value = ''
})

watch(
  classTabs,
  (nextTabs) => {
    nextTabs.forEach((item) => ensureClassGrid(item.id))
    ensureSelectionValid()
  },
  { immediate: true }
)

watch(
  selectedSmartLogRecord,
  (record) => {
    if (!record) return
    smartSolveLogs.value = Array.isArray(record.logs) ? [...record.logs] : []
    smartRuleDetailSections.value = cloneSmartRuleDetailSections(record.ruleDetails)
  },
  { immediate: true }
)

const currentGrid = computed(() => {
  if (!selectedClass.value) return {} as Record<string, Lesson | null>
  ensureClassGrid(selectedClass.value)
  return scheduleMap[selectedClass.value]
})

const teacherNameMap = computed(() => new Map(teacherRecords.value.map((item) => [item.id, item.name] as const)))
const courseNameMap = computed(() => new Map(courses.value.map((item) => [item.id, item.name] as const)))
const courseColorPalette = [
  '#4f87c3', '#1eb3ac', '#c068b1', '#e0a315', '#b69567', '#48b751', '#85a827', '#3ba0bf',
  '#c48415', '#a992bb', '#e06c75', '#56b6c2', '#98c379', '#d19a66', '#61afef', '#c678dd',
  '#2a9d8f', '#f4a261', '#e76f51', '#6a994e', '#577590', '#b56576', '#43aa8b', '#f3722c',
  '#f8961e', '#90be6d', '#277da1', '#b5179e', '#219ebc', '#ff7f50', '#8ecae6', '#fb8500'
]

function generatedColorByIndex(index: number): string {
  // Use golden-angle hue spacing for near-uniform distinct colors.
  const hue = Math.round((index * 137.508) % 360)
  return `hsl(${hue} 58% 48%)`
}

const courseColorMap = computed(() => {
  const map = new Map<string, string>()
  courses.value.forEach((course, index) => {
    const color = courseColorPalette[index] || generatedColorByIndex(index - courseColorPalette.length)
    map.set(course.id, color)
  })
  return map
})

const assignmentTeacherByClassCourse = computed(() => {
  const map = new Map<string, { teacherId: string; teacherName: string }>()
  teachingAssignments.value.forEach((item) => {
    const key = `${item.classId}::${item.courseId}`
    if (map.has(key)) return
    const teacherName = teacherNameMap.value.get(item.teacherId)
    if (!teacherName) return
    map.set(key, { teacherId: item.teacherId, teacherName })
  })
  return map
})

function resolveLessonMeta(classId: string, courseId: string, fallback: Lesson): { teacherId: string; teacher: string; name: string; color: string } {
  const assigned = assignmentTeacherByClassCourse.value.get(`${classId}::${courseId}`)
  return {
    teacherId: assigned?.teacherId ?? '',
    teacher: assigned?.teacherName ?? '未设置教师',
    name: courseNameMap.value.get(courseId) || fallback.name,
    color: courseColorMap.value.get(courseId) || fallback.color || '#5b8fd1'
  }
}

function resolveCompositeLessonMeta(
  classId: string,
  courseIds: string[],
  fallback: Lesson
): { teacherId: string; teacher: string; teacherNames: string[]; name: string; color: string } {
  const normalized = Array.from(new Set(courseIds.filter(Boolean)))
  const names: string[] = []
  const teacherNames: string[] = []
  normalized.forEach((courseId, index) => {
    const assigned = assignmentTeacherByClassCourse.value.get(`${classId}::${courseId}`)
    names.push(courseNameMap.value.get(courseId) || fallback.name?.split('/')[index]?.trim() || courseId)
    teacherNames.push(assigned?.teacherName || fallback.teacherNames?.[index] || '未设置教师')
  })
  const teacherId = assignmentTeacherByClassCourse.value.get(`${classId}::${normalized[0]}`)?.teacherId || ''
  return {
    teacherId,
    teacher: teacherNames.join(' / '),
    teacherNames,
    name: names.join('/'),
    color: courseColorMap.value.get(normalized[0]) || fallback.color || '#5b8fd1'
  }
}

function syncScheduledLessonMeta(): void {
  classRecords.value.forEach((classItem) => {
    ensureClassGrid(classItem.id)
    Object.entries(scheduleMap[classItem.id]).forEach(([slotKey, lesson]) => {
      if (!lesson) return
      const courseIds = Array.isArray(lesson.courseIds) && lesson.courseIds.length > 0
        ? lesson.courseIds.filter(Boolean)
        : [lesson.courseId || lesson.assignmentKey].filter(Boolean)
      if (courseIds.length <= 0) return

      if (courseIds.length > 1) {
        const nextMeta = resolveCompositeLessonMeta(classItem.id, courseIds, lesson)
        if (
          lesson.courseId === courseIds[0] &&
          JSON.stringify(lesson.courseIds || []) === JSON.stringify(courseIds) &&
          lesson.teacherId === nextMeta.teacherId &&
          lesson.teacher === nextMeta.teacher &&
          JSON.stringify(lesson.teacherNames || []) === JSON.stringify(nextMeta.teacherNames) &&
          lesson.name === nextMeta.name &&
          lesson.color === nextMeta.color
        ) {
          return
        }
        scheduleMap[classItem.id][slotKey] = {
          ...lesson,
          assignmentKey: lesson.assignmentKey || `oe:${courseIds.join('|')}`,
          courseId: courseIds[0],
          courseIds,
          teacherId: nextMeta.teacherId,
          teacher: nextMeta.teacher,
          teacherNames: nextMeta.teacherNames,
          name: nextMeta.name,
          color: nextMeta.color
        }
        return
      }

      const courseId = courseIds[0]
      const nextMeta = resolveLessonMeta(classItem.id, courseId, lesson)
      if (
        lesson.courseId === courseId &&
        lesson.teacherId === nextMeta.teacherId &&
        lesson.teacher === nextMeta.teacher &&
        lesson.name === nextMeta.name &&
        lesson.color === nextMeta.color
      ) {
        return
      }
      scheduleMap[classItem.id][slotKey] = {
        ...lesson,
        assignmentKey: lesson.assignmentKey || courseId,
        courseId,
        courseIds: [courseId],
        teacherId: nextMeta.teacherId,
        teacher: nextMeta.teacher,
        teacherNames: [nextMeta.teacher],
        name: nextMeta.name,
        color: nextMeta.color,
        isCombined: Boolean(lesson.isCombined)
      }
    })
  })
}

function lessonFromBlock(block: CoursePoolBlock): Lesson {
  const normalizedCourseIds = Array.isArray(block.courseIds) && block.courseIds.length > 0
    ? block.courseIds.filter(Boolean)
    : [block.assignmentKey]
  const normalizedTeacherNames = Array.isArray(block.teacherNames) && block.teacherNames.length > 0
    ? block.teacherNames.filter(Boolean)
    : [block.teacher]
  return {
    assignmentKey: block.assignmentKey,
    courseId: normalizedCourseIds[0] || block.assignmentKey,
    courseIds: normalizedCourseIds,
    teacherId: '',
    name: block.name,
    teacher: normalizedTeacherNames.join(' / '),
    teacherNames: normalizedTeacherNames,
    color: block.color,
    isOddEven: Boolean(block.isOddEven),
    oddCourseId: block.oddCourseId,
    evenCourseId: block.evenCourseId,
    oddCourseName: block.oddCourseName,
    evenCourseName: block.evenCourseName,
    locked: false
  }
}

function findMatchedCombineRule(classId: string, block: CoursePoolBlock) {
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return null
  const campusName = campusNameById(classInfo.campusId)
  if (!campusName) return null
  const courseNames = new Set(
    block.courseIds
      .map((courseId) => courseNameMap.value.get(courseId) || '')
      .filter(Boolean)
  )
  if (courseNames.size <= 0) return null

  return compiledWorkbenchRules.value.matchCombineRule(campusName, classInfo.grade, classInfo.className, courseNames)
}

function isPoolBlockCombined(block: CoursePoolBlock): boolean {
  if (!selectedClass.value) return false
  return Boolean(findMatchedCombineRule(selectedClass.value, block))
}

function resolveDropTargetClassIds(classId: string, block: CoursePoolBlock): string[] {
  const matchedRule = findMatchedCombineRule(classId, block)
  if (!matchedRule) return [classId]
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return [classId]
  const ids = matchedRule.classNames
    .map((className) => classIdByName(classInfo.campusId, classInfo.grade, className))
    .filter((item): item is string => Boolean(item))
  if (ids.length <= 0) return [classId]
  if (!ids.includes(classId)) ids.unshift(classId)
  return Array.from(new Set(ids))
}

function buildLessonForClassFromBlock(classId: string, block: CoursePoolBlock): Lesson {
  const base = lessonFromBlock(block)
  const courseIds = Array.isArray(base.courseIds) && base.courseIds.length > 0 ? base.courseIds : [base.courseId]
  if (courseIds.length > 1) {
    const meta = resolveCompositeLessonMeta(classId, courseIds, base)
    return {
      ...base,
      teacherId: meta.teacherId,
      teacher: meta.teacher,
      teacherNames: meta.teacherNames,
      name: meta.name,
      color: meta.color
    }
  }
  const meta = resolveLessonMeta(classId, courseIds[0], base)
  return {
    ...base,
    teacherId: meta.teacherId,
    teacher: meta.teacher,
    teacherNames: [meta.teacher],
    name: meta.name,
    color: meta.color
  }
}

function buildCoursePoolParamsForClass(
  classId: string,
  options?: {
    enableOddEven?: boolean
  }
): BuildRequiredCourseBlocksParams | null {
  if (!classId) return null
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return null

  const scopeKey = `${classInfo.campusId}::${classInfo.grade}`
  const scopeRows = arrangementScopes.value[scopeKey]?.rows ?? []
  const arrangedRow = scopeRows.find((row) => row.className === classInfo.className)
  const arrangedValues = arrangedRow?.values ?? {}
  const oddEvenRules = options?.enableOddEven === false ? [] : ruleSettingsSnapshotRef.value.oddEvenRules || []

  const teacherNameByCourseId = new Map<string, string>()
  teachingAssignments.value
    .filter((item) => item.classId === classId)
    .forEach((item) => {
      if (teacherNameByCourseId.has(item.courseId)) return
      const name = teacherNameMap.value.get(item.teacherId)
      if (name) {
        teacherNameByCourseId.set(item.courseId, name)
      }
    })

  return {
    campusName: campusNameById(classInfo.campusId),
    grade: classInfo.grade,
    className: classInfo.className,
    arrangedValues,
    oddEvenRules,
    courses: courses.value,
    teacherNameByCourseId,
    courseNameById: courseNameMap.value,
    courseColorById: courseColorMap.value
  }
}

function getRequiredCourseBlocksForClass(
  classId: string,
  options?: {
    enableOddEven?: boolean
  }
): CoursePoolBlock[] {
  const params = buildCoursePoolParamsForClass(classId, options)
  return params ? buildRequiredCourseBlocks(params) : []
}

const requiredCourseBlocks = computed(() => getRequiredCourseBlocksForClass(selectedClass.value))

const placedByAssignmentKey = computed(() => {
  const counter = new Map<string, number>()
  const grid = currentGrid.value
  Object.values(grid).forEach((lesson) => {
    if (!lesson) return
    const key = lesson.assignmentKey || lesson.courseId
    counter.set(key, (counter.get(key) || 0) + 1)
  })
  return counter
})

function getCoursePoolForClass(
  classId: string,
  options?: {
    enableOddEven?: boolean
  }
): CoursePoolBlock[] {
  if (!classId) return []
  ensureClassGrid(classId)
  const counter = new Map<string, number>()
  Object.values(scheduleMap[classId] || {}).forEach((lesson) => {
    if (!lesson) return
    const key = lesson.assignmentKey || lesson.courseId
    counter.set(key, (counter.get(key) || 0) + 1)
  })
  return buildRemainingCoursePool(getRequiredCourseBlocksForClass(classId, options), counter)
}

const coursePool = computed(() => getCoursePoolForClass(selectedClass.value))

watch(
  [teachingAssignments, teacherRecords, courses, classRecords],
  () => {
    syncScheduledLessonMeta()
  },
  { deep: true }
)

const schedulingProgress = computed(() => {
  classRecords.value.forEach((classItem) => ensureClassGrid(classItem.id))
  let totalRequired = 0
  let totalRemaining = 0

  classRecords.value.forEach((classItem) => {
    const requiredBlocks = getRequiredCourseBlocksForClass(classItem.id)
    totalRequired += requiredBlocks.length

    const placedCounter = new Map<string, number>()
    Object.values(scheduleMap[classItem.id] || {}).forEach((lesson) => {
      if (!lesson) return
      const assignmentKey = lesson.assignmentKey || lesson.courseId
      placedCounter.set(assignmentKey, (placedCounter.get(assignmentKey) || 0) + 1)
    })
    const remainingBlocks = buildRemainingCoursePool(requiredBlocks, placedCounter)
    totalRemaining += remainingBlocks.reduce((sum, item) => sum + Math.max(0, Number(item.remaining) || 0), 0)
  })

  const totalPlaced = Math.max(0, totalRequired - totalRemaining)
  return calcSchedulingProgress(totalRequired, totalPlaced)
})

watch(
  [schedulingProgress, () => route.query.planId],
  () => {
    if (progressSyncing.value) return
    const planId = String(route.query.planId || '')
    if (!planId) return
    progressSyncing.value = true
    void updateSchedulePlanProgress(planId, schedulingProgress.value).finally(() => {
      progressSyncing.value = false
    })
  },
  { immediate: true }
)

const activePoolCourse = computed(() => coursePool.value.find((item) => item.assignmentKey === activePoolAssignmentKey.value) ?? null)
const currentClassName = computed(
  () => classRecords.value.find((item) => item.id === selectedClass.value)?.className ?? '未选择班级'
)
const classScheduleTitle = computed(() => `${currentClassName.value}课表`)
const activeCourseLabel = computed(() =>
  activePoolCourse.value ? `${activePoolCourse.value.name} · ${activePoolCourse.value.teacher}` : ''
)
const activeTeacherName = computed(() => activePoolCourse.value?.teacher ?? '')
const shouldShowTeacherSchedule = computed(() => {
  const teacher = String(activeTeacherName.value || '').trim()
  return Boolean(teacher) && teacher !== '未设置教师'
})
const hasActiveCourse = computed(() => Boolean(activePoolAssignmentKey.value))

const teacherGrid = computed(() => {
  const result: Record<string, TeacherSlotLesson[]> = {}
  const classNameById = new Map(classRecords.value.map((item) => [item.id, item.className] as const))
  const candidateClassIds = classRecords.value
    .filter((item) => item.campusId === selectedCampus.value)
    .map((item) => item.id)

  teacherPeriods.value.forEach((period) => {
    teacherDays.value.forEach((day) => {
      const key = keyOf(period, day)
      const rows: TeacherSlotLesson[] = []
      if (shouldShowTeacherSchedule.value) {
        candidateClassIds.forEach((classId) => {
          ensureClassGrid(classId)
          const lesson = scheduleMap[classId]?.[key]
          if (!lesson || lesson.teacher !== activeTeacherName.value) return
          rows.push({
            classId,
            className: classNameById.get(classId) ?? classId,
            lesson
          })
        })
      }
      result[key] = rows
    })
  })

  return result
})
const timetableRows = computed(() => periods.value.map((period) => ({ period })))
const teacherTimetableRows = computed(() => teacherPeriods.value.map((period) => ({ period })))

function timetableRowClassName({ row }: { row: { period: number } }): string {
  const firstAfternoonPeriod = morningLessonsCount.value + 1
  if (morningLessonsCount.value <= 0 || firstAfternoonPeriod > dailyPeriodsCount.value) return ''
  return row.period === firstAfternoonPeriod ? 'is-afternoon-start' : ''
}

function onDragFromPool(assignmentKey: string): void {
  activePoolAssignmentKey.value = assignmentKey
  dragging.value = { source: 'pool', assignmentKey }
}

function onDragEnd(): void {
  dragging.value = null
}

function setActivePoolCard(assignmentKey: string): void {
  activePoolAssignmentKey.value = assignmentKey
}

function setActiveByLesson(period: number, day: string): void {
  const lesson = currentGrid.value[keyOf(period, day)]
  if (!lesson) return
  activePoolAssignmentKey.value = lesson.assignmentKey || lesson.courseId
}

function onDragFromCell(classId: string, slotKey: string): void {
  const lesson = scheduleMap[classId]?.[slotKey]
  if (lesson?.locked) {
    notify.warning('该课程已锁定，不能拖动。')
    return
  }
  dragging.value = { source: 'grid', classId, slotKey }
}

function normalizeTeacherNames(raw: string[] | string | undefined | null): string[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter((item) => item && item !== '未设置教师')))
  }
  const text = String(raw || '').trim()
  if (!text) return []
  return text
    .split('/')
    .map((item) => item.trim())
    .filter((item) => item && item !== '未设置教师')
}

const teacherNameById = computed(() => new Map(teacherRecords.value.map((item) => [item.id, item.name] as const)))
const teacherIdsByName = computed(() => {
  const map = new Map<string, string[]>()
  teacherRecords.value.forEach((item) => {
    const key = (item.name || '').trim()
    if (!key) return
    const list = map.get(key) || []
    if (!list.includes(item.id)) list.push(item.id)
    map.set(key, list)
  })
  return map
})

function lessonTeacherContext(lesson: Lesson, classId: string): { ids: string[]; names: string[] } {
  const idSet = new Set<string>()
  const nameSet = new Set<string>()

  normalizeTeacherNames(lesson.teacherNames?.length ? lesson.teacherNames : lesson.teacher).forEach((name) => {
    nameSet.add(name)
    ;(teacherIdsByName.value.get(name) || []).forEach((id) => idSet.add(id))
  })

  if (lesson.teacherId) {
    idSet.add(lesson.teacherId)
    const hit = teacherNameById.value.get(lesson.teacherId)
    if (hit) nameSet.add(hit)
  }

  const courseIds = Array.isArray(lesson.courseIds) && lesson.courseIds.length > 0
    ? lesson.courseIds.filter(Boolean)
    : [lesson.courseId].filter(Boolean)
  courseIds.forEach((courseId) => {
    const assigned = assignmentTeacherByClassCourse.value.get(`${classId}::${courseId}`)
    if (!assigned) return
    idSet.add(assigned.teacherId)
    if (assigned.teacherName) nameSet.add(assigned.teacherName)
  })

  return {
    ids: Array.from(idSet),
    names: Array.from(nameSet)
  }
}

function lessonCourseIdSet(lesson: Lesson | EngineLesson): Set<string> {
  const ids = Array.isArray(lesson.courseIds) && lesson.courseIds.length > 0
    ? lesson.courseIds
    : [lesson.courseId]
  return new Set(ids.map((item) => String(item || '').trim()).filter(Boolean))
}

function lessonSubjectNames(lesson: Lesson | EngineLesson): Set<string> {
  const names = new Set<string>()
  const courseIds = Array.isArray(lesson.courseIds) && lesson.courseIds.length > 0 ? lesson.courseIds : [lesson.courseId]
  courseIds
    .map((item) => String(courseNameMap.value.get(String(item || '').trim()) || '').trim())
    .filter(Boolean)
    .forEach((name) => names.add(name))
  const fallback = String(lesson.name || '').trim()
  if (names.size <= 0 && fallback && fallback !== '未设置课程') names.add(fallback)
  return names
}

function isPairRuleValueEnabled(value: unknown): boolean {
  const text = String(value || '').trim()
  return !['', '无特殊要求', '否', '不限制'].includes(text)
}

function isSyncStartRuleEnabledForCourseIds(courseIds: Set<string>): boolean {
  if (courseIds.size <= 0) return false
  const classIds = classTabs.value.map((item) => item.id).filter(Boolean)
  const { defaultRules } = buildDefaultRulesForSolver(classIds)
  if (!defaultRules.enabled || !defaultRules.syncStart?.enabled) return false
  const mainSet = new Set((defaultRules.mainCourseIds || []).map((item) => String(item || '').trim()).filter(Boolean))
  const secondarySet = new Set((defaultRules.secondaryCourseIds || []).map((item) => String(item || '').trim()).filter(Boolean))
  const hasSplit = mainSet.size > 0 || secondarySet.size > 0

  for (const courseId of courseIds) {
    if (mainSet.has(courseId)) return isPairRuleValueEnabled(defaultRules.syncStart.main)
    if (secondarySet.has(courseId)) return isPairRuleValueEnabled(defaultRules.syncStart.secondary)
  }
  if (hasSplit) return false
  return isPairRuleValueEnabled(defaultRules.syncStart.main) || isPairRuleValueEnabled(defaultRules.syncStart.secondary)
}

function sameClassDayAdjacencyMessageAtSlot(
  lesson: Lesson | EngineLesson,
  classId: string,
  slotKey: string,
  movingFromSlotKey?: string
): string | null {
  const target = parseSlotKey(slotKey)
  if (!target) return null
  const courseIds = lessonCourseIdSet(lesson)
  if (!isSyncStartRuleEnabledForCourseIds(courseIds)) return null
  const grid = scheduleMap[classId] || {}
  const periods = new Set<number>([target.period])

  Object.entries(grid).forEach(([key, placed]) => {
    if (!placed) return
    if (movingFromSlotKey && key === movingFromSlotKey) return
    const parsed = parseSlotKey(key)
    if (!parsed || parsed.day !== target.day) return
    const placedCourseIds = lessonCourseIdSet(placed as Lesson)
    const hit = Array.from(courseIds).some((id) => placedCourseIds.has(id))
    if (!hit) return
    periods.add(parsed.period)
  })

  const sorted = Array.from(periods).sort((a, b) => a - b)
  if (sorted.length <= 1) return null
  if (sorted.length === 2 && Math.abs(sorted[1] - sorted[0]) === 1) return null
  return '教案齐头规则：同班同课程同日需连排（2节需相邻），当前落点不允许。'
}

function teacherBanMessageAtSlot(lesson: Lesson, classId: string, slotKey: string): string | null {
  const teacherCtx = lessonTeacherContext(lesson, classId)
  if (teacherCtx.ids.length === 0 && teacherCtx.names.length === 0) return null
  return compiledWorkbenchRules.value.getTeacherBanReason({
    slotKey,
    teacherIds: teacherCtx.ids,
    teacherNames: teacherCtx.names,
    teacherNameById: teacherNameById.value
  })
}

function buildCourseRuleForbiddenSlotsForLesson(
  lesson: Lesson,
  classId: string,
  slotKeys: string[],
  options: {
    enableCourseArea: boolean
    enableCourseBan: boolean
  }
): Set<string> {
  const classInfo = classRecords.value.find((item) => item.id === classId)
  if (!classInfo) return new Set<string>()
  const campusName = campusNameById(classInfo.campusId)
  if (!campusName) return new Set<string>()
  const subjectNames = lessonSubjectNames(lesson)
  if (subjectNames.size <= 0) return new Set<string>()

  const snapshot = ruleSettingsSnapshotRef.value
  const slotSet = new Set(slotKeys)
  const result = new Set<string>()

  if (options.enableCourseArea) {
    const matchedAreaRules = (snapshot.courseAreaRules || []).filter((rule) => {
      if (rule.campus !== campusName) return false
      if (!(rule.grade === classInfo.grade || rule.grade === '全部年级')) return false
      if (rule.className !== classInfo.className) return false
      return subjectNames.has(String(rule.subject || '').trim())
    })
    const allowed = new Set(
      matchedAreaRules.flatMap((rule) =>
        (rule.allowedSlots || []).map((slot) => String(slot || '').trim()).filter((slot) => slotSet.has(slot))
      )
    )
    if (matchedAreaRules.length > 0 && allowed.size > 0) {
      slotKeys.forEach((slotKey) => {
        if (!allowed.has(slotKey)) result.add(slotKey)
      })
    }
  }

  if (options.enableCourseBan) {
    ;(snapshot.courseBanRules || []).forEach((rule) => {
      if (rule.campus !== campusName) return
      if (!(rule.grade === classInfo.grade || rule.grade === '全部年级')) return
      if (rule.className !== classInfo.className) return
      if (!subjectNames.has(String(rule.subject || '').trim())) return
      ;(rule.bannedSlots || [])
        .map((slot) => String(slot || '').trim())
        .filter((slot) => slotSet.has(slot))
        .forEach((slot) => result.add(slot))
    })
  }

  return result
}

function courseRuleMessageAtSlot(
  lesson: Lesson,
  classId: string,
  slotKey: string,
  movingFromSlotKey?: string
): string | null {
  const ruleWeightConfig = getCurrentRuleWeightConfigForScope()
  const enableCourseArea = isHardRuleEnabled(ruleWeightConfig, 'courseArea')
  const enableCourseBan = isHardRuleEnabled(ruleWeightConfig, 'courseBan')
  const relevantSlotKeys = slotListForDaysCount(resolveWeeklyDaysCountByClassId(classId))
    .filter((slot) => slot.period <= resolveDailyPeriodsCountByClassId(classId))
    .map((slot) => slot.slotKey)
  if (
    buildCourseRuleForbiddenSlotsForLesson(lesson, classId, relevantSlotKeys, {
      enableCourseArea,
      enableCourseBan
    }).has(slotKey)
  ) {
    return '课程区域/禁排规则：当前节次不允许安排该课程。'
  }

  if (!isHardRuleEnabled(ruleWeightConfig, 'courseRelation')) return null
  const classInfo = classRecords.value.find((item) => item.id === classId)
  const target = parseSlotKey(slotKey)
  if (!classInfo || !target) return null
  const campusName = campusNameById(classInfo.campusId)
  const subjectNames = lessonSubjectNames(lesson)
  if (!campusName || subjectNames.size <= 0) return null

  const grid = scheduleMap[classId] || {}
  for (const rule of ruleSettingsSnapshotRef.value.courseRelationRules || []) {
    if (rule.campus !== campusName || !(rule.grade === classInfo.grade || rule.grade === '全部年级')) continue
    const hitsA = subjectNames.has(String(rule.courseA || '').trim())
    const hitsB = subjectNames.has(String(rule.courseB || '').trim())
    if (!hitsA && !hitsB) continue
    if (hitsA && hitsB) {
      return `课程关系规则：“${rule.courseA}”与“${rule.courseB}”不能合并在同一节次。`
    }
    const oppositeName = hitsA ? String(rule.courseB || '').trim() : String(rule.courseA || '').trim()
    if (!oppositeName) continue

    const conflict = Object.entries(grid).some(([placedSlotKey, placed]) => {
      if (!placed || placedSlotKey === slotKey || (movingFromSlotKey && placedSlotKey === movingFromSlotKey)) return false
      const parsed = parseSlotKey(placedSlotKey)
      if (!parsed || parsed.day !== target.day) return false
      if (!lessonSubjectNames(placed as Lesson).has(oppositeName)) return false
      return rule.relationType === '同天互斥' || Math.abs(parsed.period - target.period) === 1
    })
    if (conflict) {
      return `课程关系规则：“${rule.courseA}”与“${rule.courseB}”${rule.relationType === '同天互斥' ? '不能同天安排' : '不能前后相邻'}。`
    }
  }
  return null
}

function teacherConflictMessagesAtSlot(teachers: string[], slotKey: string, excludedClassIds: string[] = []): string[] {
  if (teachers.length <= 0) return []
  const excluded = new Set(excludedClassIds)
  const messageList: string[] = []
  const uniqTeachers = Array.from(new Set(teachers))

  uniqTeachers.forEach((teacherName) => {
    const conflicts: string[] = []
    Object.entries(scheduleMap).forEach(([classId, grid]) => {
      if (excluded.has(classId)) return
      const lesson = grid?.[slotKey]
      if (!lesson) return
      const lessonTeachers = normalizeTeacherNames(lesson.teacherNames?.length ? lesson.teacherNames : lesson.teacher)
      if (!lessonTeachers.includes(teacherName)) return
      conflicts.push(classLabelById(classId))
    })
    if (conflicts.length > 0) {
      messageList.push(`教师「${teacherName}」在该节次已安排：${Array.from(new Set(conflicts)).join('、')}`)
    }
  })

  return messageList
}

function teacherMutualMessageAtSlot(
  teachers: string[],
  slotKey: string,
  excludedClassIds: string[] = []
): string | null {
  if (!isHardRuleEnabled(getCurrentRuleWeightConfigForScope(), 'teacherMutual')) return null
  const incoming = new Set(teachers.map((item) => String(item || '').trim()).filter(Boolean))
  if (incoming.size <= 0) return null
  const excluded = new Set(excludedClassIds)
  const existing = new Set<string>()
  Object.entries(scheduleMap).forEach(([classId, grid]) => {
    if (excluded.has(classId)) return
    const placed = grid?.[slotKey]
    if (!placed) return
    normalizeTeacherNames(placed.teacherNames?.length ? placed.teacherNames : placed.teacher).forEach((name) => existing.add(name))
  })

  for (const rule of ruleSettingsSnapshotRef.value.teacherMutualRules || []) {
    if (rule.type !== 'mutual') continue
    const groupA = new Set((rule.teacherGroupA || []).map((item) => String(item || '').trim()).filter(Boolean))
    const groupB = new Set((rule.teacherGroupB || []).map((item) => String(item || '').trim()).filter(Boolean))
    const incomingA = Array.from(incoming).some((name) => groupA.has(name))
    const incomingB = Array.from(incoming).some((name) => groupB.has(name))
    const existingA = Array.from(existing).some((name) => groupA.has(name))
    const existingB = Array.from(existing).some((name) => groupB.has(name))
    if ((incomingA && incomingB) || (incomingA && existingB) || (incomingB && existingA)) {
      return '教师互斥规则：互斥教师组不能在同一节次同时上课。'
    }
  }
  return null
}

function buildDropEvaluationContext(payload: EngineDragPayload | null, period: number, day: string) {
  return {
    payload,
    selectedClassId: selectedClass.value,
    period,
    day,
    keyOf,
    scheduleMap: scheduleMap as unknown as Record<string, Record<string, EngineLesson | null>>,
    globalFixedPointLabel: (p: number, d: string) => globalFixedPointAt(p, d)?.label ?? null,
    getPoolBlock: (assignmentKey: string) => {
      const block = coursePool.value.find((item) => item.assignmentKey === assignmentKey)
      if (!block || block.remaining <= 0) return null
      return block as EngineCoursePoolBlock
    },
    resolveDropTargetClassIds: (classId: string, block: EngineCoursePoolBlock) =>
      resolveDropTargetClassIds(classId, block as CoursePoolBlock),
    buildLessonForClassFromBlock: (classId: string, block: EngineCoursePoolBlock) =>
      buildLessonForClassFromBlock(classId, block as CoursePoolBlock),
    classLabelById,
    teacherBanMessageAtSlot: (lesson: EngineLesson, classId: string, slotKey: string) =>
      teacherBanMessageAtSlot(lesson as Lesson, classId, slotKey),
    teacherConflictMessagesAtSlot,
    teacherMutualMessageAtSlot,
    courseRuleMessageAtSlot: (lesson: EngineLesson, classId: string, slotKey: string, movingFromSlotKey?: string) =>
      courseRuleMessageAtSlot(lesson as Lesson, classId, slotKey, movingFromSlotKey),
    sameClassDayAdjacencyMessageAtSlot: (lesson: EngineLesson, classId: string, slotKey: string, movingFromSlotKey?: string) =>
      sameClassDayAdjacencyMessageAtSlot(lesson as Lesson, classId, slotKey, movingFromSlotKey)
  }
}

function dropForbiddenReason(period: number, day: string): string | null {
  const result = evaluateDropTarget(
    buildDropEvaluationContext((dragging.value as EngineDragPayload | null) ?? null, period, day)
  )
  return result.reason
}

function dropCellClass(period: number, day: string): Record<string, boolean> {
  const hasDrag = Boolean(dragging.value)
  const forbidden = hasDrag && Boolean(dropForbiddenReason(period, day))
  return {
    'is-fixed-slot': Boolean(globalFixedPointAt(period, day)),
    'is-drop-forbidden': forbidden,
    'is-drop-available': hasDrag && !forbidden
  }
}

function dropForbiddenLabel(period: number, day: string): string {
  return dropForbiddenLabelFromReason(dropForbiddenReason(period, day))
}

function onDropToCell(period: number, day: string): void {
  const result = applyDropTarget(
    buildDropEvaluationContext((dragging.value as EngineDragPayload | null) ?? null, period, day)
  )
  if (!result.allowed && result.reason) {
    notify.warning(result.reason)
  }
}

function slotListForDaysCount(dayCount: number): Array<{ period: number; day: string; slotKey: string }> {
  const scopedDays = allDays.slice(0, Math.max(1, Math.min(7, dayCount)))
  const maxPeriods = classTabs.value.reduce((max, item) => Math.max(max, resolveDailyPeriodsCountByClassId(item.id)), 1)
  return rangePeriods(maxPeriods).flatMap((period) => scopedDays.map((day) => ({ period, day, slotKey: keyOf(period, day) })))
}

function normalizeTeacherHourLimit(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const normalized = Math.floor(num)
  return normalized > 0 ? normalized : null
}

function buildTeacherHourConstraintsForGrade(
  classIds: string[],
  demands: Array<{
    lessonsByClass: Record<string, Lesson>
    teacherNames: string[]
  }>,
  options?: {
    includeLimits?: boolean
    includeWeekDistribution?: boolean
    includeDayDistribution?: boolean
  }
): NonNullable<ApiSmartSolveRequest['teacherHourConstraints']> {
  const snapshot = ruleSettingsSnapshotRef.value
  const campusName = campusNameById(selectedCampus.value)
  if (!campusName || !selectedGrade.value) return []
  const includeLimits = options?.includeLimits !== false
  const includeWeekDistribution = options?.includeWeekDistribution !== false
  const includeDayDistribution = options?.includeDayDistribution !== false

  const classIdSet = new Set(classIds.filter(Boolean))
  const activeSubjectNames = new Set<string>()
  const activeTeacherNames = new Set<string>()

  demands.forEach((demand) => {
    normalizeTeacherNames(demand.teacherNames).forEach((name) => activeTeacherNames.add(name))
    Object.values(demand.lessonsByClass || {}).forEach((lesson) => {
      if (!lesson) return
      const courseIds = Array.isArray(lesson.courseIds) && lesson.courseIds.length > 0
        ? lesson.courseIds.filter(Boolean)
        : [lesson.courseId].filter(Boolean)
      courseIds.forEach((courseId) => {
        const subjectName = (courseNameMap.value.get(courseId) || '').trim()
        if (subjectName) activeSubjectNames.add(subjectName)
      })
      normalizeTeacherNames(lesson.teacherNames?.length ? lesson.teacherNames : lesson.teacher).forEach((name) =>
        activeTeacherNames.add(name)
      )
    })
  })

  if (activeSubjectNames.size <= 0 || activeTeacherNames.size <= 0) return []

  const teacherNamesBySubject = new Map<string, Set<string>>()
  teachingAssignments.value
    .filter((item) => classIdSet.has(item.classId))
    .forEach((item) => {
      const subjectName = (courseNameMap.value.get(item.courseId) || '').trim()
      const teacherName = (teacherNameMap.value.get(item.teacherId) || '').trim()
      if (!subjectName || !teacherName) return
      const set = teacherNamesBySubject.get(subjectName) || new Set<string>()
      set.add(teacherName)
      teacherNamesBySubject.set(subjectName, set)
    })

  const ruleCandidates = (snapshot.teacherHourRules || []).filter((rule) => {
    if (rule.campus !== campusName) return false
    if (!(rule.grade === selectedGrade.value || rule.grade === '全部年级')) return false
    return activeSubjectNames.has(rule.subject)
  })

  const candidateMap = new Map<
    string,
    Array<{
      score: number
      maxDailyLessons: number | null
      maxConsecutiveLessons: number | null
      weekDistribution: '周分散' | '周集中' | null
      dayDistribution: '日分散' | '日集中' | null
    }>
  >()

  const pushCandidate = (
    teacherName: string,
    candidate: {
      score: number
      maxDailyLessons: number | null
      maxConsecutiveLessons: number | null
      weekDistribution: '周分散' | '周集中' | null
      dayDistribution: '日分散' | '日集中' | null
    }
  ) => {
    const key = teacherName.trim()
    if (!key || !activeTeacherNames.has(key)) return
    const list = candidateMap.get(key) || []
    list.push(candidate)
    candidateMap.set(key, list)
  }

  ruleCandidates.forEach((rule) => {
    const score = (rule.teacherId ? 2 : 0) + (rule.grade === selectedGrade.value ? 1 : 0)
    const candidate = {
      score,
      maxDailyLessons: includeLimits ? normalizeTeacherHourLimit(rule.maxDailyLessons) : null,
      maxConsecutiveLessons: includeLimits ? normalizeTeacherHourLimit(rule.maxConsecutiveLessons) : null,
      weekDistribution: includeWeekDistribution ? (rule.weekDistribution || null) : null,
      dayDistribution: includeDayDistribution ? (rule.dayDistribution || null) : null
    }
    if (rule.teacherId) {
      const teacherName = (teacherNameMap.value.get(rule.teacherId) || rule.teacherName || '').trim()
      pushCandidate(teacherName, candidate)
      return
    }
    const names = Array.from(teacherNamesBySubject.get(rule.subject) || [])
    names.forEach((name) => pushCandidate(name, candidate))
  })

  const constraints: NonNullable<ApiSmartSolveRequest['teacherHourConstraints']> = []
  candidateMap.forEach((list, teacherName) => {
    const sorted = [...list].sort((a, b) => b.score - a.score)
    let maxDaily: number | null = null
    let maxConsecutive: number | null = null
    let weekDistribution: '周分散' | '周集中' | null = null
    let dayDistribution: '日分散' | '日集中' | null = null

    sorted.forEach((item) => {
      if (item.maxDailyLessons != null) {
        maxDaily = maxDaily == null ? item.maxDailyLessons : Math.min(maxDaily, item.maxDailyLessons)
      }
      if (item.maxConsecutiveLessons != null) {
        maxConsecutive =
          maxConsecutive == null ? item.maxConsecutiveLessons : Math.min(maxConsecutive, item.maxConsecutiveLessons)
      }
      if (!weekDistribution && item.weekDistribution) weekDistribution = item.weekDistribution
      if (!dayDistribution && item.dayDistribution) dayDistribution = item.dayDistribution
    })

    if (maxDaily == null && maxConsecutive == null && !weekDistribution && !dayDistribution) return
    constraints.push({
      teacherName,
      maxDailyLessons: maxDaily,
      maxConsecutiveLessons: maxConsecutive,
      weekDistribution,
      dayDistribution
    })
  })

  return constraints
}

function buildTeacherMutualConstraintsForGrade(
  demands: Array<{
    lessonsByClass: Record<string, Lesson>
    teacherNames: string[]
  }>
): NonNullable<ApiSmartSolveRequest['teacherMutualConstraints']> {
  const snapshot = ruleSettingsSnapshotRef.value
  const activeTeacherNames = new Set<string>()
  demands.forEach((demand) => {
    normalizeTeacherNames(demand.teacherNames).forEach((name) => activeTeacherNames.add(name))
    Object.values(demand.lessonsByClass || {}).forEach((lesson) => {
      if (!lesson) return
      normalizeTeacherNames(lesson.teacherNames?.length ? lesson.teacherNames : lesson.teacher).forEach((name) =>
        activeTeacherNames.add(name)
      )
    })
  })
  if (activeTeacherNames.size <= 0) return []

  const constraints: NonNullable<ApiSmartSolveRequest['teacherMutualConstraints']> = []
  const dedupe = new Set<string>()
  ;(snapshot.teacherMutualRules || []).forEach((rule) => {
    const groupA = Array.from(
      new Set((rule.teacherGroupA || []).map((name) => String(name || '').trim()).filter((name) => activeTeacherNames.has(name)))
    )
    const groupB = Array.from(
      new Set((rule.teacherGroupB || []).map((name) => String(name || '').trim()).filter((name) => activeTeacherNames.has(name)))
    )
    if (groupA.length <= 0 || groupB.length <= 0) return
    const overlap = new Set(groupA.filter((name) => groupB.includes(name)))
    const normalizedA = groupA.filter((name) => !overlap.has(name))
    const normalizedB = groupB.filter((name) => !overlap.has(name))
    if (normalizedA.length <= 0 || normalizedB.length <= 0) return
    const key = `${[...normalizedA].sort().join('、')}::${[...normalizedB].sort().join('、')}`
    const reverseKey = `${[...normalizedB].sort().join('、')}::${[...normalizedA].sort().join('、')}`
    if (dedupe.has(key) || dedupe.has(reverseKey)) return
    dedupe.add(key)
    constraints.push({
      teacherGroupA: normalizedA,
      teacherGroupB: normalizedB
    })
  })
  return constraints
}

function buildCourseRelationConstraintsForGrade(
  classIds: string[]
): NonNullable<ApiSmartSolveRequest['courseRelationConstraints']> {
  const campusName = campusNameById(selectedCampus.value)
  const grade = selectedGrade.value
  if (!campusName || !grade) return []

  const courseIdsByName = new Map<string, string[]>()
  courses.value.forEach((course) => {
    const name = String(course.name || '').trim()
    const id = String(course.id || '').trim()
    if (!name || !id) return
    const ids = courseIdsByName.get(name) || []
    ids.push(id)
    courseIdsByName.set(name, ids)
  })

  const constraints: NonNullable<ApiSmartSolveRequest['courseRelationConstraints']> = []
  const emitted = new Set<string>()
  ;(ruleSettingsSnapshotRef.value.courseRelationRules || []).forEach((rule) => {
    if (rule.campus !== campusName || !(rule.grade === grade || rule.grade === '全部年级')) return
    const courseAIds = Array.from(new Set(courseIdsByName.get(String(rule.courseA || '').trim()) || []))
    const courseBIds = Array.from(new Set(courseIdsByName.get(String(rule.courseB || '').trim()) || []))
    if (courseAIds.length <= 0 || courseBIds.length <= 0) return
    classIds.forEach((classId) => {
      const classInfo = classRecords.value.find((item) => item.id === classId)
      if (!classInfo || campusNameById(classInfo.campusId) !== campusName || classInfo.grade !== grade) return
      const key = `${classId}::${[...courseAIds].sort().join(',')}::${[...courseBIds].sort().join(',')}::${rule.relationType}`
      if (emitted.has(key)) return
      emitted.add(key)
      constraints.push({
        classId,
        courseAIds,
        courseBIds,
        relationType: rule.relationType
      })
    })
  })
  return constraints
}

function buildConsecutiveConstraintsForGrade(
  classIds: string[],
  demands: Array<{
    lessonsByClass: Record<string, Lesson>
  }>
): NonNullable<ApiSmartSolveRequest['consecutiveConstraints']> {
  const snapshot = ruleSettingsSnapshotRef.value
  const campusName = campusNameById(selectedCampus.value)
  const grade = selectedGrade.value
  if (!campusName || !grade) return []

  const activeCourseIdsByClass = new Map<string, Set<string>>()
  demands.forEach((demand) => {
    Object.entries(demand.lessonsByClass || {}).forEach(([classId, lesson]) => {
      if (!classId || !lesson) return
      const set = activeCourseIdsByClass.get(classId) || new Set<string>()
      const ids = Array.isArray(lesson.courseIds) && lesson.courseIds.length > 0 ? lesson.courseIds : [lesson.courseId]
      ids.map((item) => String(item || '').trim())
        .filter(Boolean)
        .forEach((id) => set.add(id))
      activeCourseIdsByClass.set(classId, set)
    })
  })

  const constraints: NonNullable<ApiSmartSolveRequest['consecutiveConstraints']> = []
  const emitted = new Set<string>()
  Object.entries(snapshot.consecutiveSettings || {}).forEach(([ruleKey, setting]) => {
    const [ruleCampus, ruleGrade, ruleSubject] = String(ruleKey || '').split('::')
    if (ruleCampus !== campusName || ruleGrade !== grade || !ruleSubject) return
    const subjectCourseIds = courses.value
      .filter((course) => String(course.name || '').trim() === ruleSubject)
      .map((course) => String(course.id || '').trim())
      .filter(Boolean)
    const candidateCourseIds = subjectCourseIds
    classIds.forEach((classId) => {
      const className = classRecords.value.find((item) => item.id === classId)?.className || ''
      if (!className) return
      const override = setting?.classOverrides?.[className]
      const rule = override || setting?.defaultRule
      const weeklyConsecutiveCount = Math.max(0, Math.min(5, Math.floor(Number(rule?.weeklyConsecutiveCount) || 0)))
      if (weeklyConsecutiveCount <= 0) return
      const activeCourseIds = activeCourseIdsByClass.get(classId) || new Set<string>()
      const subjectMatchedActiveIds = Array.from(activeCourseIds).filter(
        (courseId) => String(courseNameMap.value.get(courseId) || '').trim() === ruleSubject
      )
      const effectiveCourseIds = Array.from(new Set([...candidateCourseIds, ...subjectMatchedActiveIds])).filter(Boolean)
      if (effectiveCourseIds.length <= 0) return
      const preferredDays = Array.from(
        new Set((rule?.preferredDays || []).map((day) => String(day || '').trim()).filter((day) => allDays.includes(day)))
      )
      const uniqCourseIds = Array.from(new Set(effectiveCourseIds))
      const dedupeKey = `${classId}::${uniqCourseIds.sort().join(',')}`
      if (emitted.has(dedupeKey)) return
      emitted.add(dedupeKey)
      constraints.push({
        classId,
        courseIds: uniqCourseIds,
        weeklyConsecutiveCount,
        preferredDays
      })
    })
  })
  return constraints
}

function buildDefaultRulesForSolver(
  classIds: string[],
  options?: {
    enableCourseDefault?: boolean
    enableMainSecondary?: boolean
  }
): {
  defaultRules: NonNullable<ApiSmartSolveRequest['defaultRules']>
  noonBoundaryByClass: NonNullable<ApiSmartSolveRequest['noonBoundaryByClass']>
} {
  const snapshot = ruleSettingsSnapshotRef.value
  const campusName = campusNameById(selectedCampus.value)
  const grade = selectedGrade.value
  const defaultConfig = snapshot.courseDefaultConfig

  const allRulesEnabled = Boolean(defaultConfig?.enabled) && options?.enableCourseDefault !== false
  const ruleEnabled = defaultConfig?.ruleEnabled || {
    syncStart: true,
    distribution: true,
    noCrossNoon: true,
    sameClassNoConsecutive: true,
    twoLessonsGap: true
  }
  const rules = defaultConfig?.rules || defaultCourseDefaultConfig.rules

  const mainSecondaryRule = (snapshot.mainSecondaryRules || [])
    .filter((item) => item.campus === campusName && (item.grade === grade || item.grade === '全部年级'))
    .sort((a, b) => {
      const aScore = (a.grade === grade ? 2 : 0) + ((a.mainSubjects?.length || 0) + (a.secondarySubjects?.length || 0) > 0 ? 1 : 0)
      const bScore = (b.grade === grade ? 2 : 0) + ((b.mainSubjects?.length || 0) + (b.secondarySubjects?.length || 0) > 0 ? 1 : 0)
      return bScore - aScore
    })[0]

  const toCourseIds = (subjects: string[] = []): string[] => {
    const subjectSet = new Set(subjects.map((item) => String(item || '').trim()).filter(Boolean))
    if (subjectSet.size <= 0) return []
    return courses.value
      .filter((course) => subjectSet.has(String(course.name || '').trim()))
      .map((course) => course.id)
      .filter(Boolean)
  }

  const enableMainSecondary = options?.enableMainSecondary !== false
  const mainCourseIds = enableMainSecondary ? toCourseIds(mainSecondaryRule?.mainSubjects || []) : []
  const secondaryCourseIds = enableMainSecondary ? toCourseIds(mainSecondaryRule?.secondarySubjects || []) : []

  const getClassHourBase = (classId: string): ClassHourClassRow | ClassHourRow | null => {
    const classRow = classHourClassRows.value.find((item) => item.classId === classId)
    if (classRow) return classRow
    const classInfo = classRecords.value.find((item) => item.id === classId)
    if (!classInfo) return null
    return classHourRows.value.find((item) => item.campusId === classInfo.campusId && item.grade === classInfo.grade) || null
  }

  const noonBoundaryByClass: NonNullable<ApiSmartSolveRequest['noonBoundaryByClass']> = {}
  classIds.forEach((classId) => {
    const base = getClassHourBase(classId)
    if (!base) return
    const morningEnd = Math.floor(Number(base.morningLessons || 0))
    const afternoonLessons = Math.floor(Number(base.afternoonLessons || 0))
    if (morningEnd <= 0 || afternoonLessons <= 0) return
    noonBoundaryByClass[classId] = {
      morningEnd,
      afternoonStart: morningEnd + 1
    }
  })

  return {
    defaultRules: {
      enabled: allRulesEnabled,
      mainCourseIds,
      secondaryCourseIds,
      syncStart: {
        enabled: allRulesEnabled && Boolean(ruleEnabled.syncStart),
        main: rules.syncStart.main,
        secondary: rules.syncStart.secondary
      },
      distribution: {
        enabled: allRulesEnabled && Boolean(ruleEnabled.distribution),
        main: rules.distribution.main,
        secondary: rules.distribution.secondary
      },
      noCrossNoon: {
        enabled: allRulesEnabled && Boolean(ruleEnabled.noCrossNoon),
        main: rules.noCrossNoon.main,
        secondary: rules.noCrossNoon.secondary
      },
      sameClassNoConsecutive: {
        enabled: allRulesEnabled && Boolean(ruleEnabled.sameClassNoConsecutive),
        main: rules.sameClassNoConsecutive.main,
        secondary: rules.sameClassNoConsecutive.secondary
      },
      twoLessonsGap: {
        enabled: allRulesEnabled && Boolean(ruleEnabled.twoLessonsGap),
        main: rules.twoLessonsGap.main,
        secondary: rules.twoLessonsGap.secondary
      }
    },
    noonBoundaryByClass
  }
}

function normalizeCombinedSolveDemands(rawDemands: ApiSolveDemand[]): ApiSolveDemand[] {
  const result: ApiSolveDemand[] = []
  const combinedGroups = new Map<string, ApiSolveDemand[]>()

  rawDemands.forEach((demand) => {
    const targetClassIds = Array.from(new Set((demand.targetClassIds || []).filter(Boolean))).sort()
    if (targetClassIds.length <= 1) {
      result.push({ ...demand, targetClassIds })
      return
    }
    const key = `${demand.assignmentKey}::${targetClassIds.join('|')}`
    const group = combinedGroups.get(key) || []
    group.push({ ...demand, targetClassIds })
    combinedGroups.set(key, group)
  })

  combinedGroups.forEach((group) => {
    const targetClassIds = group[0]?.targetClassIds || []
    const demandBySource = new Map(
      group
        .filter((item) => item.sourceClassId && targetClassIds.includes(item.sourceClassId))
        .map((item) => [item.sourceClassId as string, item] as const)
    )

    const pushSingle = (demand: ApiSolveDemand, classId: string, remaining = demand.remaining) => {
      const lesson = demand.lessonsByClass[classId]
      if (!lesson || remaining <= 0) return
      result.push({
        ...demand,
        sourceClassId: classId,
        remaining,
        targetClassIds: [classId],
        lessonsByClass: { [classId]: lesson },
        teacherNames: Array.from(new Set(lesson.teacherNames?.length ? lesson.teacherNames : [lesson.teacher])).filter(Boolean),
        forbiddenSlotsByClass: demand.forbiddenSlotsByClass?.[classId]
          ? { [classId]: [...demand.forbiddenSlotsByClass[classId]] }
          : undefined
      })
    }

    if (targetClassIds.some((classId) => !demandBySource.has(classId))) {
      group.forEach((demand) => {
        const sourceClassId = demand.sourceClassId || demand.targetClassIds[0]
        if (sourceClassId) pushSingle(demand, sourceClassId)
      })
      return
    }

    const commonRemaining = Math.min(
      ...targetClassIds.map((classId) => Math.max(0, Math.floor(Number(demandBySource.get(classId)?.remaining) || 0)))
    )
    const first = group[0]
    if (first && commonRemaining > 0) {
      const lessonsByClass = Object.fromEntries(
        targetClassIds.map((classId) => [classId, demandBySource.get(classId)?.lessonsByClass[classId] || first.lessonsByClass[classId]])
      )
      const forbiddenSlotsByClass = Object.fromEntries(
        targetClassIds.flatMap((classId) => {
          const slots = Array.from(
            new Set(group.flatMap((item) => item.forbiddenSlotsByClass?.[classId] || []))
          )
          return slots.length > 0 ? [[classId, slots] as const] : []
        })
      )
      result.push({
        ...first,
        sourceClassId: undefined,
        remaining: commonRemaining,
        targetClassIds,
        lessonsByClass,
        teacherNames: Array.from(new Set(group.flatMap((item) => item.teacherNames || []))),
        forbiddenSlotsByClass: Object.keys(forbiddenSlotsByClass).length > 0 ? forbiddenSlotsByClass : undefined
      })
    }

    targetClassIds.forEach((classId) => {
      const source = demandBySource.get(classId)
      if (!source) return
      const residual = Math.max(0, Math.floor(Number(source.remaining) || 0) - commonRemaining)
      if (residual > 0) pushSingle(source, classId, residual)
    })
  })

  return result
}

function buildApiSmartSolvePayloadForGrade(classIds: string[]): ApiSmartSolveRequest {
  const ruleWeightConfig = getCurrentRuleWeightConfigForScope()
  const enableTeacherBan = isHardRuleEnabled(ruleWeightConfig, 'teacherBan')
  const enableTeacherHourLimit = isHardRuleEnabled(ruleWeightConfig, 'teacherHourLimit')
  const enableTeacherMutual = isHardRuleEnabled(ruleWeightConfig, 'teacherMutual')
  const enableGlobalFixedPoint = isHardRuleEnabled(ruleWeightConfig, 'globalFixedPoint')
  const enableCombineCourse = isHardRuleEnabled(ruleWeightConfig, 'combineCourse')
  const enableCourseArea = isHardRuleEnabled(ruleWeightConfig, 'courseArea')
  const enableCourseBan = isHardRuleEnabled(ruleWeightConfig, 'courseBan')
  const weekDistributionWeight = getSoftRuleWeight(ruleWeightConfig, 'teacherWeekDistribution', 45)
  const dayDistributionWeight = getSoftRuleWeight(ruleWeightConfig, 'teacherDayDistribution', 25)
  const consecutiveWeight = getSoftRuleWeight(ruleWeightConfig, 'consecutive', 30)
  const includeWeekDistribution = weekDistributionWeight > 0
  const includeDayDistribution = dayDistributionWeight > 0
  const enableOddEven = isFeatureRuleEnabled(ruleWeightConfig, 'oddEven')
  const enableMainSecondary = isFeatureRuleEnabled(ruleWeightConfig, 'mainSecondary')
  const enableCourseDefault = isFeatureRuleEnabled(ruleWeightConfig, 'courseDefault')
  const enableCourseRelation = isHardRuleEnabled(ruleWeightConfig, 'courseRelation')
  const consecutivePreferredWeight = consecutiveWeight

  const classIdSet = new Set(classIds)
  classIds.forEach((classId) => ensureClassGrid(classId))
  const maxDays = Math.max(1, ...classIds.map((classId) => resolveWeeklyDaysCountByClassId(classId)))
  const slots = slotListForDaysCount(maxDays)
  const allSlotKeys = slots.map((slot) => slot.slotKey)
  const fixedSlotKeys = enableGlobalFixedPoint
    ? slots.filter((slot) => globalFixedPointAt(slot.period, slot.day)).map((slot) => slot.slotKey)
    : []
  const rawDemands: ApiSolveDemand[] = classIds.flatMap((classId) =>
    getCoursePoolForClass(classId, { enableOddEven })
      .filter((block) => block.remaining > 0)
      .map((block) => {
        const targetClassIds = (enableCombineCourse ? resolveDropTargetClassIds(classId, block) : [classId]).filter((item) =>
          classIdSet.has(item)
        )
        if (!targetClassIds.includes(classId)) targetClassIds.unshift(classId)
        const uniqTargetClassIds = Array.from(new Set(targetClassIds))
        const lessonsByClass = Object.fromEntries(
          uniqTargetClassIds.map((targetClassId) => [targetClassId, buildLessonForClassFromBlock(targetClassId, block)])
        )
        const forbiddenSlotsByClass: Record<string, string[]> = {}
        uniqTargetClassIds.forEach((targetClassId) => {
          const lesson = lessonsByClass[targetClassId]
          const dayLimit = resolveWeeklyDaysCountByClassId(targetClassId)
          const periodLimit = resolveDailyPeriodsCountByClassId(targetClassId)
          const allowedDays = new Set(allDays.slice(0, dayLimit))
          const bannedSet = new Set<string>()
          slots.forEach((slot) => {
            if (slot.period > periodLimit || !allowedDays.has(slot.day)) {
              bannedSet.add(slot.slotKey)
              return
            }
            if (enableTeacherBan && teacherBanMessageAtSlot(lesson, targetClassId, slot.slotKey)) {
              bannedSet.add(slot.slotKey)
            }
          })
          buildCourseRuleForbiddenSlotsForLesson(lesson, targetClassId, allSlotKeys, {
            enableCourseArea,
            enableCourseBan
          }).forEach((slotKey) => bannedSet.add(slotKey))
          const banned = Array.from(bannedSet)
          if (banned.length > 0) forbiddenSlotsByClass[targetClassId] = banned
        })
        return {
          assignmentKey: block.assignmentKey,
          sourceClassId: classId,
          remaining: block.remaining,
          targetClassIds: uniqTargetClassIds,
          lessonsByClass,
          teacherNames: normalizeTeacherNames(block.teacherNames?.length ? block.teacherNames : block.teacher),
          forbiddenSlotsByClass
        }
      })
  )
  const demands = normalizeCombinedSolveDemands(rawDemands)

  const scheduleMapPayload = Object.fromEntries(
    classIds.map((classId) => [
      classId,
      Object.fromEntries(slots.map((slot) => [slot.slotKey, scheduleMap[classId]?.[slot.slotKey] ?? null]))
    ])
  )
  const teacherHourConstraints = buildTeacherHourConstraintsForGrade(classIds, demands, {
    includeLimits: enableTeacherHourLimit,
    includeWeekDistribution,
    includeDayDistribution
  })
  const teacherMutualConstraints = enableTeacherMutual ? buildTeacherMutualConstraintsForGrade(demands) : []
  const consecutiveConstraints = buildConsecutiveConstraintsForGrade(classIds, demands)
  const courseRelationConstraints = enableCourseRelation ? buildCourseRelationConstraintsForGrade(classIds) : []
  const { defaultRules, noonBoundaryByClass } = buildDefaultRulesForSolver(classIds, {
    enableCourseDefault,
    enableMainSecondary
  })

  return {
    selectedClassId: classIds.includes(selectedClass.value) ? selectedClass.value : classIds[0] || '',
    classIds,
    slotKeys: slots.map((slot) => slot.slotKey),
    fixedSlotKeys,
    defaultRules,
    noonBoundaryByClass,
    teacherHourConstraints,
    teacherMutualConstraints,
    teacherRuleOptions: {
      enableTeacherMutual,
      weekDistributionWeight,
      dayDistributionWeight
    },
    ruleOptions: {
      enableGlobalFixedPoint,
      enableCombineCourse,
      enableCourseArea,
      enableCourseBan,
      enableCourseDefault,
      enableMainSecondary,
      enableOddEven,
      enableCourseRelation,
      consecutivePreferredWeight
    },
    consecutiveConstraints,
    courseRelationConstraints,
    scheduleMap: scheduleMapPayload,
    demands
  }
}

function buildRelaxedPayload(base: ApiSmartSolveRequest): ApiSmartSolveRequest {
  const next: ApiSmartSolveRequest = {
    ...base,
    defaultRules: {
      ...(base.defaultRules || {}),
      enabled: false,
      syncStart: { ...(base.defaultRules?.syncStart || { enabled: false, main: '', secondary: '' }), enabled: false },
      distribution: { ...(base.defaultRules?.distribution || { enabled: false, main: '', secondary: '' }), enabled: false },
      noCrossNoon: { ...(base.defaultRules?.noCrossNoon || { enabled: false, main: '', secondary: '' }), enabled: false },
      sameClassNoConsecutive: {
        ...(base.defaultRules?.sameClassNoConsecutive || { enabled: false, main: '', secondary: '' }),
        enabled: false
      },
      twoLessonsGap: { ...(base.defaultRules?.twoLessonsGap || { enabled: false, main: '', secondary: '' }), enabled: false }
    }
  }
  return next
}

function applyApiPlacements(placements: ApiSmartPlacement[]): void {
  placements.forEach((item) => {
    if (!item.classId || !item.slotKey || !item.lesson) return
    ensureClassGrid(item.classId)
    scheduleMap[item.classId][item.slotKey] = {
      assignmentKey: item.lesson.assignmentKey,
      courseId: item.lesson.courseId,
      courseIds: Array.isArray(item.lesson.courseIds) ? [...item.lesson.courseIds] : undefined,
      teacherId: item.lesson.teacherId,
      name: item.lesson.name,
      teacher: item.lesson.teacher,
      teacherNames: Array.isArray(item.lesson.teacherNames) ? [...item.lesson.teacherNames] : undefined,
      color: item.lesson.color,
      isCombined: Boolean(item.lesson.isCombined),
      isOddEven: Boolean(item.lesson.isOddEven),
      oddCourseId: item.lesson.oddCourseId,
      evenCourseId: item.lesson.evenCourseId,
      oddCourseName: item.lesson.oddCourseName,
      evenCourseName: item.lesson.evenCourseName,
      locked: Boolean(item.lesson.locked)
    }
  })
}

function collectPlacedStats(classIds: string[]): { placed: number; locked: number; clearable: number } {
  let placed = 0
  let locked = 0
  classIds.forEach((classId) => {
    ensureClassGrid(classId)
    Object.values(scheduleMap[classId] || {}).forEach((lesson) => {
      if (!lesson) return
      placed += 1
      if (lesson.locked) locked += 1
    })
  })
  return { placed, locked, clearable: Math.max(0, placed - locked) }
}

function clearUnlockedLessonsForClasses(classIds: string[]): number {
  let cleared = 0
  classIds.forEach((classId) => {
    ensureClassGrid(classId)
    Object.keys(scheduleMap[classId] || {}).forEach((slotKey) => {
      const lesson = scheduleMap[classId][slotKey]
      if (!lesson || lesson.locked) return
      scheduleMap[classId][slotKey] = null
      cleared += 1
    })
  })
  return cleared
}

async function runSmartScheduling(): Promise<void> {
  if (smartSchedulingLoading.value || persistLoading.value) return
  const classIds = classTabs.value.map((item) => item.id)
  if (classIds.length <= 0) {
    notify.warning('当前年级暂无班级。')
    return
  }
  classIds.forEach((classId) => ensureClassGrid(classId))

  const enableOddEven = isFeatureRuleEnabled(getCurrentRuleWeightConfigForScope(), 'oddEven')
  const oddEvenIssues = enableOddEven
    ? classIds.flatMap((classId) => {
        const params = buildCoursePoolParamsForClass(classId, { enableOddEven: true })
        return params ? findOddEvenCountIssues(params) : []
      })
    : []
  if (oddEvenIssues.length > 0) {
    const preview = oddEvenIssues.slice(0, 8).map((item) => item.message).join('\n')
    await ElMessageBox.alert(
      `${preview}${oddEvenIssues.length > 8 ? `\n等 ${oddEvenIssues.length} 处` : ''}\n\n请先将单周与双周课程设置为相同的周课时。`,
      '单双周课时校验',
      { type: 'warning', confirmButtonText: '我知道了' }
    )
    return
  }

  const statsBeforeReschedule = collectPlacedStats(classIds)
  if (statsBeforeReschedule.placed > 0) {
    try {
      await ElMessageBox.confirm(
        `检测到当前年级已有 ${statsBeforeReschedule.placed} 节已排课程（锁定 ${statsBeforeReschedule.locked} 节）。继续后将自动清空 ${statsBeforeReschedule.clearable} 节未锁定课程，并重新智能排课，是否继续？`,
        '重新排课确认',
        {
          type: 'warning',
          confirmButtonText: '确认重排',
          cancelButtonText: '取消',
          confirmButtonClass: 'el-button--danger'
        }
      )
    } catch {
      return
    }

    const cleared = clearUnlockedLessonsForClasses(classIds)
    if (cleared > 0) {
      notify.info(`已清空 ${cleared} 节未锁定课程，开始重新排课。`)
    } else {
      notify.info('当前仅有锁定课程，已保留锁定内容并继续排课。')
    }
  }

  const initialRemaining = classIds.reduce(
    (sum, classId) => sum + getCoursePoolForClass(classId).reduce((inner, item) => inner + Math.max(0, item.remaining), 0),
    0
  )
  if (initialRemaining <= 0) {
    notify.success('当前年级无需智能排课。')
    return
  }

  smartSchedulingLoading.value = true
  startSmartProgress()
  let solvedSuccess = false
  let smartSummary = ''
  try {
    const payload = buildApiSmartSolvePayloadForGrade(classIds)
    smartRuleDetailSections.value = buildSmartRuleDetails(payload, classIds)
    let solved = await solveSmartByApi(payload, handleSmartQueueUpdate)
    let placedCount = Number(solved.result.placedCount || 0)
    let remaining = Number.isFinite(solved.result.remainingCount) ? Number(solved.result.remainingCount) : initialRemaining
    let usedRelaxedMode: '' | 'default' = ''

    if (placedCount <= 0) {
      const relaxedDefaultPayload = buildRelaxedPayload(payload)
      const relaxedDefaultSolved = await solveSmartByApi(relaxedDefaultPayload, handleSmartQueueUpdate)
      if (Number(relaxedDefaultSolved.result.placedCount || 0) > 0) {
        usedRelaxedMode = 'default'
        solved = relaxedDefaultSolved
      }
      placedCount = Number(solved.result.placedCount || 0)
      remaining = Number.isFinite(solved.result.remainingCount) ? Number(solved.result.remainingCount) : initialRemaining
    }

    smartSolveLogs.value = Array.isArray(solved.logs) ? solved.logs : []
    const unplacedDiagnostic = extractUnplacedDiagnostic(smartSolveLogs.value)
    applyApiPlacements(solved.result.placements || [])
    if (placedCount <= 0) {
      smartSummary = '未找到可安排位置，请检查教师禁排/固定点/课时上限。'
      notify.warning(smartSummary)
      if (unplacedDiagnostic) {
        notify.warning(`未排原因：${unplacedDiagnostic}`)
      }
      appendSmartLogHistory({
        id: `smart-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        createdAt: Date.now(),
        success: false,
        summary: smartSummary,
        logs: [...smartSolveLogs.value],
        ruleDetails: cloneSmartRuleDetailSections(smartRuleDetailSections.value)
      })
      selectedSmartLogHistoryId.value = smartLogHistory.value[0]?.id || ''
      return
    }
    solvedSuccess = true
    if (usedRelaxedMode === 'default') {
      smartSummary = `智能排课完成：新增安排 ${placedCount} 节，剩余 ${remaining} 节（已自动放宽默认规则）。`
    } else {
      smartSummary = `智能排课完成：新增安排 ${placedCount} 节，剩余 ${remaining} 节。`
    }
    notify.success(smartSummary)
    if (remaining > 0 && unplacedDiagnostic) {
      notify.warning(`仍有未排课，主要原因：${unplacedDiagnostic}`)
    }
    appendSmartLogHistory({
      id: `smart-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      createdAt: Date.now(),
      success: true,
      summary: smartSummary,
      logs: [...smartSolveLogs.value],
      ruleDetails: cloneSmartRuleDetailSections(smartRuleDetailSections.value)
    })
    selectedSmartLogHistoryId.value = smartLogHistory.value[0]?.id || ''
  } catch (error) {
    console.error('[ScheduleWorkbench] 智能排课失败', error)
    let message = '智能排课失败，请稍后重试。'
    if (error instanceof SmartSchedulerApiError) {
      if (error.code === 'ORTOOLS_UNAVAILABLE') {
        message = '智能排课失败：OR-Tools 服务不可用，请先启动求解器服务。'
      } else if (error.code === 'ORTOOLS_TIMEOUT') {
        message = '智能排课失败：求解超时，请减少约束或缩小排课范围后重试。'
      } else if (error.code === 'ORTOOLS_INFEASIBLE') {
        message = '智能排课失败：当前约束冲突，模型不可行。请放宽规则后重试。'
      } else if (error.code === 'ORTOOLS_BAD_REQUEST') {
        message = '智能排课失败：请求参数异常，请刷新页面后重试。'
      } else if (error.code === 'SYNC_START_DAY_COUNT_CONFLICT' || error.code === 'SYNC_START_POSTCHECK_DAY_COUNT') {
        message = '智能排课失败：教案齐头冲突（同一老师不同班级同一天课时数不一致）。'
      } else if (error.code === 'SYNC_START_EXISTING_CONFLICT' || error.code === 'SYNC_START_POSTCHECK_CONSECUTIVE') {
        message = '智能排课失败：教案齐头冲突（同日多节未连续两节）。'
      } else if (error.code === 'CONSECUTIVE_EXISTING_CONFLICT') {
        message = '智能排课失败：连堂课规则与当前已排课冲突，请调整后重试。'
      } else if (error.code === 'COURSE_RELATION_EXISTING_CONFLICT') {
        message = '智能排课失败：当前已排课违反课程关系，请调整后重试。'
      } else {
        message = error.message || message
      }
    } else if (error instanceof Error) {
      message = error.message || message
    }
    smartSummary = message
    notify.error(smartSummary)
    appendSmartLogHistory({
      id: `smart-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      createdAt: Date.now(),
      success: false,
      summary: smartSummary,
      logs: [...smartSolveLogs.value],
      ruleDetails: cloneSmartRuleDetailSections(smartRuleDetailSections.value)
    })
    selectedSmartLogHistoryId.value = smartLogHistory.value[0]?.id || ''
  } finally {
    await finishSmartProgress(solvedSuccess)
    smartSchedulingLoading.value = false
  }
}

function openSmartLogsDialog(): void {
  if (!smartLogHistory.value.length) {
    notify.info('暂无智能排课日志，请先执行一次智能排课。')
    return
  }
  if (!selectedSmartLogHistoryId.value && smartLogHistory.value[0]) {
    selectedSmartLogHistoryId.value = smartLogHistory.value[0].id
  }
  smartLogDialogVisible.value = true
}

function clearCell(period: number, day: string): void {
  if (!selectedClass.value) return
  const key = keyOf(period, day)
  if (currentGrid.value[key]?.locked) {
    notify.warning('该课程已锁定，不能删除。')
    return
  }
  currentGrid.value[key] = null
}

function openLessonContextMenu(event: MouseEvent, period: number, day: string): void {
  if (!selectedClass.value) return
  const slotKey = keyOf(period, day)
  const lesson = currentGrid.value[slotKey]
  if (!lesson) return
  event.preventDefault()
  event.stopPropagation()
  lessonContextMenu.visible = true
  lessonContextMenu.x = event.clientX
  lessonContextMenu.y = event.clientY
  lessonContextMenu.classId = selectedClass.value
  lessonContextMenu.slotKey = slotKey
}

function openTeacherLessonContextMenu(event: MouseEvent, classId: string, period: number, day: string): void {
  if (!classId) return
  const slotKey = keyOf(period, day)
  const lesson = scheduleMap[classId]?.[slotKey]
  if (!lesson) return
  event.preventDefault()
  event.stopPropagation()
  lessonContextMenu.visible = true
  lessonContextMenu.x = event.clientX
  lessonContextMenu.y = event.clientY
  lessonContextMenu.classId = classId
  lessonContextMenu.slotKey = slotKey
}

function closeLessonContextMenu(): void {
  lessonContextMenu.visible = false
}

function lessonAtContextMenu(): Lesson | null {
  if (!lessonContextMenu.classId || !lessonContextMenu.slotKey) return null
  return scheduleMap[lessonContextMenu.classId]?.[lessonContextMenu.slotKey] ?? null
}

function toggleLessonLockFromMenu(): void {
  const lesson = lessonAtContextMenu()
  if (!lesson) return
  lesson.locked = !lesson.locked
  writeLockDraft()
  notify.success(lesson.locked ? '已锁定该课程。' : '已解锁该课程。')
  closeLessonContextMenu()
}

async function deleteLessonFromMenu(): Promise<void> {
  const lesson = lessonAtContextMenu()
  if (!lesson) return
  if (lesson.locked) {
    notify.warning('该课程已锁定，请先解锁后再删除。')
    closeLessonContextMenu()
    return
  }
  try {
    await ElMessageBox.confirm('确认删除该节次课程吗？', '删除确认', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    closeLessonContextMenu()
    return
  }
  if (lessonContextMenu.classId && lessonContextMenu.slotKey) {
    scheduleMap[lessonContextMenu.classId][lessonContextMenu.slotKey] = null
  }
  closeLessonContextMenu()
}

const contextMenuLessonLocked = computed(() => Boolean(lessonAtContextMenu()?.locked))

function handleGlobalPointerDown(): void {
  if (lessonContextMenu.visible) {
    closeLessonContextMenu()
  }
}

onMounted(() => {
  void hydrateRuleSettingsSnapshotFromApi().then((snapshot) => {
    ruleSettingsSnapshotRef.value = snapshot
  })
  window.addEventListener('pointerdown', handleGlobalPointerDown)
  window.addEventListener('resize', closeLessonContextMenu)
  window.addEventListener('scroll', closeLessonContextMenu, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown)
  window.removeEventListener('resize', closeLessonContextMenu)
  window.removeEventListener('scroll', closeLessonContextMenu, true)
  stopSmartProgressTimer()
})

function formatDateTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = `${d.getMonth() + 1}`.padStart(2, '0')
  const dd = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mi = `${d.getMinutes()}`.padStart(2, '0')
  const ss = `${d.getSeconds()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

const saveStatusText = computed(() => {
  if (persistLoading.value) return '保存中...'
  if (lastPublishedAt.value > 0) return `已发布：${formatDateTime(lastPublishedAt.value)}`
  if (lastPersistedAt.value > 0) return `已保存：${formatDateTime(lastPersistedAt.value)}`
  return '未保存'
})

function buildValidationReport(): { totalRequired: number; totalPlaced: number; totalRemaining: number; conflictCount: number } {
  classRecords.value.forEach((classItem) => ensureClassGrid(classItem.id))
  return buildValidationMetrics({
    arrangementScopes: arrangementScopes.value,
    scheduleMap: scheduleMap as unknown as Record<string, Record<string, EngineLesson | null>>,
    classIds: classRecords.value.map((item) => item.id)
  })
}

async function persistScheduleResult(publish: boolean): Promise<void> {
  if (persistLoading.value) return
  const report = buildValidationReport()
  if (publish && report.totalRemaining > 0) {
    try {
      await ElMessageBox.confirm(
        `当前仍有 ${report.totalRemaining} 课时未安排，确认仍要生成课表吗？`,
        '发布确认',
        {
          type: 'warning',
          confirmButtonText: '仍要发布',
          cancelButtonText: '取消',
          confirmButtonClass: 'el-button--danger'
        }
      )
    } catch {
      return
    }
  }

  persistLoading.value = true
  try {
    const now = Date.now()
    const previous = readSavedWorkbenchEntry()
    const entry: SavedScheduleWorkbenchEntry = {
      selectedCampus: selectedCampus.value,
      selectedGrade: selectedGrade.value,
      selectedClass: selectedClass.value,
      scheduleMap: snapshotScheduleMap(),
      savedAt: now,
      publishedAt: publish ? now : previous?.publishedAt,
      version: (previous?.version || 0) + 1
    }
    const nextDrafts = { ...(workbenchPersistState.value.drafts || {}) }
    delete nextDrafts[currentPlanId.value]
    const nextPublishedEntries = { ...(workbenchPersistState.value.publishedEntries || {}) }
    if (publish) nextPublishedEntries[currentPlanId.value] = structuredClone(entry)
    const nextPublishedAt = publish ? now : lastPublishedAt.value
    workbenchPersistState.value = {
      ...workbenchPersistState.value,
      entries: {
        ...(workbenchPersistState.value.entries || {}),
        [currentPlanId.value]: entry
      },
      publishedEntries: nextPublishedEntries,
      drafts: nextDrafts,
      meta: {
        ...(workbenchPersistState.value.meta || {}),
        [currentPlanId.value]: { savedAt: now, publishedAt: nextPublishedAt }
      }
    }
    await saveWorkbenchPersistSnapshot(workbenchPersistState.value)
    lastPersistedAt.value = now
    if (publish) lastPublishedAt.value = now
    notify.success(publish ? '班级、教师、课程和学校课表已同步生成并保存。' : '排课结果已保存。')
  } catch (error) {
    console.error('[ScheduleWorkbench] 保存失败', error)
    notify.error('保存失败，请稍后重试。')
  } finally {
    persistLoading.value = false
  }
}

function openPublishDialog(): void {
  if (persistLoading.value) return
  publishDialogVisible.value = true
}

function closePublishDialog(): void {
  publishDialogVisible.value = false
}

async function confirmPublishDialog(): Promise<void> {
  closePublishDialog()
  await persistScheduleResult(true)
}

function parseSlotKey(slotKey: string): { period: number; day: string } | null {
  const [periodRaw, ...dayParts] = slotKey.split('-')
  const period = Number(periodRaw)
  const day = dayParts.join('-')
  if (!Number.isFinite(period) || !day) return null
  return { period, day }
}

async function confirmClearSchedule(): Promise<void> {
  const isGradeScope = clearScheduleScope.value === 'grade'
  const targetClassIds = isGradeScope
    ? classTabs.value.map((item) => item.id).filter(Boolean)
    : selectedClass.value
      ? [selectedClass.value]
      : []

  if (targetClassIds.length === 0) {
    notify.warning(isGradeScope ? '当前年级暂无可清空班级。' : '请先选择班级。')
    return
  }

  const targetLabel = isGradeScope
    ? `「${selectedGrade.value}」全部 ${targetClassIds.length} 个班级`
    : `「${currentClassName.value}」`

  try {
    await ElMessageBox.confirm(`确认清空${targetLabel}的排课结果吗？锁定课程和全局固定点将被保留。`, '清空确认', {
      type: 'warning',
      confirmButtonText: '确认清空',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }

  let clearedCount = 0
  let lockedCount = 0
  let fixedCount = 0

  targetClassIds.forEach((classId) => {
    ensureClassGrid(classId)
    Object.entries(scheduleMap[classId]).forEach(([slotKey, lesson]) => {
      if (!lesson) return
      if (lesson.locked) {
        lockedCount += 1
        return
      }
      const parsed = parseSlotKey(slotKey)
      if (parsed && globalFixedPointAt(parsed.period, parsed.day)) {
        fixedCount += 1
        return
      }
      scheduleMap[classId][slotKey] = null
      clearedCount += 1
    })
  })

  clearSchedulePopoverVisible.value = false

  if (clearedCount <= 0) {
    notify.warning(`无可清空课程（锁定 ${lockedCount}，固定点 ${fixedCount}）。`)
    return
  }
  notify.success(`已清空${isGradeScope ? '当前年级' : '当前班级'} ${clearedCount} 节（保留锁定 ${lockedCount}，固定点 ${fixedCount}）。`)
}

function exitPoolHighlightMode(): void {
  activePoolAssignmentKey.value = ''
}

function classHasLessons(classId: string): boolean {
  if (!classId) return false
  ensureClassGrid(classId)
  return Object.values(scheduleMap[classId]).some((item) => Boolean(item))
}

function classAllLocked(classId: string): boolean {
  if (!classId) return false
  ensureClassGrid(classId)
  const lessons = Object.values(scheduleMap[classId]).filter((item): item is Lesson => Boolean(item))
  return lessons.length > 0 && lessons.every((item) => Boolean(item.locked))
}

function toggleClassLock(classId: string): void {
  if (!classId) return
  ensureClassGrid(classId)
  const entries = Object.entries(scheduleMap[classId])
  const hasAnyLesson = entries.some(([, lesson]) => Boolean(lesson))
  if (!hasAnyLesson) {
    notify.warning('该班级暂无已排课程。')
    return
  }

  const targetLocked = !classAllLocked(classId)
  entries.forEach(([slotKey, lesson]) => {
    if (!lesson) return
    scheduleMap[classId][slotKey] = {
      ...lesson,
      locked: targetLocked
    }
  })
  writeLockDraft()
  const className = classLabelById(classId)
  notify.success(targetLocked ? `「${className}」课程已全部锁定。` : `「${className}」课程已全部解锁。`)
}

function gradeHasLessons(): boolean {
  return classTabs.value.some((item) => classHasLessons(item.id))
}

function gradeAllLocked(): boolean {
  const withLessons = classTabs.value.filter((item) => classHasLessons(item.id))
  return withLessons.length > 0 && withLessons.every((item) => classAllLocked(item.id))
}

function toggleGradeLock(): void {
  const targetClasses = classTabs.value
  if (targetClasses.length === 0) {
    notify.warning('当前年级暂无班级。')
    return
  }
  const withLessons = targetClasses.filter((item) => classHasLessons(item.id))
  if (withLessons.length === 0) {
    notify.warning('当前年级暂无已排课程。')
    return
  }

  const targetLocked = !gradeAllLocked()
  withLessons.forEach((item) => {
    ensureClassGrid(item.id)
    Object.entries(scheduleMap[item.id]).forEach(([slotKey, lesson]) => {
      if (!lesson) return
      scheduleMap[item.id][slotKey] = {
        ...lesson,
        locked: targetLocked
      }
    })
  })
  writeLockDraft()
  notify.success(targetLocked ? '当前年级所有班级课程已全部锁定。' : '当前年级所有班级课程已全部解锁。')
}
</script>

<template>
  <AppContentSkeleton v-if="!workbenchReady" variant="workbench" />
  <article v-else class="panel workbench-panel">
    <header class="workbench-header">
      <div class="workbench-header-left">
        <div class="workbench-filters workbench-filters--triple">
          <div class="workbench-plan">方案：{{ planName }}</div>
          <el-select v-model="selectedCampus" placeholder="选择校区">
            <el-option v-for="campus in campusOptions" :key="campus.id" :label="campus.name" :value="campus.id" />
          </el-select>
          <el-select v-model="selectedGrade" placeholder="选择年级">
            <el-option v-for="grade in gradeOptions" :key="grade" :label="grade" :value="grade" />
          </el-select>
        </div>

        <div class="class-tabs-row">
          <el-button
            class="grade-lock-btn"
            :class="{ 'is-locked': gradeAllLocked() }"
            :disabled="!gradeHasLessons()"
            :aria-pressed="gradeAllLocked()"
            :title="gradeAllLocked() ? '点击解锁当前年级全部班级' : '点击锁定当前年级全部班级'"
            @click="toggleGradeLock"
          >
            <el-icon><component :is="gradeAllLocked() ? Lock : Unlock" /></el-icon>
            <span>{{ gradeAllLocked() ? '全年级已锁定' : '锁定全年级' }}</span>
          </el-button>
          <nav class="class-tabs el-class-tabs">
            <el-radio-group v-model="selectedClass" @change="exitPoolHighlightMode">
              <div
                v-for="classItem in classTabs"
                :key="classItem.id"
                :class="[
                  'class-tab-item',
                  {
                    'is-current': selectedClass === classItem.id,
                    'is-locked': classAllLocked(classItem.id),
                    'is-disabled': !classHasLessons(classItem.id)
                  }
                ]"
              >
                <el-radio-button :value="classItem.id" @click="exitPoolHighlightMode">
                  {{ classItem.className }}
                </el-radio-button>
                <el-button
                  class="class-tab-lock-btn"
                  :class="{ 'is-locked': classAllLocked(classItem.id) }"
                  :disabled="!classHasLessons(classItem.id)"
                  :aria-label="classAllLocked(classItem.id) ? `解锁${classItem.className}` : `锁定${classItem.className}`"
                  :aria-pressed="classAllLocked(classItem.id)"
                  :title="classAllLocked(classItem.id) ? `解锁${classItem.className}` : `锁定${classItem.className}`"
                  @click.stop="toggleClassLock(classItem.id)"
                >
                  <el-icon><component :is="classAllLocked(classItem.id) ? Lock : Unlock" /></el-icon>
                </el-button>
              </div>
            </el-radio-group>
          </nav>
        </div>
      </div>

      <div class="workbench-actions">
        <span class="save-status-text">{{ saveStatusText }}</span>
        <el-popover
          v-model:visible="clearSchedulePopoverVisible"
          placement="bottom-end"
          trigger="click"
          :width="280"
          popper-class="schedule-clear-popover"
        >
          <template #reference>
            <el-button type="danger" plain>清空课表</el-button>
          </template>
          <div class="schedule-clear-panel">
            <div class="schedule-clear-title">选择清空范围</div>
            <el-radio-group v-model="clearScheduleScope" class="schedule-clear-options">
              <el-radio value="class" :disabled="!selectedClass">
                <span>当前班级</span>
                <small>{{ currentClassName || '未选择班级' }}</small>
              </el-radio>
              <el-radio value="grade" :disabled="classTabs.length === 0">
                <span>当前年级全部班级</span>
                <small>{{ selectedGrade || '未选择年级' }} · {{ classTabs.length }} 个班级</small>
              </el-radio>
            </el-radio-group>
            <div class="schedule-clear-actions">
              <el-button text @click="clearSchedulePopoverVisible = false">取消</el-button>
              <el-button type="danger" :disabled="clearScheduleScope === 'class' ? !selectedClass : classTabs.length === 0" @click="confirmClearSchedule">
                确认清空
              </el-button>
            </div>
          </div>
        </el-popover>
        <el-button :loading="smartSchedulingLoading" @click="runSmartScheduling">智能排课</el-button>
        <el-button plain @click="openSmartLogsDialog">查看排课日志</el-button>
        <el-button :loading="persistLoading" @click="persistScheduleResult(false)">保存课表</el-button>
        <el-button type="primary" :loading="persistLoading" @click="openPublishDialog">生成课表</el-button>
      </div>
    </header>

    <section class="workbench-main">
      <aside class="course-pool">
        <h3>待安排课程</h3>
        <div class="pool-list">
          <div
            v-for="course in coursePool"
            :key="course.id"
            :class="[
              'pool-card',
              { 'is-empty': course.remaining <= 0, 'is-active': activePoolAssignmentKey === course.assignmentKey }
            ]"
            :style="{ background: course.color }"
            :draggable="course.remaining > 0"
            @click="setActivePoolCard(course.assignmentKey)"
            @dragstart="onDragFromPool(course.assignmentKey)"
            @dragend="onDragEnd"
          >
            <strong>{{ course.name }}</strong>
            <span>{{ course.teacher }}</span>
            <i v-if="course.isOddEven" class="pool-odd-even-badge">单双</i>
            <i v-if="isPoolBlockCombined(course)" class="pool-combine-badge">合</i>
            <i class="pool-count-badge">{{ course.remaining }}</i>
          </div>
          <div v-if="coursePool.length === 0" class="pool-empty">
            暂无待安排课程
          </div>
        </div>
      </aside>

      <div class="timetable-wrap">
        <div class="board-head">
          <span class="board-title">{{ classScheduleTitle }}</span>
          <span v-if="activeCourseLabel" class="board-active-tag">{{ activeCourseLabel }}</span>
        </div>
        <el-table :data="timetableRows" border class="workbench-el-table" :row-class-name="timetableRowClassName">
          <el-table-column prop="period" label="节次" width="78" />
          <el-table-column v-for="day in days" :key="day" :label="day" min-width="128">
            <template #default="{ row }">
              <div
                :class="['drop-cell', dropCellClass(row.period, day)]"
                :title="dropForbiddenReason(row.period, day) || ''"
                @dragover.prevent
                @drop.prevent="onDropToCell(row.period, day)"
                @dblclick="clearCell(row.period, day)"
              >
                <div
                  v-if="dragging && dropForbiddenLabel(row.period, day) && !currentGrid[keyOf(row.period, day)]"
                  class="drop-forbidden-mask"
                >
                  {{ dropForbiddenLabel(row.period, day) }}
                </div>
                <div
                  v-if="!currentGrid[keyOf(row.period, day)] && globalFixedPointAt(row.period, day)"
                  class="fixed-slot-mask"
                >
                  {{ globalFixedPointAt(row.period, day)?.label }}
                </div>
                <div
                  v-if="currentGrid[keyOf(row.period, day)]"
                  :class="[
                    'lesson-card',
                    {
                      'is-dim-lesson':
                        hasActiveCourse &&
                        activePoolAssignmentKey !==
                          (currentGrid[keyOf(row.period, day)]?.assignmentKey || currentGrid[keyOf(row.period, day)]?.courseId),
                      'is-active-lesson':
                        activePoolAssignmentKey ===
                        (currentGrid[keyOf(row.period, day)]?.assignmentKey || currentGrid[keyOf(row.period, day)]?.courseId)
                    }
                  ]"
                  :style="{ background: currentGrid[keyOf(row.period, day)]?.color || '#5b8fd1' }"
                  :draggable="!currentGrid[keyOf(row.period, day)]?.locked"
                  @dragstart="onDragFromCell(selectedClass, keyOf(row.period, day))"
                  @dragend="onDragEnd"
                  @click.stop="setActiveByLesson(row.period, day)"
                  @contextmenu.prevent.stop="openLessonContextMenu($event, row.period, day)"
                >
                  <strong>{{ currentGrid[keyOf(row.period, day)]?.name }}</strong>
                  <span>{{ currentGrid[keyOf(row.period, day)]?.teacher }}</span>
                  <i v-if="currentGrid[keyOf(row.period, day)]?.isOddEven" class="lesson-odd-even-badge">单双</i>
                  <i v-if="currentGrid[keyOf(row.period, day)]?.isCombined" class="lesson-combine-badge">合</i>
                  <i v-if="currentGrid[keyOf(row.period, day)]?.locked" class="lesson-lock-badge">锁</i>
                </div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <aside class="teacher-board">
        <div class="teacher-head">
          <div class="teacher-head-left">
            <h3>教师课表</h3>
            <span v-if="activeTeacherName" class="board-active-tag teacher-tag">{{ activeTeacherName }}</span>
          </div>
        </div>
        <el-empty
          v-if="activeTeacherName === '未设置教师'"
          description="当前课程未设置教师，教师课表不显示相关课程。"
        />
        <el-table
          v-else
          :data="teacherTimetableRows"
          border
          class="workbench-el-table"
          :row-class-name="timetableRowClassName"
        >
          <el-table-column prop="period" label="节次" width="78" />
          <el-table-column v-for="day in teacherDays" :key="`t-${day}`" :label="day" min-width="128">
            <template #default="{ row }">
              <div class="teacher-empty-cell">
                <div
                  v-for="item in teacherGrid[keyOf(row.period, day)]"
                  :key="`${item.classId}-${item.lesson.assignmentKey}-${row.period}-${day}`"
                  :class="['teacher-lesson-card', { 'is-other-class': item.classId !== selectedClass }]"
                  :style="{ background: item.lesson.color || '#5b8fd1' }"
                  @contextmenu.prevent.stop="openTeacherLessonContextMenu($event, item.classId, row.period, day)"
                >
                  <strong>{{ item.lesson.name }}</strong>
                  <span>{{ item.className }}</span>
                  <i v-if="item.lesson.isOddEven" class="lesson-odd-even-badge">单双</i>
                  <i v-if="item.lesson.isCombined" class="lesson-combine-badge">合</i>
                  <i v-if="item.lesson.locked" class="lesson-lock-badge">锁</i>
                </div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </aside>
    </section>

    <div
      v-if="lessonContextMenu.visible"
      class="lesson-context-menu"
      :style="{ left: `${lessonContextMenu.x}px`, top: `${lessonContextMenu.y}px` }"
      @pointerdown.stop
    >
      <div class="lesson-context-item" @click="toggleLessonLockFromMenu">
        {{ contextMenuLessonLocked ? '解锁' : '锁定' }}
      </div>
      <div class="lesson-context-item danger" @click="deleteLessonFromMenu">
        删除
      </div>
    </div>

    <el-dialog
      v-model="publishDialogVisible"
      title="生成课表"
      width="520px"
      class="publish-timetable-dialog"
    >
      <p class="publish-type-intro">保存当前排课结果，并同步更新以下四类课表：</p>
      <div class="publish-type-list">
        <div v-for="item in publishTypeOptions" :key="item.value" class="publish-type-item">
          <el-icon class="publish-type-status"><CircleCheckFilled /></el-icon>
          <div class="publish-type-copy">
            <strong>{{ item.label }}</strong>
            <span>{{ item.description }}</span>
          </div>
        </div>
      </div>
      <el-alert
        title="四类课表共用当前排课数据，生成后可在“课表管理”中切换查看。"
        type="info"
        :closable="false"
        show-icon
      />
      <template #footer>
        <div class="dialog-actions">
          <el-button @click="closePublishDialog">取消</el-button>
          <el-button type="primary" :loading="persistLoading" @click="confirmPublishDialog">确认生成</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="smartProgressVisible"
      :title="smartProgressTitle"
      width="460px"
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :modal="true"
      align-center
      class="smart-progress-dialog"
    >
      <div class="smart-progress-content">
        <section
          v-if="smartQueueUpdate?.status === 'queued'"
          class="smart-queue-status smart-queue-status--waiting"
        >
          <div class="smart-queue-status-head">
            <strong>按提交顺序等待</strong>
            <el-tag type="warning" effect="plain">
              前方 {{ smartQueueUpdate.waitingAhead }} 个任务
            </el-tag>
          </div>
          <p>系统同一时间只执行一个智能排课任务，轮到当前任务后会自动开始，无需重复提交。</p>
          <dl class="smart-queue-estimates">
            <div>
              <dt>队列任务数</dt>
              <dd>{{ smartQueueUpdate.queueSize }} 个</dd>
            </div>
            <div>
              <dt>预计开始</dt>
              <dd>{{ formatQueueEstimate(smartQueueUpdate.estimatedStartAt) }}</dd>
            </div>
            <div>
              <dt>预计完成</dt>
              <dd>{{ formatQueueEstimate(smartQueueUpdate.estimatedFinishAt) }}</dd>
            </div>
          </dl>
        </section>
        <section
          v-else-if="smartQueueUpdate?.status === 'running'"
          class="smart-queue-status smart-queue-status--running"
        >
          <div class="smart-queue-status-head">
            <strong>当前任务正在求解</strong>
            <el-tag type="success" effect="plain">已开始</el-tag>
          </div>
          <p>求解器已轮到当前任务，完成后会自动应用排课结果。</p>
          <dl class="smart-queue-estimates smart-queue-estimates--running">
            <div>
              <dt>预计耗时</dt>
              <dd>{{ formatEstimatedDuration(smartQueueUpdate.estimatedDurationMs) }}</dd>
            </div>
            <div>
              <dt>预计完成</dt>
              <dd>{{ formatQueueEstimate(smartQueueUpdate.estimatedFinishAt) }}</dd>
            </div>
          </dl>
        </section>
        <el-progress :percentage="smartProgressPercent" :stroke-width="16" />
        <p class="smart-progress-text">{{ smartProgressText }}</p>
      </div>
    </el-dialog>

    <el-dialog
      v-model="smartLogDialogVisible"
      title="智能排课日志"
      width="680px"
      :close-on-click-modal="true"
      class="smart-log-dialog"
    >
      <div v-if="smartLogHistory.length" class="smart-log-history-toolbar">
        <el-select v-model="selectedSmartLogHistoryId" class="smart-log-history-select" placeholder="请选择日志记录">
          <el-option
            v-for="item in smartLogHistory"
            :key="item.id"
            :label="`${formatDateTime(item.createdAt)} · ${item.success ? '成功' : '失败'}`"
            :value="item.id"
          />
        </el-select>
        <el-tag :type="selectedSmartLogRecord?.success ? 'success' : 'danger'" size="small">
          {{ selectedSmartLogRecord?.success ? '成功' : '失败' }}
        </el-tag>
      </div>
      <p v-if="selectedSmartLogRecord?.summary" class="smart-log-summary">{{ selectedSmartLogRecord?.summary }}</p>

      <el-timeline v-if="smartSolveLogs.length" class="smart-log-timeline">
        <el-timeline-item
          v-for="(item, index) in smartSolveLogs"
          :key="`${item.at}-${index}`"
          :timestamp="formatLogTime(item.at)"
          placement="top"
        >
          <div class="smart-log-entry">
            <div class="smart-log-phase">{{ item.phase }}</div>
            <div class="smart-log-message">{{ item.message }}</div>
          </div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无日志" />

      <div v-if="smartRuleDetailSections.length" class="smart-log-details">
        <h4>详情</h4>
        <div v-for="section in smartIntegratedRuleSections" :key="section.title" class="smart-log-detail-section">
          <div class="smart-log-detail-title">{{ section.title }}</div>
          <el-table :data="section.items" border size="small" class="smart-log-detail-table">
            <el-table-column prop="name" label="规则" min-width="180" />
            <el-table-column label="状态" min-width="120">
              <template #default="{ row }">
                <el-tag
                  :type="row.status === 'used' ? 'success' : row.status === 'unused' ? 'info' : 'warning'"
                  size="small"
                >
                  {{ smartRuleStatusText(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="detail" label="说明" min-width="280" />
          </el-table>
        </div>

        <el-collapse v-if="smartNotIntegratedRules.length" v-model="smartDetailCollapseActive" class="smart-log-collapse">
          <el-collapse-item name="not-integrated">
            <template #title>
              <span class="smart-log-collapse-title">未接入求解规则（展开查看）</span>
            </template>
            <div class="smart-log-priority">
              <div class="smart-log-priority-title">优先接入建议顺序</div>
              <ol class="smart-log-priority-list">
                <li v-for="name in smartNotIntegratedPriorityOrder" :key="name">{{ name }}</li>
              </ol>
            </div>
            <el-table :data="smartNotIntegratedRules" border size="small" class="smart-log-detail-table">
              <el-table-column prop="name" label="规则" min-width="180" />
              <el-table-column prop="source" label="来源" min-width="130" />
              <el-table-column prop="detail" label="说明" min-width="300" />
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </div>
    </el-dialog>
  </article>
</template>
