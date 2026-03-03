<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { getCurrentUser, logout } from '../services/auth'

const router = useRouter()

const userName = computed(() => getCurrentUser()?.name ?? '未知用户')

function handleLogout() {
  logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <main class="dashboard-page">
    <section class="dashboard-card">
      <h1>欢迎进入排课系统</h1>
      <p>当前登录角色：管理员</p>
      <p>当前用户：{{ userName }}</p>
      <el-button type="primary" @click="handleLogout">退出登录</el-button>
    </section>
  </main>
</template>
