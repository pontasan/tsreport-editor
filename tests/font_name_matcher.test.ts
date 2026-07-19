import { describe, expect, it } from 'vitest'
import type { ImportedFontInfo } from 'tsreport-core'
import { matchFontName } from '../src/app/[lang]/editor/font_name_matcher'

function info(baseFont: string, familyName: string, bold: boolean = false, italic: boolean = false): ImportedFontInfo {
    return {
        baseFont,
        familyName,
        subtype: 'Type0',
        flags: 0,
        italic,
        serif: false,
        fixedPitch: false,
        bold,
    }
}

describe('font name matcher', () => {
    const fonts = [
        { name: 'NotoSansJP' },
        { name: 'NotoSansJP-Bold' },
        { name: 'MS-Gothic' },
        { name: 'Arial-Bold' },
        { name: 'TimesNewRomanPSMT' },
    ]

    it('removes subset prefixes and matches style names', () => {
        const matched = matchFontName(info('ABCDEF+NotoSansJP-Bold', 'ABCDEF+NotoSansJP-Bold', true), fonts)
        expect(matched.fontName).toBe('NotoSansJP-Bold')
        expect(matched.warning).toBe(false)
    })

    it('matches legacy comma style names', () => {
        const matched = matchFontName(info('Arial,Bold', 'Arial,Bold', true), fonts)
        expect(matched.fontName).toBe('Arial-Bold')
        expect(matched.warning).toBe(false)
    })

    it('falls back to the default font below threshold', () => {
        const matched = matchFontName(info('UnknownFont', 'UnknownFont'), fonts, 'NotoSansJP')
        expect(matched.fontName).toBe('NotoSansJP')
        expect(matched.warning).toBe(true)
    })

    it('matches on account font name-table metadata when the file name is opaque', () => {
        // File name is a meaningless hash, but the metadata identifies the family
        const metaFonts = [
            { name: 'font_8a1f2c', familyName: 'Hiragino Kaku Gothic Pro', postScriptName: 'HiraKakuPro-W3' },
            { name: 'other_9b2d', familyName: 'Roboto', postScriptName: 'Roboto-Regular' },
        ]
        const matched = matchFontName(info('OVNQIQ+HiraKakuPro-W3', 'HiraKakuPro-W3'), metaFonts, 'NotoSansJP')
        expect(matched.fontName).toBe('font_8a1f2c')
        expect(matched.warning).toBe(false)
    })
})
