// Single source of truth for UI languages. Every entry has a complete client
// catalog and is accepted as the `[lang]` URL segment (for example /en/editor).

export const SUPPORTED_LANGUAGE_CODES = [
    'ja', 'en', 'zh-CN', 'ko', 'zh-TW', 'vi', 'th', 'id',
    'de', 'fr', 'es', 'pt', 'ar', 'he',
] as const

export type LanguageCode = typeof SUPPORTED_LANGUAGE_CODES[number]

export type LanguageOption = {
    code: LanguageCode
    label: string
}

// Language selectors use endonyms so their labels do not depend on the
// currently selected UI language and remain recognizable to native readers.
export const LANGUAGE_LABEL_BY_CODE: Record<LanguageCode, string> = {
    ja: '日本語',
    en: 'English',
    'zh-CN': '简体中文',
    ko: '한국어',
    'zh-TW': '繁體中文',
    vi: 'Tiếng Việt',
    th: 'ไทย',
    id: 'Bahasa Indonesia',
    de: 'Deutsch',
    fr: 'Français',
    es: 'Español',
    pt: 'Português',
    ar: 'العربية',
    he: 'עברית',
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = SUPPORTED_LANGUAGE_CODES.map(function (code) {
    return { code, label: LANGUAGE_LABEL_BY_CODE[code] }
})

// The default UI language when the request's language cannot be matched.
export const DEFAULT_LANGUAGE_CODE: LanguageCode = 'en'

// Resolves an untrusted language value (query parameter, cookie) to a supported
// `[lang]` URL segment, falling back to the default. Single source of truth so
// every route that builds a redirect path validates identically.
export function isSupportedLanguage(raw: string): raw is LanguageCode {
    return (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(raw)
}

export function resolveSupportedLanguage(raw: string): LanguageCode {
    return isSupportedLanguage(raw) ? raw : DEFAULT_LANGUAGE_CODE
}

export function getLanguageDirection(lang: LanguageCode): 'ltr' | 'rtl' {
    return lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr'
}

export function localizePathname(pathname: string, lang: LanguageCode): string {
    const segments = pathname.split('/')
    if (segments.length > 1 && isSupportedLanguage(segments[1])) {
        segments[1] = lang
        return segments.join('/')
    }
    return '/' + lang + (pathname.startsWith('/') ? pathname : '/' + pathname)
}
