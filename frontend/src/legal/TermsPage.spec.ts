import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import TermsPage from '../pages/TermsPage.vue'
import { termsSections } from './terms'

const wrappers: ReturnType<typeof mount>[] = []
function render() {
  const wrapper = mount(TermsPage)
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
})

describe('terms of service page', () => {
  it('renders every section, its contents entry and its anchor', () => {
    const wrapper = render()
    expect(wrapper.get('h1').text()).toBe('服务条款')
    expect(wrapper.findAll('.privacy-section')).toHaveLength(termsSections.length)
    const links = wrapper.findAll('.privacy-toc a')
    expect(links).toHaveLength(termsSections.length)
    expect(links[0].attributes('href')).toBe(`#${termsSections[0].id}`)
    expect(wrapper.find(`#${termsSections[0].id}`).exists()).toBe(true)
  })

  it('states the operator, last-updated date and a working contact address', () => {
    const wrapper = render()
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-11-06')
    expect(wrapper.text()).toContain('support@grailab.top')
    expect(wrapper.get('.privacy-meta a').attributes('href')).toBe('mailto:support@grailab.top')
    expect(document.title).toBe('服务条款 | grailab')
  })

  it('states the subscription, refund and simulated-trading boundaries', () => {
    const wrapper = render()
    const text = wrapper.text()
    expect(text).toContain('US$12.99')
    expect(text).toContain('7 天内申请全额退款')
    expect(text).toContain('不提供真实下单')
    expect(text).toContain('不构成投资建议')
    expect(text).toContain('Waffo Pancake')
  })

  it('links to the privacy policy and the named contact channels', () => {
    const wrapper = render()
    expect(wrapper.find('.privacy-links a[href="/privacy"]').exists()).toBe(true)
    for (const email of ['support@', 'legal@', 'security@', 'privacy@']) {
      expect(wrapper.html()).toContain(`mailto:${email}grailab.top`)
    }
  })

  it('contains no template placeholders', () => {
    const wrapper = render()
    expect(wrapper.text()).not.toMatch(/\[[^\]]+\]/)
  })

  it('marks exactly one current section in the contents rail', () => {
    const wrapper = render()
    expect(wrapper.findAll('.privacy-toc a[aria-current="true"]')).toHaveLength(1)
  })
})
