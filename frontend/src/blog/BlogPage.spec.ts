import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
vi.mock('virtual:blog', () => ({ default: [
  { title: '练习与复盘', slug: 'practice', description: '完成一次有记录的练习。', publishedAt: '2026-11-06', tags: ['使用教程'], cover: '', html: '<h2>记录决策</h2><p>正文 <strong>重点</strong></p><script>window.__unsafe = true</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">unsafe</a>' },
] }))
import BlogPage from '../pages/BlogPage.vue'
const wrappers: ReturnType<typeof mount>[] = []
function render(path: string) { window.history.replaceState({}, '', path); const wrapper = mount(BlogPage); wrappers.push(wrapper); return wrapper }
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); window.history.replaceState({}, '', '/'); document.head.querySelector('meta[name="robots"]')?.remove() })
describe('public article pages', () => {
  it('lists published titles, summaries, dates and stable detail links', () => {
    const wrapper = render('/blog')
    expect(wrapper.get('h1').text()).toBe('文章')
    expect(wrapper.get('h2 a').attributes('href')).toBe('/blog/practice')
    expect(wrapper.text()).toContain('完成一次有记录的练习。')
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-11-06')
  })
  it('renders article content, title and return navigation without auth', async () => {
    const wrapper = render('/blog/practice')
    await nextTick()
    expect(wrapper.get('h1').text()).toBe('练习与复盘')
    expect(wrapper.get('.blog-prose strong').text()).toBe('重点')
    expect(wrapper.get('.blog-back').attributes('href')).toBe('/blog')
    expect(document.title).toBe('练习与复盘 | grailab')
  })
  it('strips executable HTML from rendered Markdown', () => {
    const wrapper = render('/blog/practice')
    expect(wrapper.find('.blog-prose script').exists()).toBe(false)
    expect(wrapper.get('.blog-prose img').attributes('onerror')).toBeUndefined()
    expect(wrapper.get('.blog-prose a').attributes('href')).toBeUndefined()
    expect(wrapper.get('.blog-prose').text()).toContain('正文 重点')
  })
  it('shows actionable missing-article state and prevents indexing', () => {
    const wrapper = render('/blog/missing')
    expect(wrapper.get('h1').text()).toBe('文章不存在')
    expect(wrapper.get('.blog-missing a').attributes('href')).toBe('/blog')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
  })
})
