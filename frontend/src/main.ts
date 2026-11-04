import { clerkPlugin } from '@clerk/vue'
import { createApp } from 'vue'
import AuthBridge from './components/AuthBridge.vue'
import App from './ProductApp.vue'
import './styles.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY. Set it in frontend/.env.local for local development or pass it as a Docker build arg.')
}

const app = createApp(App)

app.use(clerkPlugin, { publishableKey: PUBLISHABLE_KEY })
app.component('AuthBridge', AuthBridge)
app.mount('#app')
