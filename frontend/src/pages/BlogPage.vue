<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import DOMPurify from 'dompurify'
import articles from 'virtual:blog'
import BrandMark from '../components/BrandMark.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import { locale } from '../i18n'
import SupportContact from '../components/SupportContact.vue'
import '../blog.css'

const english = computed(() => locale.value === 'en')
const path = window.location.pathname.replace(/\/+$/, '')
const isIndex = path === '/blog'
const slug = path.slice('/blog/'.length)
const article = articles.find(item => item.slug === slug)
const body = article ? DOMPurify.sanitize(article.html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style', 'id', 'name'] }) : ''
const dateLabel = (date: string) => new Intl.DateTimeFormat(english.value ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(date))
watchEffect(() => {
  const title = isIndex ? (english.value ? 'Articles' : '文章') : article?.title ?? (english.value ? 'Article not found' : '文章不存在')
  document.title = `${title} | grailab`
  const description = document.querySelector('meta[name="description"]')
  description?.setAttribute('content', article?.description ?? (english.value ? 'Guides and articles for deliberate trading practice.' : '关于行情回放、交易训练与复盘的文章。'))
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://grailab.top${isIndex ? '/blog' : article ? `/blog/${article.slug}` : '/blog'}`)
  if (!isIndex && !article && !document.querySelector('meta[name="robots"]')) {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex'
    document.head.appendChild(robots)
  }
})
</script>

<template>
  <div class="landing blog-page">
    <header class="site-header">
      <div class="wrap blog-header">
        <a class="brand" href="/" :aria-label="english ? 'grailab home' : 'grailab 首页'"><BrandMark />grailab</a>
        <nav class="blog-nav" :aria-label="english ? 'Main navigation' : '主导航'">
          <a href="/">{{ english ? 'Home' : '首页' }}</a>
          <a href="/blog" :aria-current="isIndex ? 'page' : undefined" :class="{ 'is-current': true }">{{ english ? 'Articles' : '文章' }}</a>
        </nav>
        <LanguageSwitcher />
      </div>
    </header>

    <main id="main-content" class="wrap blog-main" tabindex="-1">
      <template v-if="isIndex">
        <header class="blog-intro">
          <h1>{{ english ? 'Articles' : '文章' }}</h1>
          <p>{{ english ? 'On market replay, trading practice, and learning from your decisions.' : '关于行情回放、交易训练，以及每一次决策后的复盘。' }}</p>
        </header>
        <div v-if="!articles.length" class="blog-empty">
          <h2>{{ english ? 'Articles are on the way' : '文章正在准备中' }}</h2>
          <p>{{ english ? 'New articles will appear here when published.' : '新的文章发布后，会在这里与你见面。' }}</p>
          <a class="blog-text-link" href="/">{{ english ? 'Explore grailab' : '先了解 grailab' }}</a>
        </div>
        <section v-else :aria-label="english ? 'All articles' : '所有文章'">
          <article v-for="item in articles" :key="item.slug" class="blog-row">
            <time :datetime="item.publishedAt">{{ dateLabel(item.publishedAt) }}</time>
            <div class="blog-row-copy">
              <h2><a :href="`/blog/${item.slug}`">{{ item.title }}</a></h2>
              <p>{{ item.description }}</p>
              <ul v-if="item.tags.length" class="blog-tags" :aria-label="english ? 'Tags' : '标签'"><li v-for="tag in item.tags" :key="tag">{{ tag }}</li></ul>
            </div>
            <img v-if="item.cover" class="blog-thumbnail" :src="item.cover" alt="" loading="lazy" width="240" height="160" />
          </article>
        </section>
      </template>
      <article v-else-if="article" class="blog-reading">
        <a class="blog-back" href="/blog">{{ english ? 'Back to articles' : '返回文章列表' }}</a>
        <header class="blog-article-head">
          <h1>{{ article.title }}</h1>
          <p class="blog-description">{{ article.description }}</p>
          <time :datetime="article.publishedAt">{{ dateLabel(article.publishedAt) }}</time>
          <ul v-if="article.tags.length" class="blog-tags" :aria-label="english ? 'Tags' : '标签'"><li v-for="tag in article.tags" :key="tag">{{ tag }}</li></ul>
        </header>
        <img v-if="article.cover" class="blog-cover" :src="article.cover" alt="" />
        <div class="blog-prose" v-html="body"></div>
        <div class="blog-article-end"><a class="blog-text-link" href="/blog">{{ english ? 'Browse all articles' : '浏览所有文章' }}</a></div>
      </article>
      <section v-else class="blog-missing">
        <h1>{{ english ? 'Article not found' : '文章不存在' }}</h1>
        <p>{{ english ? 'This link may be incorrect, or the article is no longer available.' : '链接可能有误，或这篇文章已不再公开。' }}</p>
        <a class="blog-text-link" href="/blog">{{ english ? 'Back to articles' : '返回文章列表' }}</a>
      </section>
    </main>
    <footer class="wrap blog-footer">
      <div class="blog-footer-brand">
        <a href="/">grailab</a>
        <a href="/terms" class="blog-footer-link">{{ english ? 'Terms' : '服务条款' }}</a>
        <a href="/privacy" class="blog-footer-link">{{ english ? 'Privacy' : '隐私政策' }}</a>
        <SupportContact :label="english ? 'Support email' : '客服邮箱'" />
      </div>
      <p>{{ english ? 'Historical market replay & trading practice' : '历史行情回放与交易训练' }}</p>
    </footer>
  </div>
</template>
