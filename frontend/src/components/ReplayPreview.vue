<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Pause, Play } from '@lucide/vue'
import { locale, t } from '../i18n'
import {
  buildPreviewSeries,
  formatPreviewClock,
  formatPreviewPrice,
  PREVIEW_INITIAL_CURSOR,
  PREVIEW_TIMEFRAMES,
  PREVIEW_TRADES,
} from '../previewData'

const SPEEDS = [1, 4, 8]
const PADDING = { top: 18, right: 66, bottom: 28, left: 8 }

const root = ref<HTMLElement | null>(null)
const chartEl = ref<HTMLElement | null>(null)
const activeId = ref('5m')
const cursor = ref(PREVIEW_INITIAL_CURSOR)
const playing = ref(false)
const speed = ref(1)
const size = ref({ width: 960, height: 360 })

const active = computed(() => PREVIEW_TIMEFRAMES.find((item) => item.id === activeId.value) ?? PREVIEW_TIMEFRAMES[1])
const series = computed(() => buildPreviewSeries(active.value))
const total = computed(() => series.value.length)
const visible = computed(() => series.value.slice(0, cursor.value))
const atEnd = computed(() => cursor.value >= total.value)
const clock = computed(() => (visible.value.length ? formatPreviewClock(visible.value[visible.value.length - 1].t) : '—'))
const progress = computed(() => `${(cursor.value / total.value) * 100}%`)
const status = computed(() => {
  void locale.value
  return playing.value ? t('product.previewPlaying') : atEnd.value ? t('product.previewEnded') : t('product.previewPaused')
})
const playLabel = computed(() => (playing.value ? t('product.previewPause') : t('product.previewPlay')))
const chartLabel = computed(() => t('product.previewAria', { timeframe: active.value.label, count: cursor.value }))
const countLabel = computed(() => t('product.previewCount', { count: cursor.value, total: total.value }))

const plot = computed(() => ({
  x: PADDING.left,
  y: PADDING.top,
  width: Math.max(20, size.value.width - PADDING.left - PADDING.right),
  height: Math.max(20, size.value.height - PADDING.top - PADDING.bottom),
}))

const domain = computed(() => {
  const candles = visible.value.length ? visible.value : series.value
  let low = Infinity
  let high = -Infinity
  for (const candle of candles) {
    if (candle.l < low) low = candle.l
    if (candle.h > high) high = candle.h
  }
  const pad = Math.max((high - low) * 0.1, high * 0.0005, 1)
  return { low: low - pad, high: high + pad }
})

function xFor(index: number) {
  return plot.value.x + (index + 0.5) * (plot.value.width / total.value)
}
function yFor(price: number) {
  return plot.value.y + ((domain.value.high - price) / (domain.value.high - domain.value.low)) * plot.value.height
}

const gridLines = computed(() => Array.from({ length: 5 }, (_, index) => {
  const price = domain.value.low + ((domain.value.high - domain.value.low) * index) / 4
  return { y: yFor(price), label: formatPreviewPrice(price) }
}))

const timeTicks = computed(() => {
  const indexes = [0, Math.floor(total.value / 3), Math.floor((total.value * 2) / 3), total.value - 1]
  return indexes.map((index, position) => {
    const iso = new Date(series.value[index].t * 1000).toISOString()
    return {
      key: index,
      x: xFor(index),
      label: active.value.id === '1d' ? iso.slice(5, 10).replace('-', '/') : iso.slice(11, 16),
      anchor: position === 0 ? 'start' : position === indexes.length - 1 ? 'end' : 'middle',
    }
  })
})

const bodyWidth = computed(() => Math.max(2.5, Math.min(11, (plot.value.width / total.value) * 0.64)))

const candles = computed(() => visible.value.map((candle, index) => {
  const openY = yFor(candle.o)
  const closeY = yFor(candle.c)
  return {
    key: index,
    x: xFor(index),
    wickTop: yFor(candle.h),
    wickBottom: yFor(candle.l),
    top: Math.min(openY, closeY),
    height: Math.max(1.4, Math.abs(closeY - openY)),
    up: candle.c >= candle.o,
  }
}))

const frontierX = computed(() => {
  if (!visible.value.length) return plot.value.x
  return xFor(visible.value.length - 1) + plot.value.width / total.value / 2
})
const lastClose = computed(() => visible.value.length ? visible.value[visible.value.length - 1].c : null)
const lastCloseY = computed(() => (lastClose.value === null ? 0 : yFor(lastClose.value)))
const priceTagY = computed(() => Math.min(plot.value.y + plot.value.height - 10, Math.max(plot.value.y + 10, lastCloseY.value)))

const TRADE_GAP = 6
const tradeMarks = computed(() => PREVIEW_TRADES
  .filter((trade) => trade.index < cursor.value)
  .map((trade) => {
    const candle = series.value[trade.index]
    const buy = trade.side === 'buy'
    const y = buy ? yFor(candle.h) - TRADE_GAP : yFor(candle.l) + TRADE_GAP
    return {
      ...trade,
      x: xFor(trade.index),
      y: Math.min(plot.value.y + plot.value.height - 4, Math.max(plot.value.y + 4, y)),
      buy,
    }
  }))

let timer: number | undefined
let autoplayTimer: number | undefined
let observer: IntersectionObserver | undefined
let resizer: ResizeObserver | undefined

function intervalFor(value: number) {
  return value === 1 ? 650 : value === 4 ? 180 : 90
}
function stopTimer() {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}
function startTimer() {
  stopTimer()
  timer = window.setInterval(() => {
    if (atEnd.value) {
      playing.value = false
      return
    }
    cursor.value += 1
    if (cursor.value >= total.value) playing.value = false
  }, intervalFor(speed.value))
}
function togglePlay() {
  if (atEnd.value) cursor.value = 4
  playing.value = !playing.value
}
function chooseTimeframe(id: string) {
  if (id === activeId.value) return
  activeId.value = id
  cursor.value = PREVIEW_INITIAL_CURSOR
  stopTimer()
  if (playing.value) startTimer()
}

watch(playing, (value) => { if (value) startTimer(); else stopTimer() })
watch(speed, () => { if (playing.value) startTimer() })

onMounted(() => {
  if (chartEl.value) {
    resizer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) size.value = { width: rect.width, height: rect.height }
    })
    resizer.observe(chartEl.value)
  }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduced || !('IntersectionObserver' in window) || !root.value) return
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    observer?.disconnect()
    autoplayTimer = window.setTimeout(() => {
      if (cursor.value === PREVIEW_INITIAL_CURSOR && !playing.value) playing.value = true
    }, 700)
  }, { threshold: 0.35 })
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  stopTimer()
  if (autoplayTimer !== undefined) window.clearTimeout(autoplayTimer)
  observer?.disconnect()
  resizer?.disconnect()
})
</script>

<template>
  <div ref="root" class="instrument">
    <div class="instrument-top">
      <div class="instrument-symbol">
        <span class="instrument-tick" aria-hidden="true"></span>
        BTCUSD <span class="instrument-suffix">/ USD</span>
      </div>
      <div class="instrument-status" aria-live="polite">
        <span class="instrument-dot" :class="{ live: playing }" aria-hidden="true"></span>
        {{ status }}
      </div>
      <div class="instrument-controls">
        <div class="speed" role="group" :aria-label="t('product.previewSpeed')">
          <button
            v-for="value in SPEEDS"
            :key="value"
            type="button"
            :aria-pressed="speed === value"
            @click="speed = value"
          >{{ value }}×</button>
        </div>
        <button
          type="button"
          class="play-toggle"
          :aria-label="playLabel"
          @click="togglePlay"
        >
          <Pause v-if="playing" :size="16" :stroke-width="2.2" />
          <Play v-else :size="16" :stroke-width="2.2" />
        </button>
      </div>
    </div>

    <div class="timeframes" role="group" :aria-label="t('product.previewTimeframes')">
      <button
        v-for="timeframe in PREVIEW_TIMEFRAMES"
        :key="timeframe.id"
        type="button"
        class="tf"
        :aria-pressed="activeId === timeframe.id"
        @click="chooseTimeframe(timeframe.id)"
      >{{ timeframe.label }}</button>
    </div>

    <div ref="chartEl" class="preview-chart" role="img" :aria-label="chartLabel">
      <svg :viewBox="`0 0 ${size.width} ${size.height}`" width="100%" height="100%" aria-hidden="true">
        <g class="grid">
          <line
            v-for="line in gridLines"
            :key="`grid-${line.label}`"
            :x1="plot.x"
            :x2="plot.x + plot.width"
            :y1="line.y"
            :y2="line.y"
          />
        </g>

        <g class="axis">
          <text
            v-for="line in gridLines"
            :key="`label-${line.label}`"
            :x="plot.x + plot.width + 10"
            :y="line.y + 3.5"
          >{{ line.label }}</text>
          <text
            v-for="tick in timeTicks"
            :key="`time-${tick.key}`"
            :x="tick.x"
            :y="size.height - 9"
            :text-anchor="tick.anchor"
            class="axis-time"
          >{{ tick.label }}</text>
        </g>

        <rect
          v-if="frontierX < plot.x + plot.width"
          class="future"
          :x="frontierX"
          :y="plot.y"
          :width="Math.max(0, plot.x + plot.width - frontierX)"
          :height="plot.height"
        />

        <g class="candles">
          <g v-for="candle in candles" :key="candle.key" class="candle">
            <line :x1="candle.x" :x2="candle.x" :y1="candle.wickTop" :y2="candle.wickBottom" />
            <rect
              :x="candle.x - bodyWidth / 2"
              :y="candle.top"
              :width="bodyWidth"
              :height="candle.height"
              :class="candle.up ? 'up' : 'down'"
            />
          </g>
        </g>

        <g v-if="lastClose !== null">
          <line
            class="last-price-line"
            :x1="frontierX"
            :x2="plot.x + plot.width"
            :y1="lastCloseY"
            :y2="lastCloseY"
          />
          <line
            class="frontier"
            :x1="frontierX"
            :x2="frontierX"
            :y1="plot.y"
            :y2="plot.y + plot.height"
          />
          <g class="price-tag">
            <rect :x="plot.x + plot.width + 4" :y="priceTagY - 10" :width="54" height="20" rx="4" />
            <text :x="plot.x + plot.width + 31" :y="priceTagY + 3.5">{{ formatPreviewPrice(lastClose) }}</text>
          </g>
        </g>

        <g v-for="mark in tradeMarks" :key="mark.label" class="trade" :class="mark.buy ? 'buy' : 'sell'">
          <circle :cx="mark.x" :cy="mark.y" r="3.5" />
          <text
            :x="mark.x"
            :y="mark.buy ? mark.y - 8 : mark.y + 12"
            :class="mark.buy ? 'above' : 'below'"
            text-anchor="middle"
          >{{ mark.label }}</text>
        </g>
      </svg>
    </div>

    <div class="instrument-foot">
      <span class="clock">{{ clock }} UTC</span>
      <div class="progress" aria-hidden="true"><span :style="{ width: progress }"></span></div>
      <span class="count">{{ countLabel }}</span>
    </div>
  </div>
</template>
