// Tests run in jsdom, whose navigator reports en-US. The product's copy in the
// specs is Chinese, so pin the locale unless a test overrides it.
import { setLocale } from './i18n'

setLocale('zh')
