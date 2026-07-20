<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Download, Refresh } from '@element-plus/icons-vue'
import * as XLSX from 'xlsx'
import {
  basicDataRepository,
  type Campus,
  type TeacherRecord
} from '../../services/basicDataRepository'
import {
  loadSchedulePlans,
  loadWorkbenchPersistSnapshot,
  type SchedulePlan,
  type WorkbenchPersistSnapshot
} from '../../services/scheduleStateRepository'
import { notify } from '../../utils/notify'
import AppContentSkeleton from '../../components/AppContentSkeleton.vue'

type ScheduledLesson = {
  name?: string
  teacher?: string
  teacherId?: string
  teacherNames?: string[]
}

type TeacherHourRow = {
  key: string
  teacherId: string
  name: string
  campusId: string
  campusName: string
  courseNames: string[]
  requiredHours: number
  scheduledHours: number
  difference: number | null
  completionRate: number | null
  status: '已达标' | '未达标' | '未设置'
}

const campuses = ref<Campus[]>([])
const teacherRecords = ref<TeacherRecord[]>([])
const schedulePlans = ref<SchedulePlan[]>([])
const workbenchState = ref<WorkbenchPersistSnapshot>({ entries: {}, meta: {}, drafts: {}, logs: {} })
const selectedPlanId = ref('')
const selectedCampusId = ref('__all__')
const selectedStatus = ref<'全部状态' | TeacherHourRow['status']>('全部状态')
const keyword = ref('')
const currentPage = ref(1)
const pageSize = ref(15)
const pageSizeOptions = [15, 30, 50, 100]
const sortKey = ref<keyof TeacherHourRow | ''>('')
const sortOrder = ref<'ascending' | 'descending' | ''>('')
const loading = ref(true)
const loadError = ref('')

function formatDateTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--'
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function normalizeTeacherNames(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [value]
  return Array.from(
    new Set(
      source
        .flatMap((item) => String(item ?? '').split(/[、，,\/；;]+/))
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

const planNameById = computed(() => new Map(schedulePlans.value.map((item) => [item.id, item.name || item.id] as const)))

const publishedPlanOptions = computed(() =>
  Object.entries(workbenchState.value.meta || {})
    .map(([id, meta]) => ({
      id,
      publishedAt: Number(meta?.publishedAt || 0),
      label: `${planNameById.value.get(id) || id} · ${formatDateTime(Number(meta?.publishedAt || 0))}`
    }))
    .filter((item) => item.publishedAt > 0)
    .sort((a, b) => b.publishedAt - a.publishedAt)
)

const selectedPlan = computed(() => publishedPlanOptions.value.find((item) => item.id === selectedPlanId.value))

const campusOptions = computed(() => [
  { id: '__all__', name: '全部校区' },
  ...campuses.value.map((item) => ({ id: item.id, name: item.name }))
])

const teacherHourRows = computed<TeacherHourRow[]>(() => {
  if (!selectedPlanId.value) return []
  const entry = (workbenchState.value.publishedEntries?.[selectedPlanId.value] ??
    workbenchState.value.entries?.[selectedPlanId.value]) as {
    scheduleMap?: Record<string, Record<string, ScheduledLesson | null>>
    publishedAt?: number
  } | undefined
  if (!entry || Number(entry.publishedAt || 0) <= 0 || !entry.scheduleMap) return []

  const teacherById = new Map(teacherRecords.value.map((item) => [item.id, item] as const))
  const teacherIdsByName = new Map<string, string[]>()
  teacherRecords.value.forEach((item) => {
    const name = item.name.trim()
    if (!name) return
    const ids = teacherIdsByName.get(name) ?? []
    if (!ids.includes(item.id)) ids.push(item.id)
    teacherIdsByName.set(name, ids)
  })
  const campusNameById = new Map(campuses.value.map((item) => [item.id, item.name] as const))
  const slotsByTeacher = new Map<string, Set<string>>()
  const coursesByTeacher = new Map<string, Set<string>>()
  const fallbackNames = new Map<string, string>()

  Object.values(entry.scheduleMap).forEach((classGrid) => {
    Object.entries(classGrid || {}).forEach(([slotKey, lesson]) => {
      if (!lesson || typeof lesson !== 'object') return
      const teacherKeys = new Set<string>()
      const teacherId = String(lesson.teacherId ?? '').trim()
      if (teacherId) teacherKeys.add(teacherId)

      const names = normalizeTeacherNames(
        Array.isArray(lesson.teacherNames) && lesson.teacherNames.length > 0 ? lesson.teacherNames : lesson.teacher
      )
      const primaryTeacherName = teacherId ? teacherById.get(teacherId)?.name.trim() ?? '' : ''
      if (teacherId && !teacherById.has(teacherId) && names[0]) fallbackNames.set(teacherId, names[0])
      names.forEach((name, index) => {
        if (teacherId && (name === primaryTeacherName || (!primaryTeacherName && index === 0))) return
        const matchedIds = teacherIdsByName.get(name) ?? []
        if (matchedIds.length > 0) {
          matchedIds.forEach((id) => teacherKeys.add(id))
          return
        }
        const fallbackKey = `name:${name}`
        teacherKeys.add(fallbackKey)
        fallbackNames.set(fallbackKey, name)
      })

      teacherKeys.forEach((key) => {
        if (!slotsByTeacher.has(key)) slotsByTeacher.set(key, new Set())
        slotsByTeacher.get(key)!.add(slotKey)
        const courseName = String(lesson.name ?? '').trim()
        if (courseName) {
          if (!coursesByTeacher.has(key)) coursesByTeacher.set(key, new Set())
          coursesByTeacher.get(key)!.add(courseName)
        }
      })
    })
  })

  return Array.from(slotsByTeacher.entries())
    .map(([key, slots]) => {
      const teacher = teacherById.get(key)
      const requiredHours = Math.max(0, Math.floor(Number(teacher?.weeklyLessonRequirement) || 0))
      const scheduledHours = slots.size
      const difference = requiredHours > 0 ? scheduledHours - requiredHours : null
      const completionRate = requiredHours > 0 ? Math.round((scheduledHours / requiredHours) * 100) : null
      const status: TeacherHourRow['status'] =
        requiredHours <= 0 ? '未设置' : scheduledHours >= requiredHours ? '已达标' : '未达标'
      return {
        key,
        teacherId: teacher?.id ?? '',
        name: teacher?.name ?? fallbackNames.get(key) ?? '未知教师',
        campusId: teacher?.campusId ?? '',
        campusName: teacher?.campusId ? campusNameById.get(teacher.campusId) ?? '未设置校区' : '未设置校区',
        courseNames: Array.from(coursesByTeacher.get(key) ?? []).sort((a, b) => a.localeCompare(b, 'zh-CN')),
        requiredHours,
        scheduledHours,
        difference,
        completionRate,
        status
      }
    })
    .sort((a, b) => b.scheduledHours - a.scheduledHours || a.name.localeCompare(b.name, 'zh-CN'))
})

const filteredRows = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return teacherHourRows.value.filter((item) => {
    if (selectedCampusId.value !== '__all__' && item.campusId !== selectedCampusId.value) return false
    if (selectedStatus.value !== '全部状态' && item.status !== selectedStatus.value) return false
    if (!query) return true
    return [item.name, item.campusName, item.courseNames.join('、')].some((value) => value.toLowerCase().includes(query))
  })
})

const sortableFields = new Set<keyof TeacherHourRow>([
  'name',
  'campusName',
  'requiredHours',
  'scheduledHours',
  'difference',
  'completionRate',
  'status'
])

function sortableValue(row: TeacherHourRow, key: keyof TeacherHourRow): string | number | null {
  const value = row[key]
  if (Array.isArray(value)) return value.join('、')
  if (value === null || value === undefined) return null
  return typeof value === 'number' ? value : String(value)
}

const sortedRows = computed(() => {
  if (!sortKey.value || !sortOrder.value) return filteredRows.value
  const direction = sortOrder.value === 'ascending' ? 1 : -1
  const key = sortKey.value
  return [...filteredRows.value].sort((left, right) => {
    const leftValue = sortableValue(left, key)
    const rightValue = sortableValue(right, key)
    if (leftValue === null || rightValue === null) {
      if (leftValue === rightValue) return 0
      return leftValue === null ? 1 : -1
    }
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * direction
    }
    return String(leftValue).localeCompare(String(rightValue), 'zh-CN', { numeric: true }) * direction
  })
})

const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return sortedRows.value.slice(start, start + pageSize.value)
})

const summary = computed(() => ({
  teacherCount: filteredRows.value.length,
  totalHours: filteredRows.value.reduce((sum, item) => sum + item.scheduledHours, 0),
  reachedCount: filteredRows.value.filter((item) => item.status === '已达标').length,
  pendingCount: filteredRows.value.filter((item) => item.status === '未达标').length
}))

function statusTagType(status: TeacherHourRow['status']): 'success' | 'warning' | 'info' {
  if (status === '已达标') return 'success'
  if (status === '未达标') return 'warning'
  return 'info'
}

function formatDifference(value: number | null): string {
  if (value === null) return '--'
  return value > 0 ? `+${value}` : String(value)
}

function handleSortChange(payload: { prop?: string; order?: 'ascending' | 'descending' | null }): void {
  const prop = payload.prop as keyof TeacherHourRow | undefined
  sortKey.value = prop && sortableFields.has(prop) ? prop : ''
  sortOrder.value = payload.order ?? ''
  currentPage.value = 1
}

function rowIndex(index: number): number {
  return (currentPage.value - 1) * pageSize.value + index + 1
}

function exportStatistics(): void {
  if (sortedRows.value.length === 0) {
    notify.warning('当前筛选条件下暂无可导出的教师课时数据。')
    return
  }
  try {
    const headers = ['序号', '教师姓名', '校区', '周课时要求', '已排课时', '课时差额', '完成率', '状态']
    const rows = sortedRows.value.map((item, index) => [
      index + 1,
      item.name,
      item.campusName,
      item.requiredHours,
      item.scheduledHours,
      item.difference ?? '',
      item.completionRate === null ? '' : `${item.completionRate}%`,
      item.status
    ])
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
    worksheet['!cols'] = [
      { wch: 8 },
      { wch: 16 },
      { wch: 18 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 }
    ]
    worksheet['!autofilter'] = { ref: `A1:H${rows.length + 1}` }
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '教师课时统计')
    const planName = planNameById.value.get(selectedPlanId.value) || '当前课表'
    const safePlanName = planName.replace(/[\\/:*?"<>|]/g, '-').trim() || '当前课表'
    XLSX.writeFile(workbook, `${safePlanName}-教师课时统计.xlsx`)
    notify.success(`已导出 ${rows.length} 名教师的课时统计。`)
  } catch (error) {
    notify.error(error instanceof Error ? error.message : '教师课时统计导出失败，请稍后重试。')
  }
}

async function refreshData(showSuccess = false): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const [basicDataResult, plans, workbench] = await Promise.all([
      Promise.resolve(basicDataRepository.load()),
      loadSchedulePlans(),
      loadWorkbenchPersistSnapshot()
    ])
    const basicData = basicDataResult ?? {}
    campuses.value = Array.isArray(basicData.campuses) ? basicData.campuses : []
    teacherRecords.value = Array.isArray(basicData.teacherRecords) ? basicData.teacherRecords : []
    schedulePlans.value = plans
    workbenchState.value = workbench
    if (showSuccess) notify.success('教师课时统计已刷新。')
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '教师课时统计加载失败。'
  } finally {
    loading.value = false
  }
}

watch(
  publishedPlanOptions,
  (items) => {
    if (!items.some((item) => item.id === selectedPlanId.value)) selectedPlanId.value = items[0]?.id ?? ''
  },
  { immediate: true }
)

watch(campusOptions, (items) => {
  if (!items.some((item) => item.id === selectedCampusId.value)) selectedCampusId.value = '__all__'
})

watch(
  [filteredRows, pageSize],
  () => {
    const maxPage = Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value))
    if (currentPage.value > maxPage) currentPage.value = maxPage
  },
  { immediate: true }
)

watch([selectedPlanId, selectedCampusId, selectedStatus, keyword], () => {
  currentPage.value = 1
})

onMounted(() => void refreshData())
</script>

<template>
  <AppContentSkeleton v-if="loading" variant="table" />
  <article v-else class="panel teacher-hours-panel">
    <header class="teacher-hours-header">
      <div>
        <h1>教师课时统计</h1>
        <p>统计已生成课表中每位教师实际安排的周课时，合班课按同一时间去重计算。</p>
      </div>
      <el-button :icon="Refresh" @click="refreshData(true)">刷新数据</el-button>
    </header>

    <section class="teacher-hours-toolbar">
      <div class="teacher-hours-filter teacher-hours-filter--plan">
        <span>课表方案</span>
        <el-select v-model="selectedPlanId" placeholder="请选择已生成课表">
          <el-option v-for="item in publishedPlanOptions" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
      </div>
      <div class="teacher-hours-filter">
        <span>校区</span>
        <el-select v-model="selectedCampusId">
          <el-option v-for="item in campusOptions" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </div>
      <div class="teacher-hours-filter">
        <span>完成状态</span>
        <el-select v-model="selectedStatus">
          <el-option v-for="item in ['全部状态', '已达标', '未达标', '未设置']" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <el-input v-model="keyword" clearable placeholder="搜索教师、课程或校区" class="teacher-hours-search" />
    </section>

    <p v-if="loadError" class="teacher-hours-error">{{ loadError }}</p>
    <div v-if="!publishedPlanOptions.length && !loading" class="teacher-hours-empty-notice">
      暂无已生成课表，请先在排课管理中生成课表。
    </div>

    <section class="teacher-hours-summary" aria-label="教师课时统计概览">
      <div class="teacher-hours-metric">
        <span>已排教师</span>
        <strong>{{ summary.teacherCount }}</strong>
        <small>人</small>
      </div>
      <div class="teacher-hours-metric">
        <span>已排课时合计</span>
        <strong>{{ summary.totalHours }}</strong>
        <small>教师课时</small>
      </div>
      <div class="teacher-hours-metric teacher-hours-metric--success">
        <span>达到要求</span>
        <strong>{{ summary.reachedCount }}</strong>
        <small>人</small>
      </div>
      <div class="teacher-hours-metric teacher-hours-metric--warning">
        <span>尚未达到</span>
        <strong>{{ summary.pendingCount }}</strong>
        <small>人</small>
      </div>
    </section>

    <section class="teacher-hours-table-wrap">
      <div class="teacher-hours-table-heading">
        <div>
          <h2>教师课时明细</h2>
          <p v-if="selectedPlan">课表生成时间：{{ formatDateTime(selectedPlan.publishedAt) }}</p>
        </div>
        <div class="teacher-hours-table-actions">
          <span>共 {{ filteredRows.length }} 名教师</span>
          <el-button :icon="Download" :disabled="filteredRows.length === 0" @click="exportStatistics">数据导出</el-button>
        </div>
      </div>

      <el-table
        :data="pagedRows"
        row-key="key"
        border
        stripe
        empty-text="当前课表暂无已安排教师"
        @sort-change="handleSortChange"
      >
        <el-table-column label="序号" width="72" align="center">
          <template #default="{ $index }">{{ rowIndex($index) }}</template>
        </el-table-column>
        <el-table-column prop="name" label="教师姓名" min-width="130" sortable="custom" />
        <el-table-column prop="campusName" label="校区" min-width="130" sortable="custom" />
        <el-table-column prop="requiredHours" label="周课时要求" width="130" align="center" sortable="custom" />
        <el-table-column prop="scheduledHours" label="已排课时" width="120" align="center" sortable="custom">
          <template #default="{ row }"><strong class="teacher-hours-count">{{ row.scheduledHours }}</strong></template>
        </el-table-column>
        <el-table-column prop="difference" label="课时差额" width="110" align="center" sortable="custom">
          <template #default="{ row }">{{ formatDifference(row.difference) }}</template>
        </el-table-column>
        <el-table-column prop="completionRate" label="完成情况" min-width="180" sortable="custom">
          <template #default="{ row }">
            <div v-if="row.completionRate !== null" class="teacher-hours-progress">
              <el-progress :percentage="Math.min(100, row.completionRate)" :stroke-width="8" :show-text="false" />
              <span>{{ row.completionRate }}%</span>
            </div>
            <span v-else class="teacher-hours-muted">未设置要求</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110" align="center" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" effect="light">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div class="teacher-hours-pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          layout="total, sizes, prev, pager, next, jumper"
          :total="filteredRows.length"
        />
      </div>
    </section>
  </article>
</template>

<style scoped>
.teacher-hours-panel {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: calc(100vh - 112px);
  padding: 24px;
  overflow: hidden;
}

.teacher-hours-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.teacher-hours-header h1 {
  margin: 0;
  color: #172642;
  font-size: 30px;
  line-height: 1.25;
}

.teacher-hours-header p {
  margin: 7px 0 0;
  color: #7182a5;
  font-size: 14px;
}

.teacher-hours-toolbar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 16px;
  border: 1px solid #dbe6fb;
  border-radius: 12px;
  background: #f7faff;
}

.teacher-hours-filter {
  display: grid;
  gap: 7px;
  width: 150px;
}

.teacher-hours-filter--plan {
  width: 300px;
}

.teacher-hours-filter > span {
  color: #556889;
  font-size: 13px;
  font-weight: 600;
}

.teacher-hours-search {
  width: 240px;
  margin-left: auto;
}

.teacher-hours-empty-notice,
.teacher-hours-error {
  margin: 14px 0 0;
  padding: 11px 14px;
  border-radius: 8px;
  font-size: 13px;
}

.teacher-hours-empty-notice {
  color: #6e7fa0;
  background: #f5f7fb;
}

.teacher-hours-error {
  color: #c64040;
  background: #fff2f2;
}

.teacher-hours-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 18px 0;
}

.teacher-hours-metric {
  position: relative;
  min-height: 98px;
  padding: 17px 18px;
  border: 1px solid #dce6f8;
  border-radius: 12px;
  background: #fff;
}

.teacher-hours-metric::before {
  position: absolute;
  inset: 17px auto 17px 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #5a9df8;
  content: '';
}

.teacher-hours-metric--success::before { background: #39b980; }
.teacher-hours-metric--warning::before { background: #f1a84a; }

.teacher-hours-metric span {
  display: block;
  color: #7182a5;
  font-size: 13px;
}

.teacher-hours-metric strong {
  display: inline-block;
  margin-top: 7px;
  color: #21385f;
  font-size: 30px;
  line-height: 1;
}

.teacher-hours-metric small {
  margin-left: 7px;
  color: #8b99b3;
}

.teacher-hours-table-wrap {
  border: 1px solid #dce6f8;
  border-radius: 12px;
  overflow: hidden;
}

.teacher-hours-table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 18px;
  border-bottom: 1px solid #e2e9f6;
  background: #fff;
}

.teacher-hours-table-heading h2 {
  margin: 0;
  color: #24395f;
  font-size: 17px;
}

.teacher-hours-table-heading p,
.teacher-hours-table-actions > span {
  margin: 4px 0 0;
  color: #8190aa;
  font-size: 12px;
}

.teacher-hours-table-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.teacher-hours-count { color: #2588ef; font-size: 16px; }

.teacher-hours-table-wrap :deep(.caret-wrapper),
.teacher-hours-table-wrap :deep(.caret-wrapper:hover) {
  margin-top: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  color: inherit !important;
  font-size: inherit !important;
  background: transparent !important;
  box-shadow: none !important;
}

.teacher-hours-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 14px 16px;
  border-top: 1px solid #e2e9f6;
  background: #fff;
}

.teacher-hours-progress {
  display: grid;
  grid-template-columns: minmax(70px, 1fr) 44px;
  align-items: center;
  gap: 9px;
}

.teacher-hours-progress span,
.teacher-hours-muted {
  color: #7182a5;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .teacher-hours-toolbar { flex-wrap: wrap; }
  .teacher-hours-search { width: 100%; margin-left: 0; }
  .teacher-hours-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 720px) {
  .teacher-hours-panel { padding: 16px; }
  .teacher-hours-header { align-items: stretch; flex-direction: column; }
  .teacher-hours-filter,
  .teacher-hours-filter--plan { width: 100%; }
  .teacher-hours-summary { grid-template-columns: 1fr; }
  .teacher-hours-table-heading { align-items: flex-start; }
  .teacher-hours-table-actions { align-items: flex-end; flex-direction: column; gap: 8px; }
  .teacher-hours-pagination { justify-content: flex-start; overflow-x: auto; }
}
</style>
