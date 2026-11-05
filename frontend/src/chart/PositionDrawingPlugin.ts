import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneView, SeriesAttachedParameter, Time, Logical } from 'lightweight-charts'
import { positionMetrics, type PositionReplayDrawing } from '../replay'

export type PositionHandle = 'body' | 'entryPrice' | 'stopPrice' | 'targetPrice' | 'endTimestamp'
export interface PositionHit { drawing: PositionReplayDrawing; handle: PositionHandle }

/** Timestamp interpolation uses only the time axis, never OHLC values. */
export class PositionDrawingPlugin implements ISeriesPrimitive<Time> {
  drawings: PositionReplayDrawing[] = []
  preview: PositionReplayDrawing | null = null
  selectedId: string | null = null
  private requestUpdate: () => void = () => {}
  constructor(readonly chart: IChartApi, readonly series: ISeriesApi<'Candlestick'>, readonly times: () => number[]) {}
  attached(parameter: SeriesAttachedParameter<Time>) { this.requestUpdate = parameter.requestUpdate }
  detached() { this.requestUpdate = () => {} }
  update() { this.requestUpdate() }
  timestampAt(x: number): number | null {
    const logical = this.chart.timeScale().coordinateToLogical(x)
    const times = this.times()
    if (logical === null || !times.length) return null
    const index = Math.floor(logical)
    const step = times.length > 1 ? times[times.length - 1] - times[times.length - 2] : 60
    const left = times[index] ?? (index < 0 ? times[0] + index * step : times[times.length - 1] + (index - times.length + 1) * step)
    const right = times[index + 1] ?? left + step
    return left + (logical - index) * (right - left)
  }
  xAt(timestamp: number): number | null {
    const times = this.times()
    if (!times.length) return null
    const step = times.length > 1 ? times[times.length - 1] - times[times.length - 2] : 60
    let index = times.findIndex(time => time >= timestamp)
    let logical: number
    if (index === 0) logical = (timestamp - times[0]) / step
    else if (index === -1) logical = times.length - 1 + (timestamp - times[times.length - 1]) / step
    else logical = index - 1 + (timestamp - times[index - 1]) / (times[index] - times[index - 1])
    return this.chart.timeScale().logicalToCoordinate(logical as Logical)
  }
  geometry(drawing: PositionReplayDrawing) {
    const left = this.xAt(drawing.startTimestamp), right = this.xAt(drawing.endTimestamp)
    const entry = this.series.priceToCoordinate(drawing.entryPrice), stop = this.series.priceToCoordinate(drawing.stopPrice), target = this.series.priceToCoordinate(drawing.targetPrice)
    if ([left, right, entry, stop, target].some(value => value === null || !Number.isFinite(value))) return null
    return { left: left!, right: right!, entry: entry!, stop: stop!, target: target! }
  }
  hit(x: number, y: number): PositionHit | null {
    for (const drawing of [...this.drawings].reverse()) {
      const g = this.geometry(drawing)
      if (!g || x < g.left - 8 || x > g.right + 8 || y < Math.min(g.stop, g.target) - 8 || y > Math.max(g.stop, g.target) + 8) continue
      let handle: PositionHandle = 'body'
      if (Math.abs(x - g.right) <= 8) handle = 'endTimestamp'
      else if (Math.abs(y - g.entry) <= 8) handle = 'entryPrice'
      else if (Math.abs(y - g.stop) <= 8) handle = 'stopPrice'
      else if (Math.abs(y - g.target) <= 8) handle = 'targetPrice'
      return { drawing, handle }
    }
    return null
  }
  paneViews(): IPrimitivePaneView[] {
    return [{ zOrder: () => 'top', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(({ context }) => this.draw(context)) }) }]
  }
  private draw(ctx: CanvasRenderingContext2D) {
    const drawings = this.drawings.filter(drawing => drawing.id !== this.preview?.id)
    if (this.preview) drawings.push(this.preview)
    for (const drawing of drawings) {
      const g = this.geometry(drawing)
      if (!g) continue
      ctx.save()
      ctx.fillStyle = 'rgba(2,132,199,0.20)'
      ctx.fillRect(g.left, Math.min(g.entry, g.target), g.right - g.left, Math.abs(g.entry - g.target))
      ctx.fillStyle = drawing.style.fill ?? 'rgba(234,88,12,0.22)'
      ctx.fillRect(g.left, Math.min(g.entry, g.stop), g.right - g.left, Math.abs(g.entry - g.stop))
      ctx.strokeStyle = drawing.style.color
      ctx.lineWidth = drawing.style.width
      ctx.setLineDash(drawing.style.dashed ? [6, 4] : [])
      for (const y of [g.entry, g.stop, g.target]) { ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke() }
      const metrics = positionMetrics(drawing)
      ctx.font = '11px Consolas, monospace'
      ctx.fillStyle = '#dbe4ee'
      const labels = [
        [g.target, `收益 / Reward + ${drawing.targetPrice.toFixed(2)} (+${metrics.rewardPercent.toFixed(2)}%)`],
        [g.entry, `${drawing.tool === 'LongPosition' ? '多 / Long' : '空 / Short'} ${drawing.entryPrice.toFixed(2)}  R/R ${metrics.ratio.toFixed(2)}`],
        [g.stop, `风险 / Risk − ${drawing.stopPrice.toFixed(2)} (−${metrics.riskPercent.toFixed(2)}%)`],
      ] as const
      for (const [y, label] of labels) {
        const width = ctx.measureText(label).width + 8
        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(g.left + 3, y - 17, width, 16)
        ctx.fillStyle = '#dbe4ee'; ctx.fillText(label, g.left + 7, y - 5)
      }
      if (drawing.id === this.selectedId) {
        ctx.setLineDash([])
        for (const [x, y] of [[g.left, g.entry], [g.left, g.stop], [g.left, g.target], [g.right, g.entry]]) {
          ctx.fillStyle = '#000000'; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8)
        }
      }
      ctx.restore()
    }
  }
}
