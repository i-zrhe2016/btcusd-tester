<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { ArrowUp, ChevronDown } from '@lucide/vue'
import BrandMark from '../components/BrandMark.vue'
import SupportContact from '../components/SupportContact.vue'
import { TERMS_EMAIL, TERMS_UPDATED, TERMS_URL, termsCopy, termsSections } from '../legal/terms'
import '../privacy.css'

const copy = termsCopy
const sections = termsSections
const active = ref(sections[0].id)
const toc = ref<HTMLDetailsElement | null>(null)
const isDesktop = ref(false)
let desktopQuery: MediaQueryList | undefined
let ticking = false

function updateActive() {
  ticking = false
  let current = sections[0]?.id
  for (const section of sections) {
    const element = document.getElementById(section.id)
    if (element && element.getBoundingClientRect().top <= 140) current = section.id
  }
  if (current && active.value !== current) active.value = current
}

function onScroll() {
  if (ticking) return
  ticking = true
  window.requestAnimationFrame(updateActive)
}

function syncTocLayout() {
  isDesktop.value = desktopQuery?.matches ?? false
  if (toc.value) toc.value.open = isDesktop.value
}

function selectSection(id: string) {
  active.value = id
  if (!isDesktop.value && toc.value) toc.value.open = false
}

function setMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = name
    document.head.appendChild(tag)
  }
  tag.content = content
}

watchEffect(() => {
  document.title = copy.metaTitle
  setMeta('description', copy.metaDescription)
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', TERMS_URL)
})

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    desktopQuery = window.matchMedia('(min-width: 1024px)')
    syncTocLayout()
    desktopQuery.addEventListener('change', syncTocLayout)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  updateActive()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  desktopQuery?.removeEventListener('change', syncTocLayout)
})
</script>

<template>
  <div class="landing privacy-page terms-page">
    <header class="site-header">
      <div class="wrap privacy-header">
        <a class="brand" href="/" aria-label="grailab 首页"><BrandMark />grailab</a>
        <nav class="privacy-nav" :aria-label="copy.nav.label">
          <a href="/">{{ copy.nav.home }}</a>
          <a href="/blog">{{ copy.nav.articles }}</a>
          <a href="/terms" aria-current="page">{{ copy.nav.terms }}</a>
          <a href="/privacy">{{ copy.nav.privacy }}</a>
        </nav>
      </div>
    </header>

    <main id="main-content" class="wrap privacy-main" tabindex="-1">
      <header class="privacy-masthead">
        <div>
          <h1>{{ copy.title }}</h1>
          <p class="privacy-lead">{{ copy.lead }}</p>
        </div>
        <dl class="privacy-meta">
          <div>
            <dt>{{ copy.meta.updated }}</dt>
            <dd><time :datetime="TERMS_UPDATED">{{ copy.updatedDisplay }}</time></dd>
          </div>
          <div>
            <dt>{{ copy.meta.website }}</dt>
            <dd>grailab.top</dd>
          </div>
          <div>
            <dt>{{ copy.meta.operator }}</dt>
            <dd>grailab</dd>
          </div>
          <div>
            <dt>{{ copy.meta.contact }}</dt>
            <dd><a :href="`mailto:${TERMS_EMAIL}`">{{ TERMS_EMAIL }}</a></dd>
          </div>
        </dl>
      </header>

      <section class="privacy-summary" aria-labelledby="terms-summary-title">
        <h2 id="terms-summary-title">{{ copy.summaryTitle }}</h2>
        <ul>
          <li v-for="item in copy.summary" :key="item.label">
            <span class="privacy-summary-label">{{ item.label }}</span>
            <p>{{ item.text }}</p>
          </li>
        </ul>
      </section>

      <div class="privacy-layout">
        <details ref="toc" class="privacy-toc">
          <summary>
            <span>{{ copy.tocTitle }}</span>
            <ChevronDown :size="16" :stroke-width="2" class="privacy-toc-chevron" aria-hidden="true" />
          </summary>
          <nav :aria-label="copy.tocAria">
            <ol>
              <li v-for="section in sections" :key="section.id">
                <a
                  :href="`#${section.id}`"
                  :aria-current="active === section.id ? 'true' : undefined"
                  @click="selectSection(section.id)"
                >
                  <span class="privacy-toc-num" aria-hidden="true">{{ section.number }}</span>
                  <span>{{ section.title }}</span>
                </a>
              </li>
            </ol>
          </nav>
        </details>

        <article class="privacy-body">
          <section
            v-for="section in sections"
            :id="section.id"
            :key="section.id"
            class="privacy-section"
            :aria-labelledby="`${section.id}-title`"
          >
            <h2 :id="`${section.id}-title`">
              <span class="privacy-num" aria-hidden="true">{{ section.number }}</span>
              <span>{{ section.title }}</span>
            </h2>
            <template v-for="(block, index) in section.blocks" :key="index">
              <p v-if="block.kind === 'p'" class="privacy-paragraph">{{ block.text }}</p>
              <h3 v-else-if="block.kind === 'h3'" class="privacy-subhead">{{ block.text }}</h3>
              <ul v-else-if="block.kind === 'list'" class="privacy-list">
                <li v-for="item in block.items" :key="item">{{ item }}</li>
              </ul>
              <aside v-else-if="block.kind === 'note'" class="privacy-note">
                <p class="privacy-note-title">{{ block.title }}</p>
                <p class="privacy-note-text">{{ block.text }}</p>
              </aside>
              <p v-else-if="block.kind === 'links'" class="privacy-links">
                <a
                  v-for="link in block.items"
                  :key="link.href"
                  :href="link.href"
                  :target="link.href.startsWith('http') ? '_blank' : undefined"
                  :rel="link.href.startsWith('http') ? 'noopener noreferrer' : undefined"
                >{{ link.label }}</a>
              </p>
            </template>
          </section>

          <footer class="privacy-end">
            <p>{{ copy.end.line }}</p>
            <div class="privacy-end-actions">
              <a class="privacy-end-action" :href="`mailto:${TERMS_EMAIL}`">{{ copy.end.action }}</a>
              <a class="privacy-top-link" href="#main-content">
                <ArrowUp :size="15" :stroke-width="2" aria-hidden="true" />
                {{ copy.backToTop }}
              </a>
            </div>
          </footer>
        </article>
      </div>
    </main>

    <footer class="site-footer">
      <div class="wrap footer-inner">
        <a class="brand" href="/" aria-label="grailab 首页"><BrandMark />grailab</a>
        <div class="footer-links">
          <a href="/">{{ copy.footer.home }}</a>
          <a href="/blog">{{ copy.footer.articles }}</a>
          <a href="/terms" aria-current="page">{{ copy.footer.terms }}</a>
          <a href="/privacy">{{ copy.footer.privacy }}</a>
          <SupportContact :label="copy.footer.contact" />
        </div>
        <p class="footer-note">{{ copy.footer.disclaimer }}</p>
      </div>
    </footer>
  </div>
</template>
