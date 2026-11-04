<script setup lang="ts">
import { computed } from 'vue'
import { locale, t } from '../i18n'
import { buildPreviewSeries, PREVIEW_TIMEFRAMES, type PreviewTimeframe } from '../previewData'

const COUNT = 64
const WIDTH = 520
const PANE_HEIGHT = 92
const CURSOR_INDEX = 46
const X_LEFT = 12
const X_RIGHT = 478

const frames: { titleKey: 'product.panePrimary' | 'product.paneSecond' | 'product.paneThird'; timeframe: PreviewTimeframe }[] = [
  { titleKey: 'product.panePrimary', timeframe: PREVIEW_TIMEFRAMES[3] },
  { titleKey: 'product.paneSecond', timeframe: PREVIEW_TIMEFRAMES[2] },
  { titleKey: 'product.paneThird', timeframe: PREVIEW_TIMEFRAMES[1] },
]

const step = (X_RIGHT - X_LEFT) / COUNT
const cursorX = X_LEFT + (CURSOR_INDEX + 0.5) * step

const panes = computed(() => {
  void locale.value
  return frames.map((frame, paneIndex) => {
    const series = buildPreviewSeries(frame.timeframe, COUNT)
    let low = Infinity
    let high = -Infinity
    for (const candle of series) {
      low = Math.min(low, candle.l)
      high = Math.max(high, candle.h)
    }
    const pad = (high - low) * 0.12
    low -= pad
    high += pad
    const top = paneIndex * PANE_HEIGHT + 18
    const height = PANE_HEIGHT - 28
    const yFor = (price: number) => top + ((high - price) / (high - low)) * height
    return {
      title: `${t(frame.titleKey)} · ${frame.timeframe.label}`,
      labelY: paneIndex * PANE_HEIGHT + 15,
      dividerY: paneIndex * PANE_HEIGHT + PANE_HEIGHT,
      candles: series.map((candle, index) => {
        const openY = yFor(candle.o)
        const closeY = yFor(candle.c)
        return {
          key: `${frame.titleKey}-${index}`,
          x: X_LEFT + (index + 0.5) * step,
          wickTop: yFor(candle.h),
          wickBottom: yFor(candle.l),
          top: Math.min(openY, closeY),
          height: Math.max(1, Math.abs(closeY - openY)),
          up: candle.c >= candle.o,
        }
      }),
    }
  })
})
</script>

<template>
  <svg
    class="pane-preview"
    :viewBox="`0 0 ${WIDTH} ${PANE_HEIGHT * frames.length}`"
    width="100%"
    role="img"
    :aria-label="t('product.paneAria')"
  >
    <g v-for="pane in panes" :key="pane.title">
      <line class="pane-divider" :x1="0" :x2="WIDTH" :y1="pane.dividerY" :y2="pane.dividerY" />
      <text class="pane-label" :x="X_LEFT" :y="pane.labelY">{{ pane.title }}</text>
      <g class="candles">
        <g v-for="candle in pane.candles" :key="candle.key">
          <line :x1="candle.x" :x2="candle.x" :y1="candle.wickTop" :y2="candle.wickBottom" />
          <rect
            :x="candle.x - 2.2"
            :y="candle.top"
            :width="4.4"
            :height="candle.height"
            :class="candle.up ? 'up' : 'down'"
          />
        </g>
      </g>
    </g>
    <line
      class="pane-cursor"
      :x1="cursorX"
      :x2="cursorX"
      :y1="6"
      :y2="PANE_HEIGHT * frames.length - 8"
    />
  </svg>
</template>
