import { createApp } from 'vue'
import './styles.css'

// Public reading pages should load without waiting for the account service.
if (window.location.pathname === '/blog' || window.location.pathname.startsWith('/blog/')) {
  import('./pages/BlogPage.vue').then(({ default: BlogPage }) => createApp(BlogPage).mount('#app'))
} else {
  void import('./bootstrap')
}
