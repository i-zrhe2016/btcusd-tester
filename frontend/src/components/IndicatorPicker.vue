<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IndicatorCategory, IndicatorDef, InputConfig } from '@getcandlekit/charts'
import { INDICATOR_LABEL_KEYS, type ReplayIndicator } from '../indicators'
import { t } from '../i18n'

type Tab = 'all' | 'overlay' | 'oscillator'

const props = defineProps<{
  groups: Record<IndicatorCategory, IndicatorDef[]>
  active: ReplayIndicator[]
  maxOscillators: number
}>()

const emit = defineEmits<{
  (event: 'toggle', name: string): void
  (event: 'update', name: string, params: Record<string, number | boolean | string>): void
  (event: 'clear'): void
}>()

const open = ref(false)
const search = ref('')
const tab = ref<Tab>('all')
const expanded = ref<Set<string>>(new Set())
const root = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)

const activeByName = computed(() => new Map(props.active.map((indicator) => [indicator.name, indicator])))
const activeOscillators = computed(() => props.active.filter(
  (indicator) => definitionFor(indicator.name)?.category === 'oscillator',
).length)

const allDefinitions = computed(() => [
  ...props.groups.overlay,
  ...props.groups.oscillator,
  ...props.groups.pattern,
].sort((left, right) => indicatorLabel(left).localeCompare(indicatorLabel(right))))

const tabs = computed<Array<{ id: Tab; label: string; count: number }>>(() => [
  { id: 'all', label: t('chart.indicatorAll'), count: allDefinitions.value.length },
  { id: 'overlay', label: t('chart.indicatorOverlay'), count: props.groups.overlay.length },
  { id: 'oscillator', label: t('chart.indicatorOscillator'), count: props.groups.oscillator.length },
])

const baseList = computed(() => tab.value === 'all' ? allDefinitions.value : props.groups[tab.value])
const list = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  if (!query) return baseList.value
  return baseList.value.filter((definition) =>
    indicatorLabel(definition).toLocaleLowerCase().includes(query) ||
    definition.title.toLocaleLowerCase().includes(query) ||
    definition.shortTitle.toLocaleLowerCase().includes(query),
  )
})

function definitionFor(name: string): IndicatorDef | undefined {
  return props.groups.overlay.find((item) => item.name === name) ??
    props.groups.oscillator.find((item) => item.name === name) ??
    props.groups.pattern.find((item) => item.name === name)
}

function indicatorLabel(definition: IndicatorDef): string {
  const key = INDICATOR_LABEL_KEYS[definition.name]
  return key ? t(key) : definition.title
}

function activeIndicator(definition: IndicatorDef): ReplayIndicator | undefined {
  return activeByName.value.get(definition.name)
}

function canEnable(definition: IndicatorDef): boolean {
  if (activeIndicator(definition)) return true
  return definition.category !== 'oscillator' || activeOscillators.value < props.maxOscillators
}

function categoryBadge(definition: IndicatorDef): string {
  return definition.category === 'overlay'
    ? t('chart.indicatorOverlay')
    : definition.category === 'oscillator'
      ? t('chart.indicatorOscillator')
      : definition.category.slice(0, 3).toUpperCase()
}

function isExpanded(name: string): boolean {
  return expanded.value.has(name)
}

function toggleExpanded(name: string): void {
  const next = new Set(expanded.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expanded.value = next
}

function toggleIndicator(definition: IndicatorDef): void {
  if (!canEnable(definition)) return
  const enabled = Boolean(activeIndicator(definition))
  if (!enabled) {
    const next = new Set(expanded.value)
    next.add(definition.name)
    expanded.value = next
  } else {
    const next = new Set(expanded.value)
    next.delete(definition.name)
    expanded.value = next
  }
  emit('toggle', definition.name)
}

function paramValue(definition: IndicatorDef, config: InputConfig): number | boolean | string | undefined {
  const indicator = activeIndicator(definition)
  return indicator?.params[config.name] ?? (config.defval as number | boolean | string | undefined)
}

function changeParam(definition: IndicatorDef, config: InputConfig, event: Event): void {
  const indicator = activeIndicator(definition)
  if (!indicator) return
  const raw = (event.target as HTMLInputElement).value
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return
  const value = config.type === 'int' ? Math.round(numeric) : numeric
  emit('update', definition.name, { ...indicator.params, [config.name]: value })
}

function changeBoolParam(definition: IndicatorDef, config: InputConfig, event: Event): void {
  const indicator = activeIndicator(definition)
  if (!indicator) return
  emit('update', definition.name, { ...indicator.params, [config.name]: (event.target as HTMLInputElement).checked })
}

function changeStringParam(definition: IndicatorDef, config: InputConfig, event: Event): void {
  const indicator = activeIndicator(definition)
  if (!indicator) return
  emit('update', definition.name, { ...indicator.params, [config.name]: (event.target as HTMLSelectElement).value })
}

function clearAll(): void {
  expanded.value = new Set()
  emit('clear')
}

function close(): void {
  open.value = false
}

function onPointerDown(event: MouseEvent): void {
  if (!open.value) return
  if (root.value && event.target instanceof Node && !root.value.contains(event.target)) close()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) close()
}

watch(open, async (value) => {
  if (!value) return
  search.value = ''
  await nextTick()
  searchInput.value?.focus()
})

onMounted(() => {
  document.addEventListener('mousedown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="indicator-picker relative">
    <button
      class="indicator-picker-trigger mr-2 [padding:5px_10px] rounded-[6px] text-[length:12px] whitespace-nowrap"
      type="button"
      data-testid="indicator-picker-trigger"
      :aria-expanded="open"
      :aria-label="t('chart.indicators')"
      @click="open = !open"
    >
      {{ t('chart.indicators') }}<span v-if="props.active.length" class="indicator-picker-count">{{ props.active.length }}</span><span aria-hidden="true"> ▾</span>
    </button>

    <div v-if="open" class="indicator-picker-panel" role="dialog" :aria-label="t('chart.indicators')">
      <header class="indicator-picker-head">
        <strong>{{ t('chart.indicators') }}</strong>
        <button type="button" :aria-label="t('chart.indicatorClose')" @click="close">✕</button>
      </header>

      <input
        ref="searchInput"
        v-model="search"
        class="indicator-picker-search"
        type="search"
        :placeholder="t('chart.indicatorsSearch')"
        :aria-label="t('chart.indicatorsSearch')"
      />

      <div class="indicator-picker-tabs" role="tablist" :aria-label="t('chart.indicators')">
        <button
          v-for="option in tabs"
          :key="option.id"
          type="button"
          role="tab"
          :aria-selected="tab === option.id"
          :class="{ active: tab === option.id }"
          @click="tab = option.id"
        >
          {{ option.label }} <span>({{ option.count }})</span>
        </button>
      </div>

      <p v-if="activeOscillators >= props.maxOscillators" class="indicator-picker-limit" role="status">
        {{ t('chart.indicatorLimit', { n: props.maxOscillators }) }}
      </p>

      <ul class="indicator-picker-list">
        <li v-for="definition in list" :key="definition.name" class="indicator-picker-item">
          <div class="indicator-picker-row" :class="{ active: Boolean(activeIndicator(definition)) }">
            <button
              v-if="activeIndicator(definition)"
              type="button"
              class="indicator-picker-chevron"
              :aria-label="t('chart.indicatorParams')"
              :aria-expanded="isExpanded(definition.name)"
              @click="toggleExpanded(definition.name)"
            >{{ isExpanded(definition.name) ? '▾' : '▸' }}</button>
            <span v-else class="indicator-picker-chevron" aria-hidden="true"></span>
            <span class="indicator-picker-name">
              <span>{{ indicatorLabel(definition) }}</span>
              <small>{{ definition.shortTitle }}</small>
            </span>
            <span class="indicator-picker-category">{{ categoryBadge(definition) }}</span>
            <button
              type="button"
              role="switch"
              class="indicator-picker-switch"
              :class="{ on: Boolean(activeIndicator(definition)) }"
              :aria-checked="Boolean(activeIndicator(definition))"
              :aria-label="indicatorLabel(definition)"
              :disabled="!canEnable(definition)"
              @click="toggleIndicator(definition)"
            ><span /></button>
          </div>

          <div
            v-if="activeIndicator(definition) && isExpanded(definition.name) && definition.inputConfig.length"
            class="indicator-picker-params"
          >
            <label v-for="config in definition.inputConfig" :key="config.name">
              <span>{{ config.title ?? config.name }}</span>
              <input
                v-if="config.type === 'int' || config.type === 'float'"
                type="number"
                :min="config.type === 'int' ? 1 : 0.01"
                :step="config.type === 'int' ? 1 : 0.01"
                :value="paramValue(definition, config)"
                @change="changeParam(definition, config, $event)"
              />
              <input
                v-else-if="config.type === 'bool'"
                type="checkbox"
                :checked="Boolean(paramValue(definition, config))"
                @change="changeBoolParam(definition, config, $event)"
              />
              <select
                v-else-if="config.type === 'string' && config.options?.length"
                :value="String(paramValue(definition, config) ?? '')"
                @change="changeStringParam(definition, config, $event)"
              >
                <option v-for="option in config.options" :key="String(option)" :value="String(option)">{{ String(option) }}</option>
              </select>
            </label>
          </div>
        </li>
      </ul>

      <p v-if="!list.length" class="indicator-picker-empty">{{ t('chart.indicatorEmpty') }}</p>

      <footer class="indicator-picker-foot">
        <span>{{ t('chart.indicatorActive', { n: props.active.length }) }}</span>
        <button v-if="props.active.length" type="button" class="indicator-picker-clear" @click="clearAll">
          {{ t('chart.indicatorClear') }}
        </button>
      </footer>
    </div>
  </div>
</template>
