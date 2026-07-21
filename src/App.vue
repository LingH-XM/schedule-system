<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { notify } from './utils/notify'
import { getAuthToken, getCurrentUser, isAuthenticated, logout } from './services/auth'
import { fetchSystemHealth, isApiSourceEnabled, SystemHealthApiError } from './services/systemHealthApi'

const route = useRoute()
const router = useRouter()
const STARTUP_HEALTH_KEY = 'startup_health_checked_v2'
let checkingHealth = false

function healthSessionKey(): string {
  const token = getAuthToken()
  return `${STARTUP_HEALTH_KEY}:${token.slice(-16)}`
}

async function checkBackendHealth(): Promise<void> {
  if (checkingHealth || !isAuthenticated()) return
  if (getCurrentUser()?.mustChangePassword) return
  if (route.path === '/login' || route.path === '/design-showcase') return

  const sessionKey = healthSessionKey()
  if (sessionStorage.getItem(sessionKey) === '1') return

  if (!isApiSourceEnabled()) {
    sessionStorage.setItem(sessionKey, '1')
    notify.warning('当前前端数据源为本地 localStorage，不会写入数据库。')
    return
  }

  checkingHealth = true
  try {
    const health = await fetchSystemHealth()
    sessionStorage.setItem(sessionKey, '1')
    if (health.storageMode === 'database' && health.prismaConnected) {
      notify.success('后端已连接数据库，数据将写入 PostgreSQL。')
      return
    }
    notify.warning(health.message || '后端未连接数据库，当前为文件存储。')
  } catch (error) {
    if (error instanceof SystemHealthApiError && error.status === 401) {
      logout()
      notify.warning('登录状态已失效，请重新登录。')
      await router.replace({ name: 'login', query: { redirect: route.fullPath } })
      return
    }
    if (error instanceof SystemHealthApiError && error.status === 403) {
      notify.warning(error.message || '当前账户暂无健康检查权限。')
      return
    }
    notify.error('无法连接后端 API，请检查服务运行状态。')
  } finally {
    checkingHealth = false
  }
}

watch(
  () => route.fullPath,
  () => void checkBackendHealth(),
  { immediate: true }
)

onMounted(() => window.addEventListener('auth-session-updated', checkBackendHealth))
onBeforeUnmount(() => window.removeEventListener('auth-session-updated', checkBackendHealth))
</script>

<template>
  <RouterView />
</template>
