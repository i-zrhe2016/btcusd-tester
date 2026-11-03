<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import { ArrowRight, Play, Zap, ChartNoAxesColumnIncreasing, X, Check, ArrowUpRight } from '@lucide/vue'
const Workspace = defineAsyncComponent(() => import('./App.vue'))
const route = ref(window.location.hash)
const updateRoute = () => { route.value = window.location.hash }
window.addEventListener('hashchange', updateRoute)
onBeforeUnmount(() => window.removeEventListener('hashchange', updateRoute))
const inWorkspace = computed(() => route.value === '#workspace')
const mode = ref<'login' | 'register' | null>(null)
const email = ref('')
const password = ref('')
const confirmation = ref('')
const accepted = ref(false)
const pending = ref(false)
const message = ref('')
let authTrigger: HTMLElement | null = null
async function openAuth(next: 'login' | 'register') {
  if (!mode.value) authTrigger = document.activeElement as HTMLElement | null
  mode.value = next
  message.value = ''
  password.value = ''
  confirmation.value = ''
  accepted.value = false
  document.body.style.overflow = 'hidden'
  await nextTick()
  document.getElementById('auth-email')?.focus()
}
function closeAuth() {
  if (pending.value) return
  mode.value = null
  document.body.style.overflow = ''
  authTrigger?.focus()
}
function trapFocus(event: KeyboardEvent) {
  const elements = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]'))
  const first = elements[0]
  const last = elements.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
async function submitAuth() {
  message.value = ''
  if (mode.value === 'register' && password.value !== confirmation.value) { message.value = '两次输入的密码不一致，请重新输入。'; return }
  pending.value = true
  try {
    const response = await fetch(`/api/auth/${mode.value}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value, password: password.value }) })
    if (!response.headers.get('content-type')?.includes('application/json') || response.status === 404 || response.status === 503) throw new Error('账户服务尚未开放，请稍后再试。你仍可直接进入训练工作台。')
    if (!response.ok) { message.value = response.status === 401 ? '邮箱或密码不正确，请重试。' : response.status === 409 ? '该邮箱已注册，请直接登录。' : '暂时无法完成请求，请稍后重试。'; return }
    pending.value = false
    closeAuth()
    window.location.hash = 'workspace'
  } catch (error) { message.value = error instanceof Error && error.message.includes('账户服务') ? error.message : '连接账户服务失败，请检查网络后重试。' }
  finally { pending.value = false }
}
</script>

<template>
  <template v-if="inWorkspace">
    <a class="product-return" href="#">← 返回产品首页</a>
    <Workspace />
  </template>
  <div v-else class="product-page">
    <header class="product-header">
      <a class="product-brand" href="#" aria-label="BTCUSD Tester 首页"><span class="product-mark"></span>BTCUSD Tester</a>
      <nav class="product-nav" aria-label="主导航">
        <a href="#features">功能</a><a href="#guide">使用指南</a><a href="#plans">产品方案 <ArrowUpRight :size="17" /></a>
      </nav>
      <div class="product-account"><button class="product-login" @click="openAuth('login')">登录</button><button class="product-button compact" @click="openAuth('register')">注册账户</button></div>
    </header>
    <main id="main-content">
      <section class="product-hero">
        <h1>BTCUSD 历史行情回放与交易训练</h1>
        <p>回放真实历史行情，进行模拟交易，复盘交易表现，提升交易能力。</p>
        <div class="product-actions"><a class="product-button" href="#workspace">开始练习 <ArrowRight :size="25" /></a><a class="product-button secondary" href="#plans">了解产品方案 <ArrowUpRight :size="23" /></a></div>
        <span class="product-hero-note">用历史检验判断，让每一次练习都有收获。</span>
      </section>
      <section id="features" class="product-features" aria-label="产品功能">
        <article><Play :size="33" :stroke-width="1.8" /><h2>历史回放</h2><p>重现 BTCUSD 真实行情。<br />按自己的节奏，练习每一次判断。</p></article>
        <article><Zap :size="34" :stroke-width="1.8" /><h2>模拟交易</h2><p>基于历史数据进行下单练习。<br />在模拟环境中，打磨交易方法。</p></article>
        <article><ChartNoAxesColumnIncreasing :size="34" :stroke-width="1.8" /><h2>交易复盘</h2><p>查看交易记录与收益表现。<br />回顾决策过程，找到改进方向。</p></article>
      </section>
      <section id="guide" class="product-guide">
        <div><span class="product-section-label">使用指南</span><h2>把一次行情，变成一次进步。</h2><p>从选择历史区间开始，建立属于自己的训练节奏。</p><a class="product-inline-link" href="#workspace">进入训练工作台 <ArrowRight :size="19" /></a></div>
        <ol><li><span>1</span><div><h3>选择一段历史行情</h3><p>创建训练项目，选择时间范围与 K 线周期。</p></div></li><li><span>2</span><div><h3>回放行情，模拟下单</h3><p>控制播放节奏，在行情推进中练习交易决策。</p></div></li><li><span>3</span><div><h3>回顾记录，调整方法</h3><p>结合交易记录与收益表现，复盘自己的判断。</p></div></li></ol>
      </section>
      <section id="plans" class="product-plans">
        <div><span class="product-section-label">产品方案</span><h2>为认真练习交易的人而做。</h2><p>一处完成行情回放、模拟交易与交易复盘。</p></div>
        <div class="product-plan"><h3>月付订阅</h3><p>你的专属交易训练工作台</p><div class="product-plan-price"><strong>US$12.99</strong><span>/ 月</span></div><p>每月 12.99 美元</p><ul><li><Check :size="18" />历史行情回放与速度控制</li><li><Check :size="18" />多周期观察与模拟交易</li><li><Check :size="18" />训练项目管理与交易记录</li></ul><button class="product-button" @click="openAuth('register')">注册账户 <ArrowRight :size="21" /></button><small>订阅支付尚未开放，注册不会产生扣费。</small></div>
      </section>
    </main>
    <footer class="product-footer"><a class="product-brand" href="#"><span class="product-mark"></span>BTCUSD Tester</a><span>专注训练，沉淀判断。</span><p>仅用于模拟交易训练，不构成投资建议。</p></footer>
    <div v-if="mode" class="product-modal-backdrop" @click.self="closeAuth" @keydown.esc="closeAuth">
      <section class="product-auth" role="dialog" aria-modal="true" aria-labelledby="auth-title" @keydown.tab="trapFocus">
        <button class="product-auth-close" aria-label="关闭" :disabled="pending" @click="closeAuth"><X :size="22" /></button>
        <span class="product-mark"></span><h2 id="auth-title">{{ mode === 'login' ? '欢迎回来' : '开始你的交易训练' }}</h2><p>{{ mode === 'login' ? '登录 BTCUSD Tester，继续你的练习。' : '注册 BTCUSD Tester，建立自己的训练节奏。' }}</p>
        <form @submit.prevent="submitAuth">
          <label for="auth-email">邮箱地址</label><input id="auth-email" v-model="email" type="email" autocomplete="email" placeholder="you@example.com" required :disabled="pending" autofocus />
          <label for="auth-password">密码</label><input id="auth-password" v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :minlength="mode === 'register' ? 8 : 1" maxlength="128" :placeholder="mode === 'register' ? '至少 8 位字符' : '输入你的密码'" required :disabled="pending" />
          <template v-if="mode === 'register'"><label for="auth-confirm">确认密码</label><input id="auth-confirm" v-model="confirmation" type="password" autocomplete="new-password" placeholder="再次输入密码" required :disabled="pending" /><label class="product-consent"><input v-model="accepted" type="checkbox" required :disabled="pending" />我了解本产品用于模拟训练，不提供投资建议。</label></template>
          <p v-if="message" class="product-auth-error" role="alert">{{ message }}</p>
          <button class="product-button" type="submit" :disabled="pending">{{ pending ? '正在处理…' : mode === 'login' ? '登录' : '创建账户' }}<ArrowRight v-if="!pending" :size="20" /></button>
        </form>
        <div class="product-auth-switch">{{ mode === 'login' ? '还没有账户？' : '已有账户？' }} <button :disabled="pending" @click="openAuth(mode === 'login' ? 'register' : 'login')">{{ mode === 'login' ? '立即注册' : '去登录' }}</button></div>
      </section>
    </div>
  </div>
</template>
