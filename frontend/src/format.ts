import { locale } from './i18n'

function intlLocale(): string {
  return locale.value === 'zh' ? 'zh-CN' : 'en-US'
}

const currencyOptions: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

const decimalOptions: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat(intlLocale(), currencyOptions).format(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(intlLocale(), decimalOptions).format(value)
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}%`
}

export function formatUtc(timestamp: number): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp * 1000))
}

export function toUtcInput(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 16)
}

export function fromUtcInput(value: string): number {
  return Math.floor(new Date(`${value}:00Z`).getTime() / 1000)
}

