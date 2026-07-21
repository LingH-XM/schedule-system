import { Injectable } from '@nestjs/common'
import { hasScope, type AuthContext } from './auth.types.js'

type JsonObject = Record<string, unknown>

const SCOPED_ARRAY_KEYS = [
  'classRecords',
  'studentRecords',
  'teachingAssignments',
  'classHourRows',
  'classHourClassRows'
] as const

@Injectable()
export class DataScopeService {
  filterBasicData(auth: AuthContext, source: JsonObject): JsonObject {
    if (this.isUnrestricted(auth)) return source
    const result: JsonObject = { ...source }
    const classRecords = this.filterScopedArray(auth, source.classRecords)
    const classIds = new Set(classRecords.map((item) => String(item.id || '')).filter(Boolean))
    const campusIds = this.allowedCampusIds(auth)

    result.campuses = this.filterCampusArray(source.campuses, campusIds)
    result.teacherRecords = this.filterCampusArray(source.teacherRecords, campusIds)
    result.roomRecords = this.filterCampusArray(source.roomRecords, campusIds)
    result.groupRecords = this.filterCampusArray(source.groupRecords, campusIds)
    result.classRecords = classRecords
    for (const key of SCOPED_ARRAY_KEYS) result[key] = this.filterScopedArray(auth, source[key])
    result.classRoomMappings = asArray(source.classRoomMappings).filter((item) => classIds.has(String(item.classId || '')))
    result.arrangementScopes = this.filterScopeMap(auth, source.arrangementScopes)
    result.scheduleWorkbench = this.filterWorkbench(auth, source.scheduleWorkbench)
    result.termData = this.filterTermData(auth, source.termData)

    const selectedCampus = String(source.arrangementCampusId || source.selectedHoursCampusId || '')
    const selectedGrade = String(source.arrangementGrade || '')
    if (!hasScope(auth, selectedCampus, selectedGrade)) {
      const firstScope = auth.scopes[0]
      result.arrangementCampusId = firstScope?.campusId === '*' ? '' : firstScope?.campusId || ''
      result.selectedHoursCampusId = result.arrangementCampusId
      result.arrangementGrade = firstScope?.grade === '*' ? '' : firstScope?.grade || ''
      result.arrangementRows = []
      result.arrangementBatchValues = {}
    }
    return result
  }

  mergeBasicData(auth: AuthContext, current: JsonObject, incoming: JsonObject): JsonObject {
    if (this.isUnrestricted(auth)) return incoming
    const merged: JsonObject = { ...current }
    for (const key of SCOPED_ARRAY_KEYS) {
      merged[key] = this.mergeScopedArray(auth, current[key], incoming[key])
    }
    merged.arrangementScopes = this.mergeScopeMap(auth, current.arrangementScopes, incoming.arrangementScopes)
    merged.scheduleWorkbench = this.mergeWorkbench(auth, current.scheduleWorkbench, incoming.scheduleWorkbench)
    merged.termData = this.mergeTermData(auth, current.termData, incoming.termData)

    const campusId = String(incoming.arrangementCampusId || '')
    const grade = String(incoming.arrangementGrade || '')
    if (hasScope(auth, campusId, grade)) {
      merged.arrangementCampusId = campusId
      merged.arrangementGrade = grade
      merged.arrangementRows = incoming.arrangementRows
      merged.arrangementBatchValues = incoming.arrangementBatchValues
    }
    merged._savedAt = incoming._savedAt
    return merged
  }

  private isUnrestricted(auth: AuthContext): boolean {
    return auth.role === 'super_admin' || auth.role === 'school_admin'
  }

  private allowedCampusIds(auth: AuthContext): Set<string> | null {
    if (auth.scopes.some((scope) => scope.campusId === '*')) return null
    return new Set(auth.scopes.map((scope) => scope.campusId))
  }

  private filterCampusArray(raw: unknown, campusIds: Set<string> | null): JsonObject[] {
    const rows = asArray(raw)
    if (!campusIds) return rows
    return rows.filter((item) => campusIds.has(String(item.campusId || item.id || '')))
  }

  private filterScopedArray(auth: AuthContext, raw: unknown): JsonObject[] {
    return asArray(raw).filter((item) => hasScope(auth, String(item.campusId || ''), String(item.grade || '')))
  }

  private mergeScopedArray(auth: AuthContext, currentRaw: unknown, incomingRaw: unknown): JsonObject[] {
    const retained = asArray(currentRaw).filter(
      (item) => !hasScope(auth, String(item.campusId || ''), String(item.grade || ''))
    )
    return [...retained, ...this.filterScopedArray(auth, incomingRaw)]
  }

  private filterScopeMap(auth: AuthContext, raw: unknown): JsonObject {
    const source = asObject(raw)
    return Object.fromEntries(Object.entries(source).filter(([key]) => this.scopeKeyAllowed(auth, key)))
  }

  private mergeScopeMap(auth: AuthContext, currentRaw: unknown, incomingRaw: unknown): JsonObject {
    const current = asObject(currentRaw)
    const incoming = asObject(incomingRaw)
    return {
      ...Object.fromEntries(Object.entries(current).filter(([key]) => !this.scopeKeyAllowed(auth, key))),
      ...Object.fromEntries(Object.entries(incoming).filter(([key]) => this.scopeKeyAllowed(auth, key)))
    }
  }

  private scopeKeyAllowed(auth: AuthContext, key: string): boolean {
    const [campusId = '', grade = ''] = key.split('::')
    return hasScope(auth, campusId, grade)
  }

  private filterWorkbench(auth: AuthContext, raw: unknown): JsonObject {
    const source = asObject(raw)
    return Object.fromEntries(
      Object.entries(source).filter(([, value]) => {
        const item = asObject(value)
        return hasScope(auth, String(item.selectedCampus || ''), String(item.selectedGrade || ''))
      })
    )
  }

  private mergeWorkbench(auth: AuthContext, currentRaw: unknown, incomingRaw: unknown): JsonObject {
    const current = asObject(currentRaw)
    const incoming = asObject(incomingRaw)
    const retained = Object.fromEntries(
      Object.entries(current).filter(([, value]) => {
        const item = asObject(value)
        return !hasScope(auth, String(item.selectedCampus || ''), String(item.selectedGrade || ''))
      })
    )
    return { ...retained, ...this.filterWorkbench(auth, incoming) }
  }

  private filterTermData(auth: AuthContext, raw: unknown): JsonObject {
    return Object.fromEntries(
      Object.entries(asObject(raw)).map(([term, value]) => [term, this.filterBasicData(auth, asObject(value))])
    )
  }

  private mergeTermData(auth: AuthContext, currentRaw: unknown, incomingRaw: unknown): JsonObject {
    const current = asObject(currentRaw)
    const incoming = asObject(incomingRaw)
    const terms = new Set([...Object.keys(current), ...Object.keys(incoming)])
    return Object.fromEntries(
      Array.from(terms).map((term) => [term, this.mergeBasicData(auth, asObject(current[term]), asObject(incoming[term]))])
    )
  }
}

function asObject(raw: unknown): JsonObject {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonObject) : {}
}

function asArray(raw: unknown): JsonObject[] {
  return Array.isArray(raw) ? raw.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []
}
