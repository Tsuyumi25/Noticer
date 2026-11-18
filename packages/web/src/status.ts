import type { CardModel } from 'server/dashboard'
import { t } from './i18n/index.ts'

export type CardStatus = CardModel['status']

export const ACCENT: Record<CardStatus, string> = {
  danger: '#ef4444',
  warning: '#f97316',
  pending: '#3b82f6',
  good: '#22c55e',
  unknown: '#94a3b8',
}

export const BACKGROUND: Record<CardStatus, string> = {
  danger: '#fef2f2',
  warning: '#fffbeb',
  pending: '#eff6ff',
  good: '#f0fdf4',
  unknown: '#ffffff',
}

export const WAVE_SECONDS: Record<CardStatus, number> = { danger: 2, warning: 2.5, pending: 4, good: 10, unknown: 10 }

export const hasStatusIcon = (status: CardStatus) => status === 'good' || status === 'warning' || status === 'danger'

/** ≤ 48 hours in hours, otherwise days; one decimal, no trailing .0. */
export function formatHours(hours: number | null): { value: string; unit: string } {
  if (hours == null || !Number.isFinite(hours)) return { value: '--', unit: '' }
  const [n, unit] = hours <= 48 ? [Math.max(0, hours), t('unit.hour')] : [hours / 24, t('unit.day')]
  const rounded = Math.round(n * 10) / 10
  return { value: Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1), unit }
}
