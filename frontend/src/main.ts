import { createApp } from 'vue'
import { clerkPlugin } from '@clerk/vue'
import App from './App.vue'
import './styles.css'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error('缺少 VITE_CLERK_PUBLISHABLE_KEY，请配置 Clerk Publishable Key。')
}

const app = createApp(App)
app.use(clerkPlugin, { publishableKey })
app.mount('#app')
