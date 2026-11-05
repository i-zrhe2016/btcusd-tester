import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import DrawingStyleBar from './DrawingStyleBar.vue'
import { t } from '../i18n'
import { DEFAULT_REPLAY_DRAWING_STYLE, type ReplayDrawingStyle } from '../replay'

const style: ReplayDrawingStyle = { ...DEFAULT_REPLAY_DRAWING_STYLE }

interface BarProps {
  style: ReplayDrawingStyle
  recentColors: readonly string[]
  locked: boolean
  hasSelection: boolean
  context: 'default' | 'native' | 'position'
  label: string
}

const wrappers: VueWrapper[] = []

function mountBar(overrides: Partial<BarProps> = {}) {
  const wrapper = mount(DrawingStyleBar, {
    attachTo: document.body,
    props: {
      style,
      recentColors: [],
      locked: false,
      hasSelection: true,
      context: 'native',
      label: '趋势线',
      ...overrides,
    },
  })
  wrappers.push(wrapper as VueWrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount()
  document.body.innerHTML = ''
})

describe('DrawingStyleBar', () => {
  it('labels the selected drawing and the default mode', async () => {
    const selected = mountBar()
    expect(selected.get('.drawing-style-label').text()).toContain(t('chart.selectedDrawing'))
    expect(selected.get('.drawing-style-label').text()).toContain('趋势线')

    const fallback = mountBar({ hasSelection: false, context: 'default', label: '' })
    expect(fallback.get('.drawing-style-label').text()).toBe(t('chart.defaultStyle'))
  })

  it('opens the color panel and applies preset colors', async () => {
    const wrapper = mountBar({ style: { ...style, color: '#38bdf8' } })
    const trigger = wrapper.get('[data-testid="drawing-color-trigger"]')
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-color="#38bdf8"]').attributes('aria-checked')).toBe('true')

    await wrapper.get('[data-color="#4ade80"]').trigger('click')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ color: '#4ade80' }])
    expect(wrapper.emitted('remember-color')!.at(-1)).toEqual(['#4ade80'])
  })

  it('validates the hex field before applying', async () => {
    const wrapper = mountBar()
    await wrapper.get('[data-testid="drawing-color-trigger"]').trigger('click')

    const hex = wrapper.get('[data-testid="drawing-color"]')
    await hex.setValue('#12')
    await hex.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:style')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe(t('chart.invalidColor'))
    expect(hex.attributes('aria-invalid')).toBe('true')

    await hex.setValue('38BDF8')
    await hex.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ color: '#38bdf8' }])
    expect(wrapper.emitted('remember-color')!.at(-1)).toEqual(['#38bdf8'])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('renders recent colors only when there are any', async () => {
    const empty = mountBar({ recentColors: [] })
    await empty.get('[data-testid="drawing-color-trigger"]').trigger('click')
    expect(empty.find('.recent-grid').exists()).toBe(false)

    const wrapper = mountBar({ recentColors: ['#ffffff', '#facc15'] })
    await wrapper.get('[data-testid="drawing-color-trigger"]').trigger('click')
    const recent = wrapper.findAll('.recent-grid button')
    expect(recent).toHaveLength(2)
    await recent[0].trigger('click')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ color: '#ffffff' }])
  })

  it('applies width presets and the slider', async () => {
    const wrapper = mountBar()
    await wrapper.get('[data-testid="drawing-width-trigger"]').trigger('click')

    await wrapper.get('[data-testid="drawing-width-preset-3"]').trigger('click')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ width: 3 }])

    const slider = wrapper.get('[data-testid="drawing-width"]')
    expect(slider.attributes('min')).toBe('1')
    expect(slider.attributes('max')).toBe('8')
    expect(slider.attributes('step')).toBe('1')
    await slider.setValue('5')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ width: 5 }])
    await wrapper.setProps({ style: { ...style, width: 5 } })
    expect(wrapper.get('[data-testid="drawing-width-value"]').text()).toContain('5')
  })

  it('switches between solid and dashed', async () => {
    const wrapper = mountBar({ style: { ...style, dashed: true } })
    await wrapper.get('[data-testid="drawing-line-trigger"]').trigger('click')

    expect(wrapper.get('[data-testid="drawing-line-solid"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.get('[data-testid="drawing-dashed"]').attributes('aria-checked')).toBe('true')

    await wrapper.get('[data-testid="drawing-line-solid"]').trigger('click')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ dashed: false }])
    await wrapper.get('[data-testid="drawing-dashed"]').trigger('click')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ dashed: true }])
  })

  it('edits and clears fill and resets the style', async () => {
    const wrapper = mountBar()
    await wrapper.get('[data-testid="drawing-settings-trigger"]').trigger('click')

    await wrapper.get('[data-testid="drawing-fill"]').setValue('#123456')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ fill: '#123456' }])

    await wrapper.get('[data-testid="drawing-no-fill"]').trigger('click')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ fill: null }])

    await wrapper.get('[data-testid="drawing-reset-style"]').trigger('click')
    expect(wrapper.emitted('update:style')!.at(-1)).toEqual([{ ...DEFAULT_REPLAY_DRAWING_STYLE }])
  })

  it('closes panels on Escape with focus return and on outside mousedown', async () => {
    const wrapper = mountBar()
    const trigger = wrapper.get('[data-testid="drawing-color-trigger"]')
    await trigger.trigger('click')
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('switches panels without closing to nothing', async () => {
    const wrapper = mountBar()
    await wrapper.get('[data-testid="drawing-color-trigger"]').trigger('click')
    await wrapper.get('[data-testid="drawing-width-trigger"]').trigger('click')

    expect(wrapper.find('[data-testid="drawing-width"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="drawing-color"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="drawing-color-trigger"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('[data-testid="drawing-width-trigger"]').attributes('aria-expanded')).toBe('true')
  })

  it('disables every control while locked', async () => {
    const wrapper = mountBar({ locked: true })
    for (const id of ['drawing-color-trigger', 'drawing-width-trigger', 'drawing-line-trigger', 'drawing-settings-trigger', 'drawing-delete-selected']) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined()
    }
  })

  it('deletes only when a drawing is selected', async () => {
    const unselected = mountBar({ hasSelection: false })
    expect(unselected.get('[data-testid="drawing-delete-selected"]').attributes('disabled')).toBeDefined()

    const wrapper = mountBar()
    await wrapper.get('[data-testid="drawing-delete-selected"]').trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })
})
