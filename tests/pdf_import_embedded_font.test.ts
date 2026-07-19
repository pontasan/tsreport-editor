import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ImportedFontInfo } from 'tsreport-core'
import { assignPdfImportPreviewFonts, buildPdfImportFontRows, preparePdfEmbeddedFont } from '../src/app/[lang]/editor/pdf_import_embedded_font'

function importedFont(bytes: Uint8Array): ImportedFontInfo {
    return {
        baseFont: 'ABCDEF+STIXTwoMath-Regular',
        familyName: 'STIXTwoMath-Regular',
        subtype: 'Type0',
        flags: 0,
        italic: false,
        serif: false,
        fixedPitch: false,
        bold: false,
        fontFile: bytes,
        fontFileFormat: 'opentype',
    }
}

describe('PDF import embedded font preparation', () => {
    it('creates a deterministic application font resource and selects it by default', async () => {
        const path = join(__dirname, '..', 'src', 'public', 'fonts', 'STIXTwoMath.otf')
        const bytes = new Uint8Array(readFileSync(path))
        const info = importedFont(bytes)
        const first = await preparePdfEmbeddedFont(info)
        const second = await preparePdfEmbeddedFont(info)

        expect(first).not.toBeNull()
        expect(second).not.toBeNull()
        expect(first!.fontId).toBe(second!.fontId)
        expect(first!.fileName).toBe(first!.fontId + '.otf')
        expect(first!.resource.fontId).toBe(first!.fontId)
        expect(first!.resource.sourceBytes).toEqual(first!.bytes)

        const rows = await buildPdfImportFontRows([info], [])
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            fontName: first!.fontId,
            score: 1,
            warning: false,
        })
        expect(rows[0]!.embeddedSource?.fontId).toBe(first!.fontId)

        const page = {
            width: 100,
            height: 100,
            fonts: [info],
            styles: [{ name: 'pdf', fontFamily: info.familyName }],
            images: {},
            elements: [],
        }
        expect(assignPdfImportPreviewFonts(page, rows).styles[0]!.fontFamily).toBe(first!.fontId)
    })
})
