<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuth, useClerk, useUser } from '@clerk/vue'

const clerk = useClerk()
const { isLoaded, isSignedIn, getToken } = useAuth()
const { user } = useUser()
const googleLinked = computed(() => user.value?.externalAccounts.some(account => account.provider === 'google') ?? false)
const apiStatus = ref<'idle' | 'checking' | 'ok' | 'failed'>('idle')

function signIn() {
  clerk.value?.openSignIn({ forceRedirectUrl: `${window.location.origin}/auth/verify` })
}

async function checkApi() {
  apiStatus.value = 'checking'
  try {
    const token = await getToken.value()
    if (!token) throw new Error('No session token')
    const response = await fetch('/api/configs', { headers: { Authorization: `Bearer ${token}` } })
    apiStatus.value = response.ok ? 'ok' : 'failed'
  } catch {
    apiStatus.value = 'failed'
  }
}

watch(isSignedIn, signedIn => {
  if (signedIn) void checkApi()
  else apiStatus.value = 'idle'
}, { immediate: true })
</script>

<template>
  <main class="verification">
    <section class="card">
      <h1>登录状态检查</h1>
      <p v-if="!isLoaded">正在加载登录状态…</p>
      <template v-else-if="!isSignedIn">
        <p>请先登录，然后查看账号和服务验证结果。</p>
        <button type="button" @click="signIn">登录</button>
      </template>
      <template v-else>
        <p>Clerk 会话：已登录</p>
        <p>Google 账号：{{ googleLinked ? '已关联' : '未关联' }}</p>
        <p>后端验证：{{ apiStatus === 'ok' ? '通过' : apiStatus === 'failed' ? '失败' : '正在检查…' }}</p>
        <p class="note">账号关联状态不表示本次一定使用 Google 登录。</p>
        <button type="button" @click="checkApi">重新检查</button>
      </template>
      <p><a href="/">返回首页</a></p>
    </section>
  </main>
</template>

<style scoped>
.verification { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f7f7f7; font-family: Arial, 'Microsoft YaHei', sans-serif; }
.card { width: min(100%, 480px); padding: 32px; background: white; border: 1px solid #ddd; border-radius: 12px; }
h1 { margin: 0 0 24px; font-size: 24px; }
p { line-height: 1.6; }
.note { color: #666; font-size: 14px; }
button { padding: 10px 18px; background: #111; color: white; border: 1px solid #111; border-radius: 6px; cursor: pointer; }
a { color: #111; }
</style>
