import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import UtcDateTimePicker from './UtcDateTimePicker.vue'

function mountPicker(modelValue: string) {
  return mount(UtcDateTimePicker, {
    props: { modelValue },
    global: { stubs: { teleport: true } },
  })
}

async function openPanel(wrapper: ReturnType<typeof mountPicker>) {
  await wrapper.get('.dtp-open').trigger('click')
  await nextTick()
}

describe('UTC date-time picker', () => {
  it('shows the UTC value in a readable form and accepts typed input', async () => {
    const wrapper = mountPicker('2023-11-14T22:14')
    const input = wrapper.get('input')
    expect((input.element as HTMLInputElement).value).toBe('2023-11-14 22:14')

    await input.setValue('2024-02-29 08:05')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['2024-02-29T08:05'])
  })

  it('rejects impossible dates and restores the last valid value on blur', async () => {
    const wrapper = mountPicker('2023-11-14T22:14')
    const input = wrapper.get('input')
    await input.setValue('2023-02-30 10:00')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('2023-11-14 22:14')
  })

  it('picks a day and keeps the selected time', async () => {
    const wrapper = mountPicker('2023-11-14T22:14')
    await openPanel(wrapper)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

    await wrapper.get('[data-date="2023-11-20"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['2023-11-20T22:14'])
  })

  it('changes the hour through the time control', async () => {
    const wrapper = mountPicker('2023-11-14T22:14')
    await openPanel(wrapper)
    await wrapper.findAll('.dtp-time-select select')[0].setValue('8')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['2023-11-14T08:14'])
  })

  it('drills from days to months to years and back', async () => {
    const wrapper = mountPicker('2023-11-14T22:14')
    await openPanel(wrapper)
    expect(wrapper.findAll('.dtp-day')).toHaveLength(42)

    await wrapper.get('.dtp-title').trigger('click')
    expect(wrapper.findAll('.dtp-month')).toHaveLength(12)

    await wrapper.get('.dtp-title').trigger('click')
    expect(wrapper.findAll('.dtp-year')).toHaveLength(12)

    await wrapper.get('.dtp-year[data-year="2024"]').trigger('click')
    expect(wrapper.findAll('.dtp-month')).toHaveLength(12)

    await wrapper.get('.dtp-month[data-month="2"]').trigger('click')
    expect(wrapper.findAll('.dtp-day')).toHaveLength(42)
    expect(wrapper.get('.dtp-title').text()).toContain('2024')
  })

  it('closes on Escape', async () => {
    const wrapper = mountPicker('2023-11-14T22:14')
    await openPanel(wrapper)
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
