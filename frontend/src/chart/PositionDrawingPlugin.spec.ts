import { afterEach, describe, expect, it } from 'vitest'
import { DrawingEngine } from '@getcandlekit/charts'
import { DEFAULT_REPLAY_DRAWING_STYLE, createReplayProjectFromDraft, loadReplayProjects, saveReplayProjects, validPosition, positionMetrics, type PositionReplayDrawing, type ReplayDrawing } from '../replay'
import { PositionDrawingPlugin } from './PositionDrawingPlugin'
import { DrawingInteractionCoordinator } from './DrawingInteractionCoordinator'

function position(patch: Partial<PositionReplayDrawing> = {}): PositionReplayDrawing {
  return { id: 'long', tool: 'LongPosition', points: [], startTimestamp: 100, endTimestamp: 280, entryPrice: 100, stopPrice: 80, targetPrice: 140, style: { ...DEFAULT_REPLAY_DRAWING_STYLE }, ...patch }
}
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()) })
function harness() {
  const element = document.createElement('div'); document.body.append(element)
  const engine = new DrawingEngine()
  let times = [100, 160, 220, 280, 340]
  let spacing = 10
  const navigation = { handleScroll: { pressedMouseMove: false, mouseWheel: true }, handleScale: { mouseWheel: true, pinch: false } }
  const applied: any[] = []
  const chart = { timeScale: () => ({ coordinateToLogical: (x: number) => x / spacing, logicalToCoordinate: (logical: number) => logical * spacing }), options: () => navigation, applyOptions: (options: unknown) => applied.push(options) }
  const series = { priceToCoordinate: (price: number) => 300 - price, coordinateToPrice: (y: number) => 300 - y }
  const plugin = new PositionDrawingPlugin(chart as any, series as any, () => times)
  let previous = '[]'
  const saves: ReplayDrawing[][] = [], messages: string[] = []
  const controller = new DrawingInteractionCoordinator(element, engine, plugin, () => {
    const drawings: ReplayDrawing[] = [...engine.getDrawings().map(drawing => ({ id: drawing.id, tool: drawing.tool as any, points: drawing.points.map(point => ({ timestamp: point.time, price: point.price })), style: drawing.style })), ...controller.snapshot()]
    const next = JSON.stringify(drawings)
    if (next !== previous) { previous = next; saves.push(JSON.parse(next)) }
  }, message => messages.push(message))
  cleanups.push(() => { controller.destroy(); element.remove(); engine.destroy() })
  function pointer(type: string, x: number, price: number, shiftKey = false) {
    const event = new MouseEvent(type, { clientX: x, clientY: 300 - price, button: 0, bubbles: true, cancelable: true, shiftKey })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    element.dispatchEvent(event)
    return event
  }
  function click(x: number, price: number) { pointer('pointerdown', x, price); pointer('pointerup', x, price) }
  return { controller, engine, plugin, element, saves, applied, messages, pointer, click, setTimes: (next: number[]) => { times = next }, setSpacing: (next: number) => { spacing = next } }
}

describe('position model and persistence', () => {
  it('calculates risk, reward, percent and ratio for both sides', () => {
    expect(positionMetrics(position())).toEqual({ risk: 20, reward: 40, ratio: 2, riskPercent: 20, rewardPercent: 40 })
    const short = position({ tool: 'ShortPosition', stopPrice: 120, targetPrice: 60 })
    expect(validPosition(short)).toBe(true)
    expect(positionMetrics(short).ratio).toBe(2)
  })
  it.each([
    { stopPrice: 100 }, { targetPrice: 100 }, { stopPrice: 110 }, { targetPrice: 90 },
    { entryPrice: NaN }, { targetPrice: Infinity }, { stopPrice: 0 }, { endTimestamp: 100 }, { startTimestamp: Infinity },
    { tool: 'ShortPosition' as const },
  ])('rejects invalid geometry %o', patch => { expect(validPosition(position(patch))).toBe(false) })
  it('round trips mixed native and custom objects and drops invalid custom data', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const project = createReplayProjectFromDraft({ name: 'Mixed', symbol: 'BTCUSD', timeframe: '1m', fromInput: '2026-08-27T00:00', toInput: '2026-08-27T01:00', speed: 1 })
    const native: ReplayDrawing = { id: 'native', tool: 'HorizontalLine', points: [{ timestamp: 100, price: 100 }], style: { ...DEFAULT_REPLAY_DRAWING_STYLE } }
    saveReplayProjects([{ ...project, drawings: [native, position(), position({ id: 'bad', stopPrice: 100 })] }], storage)
    expect(loadReplayProjects(storage)[0].drawings).toEqual([native, position()])
    saveReplayProjects([{ ...project, drawings: [position({ tool: 'ShortPosition', stopPrice: 120, targetPrice: 60 })] }], storage)
    expect(loadReplayProjects(storage)[0].drawings[0]).toMatchObject({ tool: 'ShortPosition', entryPrice: 100, stopPrice: 120, targetPrice: 60 })
  })
})

describe('position interactions and projection', () => {
  it('creates a long with three clicks, returns to select, and never puts its tool in the native engine', () => {
    const h = harness()
    h.controller.selectTool('LongPosition')
    expect(h.engine.getActiveTool()).toBeNull()
    h.click(0, 100); h.click(10, 80)
    expect(h.saves).toEqual([])
    h.click(30, 140)
    expect(h.plugin.drawings).toHaveLength(1)
    expect(h.plugin.drawings[0]).toMatchObject({ tool: 'LongPosition', entryPrice: 100, stopPrice: 80, targetPrice: 140, startTimestamp: 100, endTimestamp: 280 })
    expect(h.controller.activeTool).toBeNull()
    expect(h.saves).toHaveLength(1)
    expect(h.applied.at(-1)).toEqual({ handleScroll: { pressedMouseMove: false, mouseWheel: true }, handleScale: { mouseWheel: true, pinch: false } })
  })
  it('retains an invalid target as an actionable draft without saving and accepts a corrected target', () => {
    const h = harness(); h.controller.selectTool('ShortPosition'); h.click(0, 100); h.click(10, 120); h.click(30, 130)
    expect(h.plugin.drawings).toEqual([]); expect(h.saves).toEqual([])
    expect(h.messages).toEqual(['chart.positionInvalid'])
    expect(h.controller.activeTool).toBe('ShortPosition')
    h.click(30, 60)
    expect(h.plugin.drawings[0]).toMatchObject({ tool: 'ShortPosition', stopPrice: 120, targetPrice: 60 })
  })
  it('previews dragging, commits once on release and cancels without changing stored values', () => {
    const h = harness(); h.controller.load([position()])
    h.pointer('pointerdown', 15, 100); h.pointer('pointermove', 15, 110)
    expect(h.plugin.preview?.entryPrice).toBe(110)
    expect(h.plugin.drawings[0].entryPrice).toBe(100)
    expect(h.saves).toHaveLength(1) // initial loaded snapshot first observed on selection
    h.pointer('pointermove', 15, 120); h.pointer('pointerup', 15, 120)
    expect(h.plugin.drawings[0].entryPrice).toBe(120)
    expect(h.saves).toHaveLength(2)
    h.pointer('pointerdown', 15, 120); h.pointer('pointermove', 15, 130); h.controller.cancel()
    expect(h.plugin.preview).toBeNull(); expect(h.plugin.drawings[0].entryPrice).toBe(120)
  })
  it('moves the whole position and right boundary while preserving risk/reward', () => {
    const h = harness(); h.controller.load([position()])
    h.pointer('pointerdown', 15, 125); h.pointer('pointermove', 20, 135); h.pointer('pointerup', 20, 135)
    const moved = h.plugin.drawings[0]
    expect(moved).toMatchObject({ startTimestamp: 130, endTimestamp: 310, entryPrice: 110, stopPrice: 90, targetPrice: 150 })
    expect(positionMetrics(moved).ratio).toBe(2)
    h.pointer('pointerdown', 35, 110); h.pointer('pointermove', 45, 110); h.pointer('pointerup', 45, 110)
    expect(h.plugin.drawings[0].endTimestamp).toBe(370)
  })
  it('does not mutate during locked or Shift gestures and allows native tools to own their gestures', async () => {
    const h = harness(); h.controller.load([position()]); h.engine.setLocked(true)
    expect(h.pointer('pointerdown', 15, 100).defaultPrevented).toBe(false)
    h.pointer('pointermove', 15, 110); h.pointer('pointerup', 15, 110)
    expect(h.plugin.drawings[0].entryPrice).toBe(100)
    h.engine.setLocked(false); h.controller.selectTool('TrendLine')
    expect(h.pointer('pointerdown', 15, 100).defaultPrevented).toBe(false)
    h.pointer('pointerdown', 15, 100, true)
    expect(h.engine.isLocked()).toBe(true)
    const shiftMouse = new MouseEvent('mousedown', { bubbles: true, shiftKey: true, cancelable: true }); h.element.dispatchEvent(shiftMouse)
    expect(shiftMouse.defaultPrevented).toBe(false)
    await Promise.resolve()
    expect(h.engine.isLocked()).toBe(false); expect(h.engine.getActiveTool()).toBe('TrendLine')
    expect(h.plugin.drawings[0].entryPrice).toBe(100)
  })
  it('suppresses custom compatibility mouse events, releases on cancellation and removes listeners on destroy', () => {
    const h = harness(); h.controller.selectTool('LongPosition'); h.pointer('pointerdown', 0, 100)
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); h.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    h.pointer('pointercancel', 0, 100)
    expect(h.controller.activeTool).toBeNull(); expect(h.plugin.preview).toBeNull(); expect(h.plugin.drawings).toEqual([])
    h.controller.destroy()
    const after = h.pointer('pointerdown', 0, 100)
    expect(after.defaultPrevented).toBe(false)
  })
  it('deletes only the selected custom object and edits its style independently of defaults', () => {
    const h = harness(); h.controller.load([position(), position({ id: 'other', startTimestamp: 400, endTimestamp: 500 })])
    h.plugin.selectedId = 'long'
    h.controller.setStyle({ color: '#ffffff', width: 4, dashed: true, fill: '#123456' })
    expect(h.plugin.drawings[0].style).toEqual({ color: '#ffffff', width: 4, dashed: true, fill: '#123456' })
    expect(h.plugin.drawings[1].style).toEqual(DEFAULT_REPLAY_DRAWING_STYLE)
    h.controller.removeSelected()
    expect(h.plugin.drawings.map(drawing => drawing.id)).toEqual(['other'])
    h.controller.clear(); expect(h.plugin.drawings).toEqual([])
  })
  it('projects across gaps, pan/zoom spacing, future axis and changed periods without rewriting anchors', () => {
    const h = harness(), drawing = position()
    expect(h.plugin.xAt(190)).toBe(15)
    expect(h.plugin.timestampAt(15)).toBe(190)
    expect(h.plugin.xAt(460)).toBe(60)
    expect(h.plugin.timestampAt(60)).toBe(460)
    h.setSpacing(20); expect(h.plugin.xAt(190)).toBe(30)
    h.setTimes([100, 400, 700]); expect(h.plugin.xAt(250)).toBe(10)
    expect(drawing.startTimestamp).toBe(100)
    h.setTimes([]); expect(h.plugin.geometry(drawing)).toBeNull()
  })
})
