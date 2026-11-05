<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, RotateCcw, SlidersHorizontal, Trash2 } from '@lucide/vue'
import { t } from '../i18n'
import { DEFAULT_REPLAY_DRAWING_STYLE, type ReplayDrawingStyle } from '../replay'
import { DRAWING_COLOR_PRESETS, MAX_RECENT_COLORS, normalizeHexColor } from '../drawingStyle'

const props = defineProps<{
  style: ReplayDrawingStyle
  recentColors: readonly string[]
  locked: boolean
  hasSelection: boolean
  context: 'default' | 'native' | 'position'
  label: string
}>()

const emit = defineEmits<{
  (event: 'update:style', patch: Partial<ReplayDrawingStyle>): void
  (event: 'remember-color', color: string): void
  (event: 'delete'): void
}>()

type Panel = 'color' | 'width' | 'line' | 'settings'

const root = ref<HTMLElement | null>(null)
const panel = ref<Panel | null>(null)
const hexDraft = ref(props.style.color)
const hexError = ref(false)
const triggers = ref<Record<Panel, HTMLButtonElement | null>>({
  color: null,
  width: null,
  line: null,
  settings: null,
})

const width = computed(() => Math.min(8, Math.max(1, Math.round(props.style.width))))
const currentColor = computed(() => props.style.color.toLowerCase())
const recent = computed(() => props.recentColors.slice(0, MAX_RECENT_COLORS))
const title = computed(() => props.context === 'default' || !props.label
  ? t('chart.defaultStyle')
  : `${t('chart.selectedDrawing')} · ${props.label}`)

watch(() => props.style.color, (color) => {
  if (!hexError.value) hexDraft.value = color
})

watch(() => props.locked, (locked) => {
  if (locked) panel.value = null
})

function setTrigger(name: Panel, element: unknown) {
  triggers.value[name] = element as HTMLButtonElement | null
}

async function toggle(name: Panel) {
  if (props.locked) return
  if (panel.value === name) {
    close()
    return
  }
  panel.value = name
  if (name === 'color') {
    hexDraft.value = props.style.color
    hexError.value = false
  }
  await nextTick()
  const focusTarget = name === 'color'
    ? '[data-testid="drawing-color"]'
    : name === 'width'
      ? '[data-testid="drawing-width"]'
      : name === 'line'
        ? '[data-testid="drawing-line-solid"]'
        : '[data-testid="drawing-fill"]'
  root.value?.querySelector<HTMLElement>(focusTarget)?.focus()
}

function close(restoreFocus = false) {
  const current = panel.value
  panel.value = null
  if (restoreFocus && current) triggers.value[current]?.focus()
}

function apply(patch: Partial<ReplayDrawingStyle>) {
  if (props.locked) return
  emit('update:style', patch)
}

function applyColor(value: string, remember = false): boolean {
  const normalized = normalizeHexColor(value)
  if (!normalized) return false
  apply({ color: normalized })
  if (remember) emit('remember-color', normalized)
  hexDraft.value = normalized
  hexError.value = false
  return true
}

function applyHex() {
  if (!applyColor(hexDraft.value, true)) {
    hexError.value = true
    return
  }
  hexError.value = false
}

function resetHex() {
  if (!hexError.value) return
  hexDraft.value = props.style.color
  hexError.value = false
}

function onNativeColor(event: Event) {
  applyColor((event.target as HTMLInputElement).value)
}

function onNativeChange(event: Event) {
  const normalized = normalizeHexColor((event.target as HTMLInputElement).value)
  if (normalized) emit('remember-color', normalized)
}

function applyFill(event: Event) {
  const value = (event.target as HTMLInputElement).value
  apply({ fill: value })
}

function applyFillChange(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('remember-color', normalizeHexColor(value) ?? value)
}

function setWidth(value: number | string) {
  apply({ width: Number(value) })
}

function setDashed(value: boolean) {
  apply({ dashed: value })
}

function clearFill() {
  apply({ fill: null })
}

function resetStyle() {
  apply({ ...DEFAULT_REPLAY_DRAWING_STYLE })
  hexDraft.value = DEFAULT_REPLAY_DRAWING_STYLE.color
  hexError.value = false
  emit('remember-color', DEFAULT_REPLAY_DRAWING_STYLE.color)
}

function removeSelected() {
  if (props.locked || !props.hasSelection) return
  close()
  emit('delete')
}

function onDocumentMouseDown(event: MouseEvent) {
  if (!panel.value) return
  if (root.value?.contains(event.target as Node)) return
  close()
}

onMounted(() => document.addEventListener('mousedown', onDocumentMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentMouseDown))
</script>

<template>
  <div
    ref="root"
    class="drawing-style-bar"
    role="toolbar"
    :aria-label="t('chart.drawingStyle')"
    data-testid="drawing-style-bar"
    @pointerdown.stop
    @click.stop
    @keydown.esc.stop="close(true)"
  >
    <span class="drawing-style-label" :title="title">{{ title }}</span>

    <button
      :ref="(element) => setTrigger('color', element)"
      class="style-trigger"
      type="button"
      data-testid="drawing-color-trigger"
      aria-haspopup="dialog"
      aria-controls="drawing-style-color-panel"
      :aria-expanded="panel === 'color'"
      :aria-label="t('chart.lineColor')"
      :title="t('chart.lineColor')"
      :disabled="locked"
      @click="toggle('color')"
    >
      <span class="color-dot" :style="{ background: style.color }" aria-hidden="true" />
      <ChevronDown :size="10" aria-hidden="true" />
    </button>

    <button
      :ref="(element) => setTrigger('width', element)"
      class="style-trigger"
      type="button"
      data-testid="drawing-width-trigger"
      aria-haspopup="dialog"
      aria-controls="drawing-style-width-panel"
      :aria-expanded="panel === 'width'"
      :aria-label="t('chart.widthValue', { n: width })"
      :title="t('chart.width')"
      :disabled="locked"
      @click="toggle('width')"
    >
      <span class="line-sample" :style="{ height: `${width}px` }" aria-hidden="true" />
      <span class="trigger-value">{{ width }}</span>
      <ChevronDown :size="10" aria-hidden="true" />
    </button>

    <button
      :ref="(element) => setTrigger('line', element)"
      class="style-trigger"
      type="button"
      data-testid="drawing-line-trigger"
      aria-haspopup="dialog"
      aria-controls="drawing-style-line-panel"
      :aria-expanded="panel === 'line'"
      :aria-label="t('chart.lineStyle')"
      :title="t('chart.lineStyle')"
      :disabled="locked"
      @click="toggle('line')"
    >
      <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
        <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" :stroke-width="width" :stroke-dasharray="style.dashed ? '4 3' : undefined" stroke-linecap="round" />
      </svg>
      <ChevronDown :size="10" aria-hidden="true" />
    </button>

    <button
      :ref="(element) => setTrigger('settings', element)"
      class="style-trigger"
      type="button"
      data-testid="drawing-settings-trigger"
      aria-haspopup="dialog"
      aria-controls="drawing-style-settings-panel"
      :aria-expanded="panel === 'settings'"
      :aria-label="t('chart.styleSettings')"
      :title="t('chart.styleSettings')"
      :disabled="locked"
      @click="toggle('settings')"
    >
      <SlidersHorizontal :size="14" aria-hidden="true" />
      <ChevronDown :size="10" aria-hidden="true" />
    </button>

    <button
      class="style-trigger is-danger"
      type="button"
      data-testid="drawing-delete-selected"
      :aria-label="t('chart.deleteSelected')"
      :title="t('chart.deleteSelectedTitle')"
      :disabled="locked || !hasSelection"
      @click="removeSelected"
    >
      <Trash2 :size="14" aria-hidden="true" />
    </button>

    <div
      v-if="panel === 'color'"
      id="drawing-style-color-panel"
      class="style-panel color-panel"
      role="dialog"
      :aria-label="t('chart.lineColor')"
    >
      <strong>{{ t('chart.lineColor') }}</strong>
      <div class="swatch-grid" role="radiogroup" :aria-label="t('chart.colorPresets')">
        <button
          v-for="color in DRAWING_COLOR_PRESETS"
          :key="color"
          class="swatch"
          type="button"
          role="radio"
          :aria-checked="currentColor === color"
          :aria-label="color"
          :title="color"
          :data-color="color"
          :disabled="locked"
          @click="applyColor(color, true)"
        >
          <span class="swatch-fill" :style="{ background: color }" />
          <Check v-if="currentColor === color" class="swatch-check" :size="13" aria-hidden="true" />
        </button>
      </div>

      <div class="custom-row">
        <span class="swatch is-picker" :style="{ background: style.color }">
          <input
            class="native-color"
            type="color"
            data-testid="drawing-color-native"
            :value="style.color"
            :disabled="locked"
            :aria-label="t('chart.customColor')"
            @input="onNativeColor"
            @change="onNativeChange"
          />
        </span>
        <span class="custom-label">{{ t('chart.customColor') }}</span>
        <input
          v-model="hexDraft"
          class="hex-input"
          type="text"
          maxlength="7"
          spellcheck="false"
          autocomplete="off"
          data-testid="drawing-color"
          :aria-label="t('chart.hexColor')"
          :aria-invalid="hexError"
          :disabled="locked"
          @keydown.enter.prevent="applyHex"
          @blur="resetHex"
        />
      </div>
      <p v-if="hexError" class="hex-error" role="alert">{{ t('chart.invalidColor') }}</p>

      <template v-if="recent.length">
        <strong class="recent-title">{{ t('chart.recentColors') }}</strong>
        <div class="swatch-grid recent-grid">
          <button
            v-for="color in recent"
            :key="color"
            class="swatch is-small"
            type="button"
            :style="{ background: color }"
            :aria-label="color"
            :title="color"
            :disabled="locked"
            @click="applyColor(color, true)"
          />
        </div>
      </template>
    </div>

    <div
      v-if="panel === 'width'"
      id="drawing-style-width-panel"
      class="style-panel"
      role="dialog"
      :aria-label="t('chart.width')"
    >
      <strong>{{ t('chart.width') }}</strong>
      <div class="width-presets" role="group" :aria-label="t('chart.width')">
        <button
          v-for="value in [1, 2, 3, 4]"
          :key="value"
          class="width-preset"
          type="button"
          :aria-pressed="width === value"
          :data-testid="`drawing-width-preset-${value}`"
          :disabled="locked"
          @click="setWidth(value)"
        >
          <span class="line-sample is-wide" :style="{ height: `${value}px` }" aria-hidden="true" />
          <span>{{ t('chart.widthValue', { n: value }) }}</span>
        </button>
      </div>
      <div class="slider-row">
        <input
          type="range"
          min="1"
          max="8"
          step="1"
          data-testid="drawing-width"
          :aria-label="t('chart.width')"
          :aria-valuetext="t('chart.widthValue', { n: width })"
          :value="width"
          :disabled="locked"
          @input="setWidth(($event.target as HTMLInputElement).value)"
        />
        <output data-testid="drawing-width-value">{{ t('chart.widthValue', { n: width }) }}</output>
      </div>
    </div>

    <div
      v-if="panel === 'line'"
      id="drawing-style-line-panel"
      class="style-panel"
      role="dialog"
      :aria-label="t('chart.lineStyle')"
    >
      <strong>{{ t('chart.lineStyle') }}</strong>
      <div class="line-options" role="radiogroup" :aria-label="t('chart.lineStyle')">
        <button
          type="button"
          role="radio"
          data-testid="drawing-line-solid"
          :aria-checked="!style.dashed"
          :disabled="locked"
          @click="setDashed(false)"
        >
          <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true">
            <line x1="1" y1="6" x2="39" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span>{{ t('chart.solid') }}</span>
        </button>
        <button
          type="button"
          role="radio"
          data-testid="drawing-dashed"
          :aria-checked="style.dashed"
          :disabled="locked"
          @click="setDashed(true)"
        >
          <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true">
            <line x1="1" y1="6" x2="39" y2="6" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round" />
          </svg>
          <span>{{ t('chart.dashed') }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="panel === 'settings'"
      id="drawing-style-settings-panel"
      class="style-panel"
      role="dialog"
      :aria-label="t('chart.styleSettings')"
    >
      <strong>{{ t('chart.styleSettings') }}</strong>
      <div class="fill-row">
        <span class="swatch is-picker" :class="{ 'is-empty': style.fill == null }" :style="style.fill ? { background: style.fill } : undefined">
          <input
            class="native-color"
            type="color"
            data-testid="drawing-fill"
            :value="style.fill ?? '#000000'"
            :disabled="locked"
            :aria-label="t('chart.fillColor')"
            @input="applyFill"
            @change="applyFillChange"
          />
        </span>
        <span>{{ t('chart.fill') }}</span>
        <button
          type="button"
          class="text-button"
          data-testid="drawing-no-fill"
          :aria-pressed="style.fill == null"
          :disabled="locked"
          @click="clearFill"
        >{{ t('chart.noFill') }}</button>
      </div>
      <button type="button" class="reset-button" data-testid="drawing-reset-style" :disabled="locked" @click="resetStyle">
        <RotateCcw :size="12" aria-hidden="true" />
        {{ t('chart.resetStyle') }}
      </button>
      <p class="panel-hint">{{ t('chart.styleApplyHint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.drawing-style-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 2px 4px;
  background: #0f172a;
  color: #dbe4ee;
  border: 1px solid #334155;
  border-radius: 6px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
}
.drawing-style-label {
  max-width: 128px;
  padding: 0 4px;
  overflow: hidden;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.style-trigger {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 26px;
  min-height: 26px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.style-trigger:hover:not(:disabled) {
  background: #1e293b;
  color: #f8fafc;
}
.style-trigger[aria-expanded="true"] {
  border-color: rgba(250, 204, 21, 0.6);
  background: rgba(250, 204, 21, 0.12);
  color: #facc15;
}
.style-trigger.is-danger:hover:not(:disabled) {
  background: rgba(251, 113, 133, 0.16);
  color: #fecdd3;
}
.style-trigger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.style-trigger:focus-visible,
.swatch:focus-visible,
.style-panel button:focus-visible,
.style-panel input:focus-visible {
  outline: 2px solid #facc15;
  outline-offset: 1px;
}
.color-dot {
  display: block;
  width: 14px;
  height: 14px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
}
.line-sample {
  display: block;
  width: 18px;
  min-height: 1px;
  border-radius: 1px;
  background: currentColor;
}
.line-sample.is-wide {
  width: 30px;
}
.trigger-value {
  min-width: 8px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.style-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 1;
  display: grid;
  gap: 8px;
  width: min(280px, calc(100vw - 16px));
  max-height: min(360px, 66vh);
  overflow: auto;
  padding: 10px;
  background: #0f172a;
  color: #dbe4ee;
  border: 1px solid #334155;
  border-radius: 8px;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.55);
}
.style-panel strong {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.swatch-grid {
  display: grid;
  grid-template-columns: repeat(6, 26px);
  gap: 6px;
}
.recent-grid {
  grid-template-columns: repeat(8, 22px);
}
.recent-title {
  margin-top: 2px;
}
.swatch {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  min-height: 26px;
  padding: 0;
  overflow: hidden;
  border: 1px solid #475569;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.swatch:hover:not(:disabled) {
  border-color: #e2e8f0;
}
.swatch[aria-checked="true"] {
  border-color: #facc15;
  box-shadow: 0 0 0 1px #facc15;
}
.swatch.is-small {
  width: 22px;
  height: 22px;
  min-height: 22px;
}
.swatch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.swatch-fill {
  position: absolute;
  inset: 2px;
  border-radius: 2px;
}
.swatch-check {
  position: relative;
  color: #0b1220;
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.8));
}
.swatch.is-picker {
  width: 26px;
  height: 26px;
  border-color: #64748b;
}
.swatch.is-empty {
  background: #0b1220;
}
.swatch.is-empty::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 2px;
  background: linear-gradient(to top right, transparent calc(50% - 0.75px), #cbd5e1 calc(50% - 0.75px), #cbd5e1 calc(50% + 0.75px), transparent calc(50% + 0.75px));
  pointer-events: none;
}
.native-color {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}
.custom-row,
.fill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  color: #94a3b8;
  font-size: 11px;
}
.custom-label {
  flex: 1;
  color: #94a3b8;
}
.hex-input {
  width: 84px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid #334155;
  border-radius: 4px;
  background: #0b1220;
  color: #dbe4ee;
  font-family: 'Fira Code', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.03em;
}
.hex-input[aria-invalid="true"] {
  border-color: #fb7185;
}
.hex-error {
  margin: 0;
  color: #fecdd3;
  font-size: 10.5px;
  line-height: 1.35;
}
.width-presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.width-preset {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid #334155;
  border-radius: 4px;
  background: #0b1220;
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
}
.width-preset:hover:not(:disabled) {
  border-color: #64748b;
  color: #f8fafc;
}
.width-preset[aria-pressed="true"] {
  border-color: #facc15;
  background: rgba(250, 204, 21, 0.1);
  color: #facc15;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slider-row input[type="range"] {
  flex: 1;
  height: 20px;
  margin: 0;
  accent-color: #facc15;
  cursor: pointer;
}
.slider-row output {
  min-width: 46px;
  color: #cbd5e1;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.line-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.line-options button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 46px;
  padding: 6px;
  border: 1px solid #334155;
  border-radius: 4px;
  background: #0b1220;
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
}
.line-options button:hover:not(:disabled) {
  border-color: #64748b;
  color: #f8fafc;
}
.line-options button[aria-checked="true"] {
  border-color: #facc15;
  background: rgba(250, 204, 21, 0.1);
  color: #facc15;
}
.text-button,
.reset-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  min-height: 26px;
  margin-left: auto;
  padding: 0 8px;
  border: 1px solid #334155;
  border-radius: 4px;
  background: #0b1220;
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
}
.text-button[aria-pressed="true"] {
  border-color: #facc15;
  color: #facc15;
}
.reset-button {
  justify-self: start;
  margin-left: 0;
}
.text-button:hover:not(:disabled),
.reset-button:hover:not(:disabled) {
  border-color: #64748b;
  color: #f8fafc;
}
.panel-hint {
  margin: 0;
  color: #94a3b8;
  font-size: 10.5px;
  line-height: 1.4;
}
.style-panel button:disabled,
.style-panel input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@container (max-width: 639px) {
  .drawing-style-bar {
    gap: 1px;
    padding: 2px 3px;
  }
  .drawing-style-label {
    display: none;
  }
  .swatch-grid {
    grid-template-columns: repeat(4, 26px);
  }
  .recent-grid {
    grid-template-columns: repeat(6, 22px);
  }
}
@media (pointer: coarse) {
  .style-trigger {
    height: 30px;
    min-height: 30px;
    padding: 0 7px;
  }
  .swatch,
  .swatch.is-picker {
    width: 30px;
    height: 30px;
    min-height: 30px;
  }
  .swatch-grid {
    grid-template-columns: repeat(5, 30px);
  }
}
</style>
