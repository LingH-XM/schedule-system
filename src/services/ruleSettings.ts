import { withAccountQuery, withAccountStorageKey } from './accountContext'
import { authHeaders } from './auth'

export type OddEvenRuleRecord = {
  id: string
  campus: string
  grade: string
  classNames: string[]
  oddCourse: string
  evenCourse: string
}

export type CombineCourseRuleRecord = {
  id: string
  orderNo: number
  campus: string
  grade: string
  classNames: string[]
  course: string
}

export type CourseAreaRuleRecord = {
  id: string
  campus: string
  grade: string
  subject: string
  className: string
  allowedSlots: string[]
}

export type CourseBanRuleRecord = {
  id: string
  campus: string
  grade: string
  subject: string
  className: string
  bannedSlots: string[]
}

export type MainSecondaryRuleRecord = {
  id: string
  campus: string
  grade: string
  mainSubjects: string[]
  secondarySubjects: string[]
}

export type CourseRelationRuleRecord = {
  id: string
  campus: string
  grade: string
  courseA: string
  courseB: string
  relationType: '前后互斥' | '同天互斥'
}

export type TeacherMutualRuleRecord = {
  id: string
  type: 'mutual' | 'mentoring'
  teacherGroupA: string[]
  teacherGroupB: string[]
}

export type TeacherHourRuleRecord = {
  id: string
  campus: string
  grade: string
  subject: string
  teacherId: string
  teacherName: string
  maxDailyLessons: number | null
  maxConsecutiveLessons: number | null
  weekDistribution: '周分散' | '周集中' | null
  dayDistribution: '日分散' | '日集中' | null
}

export type ConsecutiveRuleValue = {
  weeklyConsecutiveCount: number | null
  preferredDays: string[]
}

export type ConsecutiveSetting = {
  defaultRule: ConsecutiveRuleValue
  classOverrides: Record<string, ConsecutiveRuleValue>
}

export type ConsecutiveSettingMap = Record<string, ConsecutiveSetting>

export type TeacherBanRuleMap = Record<string, Record<string, boolean>>

export type CourseDefaultRuleKey =
  | 'syncStart'
  | 'distribution'
  | 'differentDayPeriod'
  | 'noCrossNoon'
  | 'sameClassNoConsecutive'
  | 'twoLessonsGap'

export type CourseDefaultRulePair = {
  main: string
  secondary: string
}

export type CourseDefaultConfig = {
  enabled: boolean
  rules: Record<CourseDefaultRuleKey, CourseDefaultRulePair>
  ruleEnabled: Record<CourseDefaultRuleKey, boolean>
}

export type RuleWeightHardKey =
  | 'teacherConflict'
  | 'teacherBan'
  | 'teacherHourLimit'
  | 'teacherMutual'
  | 'classConflict'
  | 'globalFixedPoint'
  | 'courseArea'
  | 'courseBan'
  | 'combineCourse'
  | 'courseRelation'

export type RuleWeightSoftKey =
  | 'teacherWeekDistribution'
  | 'teacherDayDistribution'
  | 'consecutive'
  | 'oddEven'
  | 'mainSecondary'
  | 'courseDefault'

export type RuleWeightRuleKey = RuleWeightHardKey | RuleWeightSoftKey

export type RuleWeightHardRule = {
  key: RuleWeightHardKey
  enabled: boolean
  priority: number
}

export type RuleWeightSoftRule = {
  key: RuleWeightSoftKey
  enabled: boolean
  weight: number
}

export type RuleWeightConfig = {
  enabled: boolean
  autoNormalize: boolean
  rules: RuleWeightRule[]
  hardRules: RuleWeightHardRule[]
  softRules: RuleWeightSoftRule[]
}

export type RuleWeightRule = {
  key: RuleWeightRuleKey
  enabled: boolean
  mode: 'hard' | 'soft'
  priority: number
  weight: number
}

export type RuleWeightConfigRecord = {
  id: string
  campus: string
  grade: string
  config: RuleWeightConfig
}

export type GlobalFixedPointRecord = {
  id: string
  campus: string
  grade: string
  type: string
  period: number
  day: string
  label: string
}

export type RuleSettingsSnapshot = {
  version: number
  globalFixedPoints: GlobalFixedPointRecord[]
  oddEvenRules: OddEvenRuleRecord[]
  combineRules: CombineCourseRuleRecord[]
  courseAreaRules: CourseAreaRuleRecord[]
  courseBanRules: CourseBanRuleRecord[]
  mainSecondaryRules: MainSecondaryRuleRecord[]
  courseRelationRules: CourseRelationRuleRecord[]
  teacherMutualRules: TeacherMutualRuleRecord[]
  teacherBanRules: TeacherBanRuleMap
  teacherHourRules: TeacherHourRuleRecord[]
  consecutiveSettings: ConsecutiveSettingMap
  courseDefaultConfig: CourseDefaultConfig
  ruleWeightConfigs: RuleWeightConfigRecord[]
  _savedAt?: number
}

const RULE_SETTINGS_STORAGE_KEY = 'schedule_rule_settings_v1'
const CURRENT_SNAPSHOT_VERSION = 2
const ruleSettingsSource = (import.meta.env.VITE_RULE_SETTINGS_SOURCE ?? import.meta.env.VITE_BASIC_DATA_SOURCE ?? 'api').toLowerCase()
const ruleSettingsApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
const ruleSettingsApiProfile = (import.meta.env.VITE_API_PROFILE ?? 'test').trim().toLowerCase() || 'test'
const ruleSettingsPlanId = (import.meta.env.VITE_RULE_SETTINGS_PLAN_ID ?? import.meta.env.VITE_BASIC_DATA_PLAN_ID ?? 'default').trim() || 'default'
const RULE_SETTINGS_API_PATH = `/api/${ruleSettingsApiProfile}/rule-settings`

export const defaultOddEvenRules: OddEvenRuleRecord[] = []
export const defaultCourseDefaultConfig: CourseDefaultConfig = {
  enabled: true,
  rules: {
    syncStart: { main: '尽量一致', secondary: '无特殊要求' },
    distribution: { main: '尽量分散到不同天', secondary: '尽量分散到不同天' },
    differentDayPeriod: { main: '尽量不同节次', secondary: '尽量不同节次' },
    noCrossNoon: { main: '不能让老师在上午末节和下午首节连上', secondary: '不能让老师在上午末节和下午首节连上' },
    sameClassNoConsecutive: { main: '优先不连堂', secondary: '优先不连堂' },
    twoLessonsGap: { main: '是', secondary: '是' }
  },
  ruleEnabled: {
    syncStart: true,
    distribution: true,
    differentDayPeriod: true,
    noCrossNoon: true,
    sameClassNoConsecutive: true,
    twoLessonsGap: true
  }
}

const legacyCourseDefaultConfig: CourseDefaultConfig = {
  enabled: true,
  rules: {
    syncStart: { main: '必须一致', secondary: '必须一致' },
    distribution: { main: '尽量在一上午/一下午集中上完', secondary: '尽量在一上午/一下午集中上完' },
    differentDayPeriod: { main: '尽量不同节次', secondary: '尽量不同节次' },
    noCrossNoon: { main: '不能让老师在上午末节和下午首节连上', secondary: '不能让老师在上午末节和下午首节连上' },
    sameClassNoConsecutive: { main: '无特殊要求', secondary: '无特殊要求' },
    twoLessonsGap: { main: '是', secondary: '是' }
  },
  ruleEnabled: {
    syncStart: true,
    distribution: true,
    differentDayPeriod: true,
    noCrossNoon: true,
    sameClassNoConsecutive: true,
    twoLessonsGap: true
  }
}

export function cloneCourseDefaultConfig(config: CourseDefaultConfig = defaultCourseDefaultConfig): CourseDefaultConfig {
  return {
    enabled: config.enabled,
    rules: {
      syncStart: { ...config.rules.syncStart },
      distribution: { ...config.rules.distribution },
      differentDayPeriod: { ...config.rules.differentDayPeriod },
      noCrossNoon: { ...config.rules.noCrossNoon },
      sameClassNoConsecutive: { ...config.rules.sameClassNoConsecutive },
      twoLessonsGap: { ...config.rules.twoLessonsGap }
    },
    ruleEnabled: { ...config.ruleEnabled }
  }
}

function isLegacyCourseDefaultConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Partial<CourseDefaultConfig>
  const rawRules = raw.rules || ({} as CourseDefaultConfig['rules'])
  const rawEnabled = raw.ruleEnabled || ({} as CourseDefaultConfig['ruleEnabled'])
  return (
    raw.enabled !== false &&
    (Object.keys(legacyCourseDefaultConfig.rules) as CourseDefaultRuleKey[]).every(
      (key) =>
        rawRules[key]?.main === legacyCourseDefaultConfig.rules[key].main &&
        rawRules[key]?.secondary === legacyCourseDefaultConfig.rules[key].secondary &&
        rawEnabled[key] !== false
    )
  )
}

const defaultRuleWeightHardRules: RuleWeightHardRule[] = [
  { key: 'teacherConflict', enabled: true, priority: 1 },
  { key: 'classConflict', enabled: true, priority: 1 },
  { key: 'teacherBan', enabled: true, priority: 2 },
  { key: 'teacherHourLimit', enabled: true, priority: 2 },
  { key: 'teacherMutual', enabled: true, priority: 2 },
  { key: 'globalFixedPoint', enabled: true, priority: 3 },
  { key: 'courseArea', enabled: true, priority: 4 },
  { key: 'courseBan', enabled: true, priority: 4 },
  { key: 'combineCourse', enabled: true, priority: 4 },
  { key: 'courseRelation', enabled: true, priority: 4 }
]

const defaultRuleWeightSoftRules: RuleWeightSoftRule[] = [
  { key: 'teacherWeekDistribution', enabled: true, weight: 45 },
  { key: 'teacherDayDistribution', enabled: true, weight: 25 },
  { key: 'consecutive', enabled: true, weight: 30 },
  { key: 'oddEven', enabled: true, weight: 0 },
  { key: 'mainSecondary', enabled: true, weight: 0 },
  { key: 'courseDefault', enabled: true, weight: 0 }
]

export const defaultRuleWeightConfig: RuleWeightConfig = {
  enabled: true,
  autoNormalize: true,
  rules: [
    ...defaultRuleWeightHardRules.map((item) => ({
      key: item.key as RuleWeightRuleKey,
      enabled: item.enabled,
      mode: 'hard' as const,
      priority: item.priority,
      weight: 0
    })),
    ...defaultRuleWeightSoftRules.map((item) => ({
      key: item.key as RuleWeightRuleKey,
      enabled: item.enabled,
      mode: 'soft' as const,
      priority: 4,
      weight: item.weight
    }))
  ],
  hardRules: defaultRuleWeightHardRules.map((item) => ({ ...item })),
  softRules: defaultRuleWeightSoftRules.map((item) => ({ ...item }))
}

export const defaultRuleWeightConfigs: RuleWeightConfigRecord[] = []

function createDefaultSnapshot(): RuleSettingsSnapshot {
  return {
    version: CURRENT_SNAPSHOT_VERSION,
    globalFixedPoints: [],
    oddEvenRules: cloneOddEvenRules(defaultOddEvenRules),
    combineRules: [],
    courseAreaRules: [],
    courseBanRules: [],
    mainSecondaryRules: [],
    courseRelationRules: [],
    teacherMutualRules: [],
    teacherBanRules: {},
    teacherHourRules: [],
    consecutiveSettings: {},
    courseDefaultConfig: cloneCourseDefaultConfig(),
    ruleWeightConfigs: defaultRuleWeightConfigs.map((item) => ({ ...item, config: normalizeRuleWeightConfig(item.config) })),
    _savedAt: 0
  }
}

function cloneGlobalFixedPoints(points: GlobalFixedPointRecord[]): GlobalFixedPointRecord[] {
  return points.map((item) => ({ ...item }))
}

function cloneOddEvenRules(rules: OddEvenRuleRecord[]): OddEvenRuleRecord[] {
  return rules.map((item) => ({
    ...item,
    classNames: [...item.classNames]
  }))
}

function cloneCombineRules(rules: CombineCourseRuleRecord[]): CombineCourseRuleRecord[] {
  return rules.map((item) => ({
    ...item,
    classNames: [...item.classNames]
  }))
}

function cloneCourseAreaRules(rules: CourseAreaRuleRecord[]): CourseAreaRuleRecord[] {
  return rules.map((item) => ({
    ...item,
    allowedSlots: [...item.allowedSlots]
  }))
}

function cloneCourseBanRules(rules: CourseBanRuleRecord[]): CourseBanRuleRecord[] {
  return rules.map((item) => ({
    ...item,
    bannedSlots: [...item.bannedSlots]
  }))
}

function cloneMainSecondaryRules(rules: MainSecondaryRuleRecord[]): MainSecondaryRuleRecord[] {
  return rules.map((item) => ({
    ...item,
    mainSubjects: [...item.mainSubjects],
    secondarySubjects: [...item.secondarySubjects]
  }))
}

function cloneCourseRelationRules(rules: CourseRelationRuleRecord[]): CourseRelationRuleRecord[] {
  return rules.map((item) => ({ ...item }))
}

function cloneTeacherMutualRules(rules: TeacherMutualRuleRecord[]): TeacherMutualRuleRecord[] {
  return rules.map((item) => ({
    ...item,
    teacherGroupA: [...item.teacherGroupA],
    teacherGroupB: [...item.teacherGroupB]
  }))
}

function cloneTeacherHourRules(rules: TeacherHourRuleRecord[]): TeacherHourRuleRecord[] {
  return rules.map((item) => ({ ...item }))
}

function cloneTeacherBanRules(rules: TeacherBanRuleMap): TeacherBanRuleMap {
  const result: TeacherBanRuleMap = {}
  Object.entries(rules || {}).forEach(([targetKey, slotMap]) => {
    if (!slotMap || typeof slotMap !== 'object') return
    result[targetKey] = {}
    Object.entries(slotMap).forEach(([slotKey, enabled]) => {
      result[targetKey][slotKey] = Boolean(enabled)
    })
  })
  return result
}

function cloneConsecutiveRuleValue(value: ConsecutiveRuleValue): ConsecutiveRuleValue {
  return {
    weeklyConsecutiveCount: value.weeklyConsecutiveCount,
    preferredDays: [...(value.preferredDays || [])]
  }
}

function cloneConsecutiveSettings(map: ConsecutiveSettingMap): ConsecutiveSettingMap {
  const result: ConsecutiveSettingMap = {}
  Object.entries(map || {}).forEach(([key, setting]) => {
    if (!setting || typeof setting !== 'object') return
    const classOverrides: Record<string, ConsecutiveRuleValue> = {}
    Object.entries(setting.classOverrides || {}).forEach(([className, value]) => {
      classOverrides[className] = cloneConsecutiveRuleValue(value)
    })
    result[key] = {
      defaultRule: cloneConsecutiveRuleValue(setting.defaultRule),
      classOverrides
    }
  })
  return result
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function isValidOddEvenRule(value: unknown): value is OddEvenRuleRecord {
  const rule = value as OddEvenRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.campus === 'string' &&
    typeof rule.grade === 'string' &&
    Array.isArray(rule.classNames) &&
    rule.classNames.every((item) => typeof item === 'string') &&
    typeof rule.oddCourse === 'string' &&
    typeof rule.evenCourse === 'string'
  )
}

function isValidGlobalFixedPoint(value: unknown): value is GlobalFixedPointRecord {
  const point = value as GlobalFixedPointRecord
  return (
    Boolean(point) &&
    typeof point.id === 'string' &&
    typeof point.campus === 'string' &&
    typeof point.grade === 'string' &&
    typeof point.type === 'string' &&
    typeof point.period === 'number' &&
    Number.isFinite(point.period) &&
    typeof point.day === 'string' &&
    typeof point.label === 'string'
  )
}

function isValidCombineRule(value: unknown): value is CombineCourseRuleRecord {
  const rule = value as CombineCourseRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.orderNo === 'number' &&
    Number.isFinite(rule.orderNo) &&
    typeof rule.campus === 'string' &&
    typeof rule.grade === 'string' &&
    Array.isArray(rule.classNames) &&
    rule.classNames.every((item) => typeof item === 'string') &&
    typeof rule.course === 'string'
  )
}

function isValidCourseAreaRule(value: unknown): value is CourseAreaRuleRecord {
  const rule = value as CourseAreaRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.campus === 'string' &&
    typeof rule.grade === 'string' &&
    typeof rule.subject === 'string' &&
    typeof rule.className === 'string' &&
    Array.isArray(rule.allowedSlots) &&
    rule.allowedSlots.every((item) => typeof item === 'string')
  )
}

function isValidCourseBanRule(value: unknown): value is CourseBanRuleRecord {
  const rule = value as CourseBanRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.campus === 'string' &&
    typeof rule.grade === 'string' &&
    typeof rule.subject === 'string' &&
    typeof rule.className === 'string' &&
    Array.isArray(rule.bannedSlots) &&
    rule.bannedSlots.every((item) => typeof item === 'string')
  )
}

function isValidMainSecondaryRule(value: unknown): value is MainSecondaryRuleRecord {
  const rule = value as MainSecondaryRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.campus === 'string' &&
    typeof rule.grade === 'string' &&
    Array.isArray(rule.mainSubjects) &&
    rule.mainSubjects.every((item) => typeof item === 'string') &&
    Array.isArray(rule.secondarySubjects) &&
    rule.secondarySubjects.every((item) => typeof item === 'string')
  )
}

function isValidCourseRelationRule(value: unknown): value is CourseRelationRuleRecord {
  const rule = value as CourseRelationRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.campus === 'string' &&
    typeof rule.grade === 'string' &&
    typeof rule.courseA === 'string' &&
    typeof rule.courseB === 'string' &&
    (rule.relationType === '前后互斥' || rule.relationType === '同天互斥')
  )
}

function isValidTeacherMutualRule(value: unknown): value is TeacherMutualRuleRecord {
  const rule = value as TeacherMutualRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    (rule.type === 'mutual' || rule.type === 'mentoring') &&
    Array.isArray(rule.teacherGroupA) &&
    rule.teacherGroupA.every((item) => typeof item === 'string') &&
    Array.isArray(rule.teacherGroupB) &&
    rule.teacherGroupB.every((item) => typeof item === 'string')
  )
}

function isValidTeacherHourRule(value: unknown): value is TeacherHourRuleRecord {
  const rule = value as TeacherHourRuleRecord
  return (
    Boolean(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.campus === 'string' &&
    typeof rule.grade === 'string' &&
    typeof rule.subject === 'string' &&
    typeof rule.teacherId === 'string' &&
    typeof rule.teacherName === 'string' &&
    (rule.maxDailyLessons === null || (typeof rule.maxDailyLessons === 'number' && Number.isFinite(rule.maxDailyLessons))) &&
    (rule.maxConsecutiveLessons === null ||
      (typeof rule.maxConsecutiveLessons === 'number' && Number.isFinite(rule.maxConsecutiveLessons))) &&
    (rule.weekDistribution === null || rule.weekDistribution === '周分散' || rule.weekDistribution === '周集中') &&
    (rule.dayDistribution === null || rule.dayDistribution === '日分散' || rule.dayDistribution === '日集中')
  )
}

function isValidTeacherBanRuleMap(value: unknown): value is TeacherBanRuleMap {
  if (!value || typeof value !== 'object') return false
  const root = value as Record<string, unknown>
  return Object.values(root).every((slotMap) => {
    if (!slotMap || typeof slotMap !== 'object') return false
    return Object.values(slotMap as Record<string, unknown>).every((enabled) => typeof enabled === 'boolean')
  })
}

const CONSECUTIVE_WEEKDAYS = new Set(['周一', '周二', '周三', '周四', '周五'])

function normalizeConsecutiveRuleValue(value: unknown): ConsecutiveRuleValue {
  const raw = (value || {}) as Partial<ConsecutiveRuleValue>
  const count =
    raw.weeklyConsecutiveCount === null || raw.weeklyConsecutiveCount === undefined
      ? null
      : Math.max(0, Math.min(5, Math.floor(Number(raw.weeklyConsecutiveCount) || 0)))
  const preferredDays = Array.isArray(raw.preferredDays)
    ? Array.from(
        new Set(
          raw.preferredDays
            .map((item) => String(item || '').trim())
            .filter((item) => CONSECUTIVE_WEEKDAYS.has(item))
        )
      )
    : []
  return {
    weeklyConsecutiveCount: count,
    preferredDays
  }
}

function normalizeConsecutiveSettings(value: unknown): ConsecutiveSettingMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const root = value as Record<string, unknown>
  const result: ConsecutiveSettingMap = {}
  Object.entries(root).forEach(([key, settingValue]) => {
    if (!settingValue || typeof settingValue !== 'object' || Array.isArray(settingValue)) return
    const setting = settingValue as Record<string, unknown>
    const classOverridesRaw =
      setting.classOverrides && typeof setting.classOverrides === 'object' && !Array.isArray(setting.classOverrides)
        ? (setting.classOverrides as Record<string, unknown>)
        : {}
    const classOverrides: Record<string, ConsecutiveRuleValue> = {}
    Object.entries(classOverridesRaw).forEach(([className, ruleValue]) => {
      if (!String(className || '').trim()) return
      classOverrides[className] = normalizeConsecutiveRuleValue(ruleValue)
    })
    result[key] = {
      defaultRule: normalizeConsecutiveRuleValue(setting.defaultRule),
      classOverrides
    }
  })
  return result
}

function normalizeCourseDefaultConfig(value: unknown): CourseDefaultConfig {
  const raw = (value || {}) as Partial<CourseDefaultConfig> & Record<string, unknown>
  const fallback = defaultCourseDefaultConfig
  const rawRules = (raw.rules && typeof raw.rules === 'object'
    ? (raw.rules as Partial<Record<CourseDefaultRuleKey, Partial<CourseDefaultRulePair>>>)
    : {}) || {}
  const normalizeDistributionValue = (input: unknown, defaultValue: string): string => {
    const text = typeof input === 'string' ? input : defaultValue
    const aliases: Record<string, string> = {
      '尽量当天上下 午都有课': '尽量分散到不同天',
      '尽量在一上午/一下午集中上完': '尽量集中在较少天',
      '尽量均匀分散到整周': '尽量分散到不同天',
      '优先排在周中时段': '优先安排在周中'
    }
    const normalized = aliases[text] || text
    return ['尽量分散到不同天', '尽量集中在较少天', '优先安排在周中', '无特殊要求'].includes(normalized)
      ? normalized
      : defaultValue
  }
  return {
    enabled: raw.enabled !== false,
    rules: {
      syncStart: {
        main: typeof rawRules.syncStart?.main === 'string' ? rawRules.syncStart.main : fallback.rules.syncStart.main,
        secondary: typeof rawRules.syncStart?.secondary === 'string' ? rawRules.syncStart.secondary : fallback.rules.syncStart.secondary
      },
      distribution: {
        main: normalizeDistributionValue(rawRules.distribution?.main, fallback.rules.distribution.main),
        secondary: normalizeDistributionValue(rawRules.distribution?.secondary, fallback.rules.distribution.secondary)
      },
      differentDayPeriod: {
        main: typeof rawRules.differentDayPeriod?.main === 'string'
          ? rawRules.differentDayPeriod.main
          : fallback.rules.differentDayPeriod.main,
        secondary: typeof rawRules.differentDayPeriod?.secondary === 'string'
          ? rawRules.differentDayPeriod.secondary
          : fallback.rules.differentDayPeriod.secondary
      },
      noCrossNoon: {
        main: typeof rawRules.noCrossNoon?.main === 'string' ? rawRules.noCrossNoon.main : fallback.rules.noCrossNoon.main,
        secondary: typeof rawRules.noCrossNoon?.secondary === 'string'
          ? rawRules.noCrossNoon.secondary
          : fallback.rules.noCrossNoon.secondary
      },
      sameClassNoConsecutive: {
        main: typeof rawRules.sameClassNoConsecutive?.main === 'string'
          ? rawRules.sameClassNoConsecutive.main
          : fallback.rules.sameClassNoConsecutive.main,
        secondary: typeof rawRules.sameClassNoConsecutive?.secondary === 'string'
          ? rawRules.sameClassNoConsecutive.secondary
          : fallback.rules.sameClassNoConsecutive.secondary
      },
      twoLessonsGap: {
        main: typeof rawRules.twoLessonsGap?.main === 'string' ? rawRules.twoLessonsGap.main : fallback.rules.twoLessonsGap.main,
        secondary: typeof rawRules.twoLessonsGap?.secondary === 'string'
          ? rawRules.twoLessonsGap.secondary
          : fallback.rules.twoLessonsGap.secondary
      }
    },
    ruleEnabled: {
      syncStart: (raw.ruleEnabled as Record<string, unknown> | undefined)?.syncStart !== false,
      distribution: (raw.ruleEnabled as Record<string, unknown> | undefined)?.distribution !== false,
      differentDayPeriod: (raw.ruleEnabled as Record<string, unknown> | undefined)?.differentDayPeriod !== false,
      noCrossNoon: (raw.ruleEnabled as Record<string, unknown> | undefined)?.noCrossNoon !== false,
      sameClassNoConsecutive: (raw.ruleEnabled as Record<string, unknown> | undefined)?.sameClassNoConsecutive !== false,
      twoLessonsGap: (raw.ruleEnabled as Record<string, unknown> | undefined)?.twoLessonsGap !== false
    }
  }
}

function normalizeRuleWeightConfig(value: unknown): RuleWeightConfig {
  const raw = (value || {}) as Partial<RuleWeightConfig>
  const rawRules = Array.isArray(raw.rules) ? raw.rules : []
  const rawHardRules = Array.isArray(raw.hardRules) ? raw.hardRules : []
  const rawSoftRules = Array.isArray(raw.softRules) ? raw.softRules : []
  const scoringSoftKeys = new Set<RuleWeightSoftKey>(['teacherWeekDistribution', 'teacherDayDistribution', 'consecutive'])
  const unavailableSoftKeys = new Set<RuleWeightSoftKey>()
  const legacyDefaultWeights: Record<RuleWeightSoftKey, number> = {
    teacherWeekDistribution: 12,
    teacherDayDistribution: 8,
    consecutive: 20,
    oddEven: 18,
    mainSecondary: 17,
    courseDefault: 15
  }
  const rawSoftWeight = (key: RuleWeightSoftKey): number | undefined => {
    const fromRules = rawRules.find((item) => item && item.key === key)
    if (fromRules && Number.isFinite(Number(fromRules.weight))) return Number(fromRules.weight)
    const fromSoftRules = rawSoftRules.find((item) => item && item.key === key)
    if (fromSoftRules && Number.isFinite(Number(fromSoftRules.weight))) return Number(fromSoftRules.weight)
    return undefined
  }
  const usesLegacyDefaultWeights = (Object.keys(legacyDefaultWeights) as RuleWeightSoftKey[]).every(
    (key) => rawSoftWeight(key) === legacyDefaultWeights[key]
  )

  const hardByKey = new Map<RuleWeightHardKey, RuleWeightHardRule>()
  const lockedHardKeys = new Set<RuleWeightHardKey>(['teacherConflict', 'classConflict'])
  for (const fallback of defaultRuleWeightConfig.hardRules) {
    const matched = rawHardRules.find((item) => item && item.key === fallback.key)
    hardByKey.set(fallback.key, {
      key: fallback.key,
      enabled: lockedHardKeys.has(fallback.key) ? true : matched?.enabled !== false,
      priority: fallback.priority
    })
  }

  const softByKey = new Map<RuleWeightSoftKey, RuleWeightSoftRule>()
  for (const fallback of defaultRuleWeightConfig.softRules) {
    const matched = rawSoftRules.find((item) => item && item.key === fallback.key)
    softByKey.set(fallback.key, {
      key: fallback.key,
      enabled: unavailableSoftKeys.has(fallback.key) ? false : matched ? matched.enabled !== false : fallback.enabled,
      weight: scoringSoftKeys.has(fallback.key)
        ? usesLegacyDefaultWeights
          ? fallback.weight
          : clampNumber(matched?.weight, 0, 100, fallback.weight)
        : 0
    })
  }

  const normalizedRules: RuleWeightRule[] = []
  const defaultByKey = new Map(defaultRuleWeightConfig.rules.map((item) => [item.key, item] as const))
  const allKeys = defaultRuleWeightConfig.rules.map((item) => item.key)

  for (const key of allKeys) {
    const fallback = defaultByKey.get(key)
    if (!fallback) continue
    const fromRules = rawRules.find((item) => item && item.key === key) as Partial<RuleWeightRule> | undefined
    if (fromRules) {
      const softKey = key as RuleWeightSoftKey
      normalizedRules.push({
        key,
        enabled:
          fallback.mode === 'hard' && lockedHardKeys.has(key as RuleWeightHardKey)
            ? true
            : key === 'courseRelation' && fromRules.mode !== 'hard'
              ? true
            : fallback.mode === 'soft' && unavailableSoftKeys.has(softKey)
              ? false
              : fromRules.enabled !== false,
        mode: fallback.mode,
        priority: fallback.mode === 'hard' ? fallback.priority : 4,
        weight:
          fallback.mode === 'soft' && !scoringSoftKeys.has(softKey)
            ? 0
            : fallback.mode === 'soft' && usesLegacyDefaultWeights
              ? fallback.weight
              : clampNumber(fromRules.weight, 0, 100, fallback.weight)
      })
      continue
    }

    const fromHard = hardByKey.get(key as RuleWeightHardKey)
    if (fromHard) {
      normalizedRules.push({
        key,
        enabled: fromHard.enabled,
        mode: 'hard',
        priority: fallback.priority,
        weight: 0
      })
      continue
    }

    const fromSoft = softByKey.get(key as RuleWeightSoftKey)
    if (fromSoft) {
      normalizedRules.push({
        key,
        enabled: fromSoft.enabled,
        mode: 'soft',
        priority: 4,
        weight: clampNumber(fromSoft.weight, 0, 100, fallback.weight)
      })
      continue
    }

    normalizedRules.push({ ...fallback })
  }

  const normalizedHardRules = normalizedRules
    .filter((item) => item.mode === 'hard')
    .map((item) => ({
      key: item.key as RuleWeightHardKey,
      enabled: item.enabled,
      priority: defaultRuleWeightConfig.hardRules.find((fallback) => fallback.key === item.key)?.priority || 4
    }))

  const normalizedSoftRules = normalizedRules
    .filter((item) => item.mode === 'soft')
    .map((item) => ({
      key: item.key as RuleWeightSoftKey,
      enabled: item.enabled,
      weight: clampNumber(item.weight, 0, 100, 0)
    }))

  return {
    enabled: raw.enabled !== false,
    autoNormalize: raw.autoNormalize !== false,
    rules: normalizedRules,
    hardRules: normalizedHardRules,
    softRules: normalizedSoftRules
  }
}

function normalizeRuleWeightConfigRecord(value: unknown): RuleWeightConfigRecord | null {
  const raw = value as Partial<RuleWeightConfigRecord>
  const campus = typeof raw?.campus === 'string' ? raw.campus.trim() : ''
  const grade = typeof raw?.grade === 'string' ? raw.grade.trim() : ''
  if (!campus || !grade) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `rw-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    campus,
    grade,
    config: normalizeRuleWeightConfig(raw.config)
  }
}

function cloneRuleWeightConfigRecords(items: RuleWeightConfigRecord[]): RuleWeightConfigRecord[] {
  return items.map((item) => ({
    ...item,
    config: normalizeRuleWeightConfig(item.config)
  }))
}

function snapshotSavedAt(payload: Partial<RuleSettingsSnapshot> | null): number {
  if (!payload || typeof payload !== 'object') return 0
  const raw = (payload as { _savedAt?: unknown })._savedAt
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

function isSnapshotPayload(payload: unknown): payload is Partial<RuleSettingsSnapshot> {
  return Boolean(payload) && typeof payload === 'object'
}

export function loadRuleSettingsSnapshot(): RuleSettingsSnapshot {
  const raw = localStorage.getItem(withAccountStorageKey(RULE_SETTINGS_STORAGE_KEY))
  if (!raw) {
    return createDefaultSnapshot()
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RuleSettingsSnapshot> & { ruleWeightConfig?: unknown }
    const globalFixedPoints = Array.isArray(parsed.globalFixedPoints)
      ? parsed.globalFixedPoints.filter((item) => isValidGlobalFixedPoint(item))
      : []
    const oddEvenRules = Array.isArray(parsed.oddEvenRules)
      ? parsed.oddEvenRules.filter((item) => isValidOddEvenRule(item))
      : []
    const combineRules = Array.isArray(parsed.combineRules)
      ? parsed.combineRules.filter((item) => isValidCombineRule(item))
      : []
    const courseAreaRules = Array.isArray(parsed.courseAreaRules)
      ? parsed.courseAreaRules.filter((item) => isValidCourseAreaRule(item))
      : []
    const courseBanRules = Array.isArray(parsed.courseBanRules)
      ? parsed.courseBanRules.filter((item) => isValidCourseBanRule(item))
      : []
    const mainSecondaryRules = Array.isArray(parsed.mainSecondaryRules)
      ? parsed.mainSecondaryRules.filter((item) => isValidMainSecondaryRule(item))
      : []
    const courseRelationRules = Array.isArray(parsed.courseRelationRules)
      ? parsed.courseRelationRules.filter((item) => isValidCourseRelationRule(item))
      : []
    const teacherMutualRules = Array.isArray(parsed.teacherMutualRules)
      ? parsed.teacherMutualRules.filter((item) => isValidTeacherMutualRule(item))
      : []
    const teacherBanRules = isValidTeacherBanRuleMap(parsed.teacherBanRules) ? parsed.teacherBanRules : {}
    const teacherHourRules = Array.isArray(parsed.teacherHourRules)
      ? parsed.teacherHourRules.filter((item) => isValidTeacherHourRule(item))
      : []
    const consecutiveSettings = normalizeConsecutiveSettings(parsed.consecutiveSettings)
    const parsedVersion = Number(parsed.version || 0)
    const courseDefaultConfig =
      parsedVersion < CURRENT_SNAPSHOT_VERSION && isLegacyCourseDefaultConfig(parsed.courseDefaultConfig)
        ? cloneCourseDefaultConfig()
        : normalizeCourseDefaultConfig(parsed.courseDefaultConfig)
    const ruleWeightConfigs = Array.isArray(parsed.ruleWeightConfigs)
      ? parsed.ruleWeightConfigs
          .map((item) => normalizeRuleWeightConfigRecord(item))
          .filter((item): item is RuleWeightConfigRecord => Boolean(item))
      : []

    // Backward compatibility: migrate old single-config storage to a default scoped record.
    if (ruleWeightConfigs.length === 0 && parsed.ruleWeightConfig) {
      ruleWeightConfigs.push({
        id: `rw-migrated-${Date.now()}`,
        campus: '本校区',
        grade: '一年级',
        config: normalizeRuleWeightConfig(parsed.ruleWeightConfig)
      })
    }

    return {
      version: CURRENT_SNAPSHOT_VERSION,
      globalFixedPoints: cloneGlobalFixedPoints(globalFixedPoints),
      oddEvenRules: cloneOddEvenRules(oddEvenRules),
      combineRules: cloneCombineRules(combineRules),
      courseAreaRules: cloneCourseAreaRules(courseAreaRules),
      courseBanRules: cloneCourseBanRules(courseBanRules),
      mainSecondaryRules: cloneMainSecondaryRules(mainSecondaryRules),
      courseRelationRules: cloneCourseRelationRules(courseRelationRules),
      teacherMutualRules: cloneTeacherMutualRules(teacherMutualRules),
      teacherBanRules: cloneTeacherBanRules(teacherBanRules),
      teacherHourRules: cloneTeacherHourRules(teacherHourRules),
      consecutiveSettings: cloneConsecutiveSettings(consecutiveSettings),
      courseDefaultConfig: cloneCourseDefaultConfig(courseDefaultConfig),
      ruleWeightConfigs: cloneRuleWeightConfigRecords(ruleWeightConfigs),
      _savedAt: snapshotSavedAt(parsed)
    }
  } catch {
    return createDefaultSnapshot()
  }
}

export function saveRuleSettingsSnapshot(snapshot: RuleSettingsSnapshot): void {
  const serialized = {
    version: CURRENT_SNAPSHOT_VERSION,
    globalFixedPoints: cloneGlobalFixedPoints(snapshot.globalFixedPoints),
    oddEvenRules: cloneOddEvenRules(snapshot.oddEvenRules),
    combineRules: cloneCombineRules(snapshot.combineRules || []),
    courseAreaRules: cloneCourseAreaRules(snapshot.courseAreaRules || []),
    courseBanRules: cloneCourseBanRules(snapshot.courseBanRules || []),
    mainSecondaryRules: cloneMainSecondaryRules(snapshot.mainSecondaryRules || []),
    courseRelationRules: cloneCourseRelationRules(snapshot.courseRelationRules || []),
    teacherMutualRules: cloneTeacherMutualRules(snapshot.teacherMutualRules || []),
    teacherBanRules: cloneTeacherBanRules(snapshot.teacherBanRules || {}),
    teacherHourRules: cloneTeacherHourRules(snapshot.teacherHourRules || []),
    consecutiveSettings: cloneConsecutiveSettings(snapshot.consecutiveSettings || {}),
    courseDefaultConfig: normalizeCourseDefaultConfig(snapshot.courseDefaultConfig),
    ruleWeightConfigs: cloneRuleWeightConfigRecords(snapshot.ruleWeightConfigs || []),
    _savedAt: Date.now()
  }

  localStorage.setItem(withAccountStorageKey(RULE_SETTINGS_STORAGE_KEY), JSON.stringify(serialized))

  if (ruleSettingsSource === 'api') {
    const endpoint = withAccountQuery(`${ruleSettingsApiBaseUrl}${RULE_SETTINGS_API_PATH}?planId=${encodeURIComponent(ruleSettingsPlanId)}`)
    void fetch(endpoint, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(serialized)
    }).catch((error) => {
      console.warn('[RuleSettings] API 保存失败，已保存在本地存储。', error)
    })
  }
}

export async function hydrateRuleSettingsSnapshotFromApi(): Promise<RuleSettingsSnapshot> {
  const local = loadRuleSettingsSnapshot()
  if (ruleSettingsSource !== 'api') {
    return local
  }

  const endpoint = withAccountQuery(`${ruleSettingsApiBaseUrl}${RULE_SETTINGS_API_PATH}?planId=${encodeURIComponent(ruleSettingsPlanId)}`)
  try {
    const response = await fetch(endpoint, { method: 'GET', headers: authHeaders() })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const payload = (await response.json()) as unknown
    if (!isSnapshotPayload(payload)) {
      return local
    }
    const apiSavedAt = snapshotSavedAt(payload)
    const localSavedAt = snapshotSavedAt(local)
    if (apiSavedAt > localSavedAt) {
      localStorage.setItem(withAccountStorageKey(RULE_SETTINGS_STORAGE_KEY), JSON.stringify(payload))
      return loadRuleSettingsSnapshot()
    }
    return local
  } catch (error) {
    console.warn('[RuleSettings] API 读取失败，回退到本地存储。', error)
    return local
  }
}
