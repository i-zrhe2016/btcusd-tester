import type { DrawingEngine } from '@getcandlekit/charts'
import type { IChartApi } from 'lightweight-charts'
import { DEFAULT_REPLAY_DRAWING_STYLE, isPositionDrawing, validPosition, type PositionReplayDrawing, type ReplayDrawing, type ReplayDrawingStyle, type ReplayDrawingTool } from '../replay'
import { PositionDrawingPlugin, type PositionHit } from './PositionDrawingPlugin'

type PositionTool = PositionReplayDrawing['tool']
export type ChartDrawingTool = ReplayDrawingTool | PositionTool

/** Owns the custom gesture only; native tools and Shift measurement retain their events. */
export class DrawingInteractionCoordinator {
  activeTool: PositionTool | null = null
  private anchors: Array<{ timestamp: number; price: number }> = []
  private drag: { hit: PositionHit; timestamp: number; price: number } | null = null
  nativePointerActive = false
  private destroyed = false
  private finishNativeGesture = () => {
    if (!this.nativePointerActive) return
    queueMicrotask(() => { if (this.destroyed) return; this.nativePointerActive = false; this.changed() })
  }
  private claimed = false
  private shiftSelection: string | null | undefined
  private restoreShiftLock() {
    if (this.shiftSelection === undefined) return
    const selected = this.shiftSelection
    this.shiftSelection = undefined
    this.engine.setLocked(false)
    this.engine.select(selected)
  }
  private pointerId: number | null = null
  private originalNavigation: Pick<ReturnType<IChartApi['options']>, 'handleScroll' | 'handleScale'> | null = null
  defaultStyle: ReplayDrawingStyle = { ...DEFAULT_REPLAY_DRAWING_STYLE }
  constructor(readonly element: HTMLElement, readonly engine: DrawingEngine, readonly positions: PositionDrawingPlugin, readonly changed: () => void, readonly feedback: (message: string) => void) {
    window.addEventListener('mouseup', this.finishNativeGesture, true)
    element.addEventListener('pointerdown', this.down, true)
    element.addEventListener('pointermove', this.move, true)
    element.addEventListener('pointerup', this.up, true)
    element.addEventListener('pointercancel', this.cancelPointer, true)
    element.addEventListener('lostpointercapture', this.cancelPointer, true)
    for (const name of ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend']) element.addEventListener(name, this.compatibility, { capture: true, passive: false })
  }
  snapshot(): ReplayDrawing[] { return this.positions.drawings.map(drawing => ({ ...drawing, points: [], style: { ...drawing.style } })) }
  load(drawings: readonly ReplayDrawing[]) { this.cancel(); this.positions.drawings = drawings.filter(isPositionDrawing).map(drawing => ({ ...drawing, style: { ...drawing.style } })); this.positions.update() }
  selectTool(tool: ChartDrawingTool) {
    this.cancel(); this.engine.cancelDraft(); this.engine.stopTool(); this.engine.select(null); this.positions.selectedId = null
    if (tool === 'LongPosition' || tool === 'ShortPosition') { this.activeTool = tool; this.pauseNavigation() }
    else this.engine.startTool(tool)
    this.changed()
  }
  cancel() {
    this.activeTool = null; this.anchors = []; this.drag = null; this.positions.preview = null
    this.restoreNavigation(); this.release(); this.positions.update()
  }
  clearSelection() { this.positions.selectedId = null; this.positions.update() }
  removeSelected() { this.positions.drawings = this.positions.drawings.filter(drawing => drawing.id !== this.positions.selectedId); this.clearSelection(); this.changed() }
  clear() { this.cancel(); this.positions.drawings = []; this.clearSelection(); this.changed() }
  setStyle(style: ReplayDrawingStyle) {
    this.defaultStyle = { ...style }; this.engine.setDefaultStyle(style)
    const selected = this.positions.drawings.find(drawing => drawing.id === this.positions.selectedId)
    if (selected) { selected.style = { ...style }; this.positions.update(); this.changed() }
    else if (this.engine.getSelectedId()) this.engine.setStyle(this.engine.getSelectedId()!, style)
  }
  private pauseNavigation() {
    if (this.originalNavigation) return
    const options = this.positions.chart.options()
    this.originalNavigation = { handleScroll: typeof options.handleScroll === 'object' ? { ...options.handleScroll } : options.handleScroll, handleScale: typeof options.handleScale === 'object' ? { ...options.handleScale } : options.handleScale }
    this.positions.chart.applyOptions({ handleScroll: false, handleScale: false })
  }
  private restoreNavigation() { if (this.originalNavigation) { this.positions.chart.applyOptions(this.originalNavigation); this.originalNavigation = null } }
  private release() {
    const pointer = this.pointerId; this.pointerId = null
    if (pointer !== null && this.element.hasPointerCapture?.(pointer)) this.element.releasePointerCapture(pointer)
  }
  private point(event: PointerEvent) {
    const rect = this.element.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    const timestamp = this.positions.timestampAt(x), price = this.positions.series.coordinateToPrice(y)
    return { x, y, timestamp, price }
  }
  private consume(event: Event) { event.preventDefault(); event.stopImmediatePropagation() }
  private compatibility = (event: Event) => {
    if ((event as MouseEvent).shiftKey) {
      if (event.type === 'mousedown') queueMicrotask(() => this.restoreShiftLock())
      return
    }
    if (this.claimed) this.consume(event)
  }
  private down = (event: PointerEvent) => {
    this.claimed = false
    if (event.shiftKey) {
      // CandleKit's native drawing controller does not check Shift. Temporarily
      // lock it for this event dispatch so MeasurementController receives it.
      if (!this.engine.isLocked()) { this.shiftSelection = this.engine.getSelectedId(); this.engine.setLocked(true) }
      return
    }
    this.restoreShiftLock()
    if (event.button !== 0 || this.engine.isLocked()) return
    if (this.engine.getActiveTool() || this.engine.getDraft()) { this.nativePointerActive = true; return }
    const point = this.point(event)
    if (point.timestamp === null || point.price === null || !Number.isFinite(point.price) || point.price <= 0) return
    const hit = this.positions.hit(point.x, point.y)
    if (!this.activeTool && !hit) { this.nativePointerActive = true; this.clearSelection(); this.changed(); return }
    this.claimed = true; this.consume(event); this.engine.select(null)
    this.pointerId = event.pointerId; this.element.setPointerCapture?.(event.pointerId)
    if (this.activeTool) {
      this.anchors.push({ timestamp: point.timestamp, price: point.price })
      if (this.anchors.length === 3) {
        const [entry, stop, target] = this.anchors
        const drawing: PositionReplayDrawing = { id: crypto.randomUUID(), tool: this.activeTool, points: [], startTimestamp: entry.timestamp, endTimestamp: Math.max(target.timestamp, entry.timestamp + 60), entryPrice: entry.price, stopPrice: stop.price, targetPrice: target.price, style: { ...this.defaultStyle } }
        if (validPosition(drawing)) { this.positions.drawings.push(drawing); this.cancel(); this.positions.selectedId = drawing.id; this.changed() }
        else { this.anchors.pop(); this.feedback('chart.positionInvalid') }
      }
    } else if (hit) {
      this.positions.selectedId = hit.drawing.id
      this.drag = { hit: { ...hit, drawing: { ...hit.drawing, style: { ...hit.drawing.style } } }, timestamp: point.timestamp, price: point.price }
      this.pauseNavigation(); this.changed()
    }
    this.positions.update()
  }
  private move = (event: PointerEvent) => {
    if (event.shiftKey || (!this.activeTool && !this.drag)) return
    const point = this.point(event)
    if (point.timestamp === null || point.price === null) return
    if (this.drag) {
      this.consume(event)
      const { hit, timestamp, price } = this.drag
      const drawing = { ...hit.drawing }
      if (hit.handle === 'body') {
        const dt = point.timestamp - timestamp, dp = point.price - price
        drawing.startTimestamp += dt; drawing.endTimestamp += dt; drawing.entryPrice += dp; drawing.stopPrice += dp; drawing.targetPrice += dp
      } else drawing[hit.handle] = hit.handle === 'endTimestamp' ? point.timestamp : point.price
      if (validPosition(drawing)) this.positions.preview = drawing
    } else if (this.activeTool && this.anchors.length) {
      const entry = this.anchors[0], direction = this.activeTool === 'LongPosition' ? 1 : -1
      const risk = Math.max(entry.price * 0.005, Math.abs(point.price - entry.price))
      const drawing: PositionReplayDrawing = { id: 'position-draft', tool: this.activeTool, points: [], startTimestamp: entry.timestamp, endTimestamp: Math.max(point.timestamp, entry.timestamp + 60), entryPrice: entry.price, stopPrice: this.anchors[1]?.price ?? entry.price - direction * risk, targetPrice: this.anchors.length > 1 ? point.price : entry.price + direction * risk * 2, style: { ...this.defaultStyle } }
      this.positions.preview = validPosition(drawing) ? drawing : null
    }
    this.positions.update()
  }
  private up = (event: PointerEvent) => {
    if (!this.claimed) return
    this.consume(event)
    if (this.drag) {
      const preview = this.positions.preview
      if (preview) this.positions.drawings = this.positions.drawings.map(drawing => drawing.id === preview.id ? preview : drawing)
      this.drag = null; this.positions.preview = null; this.restoreNavigation(); this.positions.update(); this.changed()
    }
    this.release()
  }
  private cancelPointer = () => {
    if (this.pointerId === null) return
    this.cancel(); this.changed()
  }
  destroy() {
    this.destroyed = true
    this.restoreShiftLock()
    this.cancel()
    this.nativePointerActive = false
    window.removeEventListener('mouseup', this.finishNativeGesture, true)
    this.element.removeEventListener('pointerdown', this.down, true); this.element.removeEventListener('pointermove', this.move, true)
    this.element.removeEventListener('pointerup', this.up, true); this.element.removeEventListener('pointercancel', this.cancelPointer, true); this.element.removeEventListener('lostpointercapture', this.cancelPointer, true)
    for (const name of ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend']) this.element.removeEventListener(name, this.compatibility, true)
  }
}
