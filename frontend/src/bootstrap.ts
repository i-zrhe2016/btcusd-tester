import { clerkPlugin, updateClerkOptions } from '@clerk/vue'
import { enUS, zhCN } from '@clerk/localizations'
import { createApp, defineAsyncComponent, watch } from 'vue'
import { locale } from './i18n'
import AuthBridge from './components/AuthBridge.vue'
import App from './ProductApp.vue'
import AuthVerification from './components/AuthVerification.vue'


const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY. Set it in frontend/.env.local for local development or pass it as a Docker build arg.')
}

const path = window.location.pathname.replace(/\/+$/, '') || '/'
// The feedback surface is a separate chunk: the landing page keeps its light
// initial payload and only loads the board when the route needs it.
const FeedbackPage = defineAsyncComponent(() => import('./pages/FeedbackPage.vue'))
const Root = path === '/feedback' || path.startsWith('/feedback/')
  ? FeedbackPage
  : window.location.pathname === '/auth/verify' ? AuthVerification : App

const app = createApp(Root)

app.use(clerkPlugin, {
  publishableKey: PUBLISHABLE_KEY,
  localization: locale.value === 'zh' ? zhCN : enUS,
})
watch(locale, value => updateClerkOptions({ localization: value === 'zh' ? zhCN : enUS }))
app.component('AuthBridge', AuthBridge)
app.mount('#app')
