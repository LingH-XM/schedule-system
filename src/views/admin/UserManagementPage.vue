<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { EditPen, Iphone } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type TableInstance } from 'element-plus'
import {
  createManagedUser,
  deleteManagedUser,
  fetchManagedUsers,
  purgeManagedUser,
  resetManagedUserPassword,
  restoreManagedUser,
  updateManagedUser,
  updateManagedUserStatus,
  type ManagedUser
} from '../../services/userManagementApi'
import AppContentSkeleton from '../../components/AppContentSkeleton.vue'

const loading = ref(true)
const saving = ref(false)
const dialogVisible = ref(false)
const passwordDialogVisible = ref(false)
const phoneDialogVisible = ref(false)
const editingUsername = ref('')
const errorMessage = ref('')
const users = ref<ManagedUser[]>([])
const resettingPassword = ref(false)
const deletingUsername = ref('')
const passwordTargetUser = ref<ManagedUser | null>(null)
const phoneTargetUser = ref<ManagedUser | null>(null)
const phoneForm = reactive({ phone: '' })
const phoneSaving = ref(false)
const activeView = ref<'active' | 'trash'>('active')
const accountTableRef = ref<TableInstance>()
const tableWrapRef = ref<HTMLElement | null>(null)
const selectedUsernames = ref<string[]>([])
const batchLoading = ref<'remove' | 'restore' | 'purge' | ''>('')
const tableWidth = ref(0)
let tableResizeObserver: ResizeObserver | null = null

const form = reactive({
  accountId: '',
  accountName: '',
  phone: '',
  role: 'admin' as 'super_admin' | 'admin'
})

const passwordForm = reactive({
  password: '',
  confirmPassword: ''
})

const columnWidths = computed(() => {
  const selection = 48
  const action = 236
  const available = Math.max(tableWidth.value - selection - action, 0)
  const min = {
    account: 176,
    phone: 156,
    role: 124,
    status: 96,
    lastLogin: 168,
    createdAt: 168
  }
  const minTotal = min.account + min.phone + min.role + min.status + min.lastLogin + min.createdAt
  if (available <= minTotal) {
    return { selection, action, ...min }
  }

  const extra = available - minTotal
  const weights = {
    account: 0.18,
    phone: 0.14,
    role: 0.1,
    status: 0.06,
    lastLogin: 0.26,
    createdAt: 0.26
  }

  const account = min.account + Math.round(extra * weights.account)
  const phone = min.phone + Math.round(extra * weights.phone)
  const role = min.role + Math.round(extra * weights.role)
  const status = min.status + Math.round(extra * weights.status)
  const lastLogin = min.lastLogin + Math.round(extra * weights.lastLogin)
  const createdAt = available - account - phone - role - status - lastLogin

  return {
    selection,
    action,
    account,
    phone,
    role,
    status,
    lastLogin,
    createdAt: Math.max(createdAt, min.createdAt)
  }
})

function syncTableWidth(): void {
  const nextWidth = tableWrapRef.value?.clientWidth ?? 0
  if (nextWidth > 0) {
    tableWidth.value = nextWidth
  }
}

function formatDateParts(value?: string | null): { date: string; time: string } {
  if (!value) {
    return { date: '--', time: '--' }
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { date: '--', time: '--' }
  }
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  const seconds = `${date.getSeconds()}`.padStart(2, '0')
  return {
    date: `${year}/${month}/${day}`,
    time: `${hours}:${minutes}:${seconds}`
  }
}

async function loadUsers(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    users.value = await fetchManagedUsers(activeView.value === 'trash')
    selectedUsernames.value = []
    await nextTick()
    accountTableRef.value?.clearSelection()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取账户列表失败'
  } finally {
    loading.value = false
    await nextTick()
    syncTableWidth()
    if (typeof ResizeObserver !== 'undefined' && tableWrapRef.value && !tableResizeObserver) {
      tableResizeObserver = new ResizeObserver(() => syncTableWidth())
      tableResizeObserver.observe(tableWrapRef.value)
    }
  }
}

function handleSelectionChange(selection: ManagedUser[]): void {
  selectedUsernames.value = selection.map((item) => item.username)
}

function isRowSelectable(row: ManagedUser): boolean {
  if (activeView.value === 'active') {
    return row.username !== 'admin'
  }
  return true
}

function getSelectedUsers(): ManagedUser[] {
  const selected = new Set(selectedUsernames.value)
  return users.value.filter((item) => selected.has(item.username))
}

function openCreateDialog(): void {
  form.accountId = ''
  form.accountName = ''
  form.phone = ''
  form.role = 'admin'
  errorMessage.value = ''
  editingUsername.value = ''
  dialogVisible.value = true
}

function openEditDialog(user: ManagedUser): void {
  form.accountId = user.accountId
  form.accountName = user.accountName
  form.phone = user.phone ?? ''
  form.role = user.role
  errorMessage.value = ''
  editingUsername.value = user.username
  dialogVisible.value = true
}

function openPasswordDialog(user: ManagedUser): void {
  passwordTargetUser.value = user
  passwordForm.password = ''
  passwordForm.confirmPassword = ''
  errorMessage.value = ''
  passwordDialogVisible.value = true
}

function openPhoneDialog(user: ManagedUser): void {
  phoneTargetUser.value = user
  phoneForm.phone = user.phone ?? ''
  errorMessage.value = ''
  phoneDialogVisible.value = true
}

function formatPhone(phone?: string | null): string {
  const value = String(phone || '').trim()
  if (!value) return '未绑定'
  return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

async function submitPhoneBinding(): Promise<void> {
  const user = phoneTargetUser.value
  const phone = phoneForm.phone.trim()
  if (!user) return
  if (!phone) {
    errorMessage.value = '请输入要绑定的手机号'
    return
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    errorMessage.value = '请输入正确的 11 位中国大陆手机号'
    return
  }

  phoneSaving.value = true
  errorMessage.value = ''
  try {
    const result = await updateManagedUser({
      currentUsername: user.username,
      accountId: user.accountId,
      accountName: user.accountName,
      phone,
      role: user.role
    })
    if (!result.ok) {
      errorMessage.value = result.reason === 'PHONE_EXISTS' ? '该手机号已被其他账户绑定' : '绑定手机号失败'
      return
    }
    phoneDialogVisible.value = false
    ElMessage.success('手机号已绑定，可使用该手机号登录')
    await loadUsers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '绑定手机号失败'
  } finally {
    phoneSaving.value = false
  }
}

function normalizeAccountId(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function submitCreate(): Promise<void> {
  const accountName = form.accountName.trim()
  const phone = form.phone.trim()

  if (!accountName) {
    errorMessage.value = '请填写名称'
    return
  }

  saving.value = true
  errorMessage.value = ''
  try {
    if (editingUsername.value) {
      const result = await updateManagedUser({
        currentUsername: editingUsername.value,
        accountId: normalizeAccountId(form.accountId),
        accountName,
        phone,
        role: form.role
      })
      if (!result.ok) {
        if (result.reason === 'PHONE_EXISTS') errorMessage.value = '手机号已被绑定'
        else if (result.reason === 'INVALID_PHONE') errorMessage.value = '请输入正确的 11 位中国大陆手机号'
        else if (result.reason === 'ACCOUNT_ID_IMMUTABLE') errorMessage.value = '已有账户的标识暂不支持修改'
        else if (result.reason === 'FORBIDDEN') errorMessage.value = '默认管理员角色不能降级'
        else errorMessage.value = '更新账户失败'
        return
      }
    } else {
      const result = await createManagedUser({ accountName, phone, role: form.role })
      if (!result.ok) {
        if (result.reason === 'PHONE_EXISTS') errorMessage.value = '手机号已被绑定'
        else if (result.reason === 'INVALID_PHONE') errorMessage.value = '请输入正确的 11 位中国大陆手机号'
        else errorMessage.value = '创建账户失败'
        return
      }
    }
    dialogVisible.value = false
    await loadUsers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建账户失败'
  } finally {
    saving.value = false
  }
}

async function toggleStatus(user: ManagedUser): Promise<void> {
  const nextStatus = !user.isActive
  try {
    await ElMessageBox.confirm(
      nextStatus ? `确认启用账号「${user.username}」吗？` : `确认停用账号「${user.username}」吗？`,
      nextStatus ? '启用账号' : '停用账号',
      {
        type: 'warning',
        confirmButtonText: '确认',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  await updateManagedUserStatus(user.username, nextStatus)
  await loadUsers()
}

async function submitResetPassword(): Promise<void> {
  const user = passwordTargetUser.value
  if (!user) return
  if (!passwordForm.password || !passwordForm.confirmPassword) {
    errorMessage.value = '请完整填写新密码和确认密码'
    return
  }
  if (passwordForm.password !== passwordForm.confirmPassword) {
    errorMessage.value = '两次输入的新密码不一致'
    return
  }

  resettingPassword.value = true
  errorMessage.value = ''
  try {
    const result = await resetManagedUserPassword(user.username, passwordForm.password)
    if (!result.ok) {
      errorMessage.value = result.reason === 'INVALID_PASSWORD' ? '密码长度至少 6 位' : '重置密码失败'
      return
    }
    passwordDialogVisible.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '重置密码失败'
  } finally {
    resettingPassword.value = false
  }
}

async function removeUser(user: ManagedUser): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认将账号「${user.username}」移入回收站吗？移入后可在回收站恢复。`,
      '移入回收站',
      {
        type: 'warning',
        confirmButtonText: '确认移入',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  deletingUsername.value = user.username
  errorMessage.value = ''
  try {
    const result = await deleteManagedUser(user.username)
    if (!result.ok) {
      errorMessage.value = result.reason === 'FORBIDDEN' ? '默认管理员不允许删除' : '删除账号失败'
      return
    }
    await loadUsers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除账号失败'
  } finally {
    deletingUsername.value = ''
  }
}

async function removeSelectedUsers(): Promise<void> {
  const selected = getSelectedUsers()
  if (!selected.length) {
    errorMessage.value = '请先选择要移入回收站的账号'
    return
  }

  try {
    await ElMessageBox.confirm(`确认将选中的 ${selected.length} 个账号移入回收站吗？`, '批量移入回收站', {
      type: 'warning',
      confirmButtonText: '确认移入',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  batchLoading.value = 'remove'
  errorMessage.value = ''
  const results = await Promise.allSettled(selected.map((user) => deleteManagedUser(user.username)))
  const failedCount = results.filter((result) => result.status === 'rejected' || !result.value.ok).length
  if (failedCount > 0) {
    errorMessage.value = `${failedCount} 个账号移入回收站失败，请稍后重试`
  } else {
    ElMessage.success(`已移入回收站 ${selected.length} 个账号`)
  }
  await loadUsers()
  batchLoading.value = ''
}

async function restoreUser(user: ManagedUser): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复账号「${user.username}」吗？`, '恢复账号', {
      type: 'info',
      confirmButtonText: '确认恢复',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  deletingUsername.value = user.username
  errorMessage.value = ''
  try {
    const result = await restoreManagedUser(user.username)
    if (!result.ok) {
      errorMessage.value = result.reason === 'FORBIDDEN' ? '该账号不允许恢复' : '恢复账号失败'
      return
    }
    await loadUsers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '恢复账号失败'
  } finally {
    deletingUsername.value = ''
  }
}

async function restoreSelectedUsers(): Promise<void> {
  const selected = getSelectedUsers()
  if (!selected.length) {
    errorMessage.value = '请先选择要恢复的账号'
    return
  }

  try {
    await ElMessageBox.confirm(`确认恢复选中的 ${selected.length} 个账号吗？`, '批量恢复账号', {
      type: 'info',
      confirmButtonText: '确认恢复',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  batchLoading.value = 'restore'
  errorMessage.value = ''
  const results = await Promise.allSettled(selected.map((user) => restoreManagedUser(user.username)))
  const failedCount = results.filter((result) => result.status === 'rejected' || !result.value.ok).length
  if (failedCount > 0) {
    errorMessage.value = `${failedCount} 个账号恢复失败，请稍后重试`
  } else {
    ElMessage.success(`已恢复 ${selected.length} 个账号`)
  }
  await loadUsers()
  batchLoading.value = ''
}

async function purgeUser(user: ManagedUser): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认彻底删除账号「${user.username}」吗？该账户相关数据将被永久清除，无法恢复。`,
      '彻底删除',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  deletingUsername.value = user.username
  errorMessage.value = ''
  try {
    const result = await purgeManagedUser(user.username)
    if (!result.ok) {
      errorMessage.value = result.reason === 'FORBIDDEN' ? '默认管理员不允许删除' : '彻底删除失败'
      return
    }
    await loadUsers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '彻底删除失败'
  } finally {
    deletingUsername.value = ''
  }
}

async function purgeSelectedUsers(): Promise<void> {
  const selected = getSelectedUsers()
  if (!selected.length) {
    errorMessage.value = '请先选择要彻底删除的账号'
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认彻底删除选中的 ${selected.length} 个账号吗？相关数据将被永久清除，无法恢复。`,
      '批量彻底删除',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  batchLoading.value = 'purge'
  errorMessage.value = ''
  const results = await Promise.allSettled(selected.map((user) => purgeManagedUser(user.username)))
  const failedCount = results.filter((result) => result.status === 'rejected' || !result.value.ok).length
  if (failedCount > 0) {
    errorMessage.value = `${failedCount} 个账号彻底删除失败，请稍后重试`
  } else {
    ElMessage.success(`已彻底删除 ${selected.length} 个账号`)
  }
  await loadUsers()
  batchLoading.value = ''
}

async function switchView(nextView: 'active' | 'trash'): Promise<void> {
  if (activeView.value === nextView) return
  activeView.value = nextView
  await loadUsers()
}

onMounted(() => {
  void loadUsers()
})

onBeforeUnmount(() => {
  tableResizeObserver?.disconnect()
  tableResizeObserver = null
})
</script>

<template>
  <AppContentSkeleton v-if="loading" variant="table" />
  <article v-else class="panel user-management-panel">
    <div class="user-management-head">
      <div>
        <h1>账户管理</h1>
        <p>为不同账户创建独立的排课数据空间。每个账号对应一套独立基础数据、规则和排课结果。</p>
      </div>
      <el-button v-if="activeView === 'active'" type="primary" @click="openCreateDialog">新增账号</el-button>
    </div>

    <div class="user-management-toolbar">
      <div class="user-management-tabs">
        <el-button :type="activeView === 'active' ? 'primary' : 'default'" @click="switchView('active')">正常账户</el-button>
        <el-button :type="activeView === 'trash' ? 'primary' : 'default'" @click="switchView('trash')">回收站</el-button>
      </div>
      <div class="user-management-batch-actions">
        <span class="user-management-selection-tip">已选 {{ selectedUsernames.length }} 项</span>
        <template v-if="activeView === 'active'">
          <el-button
            :disabled="selectedUsernames.length === 0"
            :loading="batchLoading === 'remove'"
            @click="removeSelectedUsers"
          >
            批量移入回收站
          </el-button>
        </template>
        <template v-else>
          <el-button
            :disabled="selectedUsernames.length === 0"
            :loading="batchLoading === 'restore'"
            @click="restoreSelectedUsers"
          >
            批量恢复
          </el-button>
          <el-button
            type="danger"
            :disabled="selectedUsernames.length === 0"
            :loading="batchLoading === 'purge'"
            @click="purgeSelectedUsers"
          >
            批量彻底删除
          </el-button>
        </template>
      </div>
    </div>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <div ref="tableWrapRef" class="account-table-wrap">
      <el-table
        ref="accountTableRef"
        :data="users"
        border
        class="account-table"
        @selection-change="handleSelectionChange"
      >
      <el-table-column type="selection" :width="columnWidths.selection" align="center" :selectable="isRowSelectable" />
      <el-table-column label="账号信息" :width="columnWidths.account">
        <template #default="{ row }">
          <div class="account-summary-cell">
            <div class="account-summary-title">{{ row.accountName }}</div>
            <div class="account-summary-meta">{{ row.accountId }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="登录手机号" :width="columnWidths.phone" align="center">
        <template #default="{ row }">
          <div class="account-phone-cell">
            <button
              class="account-phone-binding"
              :class="{ 'is-unbound': !row.phone }"
              type="button"
              :aria-label="row.phone ? '修改登录手机号' : '绑定登录手机号'"
              @click="openPhoneDialog(row)"
            >
              <el-icon><Iphone /></el-icon>
              <span>{{ row.phone ? formatPhone(row.phone) : '未绑定手机号' }}</span>
              <el-icon class="account-phone-binding-edit"><EditPen /></el-icon>
            </button>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="角色" :width="columnWidths.role">
        <template #default="{ row }">
          <div class="account-role-cell">
            <el-tag :type="row.role === 'super_admin' ? 'danger' : 'primary'" effect="light" round>
              {{ row.role === 'super_admin' ? '超级管理员' : '管理员' }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" :width="columnWidths.status">
        <template #default="{ row }">
          <el-tag :type="row.isActive ? 'success' : 'info'" effect="light" round>
            {{ row.isActive ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最近登录" :width="columnWidths.lastLogin">
        <template #default="{ row }">
          <div class="account-time-cell">
            <span class="account-time-text">{{ formatDateParts(row.lastLoginAt).date }}</span>
            <span class="account-time-subtext">{{ formatDateParts(row.lastLoginAt).time }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="activeView === 'trash' ? '删除时间' : '创建时间'" :width="columnWidths.createdAt">
        <template #default="{ row }">
          <div class="account-time-cell">
            <span class="account-time-text">{{ formatDateParts(activeView === 'trash' ? row.deletedAt : row.createdAt).date }}</span>
            <span class="account-time-subtext">{{ formatDateParts(activeView === 'trash' ? row.deletedAt : row.createdAt).time }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" :width="columnWidths.action" fixed="right">
        <template #default="{ row }">
          <div class="account-action-group">
            <template v-if="activeView === 'active'">
              <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
              <el-button link type="primary" @click="toggleStatus(row)">
                {{ row.isActive ? '停用' : '启用' }}
              </el-button>
              <el-button link type="primary" @click="openPasswordDialog(row)">重置密码</el-button>
              <el-button
                link
                type="danger"
                :disabled="row.username === 'admin'"
                :loading="deletingUsername === row.username"
                @click="removeUser(row)"
              >
                删除
              </el-button>
            </template>
            <template v-else>
              <el-button link type="primary" :loading="deletingUsername === row.username" @click="restoreUser(row)">恢复</el-button>
              <el-button link type="danger" :loading="deletingUsername === row.username" @click="purgeUser(row)">彻底删除</el-button>
            </template>
          </div>
        </template>
      </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingUsername ? '编辑账号' : '新增账号'" width="560px">
      <el-form label-position="top" class="user-management-form">
        <div v-if="!editingUsername" class="user-management-static-tags">
          <el-tag effect="light" round>账号：系统自动生成</el-tag>
          <el-tag effect="light" round>初始密码：111111</el-tag>
        </div>
        <el-form-item label="名称" required>
          <el-input v-model="form.accountName" placeholder="例如：一校区" />
        </el-form-item>
        <el-form-item label="登录手机号">
          <el-input v-model="form.phone" maxlength="11" placeholder="可选，绑定后可用手机号登录" />
        </el-form-item>
        <el-form-item v-if="editingUsername" label="账号">
          <el-input :model-value="form.accountId" disabled />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="form.role">
            <el-option label="超级管理员" value="super_admin" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
      </el-form>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <template #footer>
        <div class="dialog-actions">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitCreate">{{ editingUsername ? '保存' : '创建' }}</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="phoneDialogVisible"
      :title="phoneTargetUser?.phone ? '修改登录手机号' : '绑定登录手机号'"
      width="460px"
      @closed="errorMessage = ''"
    >
      <el-form label-position="top">
        <el-form-item label="账户">
          <el-input :model-value="phoneTargetUser?.accountName ?? ''" disabled />
        </el-form-item>
        <el-form-item label="手机号" required>
          <el-input
            v-model="phoneForm.phone"
            maxlength="11"
            inputmode="numeric"
            autocomplete="tel"
            placeholder="请输入 11 位手机号"
          />
        </el-form-item>
      </el-form>
      <p class="dialog-tip">绑定后可使用手机号或账号配合原密码登录；同一手机号仅可绑定一个账户。</p>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <template #footer>
        <div class="dialog-actions">
          <el-button @click="phoneDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="phoneSaving" @click="submitPhoneBinding">确认绑定</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialogVisible" title="重置密码" width="480px">
      <el-form label-position="top">
        <el-form-item label="账号">
          <el-input :model-value="passwordTargetUser?.username ?? ''" disabled />
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input v-model="passwordForm.password" show-password placeholder="请输入新密码，至少 6 位" />
        </el-form-item>
        <el-form-item label="确认新密码" required>
          <el-input v-model="passwordForm.confirmPassword" show-password placeholder="请再次输入新密码" />
        </el-form-item>
      </el-form>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <template #footer>
        <div class="dialog-actions">
          <el-button @click="passwordDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="resettingPassword" @click="submitResetPassword">确认重置</el-button>
        </div>
      </template>
    </el-dialog>
  </article>
</template>
