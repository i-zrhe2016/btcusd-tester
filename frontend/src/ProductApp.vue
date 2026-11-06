<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { UserButton, useAuth, useClerk } from '@clerk/vue'
import { ArrowRight, ArrowUpRight, Check } from '@lucide/vue'
import { locale, t } from './i18n'
import { createCheckout, getPaymentStatus } from './api'
import BrandMark from './components/BrandMark.vue'
import LanguageSwitcher from './components/LanguageSwitcher.vue'
import PanePreview from './components/PanePreview.vue'
import ReplayPreview from './components/ReplayPreview.vue'
const Workspace = defineAsyncComponent(() => import('./App.vue'))
const clerk = useClerk()
const { isLoaded, isSignedIn, userId } = useAuth()
const heroLines = computed(() => {
  const title = t('product.heroTitle')
  const separator = title.includes('，') ? '，' : title.includes(',') ? ',' : ''
  if (!separator) return [title]
  const index = title.indexOf(separator)
  return [title.slice(0, index + 1), title.slice(index + 1).trim()]
})
const route = ref(window.location.hash)
const updateRoute = () => { route.value = window.location.hash }
window.addEventListener('hashchange', updateRoute)
onBeforeUnmount(() => window.removeEventListener('hashchange', updateRoute))
const inWorkspace = computed(() => route.value === '#workspace')
const canUseWorkspace = computed(() => isLoaded.value === true && isSignedIn.value === true)
const enterLibrary = ref(false)
function enterWorkspace() {
  enterLibrary.value = true
  if (route.value !== '#workspace') window.location.hash = '#workspace'
}
const workspaceInitialView = computed(() => (enterLibrary.value ? 'projects' : undefined))
const isPaymentReturn = window.location.pathname === '/payment-return'
const paymentOrder = new URLSearchParams(window.location.search).get('order') || ''
const workspaceUrl = window.location.origin + '/?auth=1#workspace'
const authPendingKey = 'grailab.auth.pending'
const paymentStatus = ref<'pending' | 'paid' | 'error'>('pending')
const checkingPayment = ref(false)
let paymentTimer: ReturnType<typeof setTimeout> | undefined
let paymentRedirectTimer: ReturnType<typeof setTimeout> | undefined
let paymentAttempts = 0
let paymentStopped = false
async function checkPayment() {
  if (checkingPayment.value || !isSignedIn.value) return
  if (!paymentOrder) { paymentStatus.value = 'error'; return }
  checkingPayment.value = true
  try {
    const result = await getPaymentStatus(paymentOrder)
    if (paymentStopped) return
    paymentStatus.value = result.status
    if (result.status === 'paid') {
      if (!paymentRedirectTimer) {
        paymentRedirectTimer = setTimeout(() => {
          if (!paymentStopped) window.location.assign(workspaceUrl)
        }, 1200)
      }
    } else if (result.status === 'pending' && ++paymentAttempts < 12) {
      paymentTimer = setTimeout(checkPayment, 5000)
    }
  } catch {
    if (!paymentStopped) paymentStatus.value = 'error'
  } finally {
    checkingPayment.value = false
  }
}
onMounted(() => {
  if (isPaymentReturn) watch([isLoaded, isSignedIn], ([loaded, signedIn]) => {
    if (loaded && signedIn) void checkPayment()
  }, { immediate: true })
})
onBeforeUnmount(() => {
  paymentStopped = true
  clearTimeout(paymentTimer)
  clearTimeout(paymentRedirectTimer)
})
function paymentSignIn() {
  clerk.value?.openSignIn({
    forceRedirectUrl: window.location.href,
    fallbackRedirectUrl: window.location.href,
    signUpForceRedirectUrl: window.location.href,
    signUpFallbackRedirectUrl: window.location.href,
    oauthFlow: 'redirect' as const,
  })
}
function retryPayment() {
  clearTimeout(paymentTimer)
  paymentAttempts = 0
  paymentStatus.value = 'pending'
  void checkPayment()
}
function openAuth(mode: 'login' | 'register') {
  if (isSignedIn.value) {
    enterWorkspace()
    return
  }
  sessionStorage.setItem(authPendingKey, '1')
  const options = {
    forceRedirectUrl: workspaceUrl,
    fallbackRedirectUrl: workspaceUrl,
    oauthFlow: 'redirect' as const,
  }
  if (mode === 'login') {
    clerk.value?.openSignIn({
      ...options,
      signUpForceRedirectUrl: workspaceUrl,
      signUpFallbackRedirectUrl: workspaceUrl,
    })
  } else {
    clerk.value?.openSignUp({
      ...options,
      signInForceRedirectUrl: workspaceUrl,
      signInFallbackRedirectUrl: workspaceUrl,
    })
  }
}
watch([isLoaded, isSignedIn], ([loaded, signedIn]) => {
  if (!loaded || !signedIn) return
  if (sessionStorage.getItem(authPendingKey) !== '1') return
  sessionStorage.removeItem(authPendingKey)
  const onHome = window.location.pathname === '/' || window.location.pathname === '/index.html'
  if (onHome && window.location.hash !== '#workspace') window.location.assign(workspaceUrl)
}, { immediate: true })
const checkoutLoading = ref(false)
const checkoutError = ref(false)
async function startCheckout() {
  if (!isSignedIn.value) {
    clerk.value?.openSignUp({ forceRedirectUrl: window.location.origin + '/#plans' })
    return
  }
  checkoutLoading.value = true
  checkoutError.value = false
  try {
    const { checkoutUrl } = await createCheckout()
    const url = new URL(checkoutUrl)
    if (url.protocol !== 'https:') throw new Error('Invalid checkout URL')
    window.location.assign(url.href)
  } catch {
    checkoutError.value = true
  } finally {
    checkoutLoading.value = false
  }
}
</script>

<template>
  <AuthBridge />
  <!-- The signed-in workspace keeps its switcher in the top bar; gate pages have no bar. -->
  <div v-if="isPaymentReturn || (inWorkspace && !canUseWorkspace)" style="position: fixed; top: 16px; right: 16px; z-index: 201"><LanguageSwitcher /></div>
  <div v-if="isPaymentReturn" class="gate">
    <main class="gate-card" aria-live="polite">
      <span class="gate-mark" aria-hidden="true"></span>
      <h1>{{ paymentStatus === 'paid' ? t('payment.success') : paymentStatus === 'error' ? t('payment.errorTitle') : t('payment.checking') }}</h1>
      <p>{{ !isLoaded ? t('workspace.gateLoading') : !isSignedIn ? t('payment.signIn') : paymentStatus === 'paid' ? t('payment.successBody') : paymentStatus === 'error' ? t('payment.error') : t('payment.pending') }}</p>
      <div class="gate-actions">
        <button v-if="isLoaded && !isSignedIn" class="btn btn-primary" @click="paymentSignIn">{{ t('product.login') }}</button>
        <button v-else-if="isSignedIn && paymentStatus !== 'paid'" class="btn btn-primary" :disabled="checkingPayment" @click="retryPayment">{{ t('payment.retry') }}</button>
        <a v-else-if="paymentStatus === 'paid'" class="btn btn-primary" href="/#workspace">{{ t('product.enterWorkspace') }}</a>
      </div>
      <a class="gate-back" href="/">{{ t('product.returnHome') }}</a>
    </main>
  </div>
  <template v-else-if="inWorkspace">
    <template v-if="canUseWorkspace">
    <Workspace :user-id="userId ?? undefined" :initial-view="workspaceInitialView">
      <template #topbar-end><UserButton /></template>
    </Workspace>
    </template>
    <div v-else class="gate">
      <section class="gate-card">
        <span class="gate-mark" aria-hidden="true"></span>
        <h1>{{ t('workspace.gateTitle') }}</h1>
        <p>{{ isLoaded ? t('workspace.gateBody') : t('workspace.gateLoading') }}</p>
        <div v-if="isLoaded" class="gate-actions">
          <button class="btn btn-ghost" @click="openAuth('login')">{{ t('product.login') }}</button>
          <button class="btn btn-primary" @click="openAuth('register')">{{ t('product.signup') }}</button>
        </div>
        <a class="gate-back" href="#">{{ t('product.returnHome') }}</a>
      </section>
    </div>
  </template>
  <div v-else class="landing">
    <header class="site-header">
      <div class="wrap header-inner">
        <a class="brand" href="#" :aria-label="t('product.homeLabel')">
          <BrandMark />grailab
        </a>
        <nav class="site-nav" :aria-label="t('product.navLabel')">
          <a href="#features">{{ t('product.navFeatures') }}</a>
          <a href="#guide">{{ t('product.navGuide') }}</a>
          <a href="#plans">{{ t('product.navPlans') }}</a>
          <a href="/blog">{{ locale === 'en' ? 'Articles' : '文章' }}</a>
        </nav>
        <div class="header-actions">
          <LanguageSwitcher />
          <button class="text-button" @click="openAuth('login')">{{ t('product.login') }}</button>
          <button class="btn btn-primary btn-sm" @click="openAuth('register')">{{ t('product.signup') }}</button>
        </div>
      </div>
    </header>

    <main id="main-content">
      <section class="wrap hero">
        <div class="hero-head">
          <h1 class="hero-title" :class="{ 'is-en': locale === 'en' }">
            <span v-for="line in heroLines" :key="line">{{ line }}</span>
          </h1>
          <div class="hero-rail">
            <p class="hero-lead">{{ t('product.heroLead') }}</p>
            <div class="hero-actions">
              <a class="btn btn-primary" href="#workspace" @click.prevent="enterWorkspace">{{ t('product.start') }} <ArrowRight :size="18" :stroke-width="1.9" /></a>
              <a class="text-link" href="#features">{{ t('product.learn') }} <ArrowUpRight :size="15" :stroke-width="1.9" /></a>
            </div>
            <p class="hero-markets">{{ t('product.markets') }}</p>
          </div>
        </div>

        <div class="preview-head">
          <h2>{{ t('product.previewLabel') }}</h2>
          <p class="preview-note">{{ t('product.demoNote') }}</p>
        </div>
        <ReplayPreview />
        <ul class="capabilities" :aria-label="t('product.featuresLabel')">
          <li>{{ t('product.capabilityTimeframes') }}</li>
          <li>{{ t('product.capabilitySpeed') }}</li>
          <li>{{ t('product.capabilityPanes') }}</li>
          <li>{{ t('product.capabilityTrades') }}</li>
          <li>{{ t('product.capabilityTools') }}</li>
        </ul>
        <div class="hero-after">
          <a class="text-link" href="#features">{{ t('product.learn') }} <ArrowUpRight :size="15" :stroke-width="1.9" /></a>
          <p class="hero-markets">{{ t('product.markets') }}</p>
        </div>
      </section>

      <section id="features" class="section features">
        <div class="wrap">
          <div class="section-head">
            <h2 class="section-title">{{ t('product.featuresTitle') }}</h2>
            <p class="section-lead">{{ t('product.featuresLead') }}</p>
          </div>
          <div class="feature-grid">
            <div>
              <figure class="pane-figure">
                <PanePreview />
              </figure>
              <p class="pane-caption">
                <span>{{ t('product.featurePanelCaption') }}</span>
                <span>{{ t('product.demoNote') }}</span>
              </p>
            </div>
            <div class="feature-list">
              <article class="feature-item">
                <span class="feature-tick" aria-hidden="true"></span>
                <div>
                  <h3>{{ t('product.featurePanelTitle') }}</h3>
                  <p>{{ t('product.featurePanelBody') }}</p>
                </div>
              </article>
              <article class="feature-item">
                <span class="feature-tick" aria-hidden="true"></span>
                <div>
                  <h3>{{ t('product.featureMarketsTitle') }}</h3>
                  <p>{{ t('product.featureMarketsBody') }}</p>
                </div>
              </article>
              <article class="feature-item">
                <span class="feature-tick" aria-hidden="true"></span>
                <div>
                  <h3>{{ t('product.featureReplayTitle') }}</h3>
                  <p>{{ t('product.featureReplayBody') }}</p>
                </div>
              </article>
              <article class="feature-item">
                <span class="feature-tick" aria-hidden="true"></span>
                <div>
                  <h3>{{ t('product.featureReviewTitle') }}</h3>
                  <p>{{ t('product.featureReviewBody') }}</p>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section id="guide" class="section guide">
        <div class="wrap">
          <div class="guide-head">
            <div>
              <h2 class="section-title">{{ t('product.guideTitle') }}</h2>
              <p class="section-lead">{{ t('product.guideLead') }}</p>
            </div>
            <a class="text-link" href="#workspace" @click.prevent="enterWorkspace">{{ t('product.enterWorkspace') }} <ArrowRight :size="16" :stroke-width="1.9" /></a>
          </div>
          <ol class="steps">
            <li>
              <span class="step-num">01</span>
              <h3>{{ t('product.step1Title') }}</h3>
              <p>{{ t('product.step1Body') }}</p>
            </li>
            <li>
              <span class="step-num">02</span>
              <h3>{{ t('product.step2Title') }}</h3>
              <p>{{ t('product.step2Body') }}</p>
            </li>
            <li>
              <span class="step-num">03</span>
              <h3>{{ t('product.step3Title') }}</h3>
              <p>{{ t('product.step3Body') }}</p>
            </li>
          </ol>
        </div>
      </section>

      <section class="statement">
        <div class="wrap statement-inner">
          <h2>
            <span>{{ t('product.statementTitle') }}</span>
            <span>{{ t('product.statementSecond') }}</span>
          </h2>
          <p>{{ t('product.tradersBody') }}</p>
        </div>
      </section>

      <section id="plans" class="section wrap plans">
        <div class="plans-copy">
          <h2>{{ t('product.plansTitle') }}</h2>
          <p>{{ t('product.plansLead') }}</p>
        </div>
        <div class="plan-card">
          <h3>{{ t('product.planTitle') }}</h3>
          <div class="plan-price">
            <strong>US$12.99</strong>
            <span>{{ t('product.perMonth') }}</span>
          </div>
          <ul class="plan-list">
            <li><Check :size="16" :stroke-width="2" />{{ t('product.planFeature1') }}</li>
            <li><Check :size="16" :stroke-width="2" />{{ t('product.planFeature2') }}</li>
            <li><Check :size="16" :stroke-width="2" />{{ t('product.planFeature3') }}</li>
            <li><Check :size="16" :stroke-width="2" />{{ t('product.planFeature4') }}</li>
          </ul>
          <button class="btn btn-primary" :disabled="checkoutLoading || !isLoaded" @click="startCheckout">
            {{ checkoutLoading ? t('product.checkoutLoading') : t('product.checkout') }} <ArrowRight :size="17" :stroke-width="1.9" />
          </button>
          <small class="plan-note">{{ t('product.planNote') }}</small>
          <p v-if="checkoutError" role="alert" class="plan-error">{{ t('product.checkoutError') }}</p>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="wrap footer-inner">
        <a class="brand" href="#" :aria-label="t('product.homeLabel')">
          <BrandMark />grailab
        </a>
        <div class="footer-links">
          <a href="#features">{{ t('product.navFeatures') }}</a>
          <a href="#plans">{{ t('product.navPlans') }}</a>
          <a href="/blog">{{ locale === 'en' ? 'Articles' : '文章' }}</a>
          <a href="#workspace" @click.prevent="enterWorkspace">{{ t('product.enterWorkspace') }}</a>
        </div>
        <p class="footer-note">{{ t('product.footerDisclaimer') }}</p>
      </div>
    </footer>
  </div>
</template>
