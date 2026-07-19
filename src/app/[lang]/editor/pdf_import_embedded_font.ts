import { Font, normalizePdfEmbeddedFont, TextMeasurer, type ImportedFontInfo, type ImportedPage } from 'tsreport-core'
import { DEFAULT_FONT_ID } from '@/lib/common/font_ids'
import { matchFontName } from './font_name_matcher'
import type { FontEntry, FontResource } from './font_loader'
import { pdfFontKey } from './pdf_import_converter'

export type PdfEmbeddedFontSource = {
    fontId: string,
    fileName: string,
    extension: '.otf' | '.ttf',
    bytes: Uint8Array,
    resource: FontResource
}

export type PdfImportFontRow = {
    key: string,
    info: ImportedFontInfo,
    score: number,
    warning: boolean,
    fontName: string,
    embeddedSource: PdfEmbeddedFontSource | null
}

/**
 * Prepares the original font program embedded in a PDF for report use.
 *
 * The generated id is content-addressed, so importing the same subset again
 * reuses the same account font file. Nothing is installed into the operating
 * system; the normalized subset remains an application resource.
 */
export async function preparePdfEmbeddedFont(info: ImportedFontInfo): Promise<PdfEmbeddedFontSource | null> {
    const bytes = normalizePdfEmbeddedFont(info)
    if (bytes === null) return null
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))
    const hash = hex(digest)
    const family = sanitizeFilePart(info.familyName || info.baseFont).slice(0, 40) || 'font'
    const fontId = 'pdf-' + family + '-' + hash
    const extension = isOpenTypeCff(bytes) ? '.otf' : '.ttf'
    return {
        fontId,
        fileName: fontId + extension,
        extension,
        bytes,
        resource: {
            font,
            measurer: new TextMeasurer(font),
            fontId,
            sourceBytes: bytes,
        },
    }
}

export async function buildPdfImportFontRows(fonts: ImportedFontInfo[], fontList: FontEntry[]): Promise<PdfImportFontRow[]> {
    const rows: PdfImportFontRow[] = []
    for (let i = 0; i < fonts.length; i++) {
        const info = fonts[i]!
        const embeddedSource = await preparePdfEmbeddedFont(info)
        if (embeddedSource !== null) {
            rows.push({
                key: pdfFontKey(info.baseFont, info.familyName),
                info,
                score: 1,
                warning: false,
                fontName: embeddedSource.fontId,
                embeddedSource,
            })
            continue
        }
        const matched = matchFontName(info, fontList, DEFAULT_FONT_ID)
        rows.push({
            key: pdfFontKey(info.baseFont, info.familyName),
            info,
            score: matched.score,
            warning: matched.warning,
            fontName: matched.fontName,
            embeddedSource: null,
        })
    }
    return rows
}

export function assignPdfImportPreviewFonts(page: ImportedPage, rows: PdfImportFontRow[]): ImportedPage {
    const assignments = new Map<string, string>()
    for (let i = 0; i < rows.length; i++) {
        assignments.set(rows[i]!.info.familyName, rows[i]!.fontName)
        assignments.set(rows[i]!.info.baseFont, rows[i]!.fontName)
    }
    return {
        ...page,
        styles: page.styles.map(function (style) {
            if (style.fontFamily === undefined) return style
            const assigned = assignments.get(style.fontFamily)
            return assigned === undefined ? style : { ...style, fontFamily: assigned }
        }),
    }
}

function isOpenTypeCff(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4F
}

function sanitizeFilePart(value: string): string {
    let result = ''
    for (let i = 0; i < value.length; i++) {
        const char = value[i]!
        const code = value.charCodeAt(i)
        if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A) || char === '-' || char === '_') {
            result += char
        } else if (result !== '' && result[result.length - 1] !== '-') {
            result += '-'
        }
    }
    return result.replace(/^-+|-+$/g, '')
}

function hex(bytes: Uint8Array): string {
    let result = ''
    for (let i = 0; i < bytes.length; i++) result += bytes[i]!.toString(16).padStart(2, '0')
    return result
}
