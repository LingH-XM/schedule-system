<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import loginCampusImage from '../assets/login-campus-modern-v2.webp'
import { confirmPasswordReset, requestPasswordReset } from '../services/auth'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const submitted = ref(false)
const completed = ref(false)
const errorMessage = ref('')

const form = reactive({
  identifier: typeof route.query.identifier === 'string' ? route.query.identifier.trim() : '',
  password: '',
  confirmPassword: ''
})

const token = computed(() => typeof route.query.token === 'string' ? route.query.token.trim() : '')
const isConfirmMode = computed(() => Boolean(token.value))
const pageTitle = computed(() => isConfirmMode.value ? '设置新密码' : '找回登录密码')
const pageDescription = computed(() =>
  isConfirmMode.value
    ? '请设置一个新的登录密码，完成后即可返回系统。'
    : '输入账号、手机号或绑定邮箱，我们会将重置链接发送到绑定邮箱。'
)

function clearError(): void {
  errorMessage.value = ''
}

async function submitRequest(): Promise<void> {
  const identifier = form.identifier.trim()
  clearError()
  if (!identifier) {
    errorMessage.value = '请输入登录账号、手机号或绑定邮箱'
    return
  }
  if (identifier.length > 254) {
    errorMessage.value = '账号信息不能超过 254 个字符'
    return
  }

  loading.value = true
  const result = await requestPasswordReset(identifier)
  loading.value = false
  if (!result.ok) {
    errorMessage.value = '暂时无法连接邮件服务，请稍后重试'
    return
  }
  if (result.mailConfigured === false) {
    errorMessage.value = '邮件服务尚未完成配置，请联系管理员重置密码'
    return
  }
  submitted.value = true
}

async function submitNewPassword(): Promise<void> {
  clearError()
  if (form.password.length < 8 || form.password.length > 128) {
    errorMessage.value = '请设置 8–128 位新密码'
    return
  }
  if (form.password !== form.confirmPassword) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  const result = await confirmPasswordReset(token.value, form.password)
  loading.value = false
  if (!result.ok) {
    errorMessage.value = result.reason === 'INVALID_TOKEN'
      ? '重置链接无效、已过期或已经使用，请重新申请'
      : result.reason === 'INVALID_PASSWORD'
        ? '新密码不符合要求，请设置 8–128 位密码'
        : '密码重置服务暂时不可用，请稍后重试'
    return
  }
  completed.value = true
}

function submitForm(): void {
  if (loading.value) return
  if (isConfirmMode.value) void submitNewPassword()
  else void submitRequest()
}

function returnToLogin(): void {
  void router.replace({ name: 'login' })
}

function requestAgain(): void {
  void router.replace({ name: 'passwordReset' })
}
</script>

<template>
  <main class="login-page password-reset-page">
    <section
      class="login-visual password-reset-visual"
      :style="{ backgroundImage: `url(${loginCampusImage})` }"
      aria-label="现代校园与课表秩序插画"
    >
      <div class="login-brand">
        <span class="login-brand-mark" aria-hidden="true">
          <i></i><i></i><i></i><i></i>
        </span>
        <span>排课系统</span>
      </div>
      <div class="login-visual-copy">
        <h1>安全找回账号，<br />继续清晰地安排每一天。</h1>
        <p>重置链接仅在 30 分钟内有效，并且只能使用一次。</p>
      </div>
      <p class="login-visual-caption">账户安全由你掌握</p>
    </section>

    <section class="login-panel">
      <div class="login-panel-inner password-reset-panel">
        <div class="login-mobile-brand">
          <span class="login-brand-mark" aria-hidden="true">
            <i></i><i></i><i></i><i></i>
          </span>
          <span>排课系统</span>
        </div>

        <el-button class="password-reset-back" link type="info" @click="returnToLogin">
          <span aria-hidden="true">←</span>
          返回登录
        </el-button>

        <template v-if="submitted || completed">
          <section class="password-reset-result" aria-live="polite">
            <span class="password-reset-result-mark" aria-hidden="true">✓</span>
            <h2>{{ completed ? '密码已重置' : '请检查邮箱' }}</h2>
            <p v-if="completed">新密码已经生效，现在可以返回登录页面进入系统。</p>
            <p v-else>
              如果账户已绑定邮箱，重置链接将发送到对应邮箱，请在 30 分钟内完成操作。
            </p>
            <el-button class="login-submit" type="primary" @click="returnToLogin">
              返回登录
            </el-button>
          </section>
        </template>

        <template v-else>
          <header class="login-heading">
            <h2>{{ pageTitle }}</h2>
            <p>{{ pageDescription }}</p>
          </header>

          <form class="login-form password-reset-form" novalidate @submit.prevent="submitForm">
            <template v-if="isConfirmMode">
              <div class="login-field">
                <label for="reset-password">新密码</label>
                <el-input
                  id="reset-password"
                  v-model="form.password"
                  type="password"
                  show-password
                  maxlength="128"
                  autocomplete="new-password"
                  placeholder="请输入 8–128 位新密码"
                  autofocus
                  @input="clearError"
                />
              </div>
              <div class="login-field">
                <label for="reset-password-confirm">确认新密码</label>
                <el-input
                  id="reset-password-confirm"
                  v-model="form.confirmPassword"
                  type="password"
                  show-password
                  maxlength="128"
                  autocomplete="new-password"
                  placeholder="请再次输入新密码"
                  @input="clearError"
                />
              </div>
            </template>
            <div v-else class="login-field">
              <label for="reset-identifier">账号信息</label>
              <el-input
                id="reset-identifier"
                v-model="form.identifier"
                maxlength="254"
                autocomplete="username"
                placeholder="登录账号、手机号或绑定邮箱"
                autofocus
                @input="clearError"
              />
            </div>

            <div v-if="errorMessage" class="login-alert" role="alert" aria-live="polite">
              <strong>未能完成操作</strong>
              <span>{{ errorMessage }}</span>
              <button
                v-if="isConfirmMode && errorMessage.includes('重置链接')"
                class="password-reset-inline-action"
                type="button"
                @click="requestAgain"
              >
                重新申请重置邮件
              </button>
            </div>

            <el-button
              class="login-submit"
              native-type="submit"
              type="primary"
              :loading="loading"
            >
              {{ isConfirmMode ? '确认重置密码' : '发送重置邮件' }}
            </el-button>
          </form>

          <p v-if="!isConfirmMode" class="password-reset-security-note">
            为保护账户安全，无论账号是否存在，系统都会显示相同的发送结果。
          </p>
        </template>
      </div>
    </section>
  </main>
</template>
