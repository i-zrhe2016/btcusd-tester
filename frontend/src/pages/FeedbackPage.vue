<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { UserButton, useAuth, useClerk } from '@clerk/vue'
import { ArrowLeft, ChevronRight, Send } from '@lucide/vue'
import AuthBridge from '../components/AuthBridge.vue'
import BrandMark from '../components/BrandMark.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import { createFeedback, getFeedback, listFeedback, replyFeedback } from '../api'
import { formatUtc } from '../format'
import { locale, t, type MessageKey } from '../i18n'
import {
  FEEDBACK_BODY_LIMIT,
  FEEDBACK_CATEGORIES,
  FEEDBACK_TITLE_LIMIT,
  feedbackTimestamp,
  validateFeedbackDraft,
  type FeedbackCategory,
  type FeedbackFieldError,
  type FeedbackMessage,
  type FeedbackThread,
  type FeedbackThreadDetail,
} from '../feedback'
import '../feedback.css'

const { isLoaded, isSignedIn } = useAuth()
const clerk = useClerk()


const threads = ref<FeedbackThread[]>([])
const loading = ref(false)
const loadError = ref(false)
const filter = ref<'all' | 'mine'>('all')

const draft = reactive({ title: '', body: '', category: 'bug' as FeedbackCategory })
const submitting = ref(false)
const fieldError = ref<FeedbackFieldError | null>(null)
const submitError = ref('')

const threadId = ref<string | null>(readThreadId())
const detail = ref<FeedbackThreadDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref(false)
const chatScroller = ref<HTMLElement | null>(null)
const threadHeading = ref<HTMLElement | null>(null)

const replyBody = ref('')
const replying = ref(false)
const replyError = ref('')

const categoryLabels: Record<FeedbackCategory, MessageKey> = {
  bug: 'feedback.category.bug',
  idea: 'feedback.category.idea',
  other: 'feedback.category.other',
}

const statusLabels = {
  open: 'feedback.status.open',
  in_progress: 'feedback.status.in_progress',
  resolved: 'feedback.status.resolved',
} as const

const filteredThreads = computed(() =>
  filter.value === 'mine' ? threads.value.filter(thread => thread.mine) : threads.value,
)

const fieldErrorMessage = computed(() => {
  if (!fieldError.value) return ''
  const messages: Record<FeedbackFieldError, { key: MessageKey; params?: Record<string, number> }> = {
    titleRequired: { key: 'feedback.titleRequired' },
    titleTooLong: { key: 'feedback.titleTooLong', params: { max: FEEDBACK_TITLE_LIMIT } },
    bodyRequired: { key: 'feedback.bodyRequired' },
    bodyTooLong: { key: 'feedback.bodyTooLong', params: { max: FEEDBACK_BODY_LIMIT } },
  }
  const entry = messages[fieldError.value]
  return t(entry.key, entry.params ?? {})
})

function readThreadId(): string | null {
  const match = /^\/feedback\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
    window.location.pathname,
  )
  return match ? match[1]! : null
}

function authorLabel(thread: FeedbackThread): string {
  return thread.mine ? t('feedback.you') : t('feedback.authorCode', { code: thread.authorCode })
}

function categoryLabel(category: FeedbackCategory): string {
  return t(categoryLabels[category] ?? 'feedback.category.other')
}

function statusLabel(status: FeedbackThread['status']): string {
  return t(statusLabels[status] ?? 'feedback.status.open')
}

function timeLabel(value: string): string {
  const seconds = feedbackTimestamp(value)
  return seconds ? formatUtc(seconds) : '—'
}

function messageAuthor(message: FeedbackMessage): string {
  if (message.author === 'team') return t('feedback.team')
  return detail.value?.thread.mine
    ? t('feedback.you')
    : t('feedback.authorCode', { code: detail.value?.thread.authorCode ?? '' })
}

async function loadThreads() {
  if (!isSignedIn.value) return
  loading.value = true
  loadError.value = false
  try {
    const result = await listFeedback()
    if (isSignedIn.value) threads.value = result
  } catch {
    if (isSignedIn.value) loadError.value = true
  } finally {
    loading.value = false
  }
}

async function loadDetail() {
  const id = threadId.value
  if (!id || !isSignedIn.value) return
  detailLoading.value = true
  detailError.value = false
  detail.value = null
  replyBody.value = ''
  replyError.value = ''
  let loaded = false
  try {
    const result = await getFeedback(id)
    // A slower response for a thread the user already left must not replace it.
    if (threadId.value !== id) return
    detail.value = result
    loaded = true
  } catch {
    if (threadId.value === id) detailError.value = true
  } finally {
    // Leave the skeleton before measuring: the chat only exists once detail
    // renders, and scrolling an unmounted list does nothing on a deep link.
    if (threadId.value === id) detailLoading.value = false
  }
  if (loaded) {
    await nextTick()
    scrollToLatest()
    // Move keyboard and screen-reader context into the opened conversation
    // without shifting the page scroll position.
    threadHeading.value?.focus({ preventScroll: true })
  }
}

function scrollToLatest() {
  const element = chatScroller.value
  if (element) element.scrollTop = element.scrollHeight
}

function openThread(id: string) {
  if (threadId.value === id) return
  window.history.pushState({ feedback: id }, '', `/feedback/${id}`)
  threadId.value = id
  void loadDetail()
}

function backToList() {
  if (window.history.state?.feedback) window.history.back()
  else window.history.pushState({}, '', '/feedback')
  threadId.value = null
  detail.value = null
  detailError.value = false
}

function syncRoute() {
  threadId.value = readThreadId()
  if (threadId.value) void loadDetail()
  else detail.value = null
}

async function submitFeedback() {
  const problem = validateFeedbackDraft(draft)
  fieldError.value = problem
  submitError.value = ''
  if (problem) return
  submitting.value = true
  try {
    const created = await createFeedback({
      title: draft.title.trim(),
      body: draft.body.trim(),
      category: draft.category,
    })
    threads.value = [created, ...threads.value.filter(thread => thread.id !== created.id)]
    draft.title = ''
    draft.body = ''
    draft.category = 'bug'
    openThread(created.id)
  } catch {
    submitError.value = t('feedback.submitFailed')
  } finally {
    submitting.value = false
  }
}

async function sendReply() {
  const thread = detail.value?.thread
  if (!thread) return
  const body = replyBody.value.trim()
  if (!body) {
    replyError.value = t('feedback.replyEmpty')
    return
  }
  replying.value = true
  replyError.value = ''
  try {
    const message = await replyFeedback(thread.id, body)
    detail.value?.messages.push(message)
    thread.messageCount += 1
    thread.updatedAt = message.createdAt
    const row = threads.value.find(candidate => candidate.id === thread.id)
    if (row) {
      row.messageCount += 1
      row.lastBody = message.body
      row.updatedAt = message.createdAt
    }
    replyBody.value = ''
    await nextTick()
    scrollToLatest()
  } catch {
    replyError.value = t('feedback.replyFailed')
  } finally {
    replying.value = false
  }
}

function openAuth(mode: 'login' | 'signup') {
  if (!clerk.value) return
  const options = {
    forceRedirectUrl: window.location.href,
    fallbackRedirectUrl: window.location.href,
    oauthFlow: 'redirect' as const,
  }
  if (mode === 'login') {
    clerk.value.openSignIn({
      ...options,
      signUpForceRedirectUrl: window.location.href,
      signUpFallbackRedirectUrl: window.location.href,
    })
  } else {
    clerk.value.openSignUp({
      ...options,
      signInForceRedirectUrl: window.location.href,
      signInFallbackRedirectUrl: window.location.href,
    })
  }
}

function applyTitle() {
  document.title = t('feedback.docTitle')
}

watch([isLoaded, isSignedIn], ([loaded, entered]) => {
  if (!loaded) return
  if (entered) {
    void loadThreads()
    if (threadId.value) void loadDetail()
  } else {
    threads.value = []
    detail.value = null
  }
}, { immediate: true })

watch(locale, applyTitle)

onMounted(() => {
  applyTitle()
  window.addEventListener('popstate', syncRoute)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncRoute)
})
</script>

<template>
  <AuthBridge />
  <div v-if="isLoaded && !isSignedIn" class="gate">
    <div class="fb-gate-lang"><LanguageSwitcher /></div>
    <main id="main-content" class="gate-card">
      <BrandMark class="gate-mark" />
      <h1>{{ t('feedback.gateTitle') }}</h1>
      <p>{{ t('feedback.gateBody') }}</p>
      <div class="gate-actions">
        <button class="btn btn-ghost" @click="openAuth('login')">{{ t('product.login') }}</button>
        <button class="btn btn-primary" @click="openAuth('signup')">{{ t('product.signup') }}</button>
      </div>
      <a class="gate-back" href="/">{{ t('product.returnHome') }}</a>
    </main>
  </div>

  <div v-else-if="!isLoaded" class="gate">
    <main id="main-content" class="gate-card" aria-live="polite">
      <BrandMark class="gate-mark" />
      <h1>{{ t('feedback.pageTitle') }}</h1>
      <p>{{ t('feedback.gateLoading') }}</p>
    </main>
  </div>

  <div v-else class="feedback">
    <header class="fb-header">
      <div class="fb-wrap fb-header-inner">
        <a class="brand" href="/" :aria-label="t('product.homeLabel')">
          <BrandMark />grailab
        </a>
        <nav class="fb-nav" :aria-label="t('feedback.navLabel')">
          <a href="/#workspace">{{ t('feedback.backToWorkspace') }}</a>
        </nav>
        <div class="fb-account">
          <LanguageSwitcher />
          <UserButton />
        </div>
      </div>
    </header>

    <main id="main-content" class="fb-wrap fb-main" tabindex="-1">
      <template v-if="!threadId">
        <section class="fb-head">
          <h1>{{ t('feedback.pageTitle') }}</h1>
          <p>{{ t('feedback.pageLead') }}</p>
        </section>

        <section class="fb-compose" aria-labelledby="fb-compose-title">
          <div class="fb-compose-head">
            <h2 id="fb-compose-title">{{ t('feedback.composeTitle') }}</h2>
            <p>{{ t('feedback.composeHint') }}</p>
          </div>
          <form class="fb-form" novalidate @submit.prevent="submitFeedback">
            <fieldset class="fb-field fb-categories">
              <legend>{{ t('feedback.categoryLabel') }}</legend>
              <div class="fb-segments">
                <label v-for="category in FEEDBACK_CATEGORIES" :key="category" class="fb-segment">
                  <input v-model="draft.category" type="radio" name="feedback-category" :value="category" />
                  <span>{{ categoryLabel(category) }}</span>
                </label>
              </div>
            </fieldset>

            <div class="fb-field">
              <div class="fb-label-row">
                <label for="fb-title">{{ t('feedback.titleLabel') }}</label>
                <span class="fb-counter" aria-hidden="true">{{ t('feedback.counter', { count: draft.title.length, max: FEEDBACK_TITLE_LIMIT }) }}</span>
              </div>
              <input
                id="fb-title"
                v-model="draft.title"
                type="text"
                autocomplete="off"
                :maxlength="FEEDBACK_TITLE_LIMIT"
                :placeholder="t('feedback.titlePlaceholder')"
                :aria-invalid="fieldError === 'titleRequired' || fieldError === 'titleTooLong'"
                :aria-describedby="fieldError === 'titleRequired' || fieldError === 'titleTooLong' ? 'fb-form-error' : undefined"
                @input="fieldError = null; submitError = ''"
              />
            </div>

            <div class="fb-field">
              <div class="fb-label-row">
                <label for="fb-body">{{ t('feedback.bodyLabel') }}</label>
                <span class="fb-counter" aria-hidden="true">{{ t('feedback.counter', { count: draft.body.length, max: FEEDBACK_BODY_LIMIT }) }}</span>
              </div>
              <textarea
                id="fb-body"
                v-model="draft.body"
                rows="5"
                :maxlength="FEEDBACK_BODY_LIMIT"
                :placeholder="t('feedback.bodyPlaceholder')"
                :aria-invalid="fieldError === 'bodyRequired' || fieldError === 'bodyTooLong'"
                :aria-describedby="fieldError === 'bodyRequired' || fieldError === 'bodyTooLong' ? 'fb-form-error' : undefined"
                @input="fieldError = null; submitError = ''"
              ></textarea>
            </div>

            <p v-if="fieldErrorMessage" id="fb-form-error" class="fb-error" role="alert">{{ fieldErrorMessage }}</p>
            <p v-else-if="submitError" class="fb-error" role="alert">{{ submitError }}</p>

            <div class="fb-form-actions">
              <button class="btn btn-primary" type="submit" :disabled="submitting">
                {{ submitting ? t('feedback.submitting') : t('feedback.submit') }}
              </button>
            </div>
          </form>
        </section>

        <section class="fb-history" aria-labelledby="fb-history-title">
          <div class="fb-history-head">
            <h2 id="fb-history-title">
              {{ t('feedback.historyTitle') }}
              <span v-if="!loading && !loadError" class="fb-history-count">{{ t('feedback.historyCount', { count: threads.length }) }}</span>
            </h2>
            <div class="fb-filters" role="group" :aria-label="t('feedback.filterLabel')">
              <button type="button" :aria-pressed="filter === 'all'" @click="filter = 'all'">{{ t('feedback.filterAll') }}</button>
              <button type="button" :aria-pressed="filter === 'mine'" @click="filter = 'mine'">{{ t('feedback.filterMine') }}</button>
            </div>
          </div>

          <div v-if="loading" class="fb-list fb-list-loading" aria-live="polite" :aria-label="t('feedback.loading')">
            <span v-for="index in 3" :key="index" class="fb-skeleton-row" aria-hidden="true"></span>
          </div>

          <div v-else-if="loadError" class="fb-placeholder" role="alert">
            <p>{{ t('feedback.loadError') }}</p>
            <button type="button" class="btn btn-ghost btn-sm" @click="loadThreads">{{ t('feedback.retry') }}</button>
          </div>

          <div v-else-if="filteredThreads.length === 0" class="fb-placeholder">
            <h3>{{ filter === 'mine' ? t('feedback.emptyMineTitle') : t('feedback.emptyTitle') }}</h3>
            <p>{{ filter === 'mine' ? t('feedback.emptyMineBody') : t('feedback.emptyBody') }}</p>
          </div>

          <ul v-else class="fb-list" :aria-label="t('feedback.listLabel')">
            <li v-for="thread in filteredThreads" :key="thread.id">
              <button class="fb-row" type="button" :aria-label="t('feedback.openThread', { title: thread.title })" @click="openThread(thread.id)">
                <span class="fb-cat" :data-category="thread.category">{{ categoryLabel(thread.category) }}</span>
                <span class="fb-row-main">
                  <span class="fb-row-title">{{ thread.title }}</span>
                  <span class="fb-row-snippet">{{ thread.lastBody }}</span>
                </span>
                <span class="fb-row-meta">
                  <span>{{ authorLabel(thread) }}</span>
                  <span>{{ t('feedback.timeUtc', { time: timeLabel(thread.updatedAt) }) }}</span>
                </span>
                <span class="fb-status" :data-status="thread.status">{{ statusLabel(thread.status) }}</span>
                <span class="fb-row-count" :aria-label="t('feedback.messageCount', { count: thread.messageCount })">{{ thread.messageCount }}</span>
                <ChevronRight class="fb-row-chevron" :size="16" :stroke-width="1.8" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </section>
      </template>

      <template v-else>
        <button class="fb-back" type="button" @click="backToList">
          <ArrowLeft :size="15" :stroke-width="1.9" aria-hidden="true" />{{ t('feedback.back') }}
        </button>

        <div v-if="detailLoading" class="fb-thread fb-thread-loading" aria-live="polite" :aria-label="t('feedback.loading')">
          <span class="fb-skeleton-title" aria-hidden="true"></span>
          <span class="fb-skeleton-line" aria-hidden="true"></span>
          <span class="fb-skeleton-line short" aria-hidden="true"></span>
        </div>

        <div v-else-if="detailError" class="fb-placeholder" role="alert">
          <p>{{ t('feedback.threadLoadError') }}</p>
          <button type="button" class="btn btn-ghost btn-sm" @click="loadDetail">{{ t('feedback.retry') }}</button>
        </div>

        <article v-else-if="detail" class="fb-thread">
          <header class="fb-thread-head">
            <div class="fb-thread-tags">
              <span class="fb-cat" :data-category="detail.thread.category">{{ categoryLabel(detail.thread.category) }}</span>
              <span class="fb-status" :data-status="detail.thread.status">{{ statusLabel(detail.thread.status) }}</span>
            </div>
            <h1 ref="threadHeading" tabindex="-1">{{ detail.thread.title }}</h1>
            <p class="fb-thread-meta">
              <span>{{ authorLabel(detail.thread) }}</span>
              <span>{{ t('feedback.createdAt', { time: timeLabel(detail.thread.createdAt) }) }}</span>
              <span>{{ t('feedback.messageCount', { count: detail.thread.messageCount }) }}</span>
            </p>
          </header>

          <section class="fb-chat" :aria-label="t('feedback.conversationLabel')">
            <ol ref="chatScroller" class="fb-messages" role="log" aria-live="polite" aria-relevant="additions">
              <li
                v-for="message in detail.messages"
                :key="message.id"
                class="fb-message"
                :class="[message.author, { mine: message.author === 'user' && detail.thread.mine }]"
              >
                <div class="fb-message-meta">
                  <strong>{{ messageAuthor(message) }}</strong>
                  <time :datetime="message.createdAt">{{ timeLabel(message.createdAt) }}</time>
                </div>
                <p class="fb-bubble">{{ message.body }}</p>
              </li>
            </ol>

            <form v-if="detail.thread.mine" class="fb-reply" @submit.prevent="sendReply">
              <label for="fb-reply">{{ t('feedback.replyLabel') }}</label>
              <textarea
                id="fb-reply"
                v-model="replyBody"
                rows="3"
                :placeholder="t('feedback.replyPlaceholder')"
                @input="replyError = ''"
              ></textarea>
              <div class="fb-reply-actions">
                <p v-if="replyError" class="fb-error" role="alert">{{ replyError }}</p>
                <button class="btn btn-primary btn-sm" type="submit" :disabled="replying">
                  <Send :size="15" :stroke-width="1.9" aria-hidden="true" />
                  {{ replying ? t('feedback.replying') : t('feedback.reply') }}
                </button>
              </div>
            </form>
            <p v-else class="fb-owner-note">{{ t('feedback.ownerOnly') }}</p>
          </section>
        </article>
      </template>
    </main>
  </div>
</template>
