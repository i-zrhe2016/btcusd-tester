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

// Compact UTC month for coverage labels; width stays stable across values.
export function formatUtcMonth(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 7)
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const zh = locale.value === 'zh'
  if (days > 0) return zh ? `${days} 天${hours ? ` ${hours} 小时` : ''}` : `${days}d${hours ? ` ${hours}h` : ''}`
  if (hours > 0) return zh ? `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}` : `${hours}h${minutes ? ` ${minutes}m` : ''}`
  if (minutes > 0) return zh ? `${minutes} 分钟` : `${minutes}m`
  return zh ? '0 分钟' : '0m'
}

export function toUtcInput(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 16)
}

export function fromUtcInput(value: string): number {
  return Math.floor(new Date(`${value}:00Z`).getTime() / 1000)
}

