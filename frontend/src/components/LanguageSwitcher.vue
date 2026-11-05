<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'
import { locale, setLocale, type Locale } from '../i18n'

const options: { value: Locale; label: string; lang: string }[] = [
  { value: 'zh', label: '中文', lang: 'zh-CN' },
  { value: 'en', label: 'English', lang: 'en' },
]

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const label = computed(() => (locale.value === 'zh' ? '界面语言' : 'Interface language'))
const current = computed(() => options.find(option => option.value === locale.value) ?? options[0])

function toggleMenu() {
  if (open.value) closeMenu()
  else void openMenu()
}

async function openMenu() {
  open.value = true
  await nextTick()
  menu.value?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus()
}

function closeMenu() {
  if (!open.value) return
  open.value = false
  trigger.value?.focus()
}

function choose(value: Locale) {
  setLocale(value)
  closeMenu()
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return
  const target = event.target
  if (root.value && target instanceof Node && !root.value.contains(target)) open.value = false
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Escape') {
    // Keep Escape from reaching the replay shortcuts while the menu is open.
    event.stopPropagation()
    closeMenu()
  }
}

function onMenuKeydown(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
  if (!items.length) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLElement)
  let next = 0
  if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
  else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
  else if (event.key === 'End') next = items.length - 1
  items[next]?.focus()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div ref="root" class="language-switcher">
    <button
      ref="trigger"
      type="button"
      class="language-trigger"
      :aria-label="`${label}: ${current.label}`"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleMenu"
      @keydown.down.prevent="openMenu"
    >
      <span :lang="current.lang">{{ current.label }}</span>
      <ChevronDown :size="14" :stroke-width="2" class="chevron" :class="{ open }" aria-hidden="true" />
    </button>
    <div v-if="open" ref="menu" class="language-menu" role="listbox" :aria-label="label" @keydown="onMenuKeydown">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="option"
        class="language-option"
        :lang="option.lang"
        :aria-selected="option.value === locale"
        @click="choose(option.value)"
      >
        <span>{{ option.label }}</span>
        <Check v-if="option.value === locale" :size="14" :stroke-width="2.4" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.language-switcher { position: relative; display: inline-flex; flex-shrink: 0; color: #6B5F55; }
.language-trigger {
  display: inline-flex; align-items: center; gap: 5px; min-height: 36px; min-width: 44px;
  padding: 0 9px 0 11px; border: 1px solid #342b2529; border-radius: 9px;
  background: #FAF7F2; color: inherit; font: inherit; font-size: 13px; font-weight: 600;
  line-height: 1; cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease;
}
.language-trigger:hover { background: #F4EFE6; border-color: #342b2540; }
.language-trigger .chevron { transition: transform 160ms ease; }
.language-trigger .chevron.open { transform: rotate(180deg); }
.language-trigger:focus-visible,
.language-option:focus-visible { outline: 2px solid #C46F50; outline-offset: 2px; }
.language-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 60;
  display: grid; gap: 2px; min-width: max(100%, 132px); margin: 0; padding: 4px;
  border: 1px solid #342b2529; border-radius: 10px; background: #FFFDF9;
  box-shadow: 0 12px 28px -12px rgba(52, 43, 37, 0.35);
}
.language-option {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  min-height: 38px; padding: 0 10px; border: 0; border-radius: 6px;
  background: transparent; color: #6B5F55; font: inherit; font-size: 13px;
  text-align: left; white-space: nowrap; cursor: pointer;
}
.language-option:hover { background: #342b250d; color: #342B25; }
.language-option[aria-selected="true"] { background: #342b250f; color: #342B25; font-weight: 700; }
</style>
