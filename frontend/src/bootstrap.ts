import { clerkPlugin, updateClerkOptions } from '@clerk/vue'
import { enUS, zhCN } from '@clerk/localizations'
import { watch } from 'vue'
import { locale } from './i18n'
import { createApp } from 'vue'
import AuthBridge from './components/AuthBridge.vue'
import App from './ProductApp.vue'
import AuthVerification from './components/AuthVerification.vue'


const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY. Set it in frontend/.env.local for local development or pass it as a Docker build arg.')
}

const app = createApp(window.location.pathname === '/auth/verify' ? AuthVerification : App)

app.use(clerkPlugin, {
  publishableKey: PUBLISHABLE_KEY,
  localization: locale.value === 'zh' ? zhCN : enUS,
})
watch(locale, value => updateClerkOptions({ localization: value === 'zh' ? zhCN : enUS }))
app.component('AuthBridge', AuthBridge)
app.mount('#app')
