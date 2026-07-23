import { withAccountQuery, withAccountStorageKey } from './accountContext'
import { authHeaders } from './auth'
import type { AuthScope } from '../types/auth'

export type PlanMode = '行政班排课'

export type SchedulePlan = {
  id: string
  name: string
  mode: PlanMode
  progress: number
  favorite: boolean
  ownerUserId?: string
  scopes?: AuthScope[]
}

export type WorkbenchPersistSnapshot = {
  entries: Record<string, unknown>
  publishedEntries?: Record<string, unknown>
  meta: Record<string, { savedAt: number; publishedAt: number }>
  drafts: Record<string, unknown>
  logs: Record<string, unknown[]>
  _savedAt?: number
}

const PLANS_LOCAL_KEY = 'schedule_plans_v1'
const WORKBENCH_META_KEY = 'schedule_workbench_meta_v1'
const WORKBENCH_PERSIST_KEY = 'schedule_workbench_saved_v1'
const WORKBENCH_PUBLISHED_KEY = 'schedule_workbench_published_v1'
const WORKBENCH_DRAFTS_KEY = 'schedule_workbench_drafts_v1'
const WORKBENCH_LOGS_KEY = 'schedule_workbench_logs_v1'

const profile = (import.meta.env.VITE_API_PROFILE ?? 'test').trim().toLowerCase() || 'test'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
const planId = (import.meta.env.VITE_BASIC_DATA_PLAN_ID ?? 'default').trim() || 'default'
const source = (import.meta.env.VITE_SCHEDULE_STATE_SOURCE ?? import.meta.env.VITE_BASIC_DATA_SOURCE ?? 'api').toLowerCase()

const PLANS_API_PATH = `/api/${profile}/schedule-plans`
const WORKBENCH_API_PATH = `/api/${profile}/workbench-state`

function normalizeTermId(termId: string): string {
  return String(termId || '').trim()
}

function requireTermId(termId: string): string {
  const normalized = normalizeTermId(termId)
  if (!normalized) throw new Error('当前学年学期尚未设置，无法读取或保存排课方案。')
  return normalized
}

function scopedLocalKey(key: string, termId: string): string {
  return withAccountStorageKey(`${key}:term:${encodeURIComponent(requireTermId(termId))}`)
}

function endpoint(path: string, termId: string): string {
  return withAccountQuery(
    `${apiBaseUrl}${path}?planId=${encodeURIComponent(planId)}&termId=${encodeURIComponent(requireTermId(termId))}`
  )
}

function parsePlans(raw: string | null): SchedulePlan[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as SchedulePlan[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function plansSavedAt(plans: SchedulePlan[]): number {
  if (plans.length === 0) return 0
  const maxIdTs = plans.reduce((max, item) => {
    const ts = Number(String(item.id).split('-')[0] || 0)
    return Number.isFinite(ts) ? Math.max(max, ts) : max
  }, 0)
  return maxIdTs
}

function parseWorkbenchLocal(termId: string): WorkbenchPersistSnapshot {
  let entries: Record<string, unknown> = {}
  let publishedEntries: Record<string, unknown> = {}
  let meta: Record<string, { savedAt: number; publishedAt: number }> = {}
  let drafts: Record<string, unknown> = {}
  let logs: Record<string, unknown[]> = {}

  const entriesRaw = localStorage.getItem(scopedLocalKey(WORKBENCH_PERSIST_KEY, termId))
  if (entriesRaw) {
    try {
      const parsed = JSON.parse(entriesRaw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') entries = parsed
    } catch {
      entries = {}
    }
  }

  const publishedEntriesRaw = localStorage.getItem(scopedLocalKey(WORKBENCH_PUBLISHED_KEY, termId))
  if (publishedEntriesRaw) {
    try {
      const parsed = JSON.parse(publishedEntriesRaw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') publishedEntries = parsed
    } catch {
      publishedEntries = {}
    }
  }

  const metaRaw = localStorage.getItem(scopedLocalKey(WORKBENCH_META_KEY, termId))
  if (metaRaw) {
    try {
      const parsed = JSON.parse(metaRaw) as Record<string, { savedAt?: number; publishedAt?: number }>
      if (parsed && typeof parsed === 'object') {
        meta = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            key,
            {
              savedAt: Number(value?.savedAt || 0),
              publishedAt: Number(value?.publishedAt || 0)
            }
          ])
        )
      }
    } catch {
      meta = {}
    }
  }

  const draftsRaw = localStorage.getItem(scopedLocalKey(WORKBENCH_DRAFTS_KEY, termId))
  if (draftsRaw) {
    try {
      const parsed = JSON.parse(draftsRaw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') drafts = parsed
    } catch {
      drafts = {}
    }
  }

  const logsRaw = localStorage.getItem(scopedLocalKey(WORKBENCH_LOGS_KEY, termId))
  if (logsRaw) {
    try {
      const parsed = JSON.parse(logsRaw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        logs = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value : []])
        )
      }
    } catch {
      logs = {}
    }
  }

  const maxSavedAt = Math.max(
    0,
    ...Object.values(meta).map((item) => Math.max(Number(item.savedAt || 0), Number(item.publishedAt || 0)))
  )
  Object.entries(entries).forEach(([id, entry]) => {
    if (publishedEntries[id] !== undefined || !entry || typeof entry !== 'object') return
    const entryPublishedAt = Number((entry as { publishedAt?: unknown }).publishedAt || 0)
    if (Math.max(entryPublishedAt, Number(meta[id]?.publishedAt || 0)) > 0) {
      publishedEntries[id] = cloneWorkbenchValue(entry)
    }
  })
  return { entries, publishedEntries, meta, drafts, logs, _savedAt: maxSavedAt }
}

function writeWorkbenchLocal(snapshot: WorkbenchPersistSnapshot, termId: string): void {
  localStorage.setItem(scopedLocalKey(WORKBENCH_PERSIST_KEY, termId), JSON.stringify(snapshot.entries || {}))
  localStorage.setItem(scopedLocalKey(WORKBENCH_PUBLISHED_KEY, termId), JSON.stringify(snapshot.publishedEntries || {}))
  localStorage.setItem(scopedLocalKey(WORKBENCH_META_KEY, termId), JSON.stringify(snapshot.meta || {}))
  localStorage.setItem(scopedLocalKey(WORKBENCH_DRAFTS_KEY, termId), JSON.stringify(snapshot.drafts || {}))
  localStorage.setItem(scopedLocalKey(WORKBENCH_LOGS_KEY, termId), JSON.stringify(snapshot.logs || {}))
}

export function loadSchedulePlansLocal(termId: string): SchedulePlan[] {
  return parsePlans(localStorage.getItem(scopedLocalKey(PLANS_LOCAL_KEY, termId)))
}

export async function loadSchedulePlans(termId: string): Promise<SchedulePlan[]> {
  const normalizedTermId = requireTermId(termId)
  const local = loadSchedulePlansLocal(normalizedTermId)
  if (source !== 'api') return local

  try {
    const response = await fetch(endpoint(PLANS_API_PATH, normalizedTermId), { method: 'GET', headers: authHeaders() })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as { plans?: SchedulePlan[]; _savedAt?: number }
    const apiPlans = Array.isArray(payload?.plans) ? payload.plans : []
    const apiSavedAt = typeof payload?._savedAt === 'number' ? payload._savedAt : 0
    const localSavedAt = plansSavedAt(local)
    const latest = localSavedAt >= apiSavedAt ? local : apiPlans
    localStorage.setItem(scopedLocalKey(PLANS_LOCAL_KEY, normalizedTermId), JSON.stringify(latest))
    return latest
  } catch (error) {
    console.warn('[ScheduleState] 读取排课方案失败，回退本地。', error)
    return local
  }
}

export function saveSchedulePlansLocal(plans: SchedulePlan[], termId: string): void {
  localStorage.setItem(scopedLocalKey(PLANS_LOCAL_KEY, termId), JSON.stringify(plans))
}

export async function saveSchedulePlans(plans: SchedulePlan[], termId: string): Promise<void> {
  const normalizedTermId = requireTermId(termId)
  saveSchedulePlansLocal(plans, normalizedTermId)
  if (source !== 'api') return
  try {
    await fetch(endpoint(PLANS_API_PATH, normalizedTermId), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ plans, _savedAt: Date.now() })
    })
  } catch (error) {
    console.warn('[ScheduleState] 保存排课方案失败，已保留本地。', error)
  }
}

export async function updateSchedulePlanProgress(planIdValue: string, progress: number, termId: string): Promise<void> {
  const normalizedTermId = requireTermId(termId)
  const plans = loadSchedulePlansLocal(normalizedTermId)
  if (!Array.isArray(plans) || plans.length <= 0) return
  let changed = false
  const next = plans.map((item) => {
    if (item.id !== planIdValue) return item
    const value = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)))
    if (value === Number(item.progress || 0)) return item
    changed = true
    return { ...item, progress: value }
  })
  if (!changed) return
  await saveSchedulePlans(next, normalizedTermId)
}

export async function loadWorkbenchPersistSnapshot(termId: string): Promise<WorkbenchPersistSnapshot> {
  const normalizedTermId = requireTermId(termId)
  const local = parseWorkbenchLocal(normalizedTermId)
  if (source !== 'api') return local

  try {
    const response = await fetch(endpoint(WORKBENCH_API_PATH, normalizedTermId), { method: 'GET', headers: authHeaders() })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as Partial<WorkbenchPersistSnapshot>
    const apiState: WorkbenchPersistSnapshot = {
      entries: payload?.entries && typeof payload.entries === 'object' ? payload.entries : {},
      publishedEntries:
        payload?.publishedEntries && typeof payload.publishedEntries === 'object'
          ? (payload.publishedEntries as WorkbenchPersistSnapshot['publishedEntries'])
          : {},
      meta: payload?.meta && typeof payload.meta === 'object' ? (payload.meta as WorkbenchPersistSnapshot['meta']) : {},
      drafts: payload?.drafts && typeof payload.drafts === 'object' ? (payload.drafts as WorkbenchPersistSnapshot['drafts']) : {},
      logs: payload?.logs && typeof payload.logs === 'object' ? (payload.logs as WorkbenchPersistSnapshot['logs']) : {},
      _savedAt: typeof payload?._savedAt === 'number' ? payload._savedAt : 0
    }
    Object.entries(apiState.entries).forEach(([id, entry]) => {
      if (apiState.publishedEntries?.[id] !== undefined || !entry || typeof entry !== 'object') return
      const entryPublishedAt = Number((entry as { publishedAt?: unknown }).publishedAt || 0)
      if (Math.max(entryPublishedAt, Number(apiState.meta[id]?.publishedAt || 0)) > 0) {
        const publishedEntries = apiState.publishedEntries as Record<string, unknown>
        publishedEntries[id] = cloneWorkbenchValue(entry)
      }
    })
    const localSavedAt = Number(local._savedAt || 0)
    const apiSavedAt = Number(apiState._savedAt || 0)
    const latest = localSavedAt >= apiSavedAt ? local : apiState
    writeWorkbenchLocal(latest, normalizedTermId)
    return latest
  } catch (error) {
    console.warn('[ScheduleState] 读取工作台状态失败，回退本地。', error)
    return local
  }
}

export async function saveWorkbenchPersistSnapshot(snapshot: WorkbenchPersistSnapshot, termId: string): Promise<void> {
  const normalizedTermId = requireTermId(termId)
  const payload: WorkbenchPersistSnapshot = {
    entries: snapshot.entries || {},
    publishedEntries: snapshot.publishedEntries || {},
    meta: snapshot.meta || {},
    drafts: snapshot.drafts || {},
    logs: snapshot.logs || {},
    _savedAt: Date.now()
  }
  writeWorkbenchLocal(payload, normalizedTermId)
  if (source !== 'api') return
  try {
    await fetch(endpoint(WORKBENCH_API_PATH, normalizedTermId), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    })
  } catch (error) {
    console.warn('[ScheduleState] 保存工作台状态失败，已保留本地。', error)
  }
}

function cloneWorkbenchValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

export async function duplicateWorkbenchPlanState(
  sourcePlanId: string,
  targetPlanId: string,
  termId: string
): Promise<boolean> {
  const sourceId = String(sourcePlanId || '').trim()
  const targetId = String(targetPlanId || '').trim()
  if (!sourceId || !targetId || sourceId === targetId) return false

  const snapshot = await loadWorkbenchPersistSnapshot(termId)
  const sourceEntry = snapshot.entries?.[sourceId]
  const sourcePublishedEntry = snapshot.publishedEntries?.[sourceId]
  const sourceMeta = snapshot.meta?.[sourceId]
  const sourceDraft = snapshot.drafts?.[sourceId]
  const sourceLogs = snapshot.logs?.[sourceId]
  const sourceScheduleEntry = sourceEntry ?? sourcePublishedEntry
  const hasState =
    sourceEntry !== undefined ||
    sourcePublishedEntry !== undefined ||
    sourceMeta !== undefined ||
    sourceDraft !== undefined ||
    sourceLogs !== undefined
  if (!hasState) return false

  const now = Date.now()
  const entries = { ...(snapshot.entries || {}) }
  const publishedEntries = { ...(snapshot.publishedEntries || {}) }
  const meta = { ...(snapshot.meta || {}) }
  const drafts = { ...(snapshot.drafts || {}) }
  const logs = { ...(snapshot.logs || {}) }

  if (sourceScheduleEntry !== undefined) {
    const copiedEntry = cloneWorkbenchValue(sourceScheduleEntry)
    if (copiedEntry && typeof copiedEntry === 'object') {
      Object.assign(copiedEntry as Record<string, unknown>, {
        savedAt: now,
        publishedAt: undefined
      })
    }
    entries[targetId] = copiedEntry
  }
  delete publishedEntries[targetId]
  meta[targetId] = { savedAt: now, publishedAt: 0 }
  if (sourceDraft !== undefined) drafts[targetId] = cloneWorkbenchValue(sourceDraft)
  if (sourceLogs !== undefined) logs[targetId] = cloneWorkbenchValue(sourceLogs)

  await saveWorkbenchPersistSnapshot({ entries, publishedEntries, meta, drafts, logs, _savedAt: now }, termId)
  return sourceScheduleEntry !== undefined
}

export async function deleteWorkbenchPlanState(planIdValue: string, termId: string): Promise<boolean> {
  const targetId = String(planIdValue || '').trim()
  if (!targetId) return false

  const snapshot = await loadWorkbenchPersistSnapshot(termId)
  const entries = { ...(snapshot.entries || {}) }
  const publishedEntries = { ...(snapshot.publishedEntries || {}) }
  const meta = { ...(snapshot.meta || {}) }
  const drafts = { ...(snapshot.drafts || {}) }
  const logs = { ...(snapshot.logs || {}) }
  const hasState =
    entries[targetId] !== undefined ||
    publishedEntries[targetId] !== undefined ||
    meta[targetId] !== undefined ||
    drafts[targetId] !== undefined ||
    logs[targetId] !== undefined
  if (!hasState) return false

  delete entries[targetId]
  delete publishedEntries[targetId]
  delete meta[targetId]
  delete drafts[targetId]
  delete logs[targetId]
  await saveWorkbenchPersistSnapshot(
    { entries, publishedEntries, meta, drafts, logs, _savedAt: Date.now() },
    termId
  )
  return true
}
