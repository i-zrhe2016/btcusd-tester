import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import PrivacyPage from '../pages/PrivacyPage.vue'
import { policy } from './policy'
import { setLocale } from '../i18n'

const wrappers: ReturnType<typeof mount>[] = []
function render() {
  const wrapper = mount(PrivacyPage)
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  setLocale('zh')
})

describe('privacy policy page', () => {
  it('renders every section, its contents entry and its anchor', () => {
    const wrapper = render()
    expect(wrapper.get('h1').text()).toBe('隐私政策')
    expect(wrapper.findAll('.privacy-section')).toHaveLength(policy.zh.sections.length)
    const links = wrapper.findAll('.privacy-toc a')
    expect(links).toHaveLength(policy.zh.sections.length)
    expect(links[0].attributes('href')).toBe(`#${policy.zh.sections[0].id}`)
    expect(wrapper.find(`#${policy.zh.sections[0].id}`).exists()).toBe(true)
  })

  it('states the operator, last-updated date and a working contact address', () => {
    const wrapper = render()
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-11-06')
    expect(wrapper.text()).toContain('privacy@grailab.top')
    expect(wrapper.get('.privacy-meta a').attributes('href')).toBe('mailto:privacy@grailab.top')
  })

  it('sets purpose, retention and cookie data as real tables', () => {
    const wrapper = render()
    const tables = wrapper.findAll('.privacy-table')
    expect(tables.length).toBeGreaterThanOrEqual(3)
    const purpose = tables[0]
    expect(purpose.findAll('thead th').map(th => th.text())).toEqual(['用途', '具体说明', '法律依据'])
    expect(purpose.findAll('tbody tr').length).toBeGreaterThan(4)
  })

  it('does not invent vendor claims beyond the named processors', () => {
    const wrapper = render()
    for (const vendor of ['Clerk', 'Waffo Pancake', 'Cloudflare']) {
      expect(wrapper.text()).toContain(vendor)
    }
    expect(wrapper.text()).not.toContain('营销 Cookie 已启用')
  })

  it('switches the whole document to English with the language setting', async () => {
    const wrapper = render()
    setLocale('en')
    await nextTick()
    expect(wrapper.get('h1').text()).toBe('Privacy policy')
    expect(wrapper.get('.privacy-section h2').text()).toContain('Who is responsible')
    expect(wrapper.findAll('.privacy-section')).toHaveLength(policy.en.sections.length)
    expect(document.title).toBe('Privacy policy | grailab')
  })

  it('marks exactly one current section in the contents rail', () => {
    const wrapper = render()
    expect(wrapper.findAll('.privacy-toc a[aria-current="true"]')).toHaveLength(1)
  })
})
