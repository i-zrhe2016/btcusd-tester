<script setup lang="ts">
import { locale, setLocale } from '../i18n'
defineProps<{ dark?: boolean }>()
</script>

<template>
  <div class="language-switcher" :class="{ dark }" role="group" :aria-label="locale === 'zh' ? '界面语言' : 'Interface language'">
    <button type="button" lang="zh-CN" :aria-pressed="locale === 'zh'" @click="setLocale('zh')">中文</button>
    <button type="button" lang="en" :aria-pressed="locale === 'en'" @click="setLocale('en')">English</button>
  </div>
</template>

<style scoped>
.language-switcher { display: inline-flex; align-items: center; flex-shrink: 0; color: #6B5F55; border: 1px solid #342b2529; border-radius: 9px; padding: 2px; background: #FAF7F2; }
.language-switcher button { min-height: 44px; min-width: 44px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.language-switcher button:hover { background: #342b250a; }
.language-switcher button[aria-pressed="true"] { background: #342B25; color: #FFFDF9; }
.language-switcher button:focus-visible { outline: 2px solid #C46F50; outline-offset: 2px; }
.dark { background: #17120F; color: #EFE5D8; border-color: #efe5d833; }
.dark button[aria-pressed="true"] { background: #EFE5D8; color: #17120F; }
.dark button:hover:not([aria-pressed="true"]) { background: #efe5d81a; }
</style>
