<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import loginCampusImage from '../assets/login-campus-modern-v2.png'
import { getRememberedUsername, login } from '../services/auth'

const route = useRoute()
const router = useRouter()
const rememberedUsername = getRememberedUsername()
const loading = ref(false)
const errorMessage = ref('')
const capsLockOn = ref(false)
const lockRemainingSeconds = ref(0)
const recoveryDialogVisible = ref(false)
let lockTimer: ReturnType<typeof setInterval> | null = null

const form = reactive({
  username: rememberedUsername,
  password: '',
  remember: Boolean(rememberedUsername)
})

const fieldErrors = reactive({
  username: '',
  password: ''
})

const isLocked = computed(() => lockRemainingSeconds.value > 0)
const lockCountdown = computed(() => {
  const minutes = Math.floor(lockRemainingSeconds.value / 60)
  const seconds = lockRemainingSeconds.value % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
})

function clearLockTimer(): void {
  if (!lockTimer) return
  clearInterval(lockTimer)
  lockTimer = null
}

function startLockCountdown(seconds: number): void {
  clearLockTimer()
  lockRemainingSeconds.value = Math.max(1, Math.ceil(seconds))
  lockTimer = setInterval(() => {
    lockRemainingSeconds.value = Math.max(0, lockRemainingSeconds.value - 1)
    if (lockRemainingSeconds.value === 0) {
      clearLockTimer()
      errorMessage.value = ''
    }
  }, 1000)
}

function validateUsernameField(): boolean {
  const username = form.username.trim()
  fieldErrors.username = ''

  if (!username) {
    fieldErrors.username = '请输入登录账号或手机号'
  } else if (username.length > 64) {
    fieldErrors.username = '登录账号不能超过 64 个字符'
  } else if (/\s/.test(username)) {
    fieldErrors.username = '登录账号中不能包含空格'
  } else if (/^\d+$/.test(username) && !/^1[3-9]\d{9}$/.test(username)) {
    fieldErrors.username = '请输入正确的 11 位手机号'
  }

  return !fieldErrors.username
}

function validatePasswordField(): boolean {
  fieldErrors.password = ''

  if (!form.password) {
    fieldErrors.password = '请输入密码'
  } else if (form.password.length < 6) {
    fieldErrors.password = '密码至少需要 6 位'
  } else if (form.password.length > 128) {
    fieldErrors.password = '密码不能超过 128 位'
  }

  return !fieldErrors.password
}

function validateForm(): boolean {
  const usernameValid = validateUsernameField()
  const passwordValid = validatePasswordField()
  return usernameValid && passwordValid
}

function resolveLoginDestination(): string {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  if (redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith('/login')) {
    return redirect
  }
  return '/dashboard'
}

function handleUsernameInput(): void {
  fieldErrors.username = ''
  errorMessage.value = ''
}

function handlePasswordInput(): void {
  fieldErrors.password = ''
  errorMessage.value = ''
}

function updateCapsLock(event: KeyboardEvent): void {
  capsLockOn.value = event.getModifierState('CapsLock')
}

async function handleSubmit(): Promise<void> {
  if (loading.value || isLocked.value) return
  errorMessage.value = ''
  if (!validateForm()) return

  loading.value = true
  const result = await login({
    username: form.username.trim(),
    password: form.password,
    remember: form.remember
  })

  if (!result.ok) {
    if (result.reason === 'LOCKED') {
      startLockCountdown(result.remainingSeconds)
      errorMessage.value = '连续登录失败次数过多，账号登录已临时锁定。'
    } else if (result.reason === 'USER_DISABLED') {
      errorMessage.value = '该账号已停用，请联系系统管理员。'
    } else if (result.reason === 'NETWORK') {
      errorMessage.value = '登录服务暂时不可用，请检查网络后重试。'
    } else {
      const attempts = Number(result.attemptsRemaining)
      errorMessage.value = Number.isFinite(attempts)
        ? `账号或密码错误，还可尝试 ${Math.max(0, attempts)} 次。`
        : '账号或密码错误，请重新输入。'
    }
    loading.value = false
    return
  }

  await router.replace(resolveLoginDestination())
}

onBeforeUnmount(clearLockTimer)
</script>

<template>
  <main class="login-page">
    <section
      class="login-visual"
      :style="{ backgroundImage: `url(${loginCampusImage})` }"
      aria-label="由课表网格延展而成的现代校园插画"
    >
      <div class="login-brand">
        <span class="login-brand-mark" aria-hidden="true">
          <i></i><i></i><i></i><i></i>
        </span>
        <span>排课系统</span>
      </div>
      <div class="login-visual-copy">
        <h1>把复杂的排课，<br />变成清晰的秩序。</h1>
        <p>从基础数据、规则配置到智能求解，让每一节课都落在合适的位置。</p>
      </div>
      <p class="login-visual-caption">让教学安排更从容</p>
    </section>

    <section class="login-panel">
      <div class="login-panel-inner">
        <div class="login-mobile-brand">
          <span class="login-brand-mark" aria-hidden="true">
            <i></i><i></i><i></i><i></i>
          </span>
          <span>排课系统</span>
        </div>

        <header class="login-heading">
          <h2>欢迎回来</h2>
          <p>使用登录账号或已绑定的手机号进入系统</p>
        </header>

        <form class="login-form" novalidate @submit.prevent="handleSubmit">
          <div class="login-field" :class="{ 'has-error': fieldErrors.username }">
            <label for="username">登录账号 / 手机号</label>
            <el-input
              id="username"
              v-model="form.username"
              maxlength="64"
              autocomplete="username"
              inputmode="text"
              placeholder="请输入登录账号或手机号"
              :aria-invalid="Boolean(fieldErrors.username)"
              aria-describedby="username-error"
              autofocus
              @input="handleUsernameInput"
              @blur="validateUsernameField"
            />
            <p v-if="fieldErrors.username" id="username-error" class="login-field-error">
              {{ fieldErrors.username }}
            </p>
          </div>

          <div class="login-field" :class="{ 'has-error': fieldErrors.password }">
            <label for="password">密码</label>
            <el-input
              id="password"
              v-model="form.password"
              type="password"
              show-password
              maxlength="128"
              autocomplete="current-password"
              placeholder="请输入密码"
              :aria-invalid="Boolean(fieldErrors.password)"
              aria-describedby="password-help password-error"
              @input="handlePasswordInput"
              @blur="validatePasswordField"
              @keydown="updateCapsLock"
              @keyup="updateCapsLock"
            />
            <p v-if="fieldErrors.password" id="password-error" class="login-field-error">
              {{ fieldErrors.password }}
            </p>
            <p v-else-if="capsLockOn" id="password-help" class="login-caps-hint">大写锁定已开启</p>
          </div>

          <div class="login-options">
            <el-checkbox v-model="form.remember">记住登录账号</el-checkbox>
            <button class="login-recovery-link" type="button" @click="recoveryDialogVisible = true">
              忘记密码？
            </button>
          </div>

          <div v-if="errorMessage || isLocked" class="login-alert" role="alert" aria-live="polite">
            <strong>{{ isLocked ? '暂时无法登录' : '登录未成功' }}</strong>
            <span>{{ errorMessage }}</span>
            <span v-if="isLocked">请在 {{ lockCountdown }} 后重试。</span>
          </div>

          <el-button
            class="login-submit"
            native-type="submit"
            type="primary"
            :loading="loading"
            :disabled="isLocked"
          >
            {{ isLocked ? `请稍候 ${lockCountdown}` : loading ? '正在登录' : '登录' }}
          </el-button>
        </form>

        <footer class="login-footer">
          <span>首次登录请使用管理员提供的初始密码</span>
          <span>登录即表示你正在访问学校排课管理系统</span>
        </footer>
      </div>
    </section>

    <el-dialog
      v-model="recoveryDialogVisible"
      title="重置登录密码"
      width="420px"
      append-to-body
      class="login-recovery-dialog"
    >
      <p>为了保护学校数据，当前不支持通过公开页面自行找回密码。</p>
      <p>请联系本校系统管理员，在“账户管理”中为你的账号重置密码。</p>
      <template #footer>
        <el-button type="primary" @click="recoveryDialogVisible = false">我知道了</el-button>
      </template>
    </el-dialog>
  </main>
</template>
