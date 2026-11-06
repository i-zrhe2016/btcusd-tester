import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, type Slots } from 'vue'
import ProductApp from './ProductApp.vue'

const clerk = vi.hoisted(() => ({
  isLoaded: { value: true },
  isSignedIn: { value: false },
  userId: { value: null as string | null },
  openSignIn: vi.fn(),
  openSignUp: vi.fn(),
}))

vi.mock('@clerk/vue', async () => {
  const { h } = await import('vue')
  return {
    useAuth: () => ({ isLoaded: clerk.isLoaded, isSignedIn: clerk.isSignedIn, userId: clerk.userId }),
    useClerk: () => ({ value: { openSignIn: clerk.openSignIn, openSignUp: clerk.openSignUp } }),
    UserButton: { name: 'UserButton', render: () => h('div', { 'data-testid': 'user-button' }) },
  }
})

vi.mock('./App.vue', async () => {
  const { h } = await import('vue')
  return {
    __esModule: true,
    default: {
      name: 'WorkspaceStub',
      props: ['userId', 'initialView'],
      setup(props: { userId?: string; initialView?: 'projects' | 'replay' }, { slots }: { slots: Slots }) {
        return () => h('div', {
          'data-testid': 'workspace',
          'data-initial-view': props.initialView ?? '',
        }, slots['topbar-end']?.())
      },
    },
  }
})

vi.mock('./components/ReplayPreview.vue', async () => {
  const { h } = await import('vue')
  return { __esModule: true, default: { name: 'ReplayPreview', setup: () => () => h('div', { 'data-testid': 'replay-preview' }) } }
})

vi.mock('./components/PanePreview.vue', async () => {
  const { h } = await import('vue')
  return { __esModule: true, default: { name: 'PanePreview', setup: () => () => h('div') } }
})

let wrapper: VueWrapper | undefined

async function clickText(selector: string, text: string) {
  const node = wrapper!.findAll(selector).find((item) => item.text().includes(text))
  expect(node, text).toBeDefined()
  await node!.trigger('click')
  await flushPromises()
  // jsdom updates location.hash but does not emit hashchange.
  window.dispatchEvent(new Event('hashchange'))
  await flushPromises()
  await nextTick()
}

function mountApp() {
  wrapper = mount(ProductApp, { global: { stubs: { AuthBridge: true } } })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  clerk.isLoaded.value = true
  clerk.isSignedIn.value = false
  clerk.userId.value = null
  vi.clearAllMocks()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('signed-in landing navigation', () => {
  it('opens the project library when an already signed-in user clicks 登录', async () => {
    clerk.isSignedIn.value = true
    clerk.userId.value = 'user_1'
    mountApp()
    await flushPromises()

    await clickText('button', '登录')

    expect(clerk.openSignIn).not.toHaveBeenCalled()
    const workspace = wrapper!.find('[data-testid="workspace"]')
    expect(workspace.exists()).toBe(true)
    expect(workspace.attributes('data-initial-view')).toBe('projects')
  })

  it('opens the project library when a signed-in user clicks 开始模拟交易', async () => {
    clerk.isSignedIn.value = true
    clerk.userId.value = 'user_1'
    mountApp()
    await flushPromises()

    await clickText('a', '开始模拟交易')

    const workspace = wrapper!.find('[data-testid="workspace"]')
    expect(workspace.exists()).toBe(true)
    expect(workspace.attributes('data-initial-view')).toBe('projects')
  })

  it('passes the account button into the workspace header', async () => {
    clerk.isSignedIn.value = true
    clerk.userId.value = 'user_1'
    mountApp()
    await flushPromises()

    await clickText('a', '开始模拟交易')

    expect(wrapper!.find('[data-testid="workspace"] [data-testid="user-button"]').exists()).toBe(true)
  })

  it('still opens the sign-in dialog for signed-out visitors', async () => {
    mountApp()
    await flushPromises()

    await clickText('button', '登录')

    expect(clerk.openSignIn).toHaveBeenCalledTimes(1)
    expect(wrapper!.find('[data-testid="workspace"]').exists()).toBe(false)
  })
})
