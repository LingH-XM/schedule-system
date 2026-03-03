import type { GroupRecord } from '../basicDataRepository'
import type {
  CombineCourseRuleRecord,
  RuleSettingsSnapshot,
  TeacherBanRuleMap
} from '../ruleSettings'

type TeacherBanInput = {
  slotKey: string
  teacherIds: string[]
  teacherNames: string[]
  teacherNameById: Map<string, string>
}

export type CompiledWorkbenchRules = {
  getFixedPointLabel: (campusName: string, grade: string, period: number, day: string) => string | null
  matchCombineRule: (campusName: string, grade: string, className: string, courseNames: Set<string>) => CombineCourseRuleRecord | null
  getTeacherBanReason: (input: TeacherBanInput) => string | null
}

function parseSlot(slotKey: string): { period: number; day: string } | null {
  const [periodRaw, ...dayParts] = slotKey.split('-')
  const period = Number(periodRaw)
  const day = dayParts.join('-')
  if (!Number.isFinite(period) || !day) return null
  return { period, day }
}

function dayText(day: string): string {
  const dayMap: Record<string, string> = { '周一': '1', '周二': '2', '周三': '3', '周四': '4', '周五': '5', '周六': '6', '周日': '7' }
  return dayMap[day] || day
}

export function compileWorkbenchRules(snapshot: RuleSettingsSnapshot, groupRecords: GroupRecord[]): CompiledWorkbenchRules {
  const fixedMap = new Map<string, string>()
  ;(snapshot.globalFixedPoints || []).forEach((item) => {
    const key = `${item.campus}::${item.grade}::${item.period}::${item.day}`
    if (!fixedMap.has(key)) fixedMap.set(key, item.label)
  })

  const combineRuleList = Array.isArray(snapshot.combineRules) ? snapshot.combineRules : []
  const teacherBanRules: TeacherBanRuleMap = snapshot.teacherBanRules || {}
  const groupById = new Map(groupRecords.map((item) => [item.id, item] as const))

  const slotToTargets = new Map<string, string[]>()
  Object.entries(teacherBanRules).forEach(([targetKey, slotMap]) => {
    Object.entries(slotMap || {}).forEach(([slotKey, enabled]) => {
      if (!enabled) return
      const list = slotToTargets.get(slotKey) || []
      list.push(targetKey)
      slotToTargets.set(slotKey, list)
    })
  })

  return {
    getFixedPointLabel: (campusName, grade, period, day) => {
      if (!campusName || !day || !Number.isFinite(period)) return null
      const exact = fixedMap.get(`${campusName}::${grade}::${period}::${day}`)
      if (exact) return exact
      return fixedMap.get(`${campusName}::全部年级::${period}::${day}`) || null
    },

    matchCombineRule: (campusName, grade, className, courseNames) => {
      if (!campusName || !grade || !className || courseNames.size <= 0) return null
      return (
        combineRuleList.find((rule) => {
          if (rule.campus !== campusName) return false
          if (rule.grade !== grade) return false
          if (!rule.classNames.includes(className)) return false
          if (!courseNames.has(rule.course)) return false
          return true
        }) || null
      )
    },

    getTeacherBanReason: ({ slotKey, teacherIds, teacherNames, teacherNameById }) => {
      const targets = slotToTargets.get(slotKey)
      if (!targets || targets.length <= 0) return null
      const uniqIds = Array.from(new Set(teacherIds.filter(Boolean)))
      const uniqNames = Array.from(new Set(teacherNames.filter(Boolean)))
      const parsed = parseSlot(slotKey)
      const period = parsed?.period ?? 0
      const dayIndex = dayText(parsed?.day || '')

      for (const targetKey of targets) {
        if (targetKey.startsWith('single:')) {
          const teacherId = targetKey.slice('single:'.length)
          if (!teacherId || !uniqIds.includes(teacherId)) continue
          const teacherName = teacherNameById.get(teacherId) || uniqNames[0] || teacherId
          return `教师「${teacherName}」在周${dayIndex}第${period}节已设置不排课`
        }

        if (targetKey.startsWith('group:')) {
          const groupId = targetKey.slice('group:'.length)
          const group = groupById.get(groupId)
          if (!group || group.type !== '教研与活动分组') continue
          const memberSet = new Set((group.memberNames || []).map((item) => String(item || '').trim()).filter(Boolean))
          if (memberSet.size <= 0) continue
          const hit = uniqNames.find((name) => memberSet.has(name))
          if (!hit) continue
          return `教师「${hit}」属于教研与活动「${group.name}」，在周${dayIndex}第${period}节已设置不排课`
        }
      }

      return null
    }
  }
}
