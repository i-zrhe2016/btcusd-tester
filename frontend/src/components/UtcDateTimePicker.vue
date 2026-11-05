<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from '@lucide/vue'
import { locale, t } from '../i18n'

interface UtcParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

interface GridDay {
  key: string
  year: number
  month: number
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string
  inputId?: string
  disabled?: boolean
  compact?: boolean
  initialValue?: string
}>(), {
  inputId: undefined,
  disabled: false,
  compact: false,
  initialValue: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const DAY_MS = 86_400_000
let pickerSeq = 0
const panelId = `dtp-panel-${++pickerSeq}`

const root = ref<HTMLElement | null>(null)
const inputElement = ref<HTMLInputElement | null>(null)
const panelElement = ref<HTMLElement | null>(null)
const inputFocused = ref(false)
const open = ref(false)
const placement = ref<'above' | 'below' | 'left' | 'right' | 'sheet'>('below')
const panelStyle = ref<Record<string, string>>({})
const activeTrigger = ref<HTMLElement | null>(null)

const mode = ref<'days' | 'months' | 'years'>('days')
const viewYear = ref(1970)
const viewMonth = ref(0)
const yearsStart = ref(1970)
const focusDate = ref<UtcParts>({ year: 1970, month: 1, day: 1, hour: 0, minute: 0 })

const pad = (value: number) => String(value).padStart(2, '0')

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function partsFromStamp(stamp: number): UtcParts {
  const date = new Date(stamp)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }
}

function utcNow(): UtcParts {
  const now = new Date()
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
  }
}

function parseParts(raw: string): UtcParts | null {
  if (!raw) return null
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?)?(?:\s*(?:Z|UTC))?$/i.exec(raw.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59) return null
  return { year, month, day, hour, minute }
}

function canonical(parts: UtcParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

function displayValue(raw: string): string {
  const parts = parseParts(raw)
  return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}` : ''
}

function dayKey(parts: Pick<UtcParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

const selectedParts = computed(() => parseParts(props.modelValue))
const fallbackParts = computed(() => parseParts(props.initialValue) ?? utcNow())
const draft = ref(displayValue(props.modelValue))

watch(() => props.modelValue, (value) => {
  if (!inputFocused.value) draft.value = displayValue(value)
  if (!open.value) syncViewFrom(value)
})

watch(() => props.disabled, (value) => {
  if (value && open.value) closePanel(false)
})

function syncViewFrom(raw: string) {
  const parts = parseParts(raw)
  if (!parts) return
  viewYear.value = parts.year
  viewMonth.value = parts.month - 1
  focusDate.value = parts
}

const localeCode = computed(() => (locale.value === 'zh' ? 'zh-CN' : 'en-US'))
const monthNames = computed(() => {
  if (locale.value === 'zh') return Array.from({ length: 12 }, (_, index) => `${index + 1} 月`)
  const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
  return Array.from({ length: 12 }, (_, index) => formatter.format(new Date(Date.UTC(2021, index, 1))))
})
const weekdayNames = computed(() => (locale.value === 'zh'
  ? ['一', '二', '三', '四', '五', '六', '日']
  : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']))
const dayLabelFormatter = computed(() => new Intl.DateTimeFormat(localeCode.value, {
  timeZone: 'UTC',
  dateStyle: 'full',
}))

const today = ref(utcNow())
watch(open, (value) => {
  if (value) today.value = utcNow()
})

const gridDays = computed<GridDay[]>(() => {
  const firstStamp = Date.UTC(viewYear.value, viewMonth.value, 1)
  const offset = (new Date(firstStamp).getUTCDay() + 6) % 7
  const start = firstStamp - offset * DAY_MS
  const current = today.value
  const selected = selectedParts.value
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start + index * DAY_MS)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    return {
      key: dayKey({ year, month, day }),
      year,
      month,
      day,
      inMonth: month === viewMonth.value + 1,
      isToday: year === current.year && month === current.month && day === current.day,
      isSelected: Boolean(selected
        && year === selected.year && month === selected.month && day === selected.day),
    }
  })
})

const focusKey = computed(() => dayKey(focusDate.value))
const selectedTime = computed(() => {
  const parts = selectedParts.value ?? fallbackParts.value
  return { hour: parts.hour, minute: parts.minute }
})

const headerTitle = computed(() => {
  if (mode.value === 'days') {
    return locale.value === 'zh'
      ? `${viewYear.value} 年 ${viewMonth.value + 1} 月`
      : `${monthNames.value[viewMonth.value]} ${viewYear.value}`
  }
  if (mode.value === 'months') return locale.value === 'zh' ? `${viewYear.value} 年` : String(viewYear.value)
  return `${yearsStart.value}–${yearsStart.value + 11}`
})
const headerAction = computed(() => (mode.value === 'days'
  ? t('datepicker.chooseMonth')
  : t('datepicker.chooseYear')))
const stepLabel = computed(() => {
  if (mode.value === 'days') return [t('datepicker.previousMonth'), t('datepicker.nextMonth')]
  if (mode.value === 'months') return [t('datepicker.previousYear'), t('datepicker.nextYear')]
  return [t('datepicker.previousYears'), t('datepicker.nextYears')]
})

const yearCells = computed(() => Array.from({ length: 12 }, (_, index) => yearsStart.value + index))

function dayLabel(cell: GridDay): string {
  return dayLabelFormatter.value.format(new Date(Date.UTC(cell.year, cell.month - 1, cell.day)))
}

function commit(parts: UtcParts) {
  const value = canonical(parts)
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function pickDay(cell: GridDay) {
  const time = selectedTime.value
  const parts: UtcParts = { year: cell.year, month: cell.month, day: cell.day, ...time }
  viewYear.value = cell.year
  viewMonth.value = cell.month - 1
  focusDate.value = parts
  commit(parts)
}

function pickMonth(index: number) {
  viewMonth.value = index
  mode.value = 'days'
  const day = Math.min(focusDate.value.day, daysInMonth(viewYear.value, index + 1))
  focusDate.value = { ...focusDate.value, year: viewYear.value, month: index + 1, day }
  void nextTick(() => {
    updatePosition()
    focusDayCell()
  })
}

function pickYear(year: number) {
  viewYear.value = year
  mode.value = 'months'
  void nextTick(() => {
    updatePosition()
    focusMonthCell()
  })
}

function drillDown() {
  if (mode.value === 'days') {
    mode.value = 'months'
    void nextTick(() => {
      updatePosition()
      focusMonthCell()
    })
  } else if (mode.value === 'months') {
    mode.value = 'years'
    yearsStart.value = viewYear.value - ((viewYear.value % 12 + 12) % 12)
    void nextTick(() => {
      updatePosition()
      focusYearCell()
    })
  }
}

function step(delta: number) {
  if (mode.value === 'days') {
    const target = new Date(Date.UTC(viewYear.value, viewMonth.value + delta, 1))
    viewYear.value = target.getUTCFullYear()
    viewMonth.value = target.getUTCMonth()
    const day = Math.min(focusDate.value.day, daysInMonth(viewYear.value, viewMonth.value + 1))
    focusDate.value = { ...focusDate.value, year: viewYear.value, month: viewMonth.value + 1, day }
  } else if (mode.value === 'months') {
    viewYear.value += delta
    focusDate.value = { ...focusDate.value, year: viewYear.value }
  } else {
    yearsStart.value += delta * 12
  }
}

function setFocus(parts: UtcParts) {
  focusDate.value = parts
  viewYear.value = parts.year
  viewMonth.value = parts.month - 1
  void nextTick(focusDayCell)
}

function shiftDay(days: number) {
  const base = focusDate.value
  setFocus(partsFromStamp(Date.UTC(base.year, base.month - 1, base.day) + days * DAY_MS))
}

function shiftMonth(months: number) {
  const base = focusDate.value
  const target = new Date(Date.UTC(base.year, base.month - 1 + months, 1))
  const year = target.getUTCFullYear()
  const month = target.getUTCMonth() + 1
  setFocus({ ...base, year, month, day: Math.min(base.day, daysInMonth(year, month)) })
}

function onDayKey(event: KeyboardEvent, cell: GridDay) {
  switch (event.key) {
    case 'ArrowLeft': shiftDay(-1); break
    case 'ArrowRight': shiftDay(1); break
    case 'ArrowUp': shiftDay(-7); break
    case 'ArrowDown': shiftDay(7); break
    case 'PageUp': shiftMonth(-1); break
    case 'PageDown': shiftMonth(1); break
    case 'Home': shiftDay(-((new Date(Date.UTC(cell.year, cell.month - 1, cell.day)).getUTCDay() + 6) % 7)); break
    case 'End': shiftDay(6 - ((new Date(Date.UTC(cell.year, cell.month - 1, cell.day)).getUTCDay() + 6) % 7)); break
    default: return
  }
  event.preventDefault()
}

function focusDayCell() {
  panelElement.value?.querySelector<HTMLElement>(`[data-date="${focusKey.value}"]`)?.focus()
}
function focusMonthCell() {
  panelElement.value?.querySelector<HTMLElement>(`[data-month="${viewMonth.value}"]`)?.focus()
}
function focusYearCell() {
  panelElement.value?.querySelector<HTMLElement>(`[data-year="${viewYear.value}"]`)?.focus()
}

function pickToday() {
  const current = utcNow()
  today.value = current
  const time = selectedTime.value
  const parts: UtcParts = { ...current, ...time }
  viewYear.value = current.year
  viewMonth.value = current.month - 1
  focusDate.value = parts
  commit(parts)
  void nextTick(() => {
    updatePosition()
    focusDayCell()
  })
}

function changeHour(event: Event) {
  const hour = Number((event.target as HTMLSelectElement).value)
  const date = selectedParts.value ?? focusDate.value
  commit({ ...date, hour, minute: selectedTime.value.minute })
}

function changeMinute(event: Event) {
  const minute = Number((event.target as HTMLSelectElement).value)
  const date = selectedParts.value ?? focusDate.value
  commit({ ...date, hour: selectedTime.value.hour, minute })
}

function updatePosition() {
  const anchor = root.value?.getBoundingClientRect()
  if (!anchor) return
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // Phones get a bottom sheet: 324px floating panels would leave no context.
  if (viewportWidth < 560) {
    placement.value = 'sheet'
    panelStyle.value = {
      left: '8px',
      right: '8px',
      bottom: '8px',
      maxHeight: `${Math.min(560, Math.round(viewportHeight * 0.82))}px`,
    }
    return
  }

  const width = Math.min(324, viewportWidth - 16)
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8))

  // Measure the unconstrained panel first so the side decision uses the full height.
  if (panelElement.value) panelElement.value.style.maxHeight = 'none'
  const naturalHeight = panelElement.value?.getBoundingClientRect().height ?? 410
  const spaceBelow = viewportHeight - anchor.bottom - 8
  const spaceAbove = anchor.top - 8
  const spaceRight = viewportWidth - anchor.right - 8
  const spaceLeft = anchor.left - 8

  if (spaceBelow >= naturalHeight) {
    placement.value = 'below'
    panelStyle.value = {
      left: `${left}px`,
      top: `${anchor.bottom + 8}px`,
      width: `${width}px`,
      maxHeight: `${naturalHeight}px`,
    }
    return
  }
  if (spaceAbove >= naturalHeight) {
    placement.value = 'above'
    panelStyle.value = {
      left: `${left}px`,
      top: `${anchor.top - naturalHeight - 8}px`,
      width: `${width}px`,
      maxHeight: `${naturalHeight}px`,
    }
    return
  }
  if (spaceRight >= width) {
    placement.value = 'right'
    panelStyle.value = {
      left: `${anchor.right + 8}px`,
      top: `${Math.max(8, Math.min(anchor.top, viewportHeight - naturalHeight - 8))}px`,
      width: `${width}px`,
      maxHeight: `${naturalHeight}px`,
    }
    return
  }
  if (spaceLeft >= width) {
    placement.value = 'left'
    panelStyle.value = {
      left: `${anchor.left - width - 8}px`,
      top: `${Math.max(8, Math.min(anchor.top, viewportHeight - naturalHeight - 8))}px`,
      width: `${width}px`,
      maxHeight: `${naturalHeight}px`,
    }
    return
  }

  // No side has the full height: stay adjacent and let the calendar body scroll.
  const placeAbove = spaceAbove > spaceBelow
  const maxHeight = Math.max(180, Math.min(naturalHeight, (placeAbove ? spaceAbove : spaceBelow) - 2))
  placement.value = placeAbove ? 'above' : 'below'
  panelStyle.value = {
    left: `${left}px`,
    top: placeAbove
      ? `${Math.max(8, anchor.top - maxHeight - 8)}px`
      : `${Math.min(anchor.bottom + 8, viewportHeight - maxHeight - 8)}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  }
}

async function openPanel(source: HTMLElement) {
  if (props.disabled || open.value) return
  activeTrigger.value = source
  const base = selectedParts.value ?? fallbackParts.value
  viewYear.value = base.year
  viewMonth.value = base.month - 1
  focusDate.value = base
  mode.value = 'days'

  // Seed the position before the first paint so the panel never flashes elsewhere.
  const anchor = root.value?.getBoundingClientRect() ?? source.getBoundingClientRect()
  if (window.innerWidth < 560) {
    placement.value = 'sheet'
    panelStyle.value = {
      left: '8px',
      right: '8px',
      bottom: '8px',
      maxHeight: `${Math.min(560, Math.round(window.innerHeight * 0.82))}px`,
    }
  } else {
    const width = Math.min(324, window.innerWidth - 16)
    placement.value = 'below'
    panelStyle.value = {
      left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`,
      top: `${anchor.bottom + 8}px`,
      width: `${width}px`,
      maxHeight: 'calc(100vh - 16px)',
    }
  }

  open.value = true
  await nextTick()
  updatePosition()
  await nextTick()
  updatePosition()
  focusDayCell()
}

function closePanel(returnFocus = true) {
  if (!open.value) return
  open.value = false
  mode.value = 'days'
  if (returnFocus) activeTrigger.value?.focus()
}

function toggleFrom(event: MouseEvent) {
  if (open.value) closePanel()
  else void openPanel(event.currentTarget as HTMLElement)
}

function onArrowDown(event: KeyboardEvent) {
  void openPanel(event.currentTarget as HTMLElement)
}

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
  const parts = parseParts(draft.value)
  if (parts) commit(parts)
}

function onBlur() {
  inputFocused.value = false
  draft.value = displayValue(props.modelValue)
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closePanel()
    return
  }
  if (event.key !== 'Tab') return
  const focusables = panelElement.value
    ? Array.from(panelElement.value.querySelectorAll<HTMLElement>('button, select, input'))
      .filter(element => !element.hasAttribute('disabled') && element.tabIndex >= 0)
    : []
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inside = Boolean(active && panelElement.value?.contains(active))
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault()
    first.focus()
  }
}

function onDocumentPointer(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (root.value?.contains(target) || panelElement.value?.contains(target)) return
  closePanel(false)
}

function addWindowListeners() {
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  document.addEventListener('pointerdown', onDocumentPointer, true)
}

function removeWindowListeners() {
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  document.removeEventListener('pointerdown', onDocumentPointer, true)
}

watch(open, (value) => {
  if (value) addWindowListeners()
  else removeWindowListeners()
})
watch(mode, () => { void nextTick(updatePosition) })
onBeforeUnmount(removeWindowListeners)
</script>

<template>
  <div ref="root" class="dtp-field" :class="{ 'is-focused': inputFocused, 'is-disabled': disabled, 'is-compact': compact }">
    <input
      :id="inputId"
      ref="inputElement"
      class="dtp-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :value="draft"
      :placeholder="t('datepicker.placeholder')"
      :disabled="disabled"
      @input="onInput"
      @focus="inputFocused = true"
      @blur="onBlur"
      @keydown.down.prevent="onArrowDown"
    />
    <button
      type="button"
      class="dtp-open"
      :class="{ 'is-open': open }"
      :disabled="disabled"
      :aria-label="t('datepicker.open')"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="panelId"
      @click="toggleFrom"
    >
      <CalendarDays :size="16" aria-hidden="true" />
    </button>
  </div>

  <Teleport to="body">
    <div v-if="open && placement === 'sheet'" class="dtp-scrim" aria-hidden="true" />
    <div
      v-if="open"
      :id="panelId"
      ref="panelElement"
      class="dtp-panel"
      :class="{ 'is-sheet': placement === 'sheet' }"
      :style="panelStyle"
      :data-placement="placement"
      role="dialog"
      :aria-modal="placement === 'sheet' ? 'true' : undefined"
      :aria-label="t('datepicker.dialog')"
      @keydown="onPanelKeydown"
    >
      <div class="dtp-head">
        <button type="button" class="dtp-nav" :aria-label="stepLabel[0]" @click="step(-1)">
          <ChevronLeft :size="16" aria-hidden="true" />
        </button>
        <button v-if="mode !== 'years'" type="button" class="dtp-title" :aria-label="headerAction" @click="drillDown">
          {{ headerTitle }}
        </button>
        <span v-else class="dtp-title is-static">{{ headerTitle }}</span>
        <button type="button" class="dtp-nav" :aria-label="stepLabel[1]" @click="step(1)">
          <ChevronRight :size="16" aria-hidden="true" />
        </button>
      </div>

      <div class="dtp-body">
        <div v-if="mode === 'days'" class="dtp-calendar">
          <div class="dtp-weekdays" aria-hidden="true">
            <span v-for="name in weekdayNames" :key="name">{{ name }}</span>
          </div>
          <div class="dtp-grid" role="group" :aria-label="headerTitle">
            <button
              v-for="cell in gridDays"
              :key="cell.key"
              type="button"
              class="dtp-day"
              :class="{ outside: !cell.inMonth, today: cell.isToday, selected: cell.isSelected }"
              :data-date="cell.key"
              :tabindex="cell.key === focusKey ? 0 : -1"
              :aria-selected="cell.isSelected ? 'true' : 'false'"
              :aria-label="dayLabel(cell)"
              @click="pickDay(cell)"
              @keydown="onDayKey($event, cell)"
            >{{ cell.day }}</button>
          </div>
        </div>

        <div v-else-if="mode === 'months'" class="dtp-months" role="group" :aria-label="headerTitle">
          <button
            v-for="(name, index) in monthNames"
            :key="name"
            type="button"
            class="dtp-month"
            :class="{ selected: index === viewMonth }"
            :data-month="index"
            :aria-pressed="index === viewMonth"
            @click="pickMonth(index)"
          >{{ name }}</button>
        </div>

        <div v-else class="dtp-years" role="group" :aria-label="headerTitle">
          <button
            v-for="year in yearCells"
            :key="year"
            type="button"
            class="dtp-year"
            :class="{ selected: year === viewYear }"
            :data-year="year"
            :aria-pressed="year === viewYear"
            @click="pickYear(year)"
          >{{ year }}</button>
        </div>
      </div>

      <div class="dtp-time">
        <span class="dtp-time-label">{{ t('datepicker.time') }}</span>
        <span class="dtp-time-select">
          <select :value="selectedTime.hour" :aria-label="t('datepicker.hour')" @change="changeHour">
            <option v-for="hour in 24" :key="hour" :value="hour - 1">{{ pad(hour - 1) }}</option>
          </select>
          <ChevronDown :size="12" aria-hidden="true" />
        </span>
        <span class="dtp-time-sep" aria-hidden="true">:</span>
        <span class="dtp-time-select">
          <select :value="selectedTime.minute" :aria-label="t('datepicker.minute')" @change="changeMinute">
            <option v-for="minute in 60" :key="minute" :value="minute - 1">{{ pad(minute - 1) }}</option>
          </select>
          <ChevronDown :size="12" aria-hidden="true" />
        </span>
        <span class="dtp-utc">UTC</span>
      </div>

      <div class="dtp-foot">
        <button type="button" class="dtp-today" @click="pickToday">{{ t('datepicker.today') }}</button>
        <button type="button" class="dtp-done" @click="closePanel()">{{ t('datepicker.done') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dtp-field {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
}

.dtp-field:hover {
  border-color: var(--border-strong);
}

.dtp-field.is-focused {
  border-color: var(--text);
  box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.1);
}

.dtp-field.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dtp-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  min-height: 0;
  padding: 9px 4px 9px 11px;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
}

.dtp-input:focus,
.dtp-input:focus-visible {
  outline: none;
}

.dtp-input::placeholder {
  color: var(--text-dim);
}

.dtp-field.is-compact .dtp-input {
  padding-left: 9px;
  font-size: 12px;
}

.dtp-field.is-compact .dtp-open {
  width: 28px;
  margin-right: 4px;
}

.dtp-input:disabled {
  cursor: not-allowed;
}

.dtp-open {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  margin-right: 6px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.dtp-open:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}

.dtp-open.is-open {
  background: var(--surface-3);
  color: var(--text);
}

.dtp-open:disabled {
  cursor: not-allowed;
}

.dtp-open:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.dtp-scrim {
  position: fixed;
  inset: 0;
  z-index: 59;
  background: rgba(17, 24, 39, 0.28);
  animation: dtp-fade 160ms ease both;
}

.dtp-panel {
  --dtp-x: 0px;
  --dtp-y: 4px;
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: calc(100vh - 16px);
  overflow: hidden;
  padding: 10px 12px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 18px 48px rgba(17, 24, 39, 0.16), 0 2px 6px rgba(17, 24, 39, 0.06);
  animation: dtp-rise 160ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transform-origin: top center;
  overscroll-behavior: contain;
}

.dtp-panel[data-placement='above'] {
  --dtp-y: -4px;
  transform-origin: bottom left;
}

.dtp-panel[data-placement='right'] {
  --dtp-x: 4px;
  --dtp-y: 0px;
  transform-origin: left top;
}

.dtp-panel[data-placement='left'] {
  --dtp-x: -4px;
  --dtp-y: 0px;
  transform-origin: right top;
}

.dtp-panel[data-placement='sheet'] {
  animation: dtp-sheet 200ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.dtp-panel.is-sheet {
  padding: 14px 16px 16px;
  border-radius: 14px;
  box-shadow: 0 -12px 40px rgba(17, 24, 39, 0.18);
}

.dtp-panel.is-sheet .dtp-day {
  height: 44px;
}

.dtp-panel.is-sheet .dtp-month,
.dtp-panel.is-sheet .dtp-year {
  height: 52px;
}

@keyframes dtp-fade {
  from {
    opacity: 0;
  }
}

@keyframes dtp-sheet {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}

.dtp-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.dtp-head,
.dtp-time,
.dtp-foot {
  flex: none;
}

@keyframes dtp-rise {
  from {
    opacity: 0;
    transform: translate(var(--dtp-x), var(--dtp-y));
  }
}

.dtp-head {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 4px;
}

.dtp-nav {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.dtp-nav:hover {
  background: var(--surface-2);
  color: var(--text);
}

.dtp-nav:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.dtp-title {
  flex: 1 1 auto;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
  cursor: pointer;
}

.dtp-title:hover {
  background: var(--surface-2);
}

.dtp-title:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.dtp-title.is-static {
  display: grid;
  place-items: center;
  cursor: default;
}

.dtp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.dtp-weekdays span {
  display: grid;
  place-items: center;
  height: 22px;
  color: var(--text-dim);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.dtp-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.dtp-day {
  position: relative;
  display: grid;
  place-items: center;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.dtp-day:hover {
  background: var(--surface-2);
}

.dtp-day.outside {
  color: var(--text-dim);
  opacity: 0.55;
}

.dtp-day.today::after {
  content: '';
  position: absolute;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.65;
}

.dtp-day.selected {
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}

.dtp-day.selected:hover {
  background: var(--accent-strong);
}

.dtp-day.selected::after {
  background: var(--accent-ink);
  opacity: 0.9;
}

.dtp-day:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.dtp-months,
.dtp-years {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 6px 0 2px;
}

.dtp-month,
.dtp-year {
  height: 46px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.dtp-month:hover,
.dtp-year:hover {
  background: var(--surface-3);
}

.dtp-month.selected,
.dtp-year.selected {
  background: var(--accent);
  color: var(--accent-ink);
}

.dtp-month:focus-visible,
.dtp-year:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.dtp-time {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.dtp-time-label {
  margin-right: 2px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.dtp-time-select {
  position: relative;
  display: block;
}

.dtp-time-select select {
  appearance: none;
  width: 54px;
  min-height: 32px;
  padding: 0 20px 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.dtp-time-select select:hover {
  border-color: var(--border-strong);
}

.dtp-time-select select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.dtp-time-select svg {
  position: absolute;
  top: 50%;
  right: 6px;
  color: var(--text-dim);
  pointer-events: none;
  transform: translateY(-50%);
}

.dtp-time-sep {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}

.dtp-utc {
  margin-left: auto;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.dtp-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}

.dtp-today {
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.dtp-today:hover {
  background: var(--surface-2);
  color: var(--text);
}

.dtp-today:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.dtp-done {
  height: 30px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.dtp-done:hover {
  background: var(--accent-strong);
}

.dtp-done:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (pointer: coarse) {
  .dtp-open {
    width: 40px;
    height: 40px;
    margin-right: 2px;
  }

  .dtp-day {
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dtp-panel {
    animation: none;
  }
}
</style>
