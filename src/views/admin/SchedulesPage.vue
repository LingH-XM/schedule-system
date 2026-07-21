<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import {
  deleteWorkbenchPlanState,
  duplicateWorkbenchPlanState,
  loadSchedulePlans,
  saveSchedulePlans,
  type PlanMode,
  type SchedulePlan
} from '../../services/scheduleStateRepository'
import {
  basicDataRepository,
  type BasicDataSnapshot,
  type ClassHourClassRow,
  type ClassHourRow
} from '../../services/basicDataRepository'
import { getCurrentUser } from '../../services/auth'

const router = useRouter()

const plans = ref<SchedulePlan[]>([])
const plansReady = ref(false)
const animatedProgress = ref<Record<string, number>>({})
let progressAnimationFrame = 0
const showDialog = ref(false)
const dialogType = ref<'create' | 'rename'>('create')
const editingId = ref('')
const formError = ref('')

const form = reactive<{ name: string; mode: PlanMode }>({
  name: '',
  mode: '行政班排课'
})
const classHourRows = ref<ClassHourRow[]>([])
const classHourClassRows = ref<ClassHourClassRow[]>([])
const basicDataSnapshot = ref<Partial<BasicDataSnapshot> | null>(null)

const modeOptions: PlanMode[] = ['行政班排课']
const sortedPlans = computed(() => [...plans.value].sort((a, b) => Number(b.favorite) - Number(a.favorite)))

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function isLegacyMockPlanSet(input: SchedulePlan[]): boolean {
  if (input.length !== 3) return false
  const names = input.map((item) => item.name).sort().join('|')
  return names === '夏大翔安|时代华威1|时代华威2'
}

function normalizeMode(input: unknown): PlanMode {
  if (input === '行政班排课') return '行政班排课'
  return '行政班排课'
}

function normalizedProgress(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

function displayedProgress(plan: SchedulePlan): number {
  return animatedProgress.value[plan.id] ?? normalizedProgress(plan.progress)
}

function startProgressAnimation(): void {
  if (progressAnimationFrame) cancelAnimationFrame(progressAnimationFrame)
  const targets = Object.fromEntries(plans.value.map((plan) => [plan.id, normalizedProgress(plan.progress)]))
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animatedProgress.value = targets
    return
  }
  animatedProgress.value = Object.fromEntries(Object.keys(targets).map((id) => [id, 0]))
  const startedAt = performance.now()
  const duration = 850
  const tick = (now: number) => {
    const ratio = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - ratio, 3)
    animatedProgress.value = Object.fromEntries(
      Object.entries(targets).map(([id, target]) => [id, Math.round(target * eased)])
    )
    if (ratio < 1) progressAnimationFrame = requestAnimationFrame(tick)
    else progressAnimationFrame = 0
  }
  progressAnimationFrame = requestAnimationFrame(tick)
}

async function loadPlans(): Promise<void> {
  const loaded = await loadSchedulePlans()
  if (!Array.isArray(loaded) || loaded.length <= 0) {
    plans.value = []
    return
  }
  const normalized = loaded.map((item) => ({
    ...item,
    mode: normalizeMode(item.mode)
  }))
  if (isLegacyMockPlanSet(normalized)) {
    plans.value = []
    void saveSchedulePlans([])
    return
  }
  plans.value = normalized
}

watch(
  plans,
  (value) => {
    if (!plansReady.value) return
    void saveSchedulePlans(value)
  },
  { deep: true }
)

onMounted(() => {
  void Promise.all([loadPlans(), basicDataRepository.load()]).then(([, basicData]) => {
    const payload = basicData && typeof basicData === 'object' ? basicData : {}
    basicDataSnapshot.value = payload as Partial<BasicDataSnapshot>
    classHourRows.value = Array.isArray((payload as { classHourRows?: unknown[] }).classHourRows)
      ? ((payload as { classHourRows: ClassHourRow[] }).classHourRows || [])
      : []
    classHourClassRows.value = Array.isArray((payload as { classHourClassRows?: unknown[] }).classHourClassRows)
      ? ((payload as { classHourClassRows: ClassHourClassRow[] }).classHourClassRows || [])
      : []
    plansReady.value = true
    startProgressAnimation()
  })
})

onBeforeUnmount(() => {
  if (progressAnimationFrame) cancelAnimationFrame(progressAnimationFrame)
})

type RequiredCheckItem = {
  key: string
  label: string
  isSet: boolean
}

const firstUnmetRequiredLabel = computed(() => {
  const snapshot = (basicDataSnapshot.value || {}) as Partial<BasicDataSnapshot> & {
    teachingAssignments?: unknown[]
    arrangementRows?: unknown[]
    arrangementScopes?: Record<string, unknown>
  }

  const campuses = Array.isArray(snapshot.campuses) ? snapshot.campuses : []
  const courses = Array.isArray(snapshot.courses) ? snapshot.courses : []
  const classRecords = Array.isArray(snapshot.classRecords) ? snapshot.classRecords : []
  const teacherRecords = Array.isArray(snapshot.teacherRecords) ? snapshot.teacherRecords : []
  const groupRecords = Array.isArray(snapshot.groupRecords) ? snapshot.groupRecords : []
  const teachingAssignments = Array.isArray(snapshot.teachingAssignments) ? snapshot.teachingAssignments : []
  const classHourRowsValue = Array.isArray(snapshot.classHourRows) ? snapshot.classHourRows : []
  const classHourClassRowsValue = Array.isArray(snapshot.classHourClassRows) ? snapshot.classHourClassRows : []

  const hasConfiguredClassHours = [...classHourRowsValue, ...classHourClassRowsValue].some(
    (item) =>
      Number(item.weeklyDays || 0) > 0 ||
      Number(item.morningStudy || 0) > 0 ||
      Number(item.morningLessons || 0) > 0 ||
      Number(item.afternoonLessons || 0) > 0 ||
      Number(item.eveningStudy || 0) > 0
  )

  const hasArrangementInRows = (rows: unknown[]): boolean =>
    rows.some((row) => {
      if (!row || typeof row !== 'object') return false
      const values = (row as { values?: Record<string, unknown> }).values
      if (!values || typeof values !== 'object') return false
      return Object.values(values).some((value) => {
        const numeric = Number(value || 0)
        return Number.isFinite(numeric) && numeric > 0
      })
    })

  const arrangementRows = Array.isArray(snapshot.arrangementRows) ? snapshot.arrangementRows : []
  const arrangementScopes = snapshot.arrangementScopes && typeof snapshot.arrangementScopes === 'object' ? snapshot.arrangementScopes : {}
  const hasArrangementInScopes = Object.values(arrangementScopes).some((scope) => {
    if (!scope || typeof scope !== 'object') return false
    const rows = (scope as { rows?: unknown[] }).rows
    return Array.isArray(rows) && hasArrangementInRows(rows)
  })

  const hasTeachingAssignment = teachingAssignments.length > 0
  const hasHeadTeacher = classRecords.some((item) => Boolean(String(item.headTeacherId ?? '').trim()))

  const checks: RequiredCheckItem[] = [
    { key: 'campus', label: '校区', isSet: campuses.length > 0 },
    { key: 'course-manage', label: '课程', isSet: courses.length > 0 },
    { key: 'class-setting', label: '班级', isSet: classRecords.length > 0 },
    { key: 'class-hours', label: '班级课时', isSet: hasConfiguredClassHours },
    { key: 'time-slot', label: '课程安排', isSet: hasArrangementInRows(arrangementRows) || hasArrangementInScopes },
    { key: 'group-manage', label: '教研与活动分组', isSet: groupRecords.length > 0 },
    { key: 'teacher-entry', label: '录入教师', isSet: teacherRecords.length > 0 },
    { key: 'teaching-info', label: '任课信息', isSet: hasTeachingAssignment || hasHeadTeacher }
  ]

  const firstUnmet = checks.find((item) => !item.isSet)
  return firstUnmet ? firstUnmet.label : ''
})

const hasUnmetRequiredItems = computed(() => Boolean(firstUnmetRequiredLabel.value))

function openCreateDialog(): void {
  dialogType.value = 'create'
  editingId.value = ''
  form.name = ''
  form.mode = '行政班排课'
  formError.value = ''
  showDialog.value = true
}

function openRenameDialog(plan: SchedulePlan): void {
  dialogType.value = 'rename'
  editingId.value = plan.id
  form.name = plan.name
  form.mode = plan.mode
  formError.value = ''
  showDialog.value = true
}

function closeDialog(): void {
  showDialog.value = false
}

function submitDialog(): void {
  const name = form.name.trim()
  if (!name) {
    formError.value = '方案名称不能为空'
    return
  }

  if (dialogType.value === 'create') {
    plans.value.unshift({
      id: uid(),
      name,
      mode: form.mode,
      progress: 0,
      favorite: false,
      ownerUserId: getCurrentUser()?.userId,
      scopes: getCurrentUser()?.scopes ?? []
    })
    closeDialog()
    return
  }

  plans.value = plans.value.map((plan) =>
    plan.id === editingId.value
      ? {
          ...plan,
          name,
          mode: form.mode
        }
      : plan
  )

  closeDialog()
}

function toggleFavorite(id: string): void {
  plans.value = plans.value.map((plan) =>
    plan.id === id
      ? {
          ...plan,
          favorite: !plan.favorite
        }
      : plan
  )
}

async function duplicatePlan(id: string): Promise<void> {
  const target = plans.value.find((plan) => plan.id === id)
  if (!target) return

  const newPlanId = uid()
  const copiedScheduleResult = await duplicateWorkbenchPlanState(target.id, newPlanId)
  plans.value.unshift({
    ...target,
    id: newPlanId,
    name: `${target.name}副本`,
    favorite: false,
    progress: target.progress
  })
  ElMessage.success(copiedScheduleResult ? '已复制方案及排课内容，副本尚未发布。' : '已复制方案；原方案暂无排课结果。')
}

async function deletePlan(id: string): Promise<void> {
  const target = plans.value.find((plan) => plan.id === id)
  const displayName = target?.name ?? '该方案'
  try {
    await ElMessageBox.confirm(
      `确认删除排课方案「${displayName}」吗？该方案的排课内容及已发布课表数据将一并删除，且无法恢复。`,
      '删除排课方案',
      {
        type: 'warning',
        confirmButtonText: '删除方案及课表',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  await deleteWorkbenchPlanState(id)
  plans.value = plans.value.filter((plan) => plan.id !== id)
  ElMessage.success('排课方案及关联课表数据已删除。')
}

function adjustSchedule(id: string): void {
  if (hasUnmetRequiredItems.value) {
    return
  }
  const target = plans.value.find((plan) => plan.id === id)
  router.push({
    name: 'scheduleWorkbench',
    query: {
      planId: id,
      planName: target?.name ?? '排课方案'
    }
  })
}
</script>

<template>
  <article class="panel schedule-panel">
    <header class="plan-header">
      <div>
        <h1>排课方案管理</h1>
        <p>可创建多个方案并行试排，支持收藏、复制和重命名。</p>
      </div>
    </header>

    <section v-if="!plansReady" class="plan-grid plan-skeleton-grid" aria-label="正在读取排课方案" aria-busy="true">
      <article class="plan-card plan-skeleton-card">
        <el-skeleton animated>
          <template #template>
            <div class="plan-skeleton-head">
              <el-skeleton-item variant="h1" class="plan-skeleton-title" />
              <el-skeleton-item variant="text" class="plan-skeleton-link" />
            </div>
            <el-skeleton-item variant="text" class="plan-skeleton-line plan-skeleton-line--wide" />
            <el-skeleton-item variant="text" class="plan-skeleton-line" />
            <el-skeleton-item variant="rect" class="plan-skeleton-progress" />
            <div class="plan-skeleton-actions">
              <el-skeleton-item variant="button" />
              <el-skeleton-item variant="button" />
              <el-skeleton-item variant="button" />
            </div>
          </template>
        </el-skeleton>
      </article>

      <div class="plan-create-card plan-skeleton-create" aria-hidden="true">
        <el-skeleton animated>
          <template #template>
            <el-skeleton-item variant="circle" class="plan-skeleton-plus" />
            <el-skeleton-item variant="text" class="plan-skeleton-create-label" />
          </template>
        </el-skeleton>
      </div>
    </section>

    <section v-else class="plan-grid">
      <article v-for="plan in sortedPlans" :key="plan.id" class="plan-card">
        <div class="plan-card-head">
          <h2>{{ plan.name }}</h2>
          <el-button type="primary" link @click="openRenameDialog(plan)">重命名</el-button>
        </div>

        <p>排课模式：{{ plan.mode }}</p>
        <div class="progress-row">
          <span>排课进度：</span>
          <div class="plan-progress-status">
            <span v-if="!plansReady" class="plan-progress-loading" aria-label="排课进度加载中">--</span>
            <strong v-else-if="!hasUnmetRequiredItems" class="plan-progress-number">
              <span>{{ displayedProgress(plan) }}</span><small>%</small>
            </strong>
            <el-tag v-else type="danger" effect="light" size="small">未设置{{ firstUnmetRequiredLabel }}</el-tag>
          </div>
          <el-button
            v-if="plansReady && !hasUnmetRequiredItems"
            type="primary"
            link
            class="plan-adjust-btn"
            @click="adjustSchedule(plan.id)"
          >
            调整课表
          </el-button>
        </div>

        <footer class="plan-actions">
          <el-button
            class="favorite-toggle-btn"
            :class="{ 'is-favorite': plan.favorite }"
            text
            @click="toggleFavorite(plan.id)"
          >
            {{ plan.favorite ? '★ 已收藏' : '☆ 收藏' }}
          </el-button>
          <el-button text @click="duplicatePlan(plan.id)">复制</el-button>
          <el-button text type="danger" @click="deletePlan(plan.id)">删除</el-button>
        </footer>
      </article>

      <div class="plan-create-card" role="button" tabindex="0" @click="openCreateDialog" @keydown.enter="openCreateDialog">
        <span class="plus">+</span>
        <span>创建排课方案</span>
      </div>
    </section>

    <el-dialog v-model="showDialog" :title="dialogType === 'create' ? '创建排课方案' : '重命名排课方案'" width="520px">
      <el-form label-position="top">
        <el-form-item label="方案名称">
          <el-input id="plan-name" v-model="form.name" placeholder="请输入方案名称" />
        </el-form-item>
        <el-form-item label="排课模式">
          <el-select id="plan-mode" v-model="form.mode">
            <el-option v-for="mode in modeOptions" :key="mode" :label="mode" :value="mode" />
          </el-select>
        </el-form-item>
      </el-form>

      <p v-if="formError" class="error">{{ formError }}</p>

      <template #footer>
        <div class="dialog-actions">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" @click="submitDialog">{{ dialogType === 'create' ? '创建方案' : '保存方案' }}</el-button>
        </div>
      </template>
    </el-dialog>
  </article>
</template>

<style scoped>
.plan-skeleton-card {
  pointer-events: none;
}

.plan-skeleton-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.plan-skeleton-title {
  width: 42%;
  height: 28px;
}

.plan-skeleton-link {
  width: 52px;
}

.plan-skeleton-line {
  display: block;
  width: 58%;
  margin-bottom: 20px;
}

.plan-skeleton-line--wide {
  width: 72%;
}

.plan-skeleton-progress {
  width: 100%;
  height: 8px;
  margin: 2px 0 24px;
  border-radius: 999px;
}

.plan-skeleton-actions {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-top: 14px;
  border-top: 1px solid #edf1f7;
}

.plan-skeleton-actions .el-skeleton__item {
  width: 64px;
  height: 28px;
}

.plan-skeleton-create {
  pointer-events: none;
}

.plan-skeleton-create :deep(.el-skeleton__content) {
  display: flex;
  min-height: 184px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.plan-skeleton-plus {
  width: 42px;
  height: 42px;
}

.plan-skeleton-create-label {
  width: 112px;
}

.schedule-panel .progress-row {
  display: grid;
  grid-template-columns: auto minmax(112px, max-content) minmax(0, 1fr);
  align-items: center;
  min-height: 32px;
  gap: 8px;
}

.plan-progress-status {
  display: flex;
  align-items: center;
  min-width: 112px;
  min-height: 28px;
}

.plan-progress-loading {
  display: inline-block;
  width: 46px;
  color: #a8b3c8;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
}

.plan-progress-number {
  display: inline-flex;
  align-items: baseline;
  min-width: 52px;
  overflow: hidden;
  color: #1fa862;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.plan-progress-number > span {
  display: inline-block;
  min-width: 3ch;
  text-align: right;
  animation: plan-progress-roll 650ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.plan-progress-number small {
  margin-left: 1px;
  font-size: 1em;
  font-weight: inherit;
}

.schedule-panel .plan-adjust-btn {
  justify-self: end;
  margin-left: 0;
}

@keyframes plan-progress-roll {
  from {
    opacity: 0.2;
    transform: translateY(70%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .plan-progress-number > span { animation: none; }
}

@media (max-width: 640px) {
  .schedule-panel .progress-row {
    grid-template-columns: auto minmax(96px, max-content) minmax(0, 1fr);
  }

  .plan-progress-status { min-width: 96px; }
}
</style>
