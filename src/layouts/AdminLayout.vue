<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Expand, Fold, School, SwitchButton } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { changeOwnPassword, getCurrentUser, hasPermission, hasRequiredRole, logout } from '../services/auth'
import { basicDataRepository } from '../services/basicDataRepository'
import { formatSchoolTermLabel } from '../utils/termLabel'

const route = useRoute()
const router = useRouter()

const navItems = [
  { label: '控制台', to: '/dashboard' },
  { label: '账户管理', to: '/users', minRole: 'school_admin' as const },
  { label: '学校功能配置', to: '/school-features', exactRole: 'super_admin' as const },
  { label: '基础数据', to: '/basic-data', permission: 'basic_data.read' },
  { label: '排课规则', to: '/rule-settings', permission: 'rules.read' },
  { label: '排课管理', to: '/schedules', permission: 'schedule.read' },
  { label: '教师课时统计', to: '/teacher-hours-statistics', permission: 'timetable.read' },
  { label: '课表管理', to: '/timetable-management', permission: 'timetable.read' }
]

const currentUser = computed(() => getCurrentUser())
const currentRoleLabel = computed(() => ({
  super_admin: '超级管理员',
  school_admin: '学校管理员',
  grade_scheduler: '年级排课员',
  viewer: '查看账户'
}[currentUser.value?.role ?? 'viewer']))
const visibleNavItems = computed(() =>
  navItems.filter((item) =>
    (!item.minRole || hasRequiredRole(currentUser.value?.role, item.minRole)) &&
    (!item.exactRole || currentUser.value?.role === item.exactRole) &&
    (!item.permission || hasPermission(item.permission))
  ).map((item) => item.to === '/users'
    ? { ...item, label: currentUser.value?.role === 'super_admin' ? '学校账户' : '子账户管理' }
    : item)
)
const SIDEBAR_COLLAPSE_KEY = 'admin_sidebar_collapsed_v1'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1')
const isCompactScreen = ref(false)
const mobileNavOpen = ref(false)
const currentTermLabel = ref('未设置学期')
const passwordDialogVisible = ref(Boolean(getCurrentUser()?.mustChangePassword))
const passwordSaving = ref(false)
const passwordError = ref('')
const passwordForm = ref({ currentPassword: '', nextPassword: '', confirmPassword: '' })
let compactScreenMedia: MediaQueryList | null = null

async function refreshCurrentTerm(): Promise<void> {
  const result = basicDataRepository.load()
  const snapshot = result instanceof Promise ? await result : result
  currentTermLabel.value = formatSchoolTermLabel(String(snapshot?.selectedTerm || '')) || '未设置学期'
}

function handleTermChanged(event: Event): void {
  const term = (event as CustomEvent<string>).detail
  currentTermLabel.value = formatSchoolTermLabel(String(term || '')) || '未设置学期'
}

function syncCompactScreen(event: MediaQueryList | MediaQueryListEvent): void {
  isCompactScreen.value = event.matches
  if (!event.matches) {
    mobileNavOpen.value = false
  }
}

onMounted(() => {
  void refreshCurrentTerm()
  window.addEventListener('schedule-term-changed', handleTermChanged)
  compactScreenMedia = window.matchMedia('(max-width: 1366px)')
  syncCompactScreen(compactScreenMedia)
  compactScreenMedia.addEventListener('change', syncCompactScreen)
})

onBeforeUnmount(() => {
  window.removeEventListener('schedule-term-changed', handleTermChanged)
  compactScreenMedia?.removeEventListener('change', syncCompactScreen)
})

watch(
  sidebarCollapsed,
  (value) => {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, value ? '1' : '0')
  },
  { immediate: true }
)

async function handleLogout(): Promise<void> {
  try {
    await ElMessageBox.confirm('退出后需要重新登录才能继续操作，是否退出？', '确认退出登录', {
      confirmButtonText: '退出登录',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  logout()
  await router.push({ name: 'login' })
}

async function submitRequiredPasswordChange(): Promise<void> {
  const { currentPassword, nextPassword, confirmPassword } = passwordForm.value
  if (!currentPassword || !nextPassword || !confirmPassword) {
    passwordError.value = '请完整填写密码信息'
    return
  }
  if (nextPassword.length < 8) {
    passwordError.value = '新密码至少 8 位'
    return
  }
  if (nextPassword !== confirmPassword) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }
  passwordSaving.value = true
  passwordError.value = ''
  const result = await changeOwnPassword(currentPassword, nextPassword)
  passwordSaving.value = false
  if (!result.ok) {
    passwordError.value = result.reason === 'INVALID_CURRENT_PASSWORD'
      ? '当前密码不正确'
      : result.reason === 'SAME_PASSWORD' ? '新密码不能与当前密码相同' : '密码修改失败'
    return
  }
  passwordDialogVisible.value = false
  ElMessage.success('密码修改成功')
}

function toggleSidebar(): void {
  if (isCompactScreen.value) {
    mobileNavOpen.value = !mobileNavOpen.value
    return
  }
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function closeMobileNav(): void {
  mobileNavOpen.value = false
}

function isNavActive(target: string): boolean {
  return route.path === target || route.path.startsWith(`${target}/`)
}

watch(
  () => route.fullPath,
  () => closeMobileNav()
)

</script>

<template>
  <div
    class="admin-shell"
    :class="{
      'sidebar-collapsed': sidebarCollapsed && !isCompactScreen,
      'compact-layout': isCompactScreen,
      'mobile-nav-open': mobileNavOpen
    }"
  >
    <button
      v-if="isCompactScreen && mobileNavOpen"
      class="mobile-nav-mask"
      type="button"
      aria-label="关闭导航"
      @click="closeMobileNav"
    />
    <aside class="admin-sidebar">
      <div class="brand-row">
        <div class="brand">排课系统</div>
        <el-button class="sidebar-collapse-btn" text @click="toggleSidebar">
          <el-icon><Fold /></el-icon>
          <span>收起</span>
        </el-button>
      </div>
      <nav class="nav-menu">
        <RouterLink
          v-for="item in visibleNavItems"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ active: isNavActive(item.to) }"
          @click="closeMobileNav"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <div class="admin-main">
      <header class="admin-header">
        <div class="header-left">
          <el-button
            v-if="sidebarCollapsed || isCompactScreen"
            class="sidebar-expand-btn"
            text
            :aria-label="isCompactScreen ? '打开导航' : '展开导航'"
            @click="toggleSidebar"
          >
            <el-icon><Expand /></el-icon>
            <span>{{ isCompactScreen ? '导航' : '展开导航' }}</span>
          </el-button>
          <div class="header-term-display">
            <span>当前学年学期</span>
            <strong>{{ currentTermLabel }}</strong>
          </div>
        </div>
        <div class="user-actions">
          <div class="header-accountbar">
            <div class="user-identity-card">
              <span class="user-identity-icon">
                <el-icon><School /></el-icon>
              </span>
              <div class="user-identity-copy">
                <span class="user-identity-label">当前学校</span>
                <div class="user-identity-main">
                  <span class="user-identity-name">{{ currentUser?.schoolName ?? currentUser?.name ?? '未知用户' }}</span>
                  <span class="user-identity-role">{{ currentRoleLabel }}</span>
                </div>
              </div>
            </div>
            <span class="header-account-divider" />
            <el-button class="logout-btn" @click="handleLogout">
              <el-icon><SwitchButton /></el-icon>
              <span>退出登录</span>
            </el-button>
          </div>
        </div>
      </header>

      <section class="admin-content">
        <RouterView />
      </section>
    </div>

    <el-dialog
      v-model="passwordDialogVisible"
      title="首次登录，请修改密码"
      width="460px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <p class="password-change-tip">为保护学校排课数据，使用初始密码登录后需先设置新密码。</p>
      <el-form label-position="top">
        <el-form-item label="当前密码"><el-input v-model="passwordForm.currentPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="passwordForm.nextPassword" type="password" show-password /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="passwordForm.confirmPassword" type="password" show-password /></el-form-item>
      </el-form>
      <p v-if="passwordError" class="password-change-error">{{ passwordError }}</p>
      <template #footer>
        <el-button type="primary" :loading="passwordSaving" @click="submitRequiredPasswordChange">保存新密码</el-button>
      </template>
    </el-dialog>
  </div>
</template>
