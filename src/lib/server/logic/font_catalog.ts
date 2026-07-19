// Curated Google Fonts catalog for the per-account font download feature.
//
// Only the languages the product commits to are offered. For each language a
// small set of candidate families is proposed; each family maps to one complete
// static/variable TTF served from the google/fonts repository (a single file per
// font id, unlike the CSS API which returns per-unicode-range woff2 subsets).

import { SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@/lib/common/i18n/languages'

export type FontCatalogEntry = {
    // Font id (basename saved to the account's font dir; used as style.fontFamily).
    fontId: string
    // Human-facing family name.
    family: string
    // Complete TTF download URL.
    url: string
}

const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl'

// Latin-script families cover en/de/fr/es/pt/id/vi (Vietnamese diacritics included).
const LATIN: FontCatalogEntry[] = [
    { fontId: 'NotoSans', family: 'Noto Sans', url: `${GF}/notosans/NotoSans%5Bwdth,wght%5D.ttf` },
    { fontId: 'NotoSerif', family: 'Noto Serif', url: `${GF}/notoserif/NotoSerif%5Bwdth,wght%5D.ttf` },
    { fontId: 'Roboto', family: 'Roboto', url: `${GF}/roboto/Roboto%5Bwdth,wght%5D.ttf` },
]

// language code (editor lang / ISO) -> candidate families.
const CATALOG: Record<LanguageCode, FontCatalogEntry[]> = {
    ja: [
        { fontId: 'NotoSansJP', family: 'Noto Sans JP', url: `${GF}/notosansjp/NotoSansJP%5Bwght%5D.ttf` },
        { fontId: 'NotoSerifJP', family: 'Noto Serif JP', url: `${GF}/notoserifjp/NotoSerifJP%5Bwght%5D.ttf` },
    ],
    en: LATIN,
    'zh-CN': [
        { fontId: 'NotoSansSC', family: 'Noto Sans SC', url: `${GF}/notosanssc/NotoSansSC%5Bwght%5D.ttf` },
        { fontId: 'NotoSerifSC', family: 'Noto Serif SC', url: `${GF}/notoserifsc/NotoSerifSC%5Bwght%5D.ttf` },
    ],
    ko: [
        { fontId: 'NotoSansKR', family: 'Noto Sans KR', url: `${GF}/notosanskr/NotoSansKR%5Bwght%5D.ttf` },
        { fontId: 'NotoSerifKR', family: 'Noto Serif KR', url: `${GF}/notoserifkr/NotoSerifKR%5Bwght%5D.ttf` },
    ],
    'zh-TW': [
        { fontId: 'NotoSansTC', family: 'Noto Sans TC', url: `${GF}/notosanstc/NotoSansTC%5Bwght%5D.ttf` },
        { fontId: 'NotoSerifTC', family: 'Noto Serif TC', url: `${GF}/notoseriftc/NotoSerifTC%5Bwght%5D.ttf` },
    ],
    vi: [
        { fontId: 'NotoSans', family: 'Noto Sans', url: `${GF}/notosans/NotoSans%5Bwdth,wght%5D.ttf` },
        { fontId: 'NotoSerif', family: 'Noto Serif', url: `${GF}/notoserif/NotoSerif%5Bwdth,wght%5D.ttf` },
        { fontId: 'BeVietnamPro', family: 'Be Vietnam Pro', url: `${GF}/bevietnampro/BeVietnamPro-Regular.ttf` },
    ],
    th: [
        { fontId: 'NotoSansThai', family: 'Noto Sans Thai', url: `${GF}/notosansthai/NotoSansThai%5Bwdth,wght%5D.ttf` },
        { fontId: 'NotoSerifThai', family: 'Noto Serif Thai', url: `${GF}/notoserifthai/NotoSerifThai%5Bwdth,wght%5D.ttf` },
    ],
    id: LATIN,
    de: LATIN,
    fr: LATIN,
    es: LATIN,
    pt: LATIN,
    ar: [
        { fontId: 'NotoSansArabic', family: 'Noto Sans Arabic', url: `${GF}/notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf` },
        { fontId: 'NotoKufiArabic', family: 'Noto Kufi Arabic', url: `${GF}/notokufiarabic/NotoKufiArabic%5Bwght%5D.ttf` },
    ],
    he: [
        { fontId: 'NotoSansHebrew', family: 'Noto Sans Hebrew', url: `${GF}/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf` },
        { fontId: 'NotoSerifHebrew', family: 'Noto Serif Hebrew', url: `${GF}/notoserifhebrew/NotoSerifHebrew%5Bwdth,wght%5D.ttf` },
    ],
}

export const FONT_CATALOG_LANGUAGE_CODES: readonly LanguageCode[] = SUPPORTED_LANGUAGE_CODES

export function candidatesForLanguage(language: LanguageCode): FontCatalogEntry[] {
    return CATALOG[language]
}

// Looks up a single catalog entry by font id across all languages (for download).
export function catalogEntryByFontId(fontId: string): FontCatalogEntry | undefined {
    const codes = SUPPORTED_LANGUAGE_CODES
    for (let i = 0; i < codes.length; i++) {
        const entries = CATALOG[codes[i]!]!
        for (let j = 0; j < entries.length; j++) {
            if (entries[j]!.fontId === fontId) return entries[j]
        }
    }
    return undefined
}
