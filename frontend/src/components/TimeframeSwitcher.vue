<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  id: string
  modelValue: string
  options: string[]
  labels: Record<string, string>
  label: string
}>()
const emit = defineEmits<{ change: [event: Event] }>()
const shortcuts = computed(() => ['15m', '30m', '1h', '4h', '1d', '1w', '1M'].filter(value => props.options.includes(value)))
const compactLabels: Record<string, string> = { '15m': '15分', '30m': '30分', '1h': '1小时', '4h': '4小时', '1d': '天', '1w': '周', '1M': '月' }
function choose(value: string) {
  const select = document.getElementById(props.id) as HTMLSelectElement | null
  if (!select) return
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}
</script>

<template>
  <div class="timeframe-switcher" role="group" :aria-label="label">
    <div class="timeframe-shortcuts">
      <button v-for="value in shortcuts" :key="value" type="button" class="timeframe-shortcut"
        :class="{ active: modelValue === value }" :aria-pressed="modelValue === value"
        @click="choose(value)">{{ compactLabels[value] }}</button>
      <span v-if="!shortcuts.includes(modelValue)" class="timeframe-shortcut active">{{ labels[modelValue] ?? modelValue }}</span>
    </div>
    <div class="timeframe-more">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <select :id="id" data-testid="replay-pane-timeframe" :aria-label="label" :value="modelValue" @change="emit('change', $event)">
        <option v-for="value in options" :key="value" :value="value">{{ labels[value] ?? value }}</option>
      </select>
    </div>
  </div>
</template>
