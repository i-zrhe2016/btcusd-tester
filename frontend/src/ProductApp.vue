<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref } from 'vue'
import { UserButton, useAuth, useClerk } from '@clerk/vue'
import { ArrowRight, Play, Zap, ChartNoAxesColumnIncreasing, Check, ArrowUpRight } from '@lucide/vue'
import { locale, t, toggleLocale } from './i18n'
// Literal utility strings remain visible to Tailwind's source scanner.
const productButtonClass = 'inline-flex justify-center items-center gap-[23px] font-semibold leading-[1.3] cursor-pointer transition-colors duration-150'
const Workspace = defineAsyncComponent(() => import('./App.vue'))
const clerk = useClerk()
const { isLoaded, isSignedIn } = useAuth()
const route = ref(window.location.hash)
const updateRoute = () => { route.value = window.location.hash }
window.addEventListener('hashchange', updateRoute)
onBeforeUnmount(() => window.removeEventListener('hashchange', updateRoute))
const inWorkspace = computed(() => route.value === '#workspace')
const canUseWorkspace = computed(() => isLoaded.value === true && isSignedIn.value === true)
// Only email sign-in and sign-up are supported for now, so keep the social
// buttons and the "or" divider out of the Clerk modal.
const emailOnlyAppearance = {
  elements: {
    socialButtons: { display: 'none' },
    socialButtonsBlockButton: { display: 'none' },
    dividerRow: { display: 'none' },
    dividerText: { display: 'none' },
  },
}
function openAuth(mode: 'login' | 'register') {
  const options = {
    forceRedirectUrl: window.location.origin + '/?auth=1#workspace',
    appearance: emailOnlyAppearance,
  }
  if (mode === 'login') clerk.value?.openSignIn(options)
  else clerk.value?.openSignUp(options)
}
function featureLines(key: 'product.featureReplayBody' | 'product.featureTradeBody' | 'product.featureReviewBody'): [string, string] {
  const [first, second = ''] = t(key).split('|')
  return [first, second]
}
</script>

<template>
  <AuthBridge />
  <template v-if="inWorkspace">
    <template v-if="canUseWorkspace">
    <a class="product-return fixed bottom-[15px] left-[18px] z-[100] bg-white text-[color:#111] [border:1px_solid_#ddd] rounded-[6px] [padding:8px_12px] text-[length:12px] no-underline" href="#">{{ t('product.returnHome') }}
    </a>
    <div class="fixed top-4 right-4 z-[200]"><UserButton /></div>
    <Workspace />
    </template>
    <div v-else class="gate fixed inset-0 bg-white flex items-center justify-center [padding:24px] [font-family:Arial,'Microsoft_YaHei','PingFang_SC',sans-serif]">
      <section class="gate-card text-center w-[420px] max-w-full">
        <span class="product-mark inline-block w-[31px] h-[30px] bg-black [clip-path:polygon(50%_0,100%_100%,0_100%)]"></span>
        <h1 class="text-[length:26px] font-[750] tracking-[-.6px] [margin:22px_0_10px]">{{ t('workspace.gateTitle') }}</h1>
        <p class="text-[color:#777] text-[length:14px] leading-[1.8] [margin:0_0_26px]">{{ isLoaded ? t('workspace.gateBody') : t('workspace.gateLoading') }}</p>
        <div v-if="isLoaded" class="flex justify-center gap-[12px]">
          <button class="gate-button gate-button-secondary bg-white text-[color:#111] [border:1px_solid_#111] rounded-[8px] [padding:12px_26px] text-[length:15px] min-h-[46px] cursor-pointer [font-family:inherit]" @click="openAuth('login')">{{ t('product.login') }}</button>
          <button class="gate-button bg-black text-[color:#fff] [border:1px_solid_#000] rounded-[8px] [padding:12px_26px] text-[length:15px] min-h-[46px] cursor-pointer [font-family:inherit]" @click="openAuth('register')">{{ t('product.signup') }}</button>
        </div>
        <div class="flex items-center justify-center gap-[18px] mt-[24px]">
          <a class="text-[length:13px] text-[color:#777]" href="#">{{ t('product.returnHome') }}</a>
          <button class="text-[length:13px] text-[color:#111] underline underline-offset-4 [border:0] bg-transparent cursor-pointer [padding:4px] [font-family:inherit]" type="button" data-testid="locale-toggle" :aria-label="t('product.languageSwitch')" @click="toggleLocale">{{ locale === 'zh' ? 'English' : '中文' }}</button>
        </div>
      </section>
    </div>
  </template>
  <div v-else class="product-page box-border [&_*]:box-border bg-white text-[color:#080808] min-h-[100vh] [font-family:Arial,'Microsoft_YaHei','PingFang_SC',sans-serif] [-webkit-font-smoothing:antialiased] [&_:focus-visible]:[outline:2px_solid_#111] [&_:focus-visible]:outline-offset-[5px] motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:transition-none">
    <header class="product-header max-w-[1440px] m-auto [padding:28px_48px] flex items-center gap-[45px] [@media(max-width:1000px)]:[padding:24px] [@media(max-width:1000px)]:gap-[25px] [@media(max-width:700px)]:[padding:21px_20px] [@media(max-width:700px)]:flex-wrap [@media(max-width:700px)]:gap-[24px_10px]">
      <a class="product-brand inline-flex items-center gap-[17px] text-[length:27px] font-[750] whitespace-nowrap tracking-[-.8px] [@media(max-width:1000px)]:text-[length:22px] [@media(max-width:700px)]:text-[length:20px] [@media(max-width:700px)]:gap-[10px] text-inherit no-underline" href="#" :aria-label="t('product.homeLabel')">
        <span class="product-mark inline-block w-[31px] h-[30px] bg-black [clip-path:polygon(50%_0,100%_100%,0_100%)] shrink-0 [@media(max-width:700px)]:w-[24px] [@media(max-width:700px)]:h-[23px]"></span>grailab
      </a>
      <nav class="product-nav ml-auto flex gap-[39px] items-center text-[length:17px] [@media(max-width:1000px)]:gap-[20px] [@media(max-width:1000px)]:text-[length:14px] [@media(max-width:700px)]:[order:3] [@media(max-width:700px)]:w-full [@media(max-width:700px)]:justify-center [@media(max-width:700px)]:gap-[37px]" :aria-label="t('product.navLabel')">
        <a class="text-inherit no-underline flex items-center gap-[9px]" href="#features">{{ t('product.navFeatures') }}
        </a>
        <a class="text-inherit no-underline flex items-center gap-[9px]" href="#guide">{{ t('product.navGuide') }}
        </a>
        <a class="text-inherit no-underline flex items-center gap-[9px]" href="#plans">{{ t('product.navPlans') }} <ArrowUpRight :size="17" />
        </a>
      </nav>
      <div class="product-account flex items-center gap-[24px] [@media(max-width:1000px)]:gap-[17px] [@media(max-width:700px)]:ml-auto [@media(max-width:700px)]:gap-[15px]">
        <button class="product-lang [border:0] bg-transparent text-[color:#080808] [padding:10px_0] cursor-pointer text-[length:17px] [@media(max-width:700px)]:text-[length:14px] [font-family:inherit]" type="button" data-testid="locale-toggle" :aria-label="t('product.languageSwitch')" @click="toggleLocale">{{ locale === 'zh' ? 'EN' : '中文' }}</button>
        <button class="product-login [border:0] bg-transparent text-[color:#080808] [padding:10px_0] cursor-pointer text-[length:17px] [@media(max-width:700px)]:text-[length:14px] disabled:opacity-[.5] disabled:cursor-wait [font-family:inherit]" @click="openAuth('login')">{{ t('product.login') }}
        </button>
        <button class="product-button compact disabled:opacity-[.5] disabled:cursor-wait bg-black text-[color:#fff] [border:1px_solid_#000] rounded-[8px] [padding:13px_23px] text-[length:16px] min-h-[46px] hover:bg-[#292929] [@media(max-width:700px)]:[padding:10px_13px] [@media(max-width:700px)]:text-[length:13px] [@media(max-width:700px)]:min-h-[38px] [font-family:inherit]" :class="productButtonClass" @click="openAuth('register')">{{ t('product.signup') }}
        </button>
      </div>
    </header>
    <main id="main-content">
      <section class="product-hero text-center [padding:133px_24px_0] [@media(min-width:1600px)]:pt-[145px] [@media(max-width:1000px)]:pt-[100px] [@media(max-width:700px)]:[padding:73px_22px_0]">
        <h1 class="text-[length:clamp(30px,4.1vw,61px)] leading-[1.3] tracking-[-2px] m-0 font-[750] [@media(max-width:700px)]:text-[length:34px] [@media(max-width:700px)]:tracking-[-1.3px] [@media(max-width:700px)]:leading-[1.55] [@media(max-width:700px)]:max-w-[500px] [@media(max-width:700px)]:m-auto">{{ t('product.heroTitle') }}</h1>
        <p class="text-[color:#626262] text-[length:clamp(17px,1.9vw,26px)] leading-[1.8] [margin:24px_auto_0] max-w-[1000px] [@media(max-width:700px)]:text-[length:16px] [@media(max-width:700px)]:max-w-[350px] [@media(max-width:700px)]:mt-[19px]">{{ t('product.heroLead') }}</p>
        <p class="product-markets text-[color:#111] text-[length:18px] font-semibold leading-[1.8] [margin:18px_auto_0] [@media(max-width:700px)]:text-[length:16px]">{{ t('product.markets') }}</p>
        <div class="product-actions flex justify-center gap-[30px] mt-[43px] [@media(max-width:700px)]:gap-[13px] [@media(max-width:700px)]:mt-[30px]">
          <a class="product-button text-[color:#fff] no-underline bg-black [border:1px_solid_#000] rounded-[9px] [padding:19px_34px] text-[length:20px] min-h-[62px] hover:bg-[#292929] [@media(max-width:700px)]:text-[length:15px] [@media(max-width:700px)]:[padding:15px_19px] [@media(max-width:700px)]:min-h-[51px] [@media(max-width:700px)]:gap-[12px]" :class="productButtonClass" href="#workspace">{{ t('product.start') }} <ArrowRight :size="25" />
          </a>
          <a class="product-button secondary text-[color:#080808] no-underline bg-white [border:1px_solid_#111] rounded-[9px] [padding:19px_34px] text-[length:20px] min-h-[62px] hover:bg-[#f5f5f5] [@media(max-width:700px)]:text-[length:15px] [@media(max-width:700px)]:[padding:15px_19px] [@media(max-width:700px)]:min-h-[51px] [@media(max-width:700px)]:gap-[12px]" :class="productButtonClass" href="#plans">{{ t('product.learn') }} <ArrowUpRight :size="23" />
          </a>
        </div>
        <span class="product-hero-note block text-[color:#929292] text-[length:13px] mt-[21px] [@media(max-width:700px)]:text-[length:11px] [@media(max-width:700px)]:mt-[19px]">{{ t('product.heroNote') }}</span>
      </section>
      <section id="features" class="product-features max-w-[1210px] [padding:0_42px_102px] [margin:112px_auto_0] grid grid-cols-[repeat(3,1fr)] gap-[70px] [@media(min-width:1600px)]:mt-[130px] [@media(min-width:1600px)]:pb-[120px] [@media(max-width:1000px)]:gap-[35px] [@media(max-width:1000px)]:pl-[30px] [@media(max-width:1000px)]:pr-[30px] [@media(max-width:700px)]:grid-cols-[1fr] [@media(max-width:700px)]:mt-[68px] [@media(max-width:700px)]:[padding:0_30px_60px] [@media(max-width:700px)]:gap-[32px]" :aria-label="t('product.featuresLabel')">
        <article class="[@media(max-width:700px)]:relative [@media(max-width:700px)]:pl-[58px]">
          <Play class="mb-[19px] [@media(max-width:700px)]:absolute [@media(max-width:700px)]:left-0 [@media(max-width:700px)]:top-[4px] [@media(max-width:700px)]:w-[27px]" :size="33" :stroke-width="1.8" />
          <h2 class="text-[length:27px] tracking-[-.5px] [margin:0_0_13px] [@media(max-width:1000px)]:text-[length:23px] [@media(max-width:700px)]:text-[length:22px] [@media(max-width:700px)]:mb-[7px] font-bold">{{ t('product.featureReplayTitle') }}</h2>
          <p class="text-[length:17px] text-[color:#696969] leading-[1.9] m-0 [@media(max-width:1000px)]:text-[length:15px] [@media(max-width:700px)]:text-[length:15px]">{{ featureLines('product.featureReplayBody')[0] }}<br class="[@media(max-width:700px)]:hidden" />{{ featureLines('product.featureReplayBody')[1] }}</p>
        </article>
        <article class="[@media(max-width:700px)]:relative [@media(max-width:700px)]:pl-[58px]">
          <Zap class="mb-[19px] [@media(max-width:700px)]:absolute [@media(max-width:700px)]:left-0 [@media(max-width:700px)]:top-[4px] [@media(max-width:700px)]:w-[27px]" :size="34" :stroke-width="1.8" />
          <h2 class="text-[length:27px] tracking-[-.5px] [margin:0_0_13px] [@media(max-width:1000px)]:text-[length:23px] [@media(max-width:700px)]:text-[length:22px] [@media(max-width:700px)]:mb-[7px] font-bold">{{ t('product.featureTradeTitle') }}</h2>
          <p class="text-[length:17px] text-[color:#696969] leading-[1.9] m-0 [@media(max-width:1000px)]:text-[length:15px] [@media(max-width:700px)]:text-[length:15px]">{{ featureLines('product.featureTradeBody')[0] }}<br class="[@media(max-width:700px)]:hidden" />{{ featureLines('product.featureTradeBody')[1] }}</p>
        </article>
        <article class="[@media(max-width:700px)]:relative [@media(max-width:700px)]:pl-[58px]">
          <ChartNoAxesColumnIncreasing class="mb-[19px] [@media(max-width:700px)]:absolute [@media(max-width:700px)]:left-0 [@media(max-width:700px)]:top-[4px] [@media(max-width:700px)]:w-[27px]" :size="34" :stroke-width="1.8" />
          <h2 class="text-[length:27px] tracking-[-.5px] [margin:0_0_13px] [@media(max-width:1000px)]:text-[length:23px] [@media(max-width:700px)]:text-[length:22px] [@media(max-width:700px)]:mb-[7px] font-bold">{{ t('product.featureReviewTitle') }}</h2>
          <p class="text-[length:17px] text-[color:#696969] leading-[1.9] m-0 [@media(max-width:1000px)]:text-[length:15px] [@media(max-width:700px)]:text-[length:15px]">{{ featureLines('product.featureReviewBody')[0] }}<br class="[@media(max-width:700px)]:hidden" />{{ featureLines('product.featureReviewBody')[1] }}</p>
        </article>
      </section>
      <section id="traders" class="product-traders max-w-[1240px] m-auto grid grid-cols-[1fr_1fr] gap-[90px] [padding:80px_40px] [border-top:1px_solid_#e9e9e9] [@media(max-width:700px)]:grid-cols-[1fr] [@media(max-width:700px)]:gap-[28px] [@media(max-width:700px)]:[padding:52px_27px]" aria-labelledby="traders-title">
        <div class="product-traders-intro">
          <h2 class="text-[length:38px] leading-[1.4] tracking-[-1px] [margin:0_0_22px] [@media(max-width:700px)]:text-[length:29px] font-bold" id="traders-title">{{ t('product.tradersTitle') }}</h2>
          <p class="product-traders-statement text-[length:18px] leading-[1.9] text-[color:#080808] [margin:0_0_16px] max-w-[460px] [@media(max-width:700px)]:text-[length:16px] font-semibold">{{ t('product.tradersStatement') }}</p>
          <p class="text-[length:18px] leading-[1.9] text-[color:#626262] [margin:0_0_16px] max-w-[460px] [@media(max-width:700px)]:text-[length:16px]">{{ t('product.tradersBody') }}</p>
        </div>
        <div class="product-traders-details grid gap-[26px]">
          <article class="[border-left:2px_solid_#ddd] pl-[22px]">
            <h3 class="text-[length:18px] [margin:0_0_8px] font-bold">{{ t('product.traderPoint1Title') }}</h3>
            <p class="text-[length:15px] leading-[1.9] text-[color:#707070] m-0">{{ t('product.traderPoint1Body') }}</p>
          </article>
          <article class="[border-left:2px_solid_#ddd] pl-[22px]">
            <h3 class="text-[length:18px] [margin:0_0_8px] font-bold">{{ t('product.traderPoint2Title') }}</h3>
            <p class="text-[length:15px] leading-[1.9] text-[color:#707070] m-0">{{ t('product.traderPoint2Body') }}</p>
          </article>
          <article class="[border-left:2px_solid_#ddd] pl-[22px]">
            <h3 class="text-[length:18px] [margin:0_0_8px] font-bold">{{ t('product.traderPoint3Title') }}</h3>
            <p class="text-[length:15px] leading-[1.9] text-[color:#707070] m-0">{{ t('product.traderPoint3Body') }}</p>
          </article>
        </div>
      </section>
      <section id="guide" class="product-guide [border-top:1px_solid_#e9e9e9] max-w-[1240px] [padding:90px_40px] grid grid-cols-[1.1fr_1fr] gap-[100px] m-auto [@media(max-width:1000px)]:gap-[40px] [@media(max-width:700px)]:grid-cols-[1fr] [@media(max-width:700px)]:[padding:52px_27px] [@media(max-width:700px)]:gap-[35px]">
        <div>
          <span class="product-section-label text-[length:14px] text-[color:#777]">{{ t('product.guideLabel') }}</span>
          <h2 class="text-[length:33px] leading-[1.5] tracking-[-1px] [margin:16px_0] [@media(max-width:700px)]:text-[length:27px] font-bold">{{ t('product.guideTitle') }}</h2>
          <p class="text-[color:#707070] text-[length:16px] leading-[1.9] m-0">{{ t('product.guideBody') }}</p>
          <a class="product-inline-link inline-flex gap-[16px] items-center mt-[25px] text-[length:16px] font-semibold text-inherit no-underline" href="#workspace">{{ t('product.enterWorkspace') }} <ArrowRight :size="19" />
          </a>
        </div>
        <ol class="p-0 m-0 list-none grid gap-[28px]">
          <li class="flex gap-[20px]">
            <span class="[border:1px_solid_#ddd] w-[32px] h-[32px] rounded-[50%] grid place-items-center shrink-0 text-[length:14px]">1</span>
            <div>
              <h3 class="text-[length:18px] [margin:2px_0_7px] font-bold">{{ t('product.step1Title') }}</h3>
              <p class="text-[color:#707070] text-[length:14px] leading-[1.9] m-0">{{ t('product.step1Body') }}</p>
            </div>
          </li>
          <li class="flex gap-[20px]">
            <span class="[border:1px_solid_#ddd] w-[32px] h-[32px] rounded-[50%] grid place-items-center shrink-0 text-[length:14px]">2</span>
            <div>
              <h3 class="text-[length:18px] [margin:2px_0_7px] font-bold">{{ t('product.step2Title') }}</h3>
              <p class="text-[color:#707070] text-[length:14px] leading-[1.9] m-0">{{ t('product.step2Body') }}</p>
            </div>
          </li>
          <li class="flex gap-[20px]">
            <span class="[border:1px_solid_#ddd] w-[32px] h-[32px] rounded-[50%] grid place-items-center shrink-0 text-[length:14px]">3</span>
            <div>
              <h3 class="text-[length:18px] [margin:2px_0_7px] font-bold">{{ t('product.step3Title') }}</h3>
              <p class="text-[color:#707070] text-[length:14px] leading-[1.9] m-0">{{ t('product.step3Body') }}</p>
            </div>
          </li>
        </ol>
      </section>
      <section id="plans" class="product-plans [background:#fafafa] [padding:78px_max(40px,calc((100vw_-_1160px)/2))] grid grid-cols-[1fr_1fr] gap-[90px] items-center [@media(max-width:1000px)]:gap-[40px] [@media(max-width:1000px)]:[padding:60px_30px] [@media(max-width:700px)]:grid-cols-[1fr] [@media(max-width:700px)]:[padding:48px_24px] [@media(max-width:700px)]:gap-[25px]">
        <div>
          <span class="product-section-label text-[length:14px] text-[color:#777]">{{ t('product.plansLabel') }}</span>
          <h2 class="text-[length:33px] leading-[1.5] tracking-[-1px] [margin:16px_0] [@media(max-width:700px)]:text-[length:27px] font-bold">{{ t('product.plansTitle') }}</h2>
          <p class="text-[color:#707070] text-[length:16px] leading-[1.9] m-0">{{ t('product.plansBody') }}</p>
        </div>
        <div class="product-plan bg-white [border:1px_solid_#dedede] rounded-[12px] [padding:33px] [@media(max-width:700px)]:[padding:27px]">
          <h3 class="text-[length:25px] m-0 font-bold">{{ t('product.planTitle') }}</h3>
          <p class="text-[color:#707070] text-[length:14px] leading-[1.9] [margin:9px_0_25px]">{{ t('product.planSubtitle') }}</p>
          <div class="product-plan-price flex items-baseline gap-[9px] mt-[24px]">
            <strong class="text-[length:44px] leading-[1.2] tracking-[-1.5px]">US$12.99</strong>
            <span class="text-[length:16px] text-[color:#707070]">{{ t('product.perMonth') }}</span>
          </div>
          <p class="text-[color:#707070] text-[length:14px] leading-[1.9] [margin:9px_0_25px]">{{ t('product.planPriceNote') }}</p>
          <ul class="list-none p-0 [margin:0_0_30px] grid gap-[17px]">
            <li class="flex items-center gap-[12px] text-[length:15px]">
              <Check :size="18" />{{ t('product.planFeature1') }}
            </li>
            <li class="flex items-center gap-[12px] text-[length:15px]">
              <Check :size="18" />{{ t('product.planFeature2') }}
            </li>
            <li class="flex items-center gap-[12px] text-[length:15px]">
              <Check :size="18" />{{ t('product.planFeature3') }}
            </li>
          </ul>
          <button class="product-button disabled:opacity-[.5] disabled:cursor-wait bg-black text-[color:#fff] [border:1px_solid_#000] rounded-[9px] [padding:14px] text-[length:16px] min-h-[50px] hover:bg-[#292929] w-full [font-family:inherit]" :class="productButtonClass" @click="openAuth('register')">{{ t('product.signup') }} <ArrowRight :size="21" />
          </button>
          <small class="block text-[color:#777] text-center text-[length:12px] mt-[15px]">{{ t('product.planNote') }}</small>
        </div>
      </section>
    </main>
    <footer class="product-footer max-w-[1344px] [padding:45px_48px_30px] m-auto flex items-center flex-wrap gap-[22px] [@media(max-width:700px)]:[padding:30px_24px] [@media(max-width:700px)]:gap-[15px]">
      <a class="product-brand inline-flex items-center gap-[10px] text-[length:18px] font-[750] whitespace-nowrap tracking-[-.8px] text-inherit no-underline" href="#">
        <span class="product-mark inline-block w-[20px] h-[19px] bg-black [clip-path:polygon(50%_0,100%_100%,0_100%)] shrink-0"></span>grailab
      </a>
      <span class="text-[length:13px] text-[color:#777] ml-auto [@media(max-width:700px)]:text-[length:11px]">{{ t('product.footerTagline') }}</span>
      <p class="w-full text-[length:12px] text-[color:#999] m-0">{{ t('product.footerDisclaimer') }}</p>
    </footer>
  </div>
</template>

<style scoped>
.product-page ::selection {
  background: #111;
  color: #fff;
}
.product-hero h1 {
  text-wrap: balance;
  letter-spacing: -.03em;
}
.product-nav a {
  min-height: 44px;
  text-underline-offset: 6px;
}
.product-nav a:hover,
.product-inline-link:hover {
  text-decoration: underline;
}
.product-hero-note,
.product-footer > p {
  color: #737373;
}
.product-traders-intro,
.product-traders-details {
  min-width: 0;
}
#features,
#guide,
#plans {
  scroll-margin-top: 32px;
}
.product-plan li > svg {
  flex-shrink: 0;
}
@media (max-width: 1000px) {
  .product-traders {
    gap: 40px;
  }
}
@media (max-width: 700px) {
  .product-header {
    row-gap: 12px;
  }
  .product-nav {
    justify-content: space-between;
    gap: 16px;
  }
  .product-login,
  .product-account .product-button {
    min-height: 44px;
  }
  .product-hero-note {
    font-size: 12px;
    line-height: 1.8;
  }
  .product-traders {
    gap: 28px;
  }
}
</style>
