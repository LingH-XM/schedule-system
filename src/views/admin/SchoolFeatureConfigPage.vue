<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppContentSkeleton from '../../components/AppContentSkeleton.vue'
import {
  fetchSchoolFeatureCatalog,
  fetchSchoolFeatureRecords,
  updateSchoolFeatureRecord,
  type SchoolFeatureDefinition,
  type SchoolFeatureRecord
} from '../../services/schoolFeatureApi'

const loading = ref(true)
const route = useRoute()
const saving = ref(false)
const dialogVisible = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const catalog = ref<SchoolFeatureDefinition[]>([])
const schools = ref<SchoolFeatureRecord[]>([])
const activeSchool = ref<SchoolFeatureRecord | null>(null)
const form = reactive({ featureFlags: {} as Record<string, boolean>, featureNotes: '' })

const filteredSchools = computed(() => {
  const value = keyword.value.trim().toLowerCase()
  if (!value) return schools.value
  return schools.value.filter((school) =>
    [school.schoolName, school.schoolId, school.administrator?.name, school.administrator?.username]
      .some((item) => String(item || '').toLowerCase().includes(value))
  )
})

function enabledCount(school: SchoolFeatureRecord): number {
  return catalog.value.filter((feature) => school.featureFlags[feature.key] !== false).length
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date).replace(/\//g, '-')
}

async function loadData(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const [featureCatalog, records] = await Promise.all([
      fetchSchoolFeatureCatalog(),
      fetchSchoolFeatureRecords()
    ])
    catalog.value = featureCatalog
    schools.value = records
    const requestedSchoolId = String(route.query.schoolId || '').trim()
    const requestedSchool = records.find((school) => school.schoolId === requestedSchoolId)
    if (requestedSchool) openConfig(requestedSchool)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取学校功能配置失败'
  } finally {
    loading.value = false
  }
}

function openConfig(school: SchoolFeatureRecord): void {
  activeSchool.value = school
  form.featureFlags = Object.fromEntries(
    catalog.value.map((feature) => [feature.key, school.featureFlags[feature.key] !== false])
  )
  form.featureNotes = school.featureNotes || ''
  dialogVisible.value = true
}

async function saveConfig(): Promise<void> {
  if (!activeSchool.value) return
  saving.value = true
  try {
    const updated = await updateSchoolFeatureRecord(activeSchool.value.schoolId, {
      featureFlags: form.featureFlags,
      featureSettings: activeSchool.value.featureSettings || {},
      featureNotes: form.featureNotes
    })
    const index = schools.value.findIndex((school) => school.schoolId === updated.schoolId)
    if (index >= 0) schools.value.splice(index, 1, updated)
    dialogVisible.value = false
    ElMessage.success('学校功能配置已保存')
  } catch {
    ElMessage.error('保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

onMounted(() => void loadData())
</script>

<template>
  <AppContentSkeleton v-if="loading" variant="table" />
  <article v-else class="panel school-feature-panel">
    <div class="school-feature-head">
      <div>
        <h1>学校功能配置</h1>
        <p>按学校启用功能模块，为后续定制功能保留独立配置空间。</p>
      </div>
      <el-input v-model="keyword" clearable class="school-feature-search" placeholder="搜索学校、编号或管理员" />
    </div>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <el-table :data="filteredSchools" border class="admin-element-table school-feature-table">
      <el-table-column label="学校" min-width="220">
        <template #default="{ row }">
          <div class="school-feature-school">
            <strong>{{ row.schoolName }}</strong>
            <span>{{ row.schoolId }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="学校管理员" min-width="190">
        <template #default="{ row }">
          <div v-if="row.administrator" class="school-feature-admin">
            <span>{{ row.administrator.name }}</span>
            <small>{{ row.administrator.username }}</small>
          </div>
          <span v-else class="muted">未设置</span>
        </template>
      </el-table-column>
      <el-table-column label="已启用功能" width="140" align="center">
        <template #default="{ row }">
          <span class="school-feature-count">{{ enabledCount(row) }} / {{ catalog.length }}</span>
        </template>
      </el-table-column>
      <el-table-column label="配置说明" min-width="260" show-overflow-tooltip>
        <template #default="{ row }">{{ row.featureNotes || '使用标准功能配置' }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="175" align="center">
        <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openConfig(row)">配置功能</el-button>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无学校账户" /></template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="`${activeSchool?.schoolName ?? ''} · 功能配置`" width="720px">
      <p class="school-feature-dialog-tip">关闭功能后，该配置会保留；后续对应模块接入功能开关时即可按学校控制。</p>
      <el-table :data="catalog" border class="admin-element-table school-feature-dialog-table">
        <el-table-column label="功能" width="165">
          <template #default="{ row }"><strong>{{ row.label }}</strong></template>
        </el-table-column>
        <el-table-column prop="description" label="用途说明" min-width="340" />
        <el-table-column label="启用" width="90" align="center">
          <template #default="{ row }"><el-switch v-model="form.featureFlags[row.key]" /></template>
        </el-table-column>
      </el-table>
      <el-form label-position="top" class="school-feature-note-form">
        <el-form-item label="学校定制说明">
          <el-input
            v-model="form.featureNotes"
            type="textarea"
            :rows="3"
            maxlength="1000"
            show-word-limit
            placeholder="记录该学校的定制需求、交付范围或后续开发说明"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button>
      </template>
    </el-dialog>
  </article>
</template>

<style scoped>
.school-feature-panel { min-width: 0; }
.school-feature-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.school-feature-head h1 { margin: 0 0 8px; }
.school-feature-head p { margin: 0; color: var(--text-secondary, #5f6f8a); }
.school-feature-search { width: min(360px, 34vw); }
.school-feature-school, .school-feature-admin { display: flex; flex-direction: column; gap: 4px; }
.school-feature-school span, .school-feature-admin small { color: var(--text-secondary, #5f6f8a); }
.school-feature-count { font-variant-numeric: tabular-nums; color: var(--el-color-primary); font-weight: 600; }
.school-feature-dialog-tip { margin: -2px 0 16px; color: var(--text-secondary, #5f6f8a); line-height: 1.6; }
.school-feature-note-form { margin-top: 20px; }
.muted { color: var(--text-secondary, #5f6f8a); }
@media (max-width: 900px) {
  .school-feature-head { align-items: stretch; flex-direction: column; }
  .school-feature-search { width: 100%; }
}
</style>
