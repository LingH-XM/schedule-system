<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Expand, Fold } from '@element-plus/icons-vue'
import { getCurrentUser, logout } from '../services/auth'

const route = useRoute()
const router = useRouter()

const navItems = [
  { label: '控制台', to: '/dashboard' },
  { label: '基础数据', to: '/basic-data' },
  { label: '排课规则设置', to: '/rule-settings' },
  { label: '排课管理', to: '/schedules' },
  { label: '课表管理', to: '/timetable-management' }
]

const currentUser = computed(() => getCurrentUser())
const SIDEBAR_COLLAPSE_KEY = 'admin_sidebar_collapsed_v1'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1')

watch(
  sidebarCollapsed,
  (value) => {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, value ? '1' : '0')
  },
  { immediate: true }
)

function handleLogout() {
  logout()
  router.push({ name: 'login' })
}

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function isNavActive(target: string): boolean {
  return route.path === target || route.path.startsWith(`${target}/`)
}
</script>

<template>
  <div class="admin-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
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
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          :class="{ active: isNavActive(item.to) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <div class="admin-main">
      <header class="admin-header">
        <div class="header-left">
          <el-button
            v-if="sidebarCollapsed"
            class="sidebar-expand-btn"
            text
            @click="toggleSidebar"
          >
            <el-icon><Expand /></el-icon>
            <span>展开导航</span>
          </el-button>
        </div>
        <div class="user-actions">
          <span>{{ currentUser?.name ?? '未知用户' }}</span>
          <el-button size="small" @click="handleLogout">退出</el-button>
        </div>
      </header>

      <section class="admin-content">
        <RouterView />
      </section>
    </div>
  </div>
</template>
