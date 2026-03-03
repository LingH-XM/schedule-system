<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getRememberedUsername, login } from '../services/auth'

const router = useRouter()
const loading = ref(false)
const errorMessage = ref('')

const form = reactive({
  username: getRememberedUsername(),
  password: '',
  remember: Boolean(getRememberedUsername())
})

const passwordStrength = computed(() => {
  const value = form.password
  if (!value) {
    return { label: '未输入', level: 0 }
  }

  let score = 0
  if (value.length >= 8) score += 1
  if (/[A-Z]/.test(value)) score += 1
  if (/[a-z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1

  if (score <= 2) return { label: '弱', level: 1 }
  if (score <= 4) return { label: '中', level: 2 }
  return { label: '强', level: 3 }
})

function formatLockTime(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} 分钟`
}

function handleSubmit() {
  errorMessage.value = ''

  if (!form.username || !form.password) {
    errorMessage.value = '请输入用户名和密码'
    return
  }

  loading.value = true

  setTimeout(() => {
    const result = login({
      username: form.username.trim(),
      password: form.password,
      remember: form.remember
    })

    if (!result.ok) {
      if (result.reason === 'LOCKED') {
        errorMessage.value = `登录失败次数过多，请 ${formatLockTime(result.remainingSeconds)} 后再试`
      } else {
        errorMessage.value = '用户名或密码错误'
      }
      loading.value = false
      return
    }

    router.push({ name: 'dashboard' })
  }, 250)
}
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <h1>排课系统登录</h1>
      <p>请输入管理员账号访问后台</p>

      <form class="login-form" @submit.prevent="handleSubmit">
        <label for="username">用户名</label>
        <el-input id="username" v-model="form.username" autocomplete="username" placeholder="请输入用户名" />

        <label for="password">密码</label>
        <el-input
          id="password"
          v-model="form.password"
          type="password"
          show-password
          autocomplete="current-password"
          placeholder="请输入密码"
        />

        <p class="strength" :data-level="passwordStrength.level">
          密码强度：{{ passwordStrength.label }}
        </p>

        <el-checkbox v-model="form.remember">记住我</el-checkbox>

        <el-button native-type="submit" type="primary" :loading="loading">
          {{ loading ? '登录中...' : '登录' }}
        </el-button>
      </form>

      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <div class="hint">测试账号：admin / Admin@123456</div>
    </section>
  </main>
</template>
