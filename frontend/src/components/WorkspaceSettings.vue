<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from '@lucide/vue'
import { t } from '../i18n'
import { shortcutActions, shortcutActionLabel, shortcutLabel, validShortcut, defaultShortcuts, type ShortcutBindings, type ShortcutAction } from '../shortcuts'

const props = defineProps<{
  bindings: ShortcutBindings
  colors: { up: string; down: string; hollow: boolean }
}>()
const emit = defineEmits<{
  bindings: [value: ShortcutBindings]
  colors: [value: { up: string; down: string; hollow: boolean }]
  opened: [value: boolean]
}>()

const tabs = computed(() => [
  { id: 'settings' as const, label: t('settings.tabGeneral') },
  { id: 'help' as const, label: t('settings.tabHelp') },
])
const helpGroups = computed<{ title: string; actions: ShortcutAction[] }[]>(() => [
  { title: t('settings.groupAdvance'), actions: ['forward', 'backward', 'play'] },
  { title: t('settings.groupTrading'), actions: ['buy', 'sell'] },
  { title: t('settings.groupChart'), actions: ['trend'] },
])
const previewBars = [
  { open: 80, close: 42, high: 30, low: 96 },
  { open: 46, close: 88, high: 36, low: 104 },
  { open: 96, close: 60, high: 48, low: 110 },
  { open: 58, close: 100, high: 44, low: 114 },
  { open: 92, close: 56, high: 40, low: 102 },
  { open: 66, close: 28, high: 16, low: 76 },
]

const dialog = ref<HTMLDialogElement>()
const tab = ref<'help' | 'settings'>('settings')
const recording = ref<ShortcutAction | null>(null)
const feedback = ref<{ kind: 'ok' | 'error'; text: string } | null>(null)

function open(value: 'help' | 'settings') {
  setTab(value)
  dialog.value?.showModal()
  emit('opened', true)
}
function setTab(value: 'help' | 'settings') {
  tab.value = value
  recording.value = null
  feedback.value = null
}
function close() {
  dialog.value?.close()
}
function closed() {
  recording.value = null
  emit('opened', false)
}
function moveTab(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const items = tabs.value
  const index = items.findIndex(item => item.id === tab.value)
  const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
  setTab(items[next].id)
  document.getElementById(`settings-tab-${items[next].id}`)?.focus()
}
function startRecording(id: ShortcutAction) {
  recording.value = id
  feedback.value = null
}
function capture(event: KeyboardEvent, id: ShortcutAction) {
  if (event.key === 'Tab') { recording.value = null; return }
  if (recording.value !== id) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { recording.value = null; return }
  const key = event.key.toLowerCase()
  if (event.repeat || event.isComposing) return
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !validShortcut(key)) {
    feedback.value = { kind: 'error', text: t('settings.invalidKey') }
    return
  }
  const conflict = shortcutActions.find(action => action.id !== id && props.bindings[action.id] === key)
  if (conflict) {
    feedback.value = { kind: 'error', text: t('settings.conflict', { label: shortcutActionLabel(conflict.id) }) }
    return
  }
  emit('bindings', { ...props.bindings, [id]: key })
  recording.value = null
  feedback.value = { kind: 'ok', text: t('settings.saved', { label: shortcutActionLabel(id), key: shortcutLabel(key) }) }
}
function resetColors() {
  emit('colors', { up: '#ffffff', down: '#ffffff', hollow: true })
}
function resetShortcuts() {
  emit('bindings', { ...defaultShortcuts })
  recording.value = null
  feedback.value = { kind: 'ok', text: t('settings.defaultsRestored') }
}
function actionLabel(id: ShortcutAction) {
  return shortcutActionLabel(id)
}
defineExpose({ open })
</script>

<template>
  <dialog
    ref="dialog"
    class="workspace-settings"
    aria-labelledby="workspace-settings-title"
    @close="closed"
    @click="($event.target === dialog) && close()"
  >
    <header class="settings-head">
      <h2 id="workspace-settings-title">{{ t('settings.title') }}</h2>
      <button class="icon-button" type="button" :aria-label="t('settings.close')" @click="close">
        <X :size="16" aria-hidden="true" />
      </button>
    </header>

    <div class="settings-tabs" role="tablist" :aria-label="t('settings.tabsLabel')" @keydown="moveTab">
      <button
        v-for="item in tabs"
        :id="`settings-tab-${item.id}`"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        :aria-controls="`settings-panel-${item.id}`"
        :tabindex="tab === item.id ? 0 : -1"
        :class="{ active: tab === item.id }"
        @click="setTab(item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="settings-body">
      <div
        v-if="tab === 'settings'"
        id="settings-panel-settings"
        class="settings-panel"
        role="tabpanel"
        aria-labelledby="settings-tab-settings"
      >
        <section class="settings-column">
          <div class="section-head">
            <h3>{{ t('settings.candleColors') }}</h3>
            <button class="link-button" type="button" @click="resetColors">{{ t('settings.reset') }}</button>
          </div>

          <div class="candle-preview" aria-hidden="true">
            <span class="preview-label">{{ t('settings.preview') }}</span>
            <svg viewBox="0 0 280 130" preserveAspectRatio="xMidYMid meet">
              <g v-for="(bar, index) in previewBars" :key="index">
                <line
                  :x1="26 + index * 42" :y1="bar.high" :x2="26 + index * 42" :y2="bar.low"
                  :stroke="bar.close < bar.open ? colors.up : colors.down"
                  stroke-width="1.5"
                />
                <rect
                  :x="21 + index * 42"
                  :y="Math.min(bar.open, bar.close)"
                  width="10"
                  :height="Math.max(2, Math.abs(bar.close - bar.open))"
                  :fill="bar.close > bar.open ? colors.down : colors.hollow ? 'none' : colors.up"
                  :stroke="bar.close > bar.open ? colors.down : colors.up"
                  stroke-width="1.5"
                />
              </g>
            </svg>
          </div>

          <div class="setting-rows">
            <div class="setting-row">
              <span class="row-label">{{ t('settings.upCandle') }}</span>
              <span class="hex">{{ colors.up.toUpperCase() }}</span>
              <label class="swatch" :style="{ background: colors.up }" :title="t('settings.upColor')">
                <input
                  type="color"
                  :aria-label="t('settings.upColorAria')"
                  :value="colors.up"
                  @input="emit('colors', { ...colors, up: ($event.target as HTMLInputElement).value })"
                />
              </label>
            </div>
            <div class="setting-row">
              <span class="row-label">{{ t('settings.downCandle') }}</span>
              <span class="hex">{{ colors.down.toUpperCase() }}</span>
              <label class="swatch" :style="{ background: colors.down }" :title="t('settings.downColor')">
                <input
                  type="color"
                  :aria-label="t('settings.downColorAria')"
                  :value="colors.down"
                  @input="emit('colors', { ...colors, down: ($event.target as HTMLInputElement).value })"
                />
              </label>
            </div>
            <label class="setting-row switch-row">
              <span class="row-label">
                {{ t('settings.hollow') }}
                <span class="row-hint">{{ t('settings.hollowHint') }}</span>
              </span>
              <input
                class="switch"
                type="checkbox"
                role="switch"
                :aria-label="t('settings.hollow')"
                :checked="colors.hollow"
                @change="emit('colors', { ...colors, hollow: ($event.target as HTMLInputElement).checked })"
              />
            </label>
          </div>

        </section>

        <section class="settings-column">
          <div class="section-head">
            <h3>{{ t('settings.shortcuts') }}</h3>
            <button class="link-button" type="button" @click="resetShortcuts">{{ t('settings.reset') }}</button>
          </div>
          <p class="section-note">{{ t('settings.shortcutsNote') }}</p>

          <div class="setting-rows key-rows">
            <div v-for="action in shortcutActions" :key="action.id" class="setting-row">
              <span class="row-label">{{ actionLabel(action.id) }}</span>
              <button
                type="button"
                class="keycap"
                :class="{ recording: recording === action.id }"
                :aria-label="t('settings.shortcutAria', { label: actionLabel(action.id), key: shortcutLabel(bindings[action.id]) })"
                @click="startRecording(action.id)"
                @blur="recording = null"
                @keydown="capture($event, action.id)"
              >
                <template v-if="recording === action.id">
                  <span class="recording-dot" aria-hidden="true" />
                  {{ t('settings.recording') }}
                </template>
                <template v-else>{{ shortcutLabel(bindings[action.id]) }}</template>
              </button>
            </div>
          </div>
          <p class="feedback" :class="feedback?.kind" role="status">{{ feedback?.text ?? '' }}</p>
        </section>
      </div>

      <section
        v-else
        id="settings-panel-help"
        class="settings-section"
        role="tabpanel"
        aria-labelledby="settings-tab-help"
      >
        <p class="help-intro">{{ t('settings.helpIntro') }}</p>
        <p class="help-note">{{ t('settings.helpNote') }}</p>

        <div v-for="group in helpGroups" :key="group.title" class="help-group">
          <h3>{{ group.title }}</h3>
          <dl class="help-rows">
            <div v-for="action in group.actions" :key="action" class="help-row">
              <dt>{{ actionLabel(action) }}</dt>
              <dd><kbd>{{ shortcutLabel(bindings[action]) }}</kbd></dd>
            </div>
          </dl>
        </div>

        <div class="help-footer">
          <p class="section-note">{{ t('settings.allCustomizable') }}</p>
          <button class="link-button" type="button" @click="setTab('settings')">{{ t('settings.goToShortcuts') }}</button>
        </div>
      </section>
    </div>

    <footer class="settings-foot">
      {{ t('settings.footer') }}
    </footer>
  </dialog>
</template>

<style scoped>
.workspace-settings {
  width: min(640px, calc(100vw - 24px));
  max-height: min(760px, calc(100dvh - 24px));
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 18px 48px rgba(17, 24, 39, 0.18), 0 2px 8px rgba(17, 24, 39, 0.08);
}
.workspace-settings:not([open]) {
  display: none;
}
.workspace-settings[open] {
  animation: settings-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
}
@starting-style {
  .workspace-settings[open] {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
}
.workspace-settings::backdrop {
  background: rgba(17, 24, 39, 0.42);
  backdrop-filter: blur(6px);
  animation: backdrop-in 200ms ease-out;
}
@starting-style {
  .workspace-settings[open]::backdrop {
    opacity: 0;
  }
}
@keyframes settings-in {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 0;
}
h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.icon-button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease;
}
.icon-button:hover {
  border-color: var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
}

.settings-tabs {
  display: flex;
  gap: 24px;
  padding: 16px 22px 0;
  border-bottom: 1px solid var(--border);
}
.settings-tabs button {
  position: relative;
  padding: 0 0 11px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: color 150ms ease;
}
.settings-tabs button:hover {
  color: var(--text);
}
.settings-tabs button.active {
  color: var(--text);
}
.settings-tabs button.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
}

.settings-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
.settings-body::-webkit-scrollbar {
  width: 8px;
}
.settings-body::-webkit-scrollbar-thumb {
  border: 2px solid var(--surface);
  border-radius: 999px;
  background: var(--border-strong);
}
.settings-panel {
  display: grid;
  gap: 28px;
}
.settings-column {
  display: grid;
  gap: 12px;
  align-content: start;
  min-width: 0;
}
.settings-section {
  display: grid;
  gap: 12px;
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.01em;
}
.link-button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: var(--border-strong);
  text-underline-offset: 4px;
  cursor: pointer;
  transition: color 150ms ease, text-decoration-color 150ms ease;
}
.link-button:hover {
  color: var(--text);
  text-decoration-color: var(--text);
}
.section-note {
  margin: -6px 0 0;
  color: var(--text-dim);
  font-size: 11.5px;
  line-height: 1.6;
}

.candle-preview {
  position: relative;
  height: auto;
  aspect-ratio: 280 / 130;
  overflow: hidden;
  border: 1px solid var(--chart-border);
  border-radius: 8px;
  background: var(--chart-bg);
}
.candle-preview svg {
  display: block;
  width: 100%;
  height: 100%;
}
.preview-label {
  position: absolute;
  top: 9px;
  left: 12px;
  color: rgba(219, 228, 238, 0.68);
  font-family: 'Fira Code', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.setting-rows {
  display: grid;
  border-top: 1px solid var(--border);
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.key-rows .setting-row {
  min-height: 44px;
  padding: 6px 0;
}
.row-label {
  display: grid;
  gap: 1px;
  margin-right: auto;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
}
.row-hint {
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 400;
}
.hex {
  color: var(--text-muted);
  font-family: 'Fira Code', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
}
.swatch {
  display: block;
  position: relative;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
  transition: transform 140ms ease, border-color 140ms ease;
}
.swatch:hover {
  transform: scale(1.06);
  border-color: var(--text);
}
.swatch:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}
.swatch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  margin: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}
.switch-row {
  cursor: pointer;
}
.switch {
  appearance: none;
  position: relative;
  width: 38px;
  height: 22px;
  min-height: 0;
  flex: 0 0 38px;
  padding: 0;
  margin: 0;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface-3);
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease;
}
.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.28);
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.switch:checked {
  border-color: var(--accent);
  background: var(--accent);
}
.switch:checked::after {
  transform: translateX(16px);
}
.switch:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

.keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 96px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-bottom-color: var(--border-strong);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  font-family: 'Fira Code', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease;
}
.keycap:hover {
  border-color: var(--border-strong);
  background: var(--surface-3);
}
.keycap.recording {
  border-color: var(--text);
  background: var(--surface);
  color: var(--text-muted);
  letter-spacing: 0.02em;
}
.recording-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text);
  animation: record-pulse 900ms ease-in-out infinite;
}
@keyframes record-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}

.feedback {
  min-height: 16px;
  margin: 0;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.5;
}
.feedback.error {
  color: var(--danger);
  font-weight: 600;
}

.help-intro {
  margin: 0;
  max-width: 56ch;
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.75;
}
.help-note {
  margin: -4px 0 6px;
  color: var(--text-dim);
  font-size: 11.5px;
  line-height: 1.6;
}
.help-group {
  display: grid;
  gap: 6px;
}
.help-group + .help-group {
  margin-top: 10px;
}
.help-group h3 {
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.help-rows {
  display: grid;
  margin: 0;
  border-top: 1px solid var(--border);
}
.help-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}
.help-row dt {
  font-size: 12.5px;
  font-weight: 600;
}
.help-row dd {
  margin: 0;
}
.help-row kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-bottom-color: var(--border-strong);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  font-family: 'Fira Code', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.help-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.help-footer .section-note {
  margin: 0;
}

.settings-foot {
  flex: none;
  padding: 12px 22px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.5;
}

::selection {
  background: var(--text);
  color: var(--surface);
}

@media (min-width: 660px) {
  .settings-panel {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
@media (max-width: 520px) {
  .workspace-settings {
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
  }
  .settings-head {
    padding: 16px 16px 0;
  }
  .settings-tabs {
    gap: 18px;
    padding: 14px 16px 0;
  }
  .settings-body {
    padding: 18px 16px;
  }
  .settings-foot {
    padding: 11px 16px;
  }
  .icon-button {
    width: 36px;
    height: 36px;
  }
  .candle-preview {
    aspect-ratio: auto;
    height: 112px;
  }
  .keycap {
    min-width: 84px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-settings[open],
  .workspace-settings::backdrop {
    animation: none;
  }
  .recording-dot {
    animation: none;
  }
}
</style>
