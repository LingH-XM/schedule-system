<script setup lang="ts">
import { onMounted } from 'vue'
import { notify } from './utils/notify'
import { fetchSystemHealth, isApiSourceEnabled } from './services/systemHealthApi'

const STARTUP_HEALTH_KEY = 'startup_health_checked_v1'

onMounted(() => {
  if (sessionStorage.getItem(STARTUP_HEALTH_KEY) === '1') return
  sessionStorage.setItem(STARTUP_HEALTH_KEY, '1')

  if (!isApiSourceEnabled()) {
    notify.warning('当前前端数据源为本地 localStorage，不会写入数据库。')
    return
  }

  void fetchSystemHealth()
    .then((health) => {
      if (health.storageMode === 'database' && health.prismaConnected) {
        notify.success('后端已连接数据库，数据将写入 PostgreSQL。')
        return
      }
      notify.warning(health.message || '后端未连接数据库，当前为文件存储。')
    })
    .catch(() => {
      notify.error('后端健康检查失败，请确认 API 服务是否已启动。')
    })
})
</script>

<template>
  <RouterView />
</template>
