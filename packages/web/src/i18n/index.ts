import { ref, watchEffect } from 'vue'
import en from './en.ts'
import ja from './ja.ts'
import zhTW from './zh-TW.ts'

export type MessageKey = keyof typeof zhTW
export type Messages = Record<MessageKey, string>

/** Keys that come as a `.one` / `.other` pair, chosen by the count. */
type PluralKey = { [K in MessageKey]: K extends `${infer Base}.other` ? Base : never }[MessageKey]

export const LOCALES = {
  'zh-TW': { name: '中文', messages: zhTW as Messages },
  en: { name: 'English', messages: en },
  ja: { name: '日本語', messages: ja },
} as const

export type Locale = keyof typeof LOCALES

const STORAGE_KEY = 'locale'

function detect(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && saved in LOCALES) return saved as Locale
  for (const tag of navigator.languages) {
    const lang = tag.toLowerCase().split('-')[0]
    // There is one Chinese locale; Simplified readers get Traditional rather than English.
    if (lang === 'zh') return 'zh-TW'
    if (lang === 'ja') return 'ja'
    if (lang === 'en') return 'en'
  }
  return 'en'
}

export const locale = ref<Locale>(detect())

export function setLocale(next: Locale) {
  locale.value = next
  localStorage.setItem(STORAGE_KEY, next)
}

watchEffect(() => {
  document.documentElement.lang = locale.value
})

const fill = (text: string, params?: Record<string, string | number>) =>
  params ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : text

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return fill(LOCALES[locale.value].messages[key], params)
}

/** Picks the plural form for `n` (always `.other` in Chinese and Japanese) and fills `{n}`. */
export function tn(key: PluralKey, n: number, params?: Record<string, string | number>): string {
  const form = new Intl.PluralRules(locale.value).select(n) === 'one' ? 'one' : 'other'
  return t(`${key}.${form}` as MessageKey, { n, ...params })
}
