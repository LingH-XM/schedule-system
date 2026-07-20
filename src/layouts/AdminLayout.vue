<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Expand, Fold, School, SwitchButton } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { getCurrentUser, hasRequiredRole, logout } from '../services/auth'
import { basicDataRepository } from '../services/basicDataRepository'
import { formatSchoolTermLabel } from '../utils/termLabel'

const route = useRoute()
const router = useRouter()

const navItems = [
  { label: '控制台', to: '/dashboard' },
  { label: '账户管理', to: '/users', minRole: 'super_admin' as const },
  { label: '基础数据', to: '/basic-data' },
  { label: '排课规则设置', to: '/rule-settings' },
  { label: '排课管理', to: '/schedules' },
  { label: '教师课时统计', to: '/teacher-hours-statistics' },
  { label: '课表管理', to: '/timetable-management' }
]

const currentUser = computed(() => getCurrentUser())
const visibleNavItems = computed(() =>
  navItems.filter((item) => !item.minRole || hasRequiredRole(currentUser.value?.role, item.minRole))
)
const SIDEBAR_COLLAPSE_KEY = 'admin_sidebar_collapsed_v1'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1')
const isCompactScreen = ref(false)
const mobileNavOpen = ref(false)
const currentTermLabel = ref('未设置学期')
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
                  <span class="user-identity-name">{{ currentUser?.accountName ?? currentUser?.name ?? '未知用户' }}</span>
                  <span class="user-identity-role">{{ currentUser?.role === 'super_admin' ? '超级管理员' : '管理员' }}</span>
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
  </div>
</template>
