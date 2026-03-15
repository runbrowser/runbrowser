import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'zh', 'ja', 'fr', 'es'],
  defaultLocale: 'en',
})

/* Display names for each locale, used in the locale switcher */
export const localeNames: Record<string, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  fr: 'Français',
  es: 'Español',
}
