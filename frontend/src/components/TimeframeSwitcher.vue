<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { timeframeShortLabel } from '../i18n'

const shortcutsElement = ref<HTMLElement | null>(null)
const highlight = ref({ width: '0px', transform: 'translateX(0px)', opacity: 0 })
let resizeObserver: ResizeObserver | undefined
function updateHighlight() {
  const container = shortcutsElement.value
  const active = container?.querySelector<HTMLElement>('.active')
  if (!container || !active) return
  highlight.value = {
    width: `${active.offsetWidth}px`,
    transform: `translateX(${active.offsetLeft}px)`,
    opacity: 1,
  }
  // Keep the active timeframe visible when the strip is narrower than its
  // options, which is the normal case on phones.
  const left = active.offsetLeft
  const right = left + active.offsetWidth
  if (left < container.scrollLeft) container.scrollLeft = left
  else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth
}
onMounted(() => {
  updateHighlight()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateHighlight)
    if (shortcutsElement.value) resizeObserver.observe(shortcutsElement.value)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())

const props = defineProps<{
  id: string
  modelValue: string
  options: string[]
  labels: Record<string, string>
  label: string
}>()
watch(() => [props.modelValue, props.options, props.labels], async () => {
  await nextTick()
  updateHighlight()
}, { deep: true })
const emit = defineEmits<{ change: [event: Event] }>()
const shortcuts = computed(() => ['15m', '30m', '1h', '4h', '1d', '1w', '1M'].filter(value => props.options.includes(value)))
const compactLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(shortcuts.value.map(value => [value, timeframeShortLabel(value)])),
)
function choose(value: string) {
  const select = document.getElementById(props.id) as HTMLSelectElement | null
  if (!select) return
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}
</script>

<template>
  <div class="timeframe-switcher flex items-center min-w-0 gap-[3px] text-[color:#d1d4dc] [font-family:Arial,_'Microsoft_YaHei',_sans-serif]" role="group" :aria-label="label">
    <div ref="shortcutsElement" class="timeframe-shortcuts relative items-center min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none]">
      <span class="timeframe-highlight absolute top-0 left-0 h-8 rounded-[6px] [background:#303030] pointer-events-none" :style="highlight" aria-hidden="true"></span>
      <button v-for="value in shortcuts" :key="value" type="button" class="timeframe-shortcut flex-none inline-flex items-center justify-center h-8 [padding:0_7px] rounded-[6px] [font:500_14px/1_Arial,_'Microsoft_YaHei',_sans-serif] whitespace-nowrap cursor-pointer relative"
        :class="{ active: modelValue === value }" :aria-pressed="modelValue === value"
        @click="choose(value)">{{ compactLabels[value] }}</button>
      <span v-if="!shortcuts.includes(modelValue)" class="timeframe-shortcut active flex-none inline-flex items-center justify-center h-8 [padding:0_7px] rounded-[6px] [font:500_14px/1_Arial,_'Microsoft_YaHei',_sans-serif] whitespace-nowrap cursor-pointer relative">{{ labels[modelValue] ?? modelValue }}</span>
    </div>
    <div class="timeframe-more [flex:0_0_28px] grid place-items-center rounded-[6px]">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <select :id="id" data-testid="replay-pane-timeframe" :aria-label="label" :value="modelValue" @change="emit('change', $event)">
        <option v-for="value in options" :key="value" :value="value">{{ labels[value] ?? value }}</option>
      </select>
    </div>
  </div>
</template>
