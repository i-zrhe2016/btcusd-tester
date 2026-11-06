import { createApp } from 'vue'
import './styles.css'

// Public reading pages should load without waiting for the account service.
const path = window.location.pathname.replace(/\/+$/, '') || '/'
if (path === '/blog' || path.startsWith('/blog/')) {
  import('./pages/BlogPage.vue').then(({ default: BlogPage }) => createApp(BlogPage).mount('#app'))
} else if (path === '/privacy') {
  import('./pages/PrivacyPage.vue').then(({ default: PrivacyPage }) => createApp(PrivacyPage).mount('#app'))
} else {
  void import('./bootstrap')
}
