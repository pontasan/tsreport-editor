import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
    DEFAULT_FONT_ID,
    LEGACY_DEFAULT_FONT_ID,
    buildFontFileIndex,
    builtinFontFilePath,
    resolveFontFilePath,
} from '../src/lib/server/logic/font_resolver'
import { ReportPreviewLogic } from '../src/lib/server/logic/report_preview_logic'

const temporaryDirectories: string[] = []

async function createFontDirectory(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'font-resolver-'))
    temporaryDirectories.push(dir)
    return dir
}

afterEach(async function () {
    for (let i = 0; i < temporaryDirectories.length; i++) {
        await rm(temporaryDirectories[i]!, { recursive: true, force: true })
    }
    temporaryDirectories.length = 0
})

describe('font id resolution', function () {
    test('canonical built-in id resolves to identical bytes for preview and print when a legacy account id exists', async function () {
        const fontDir = await createFontDirectory()
        const accountPath = join(fontDir, LEGACY_DEFAULT_FONT_ID + '.ttf')
        await writeFile(accountPath, 'account-font-bytes')

        const printPath = resolveFontFilePath(DEFAULT_FONT_ID, fontDir)
        expect(printPath).toBe(builtinFontFilePath(DEFAULT_FONT_ID))

        const preview = await ReportPreviewLogic.getFontBinary(fontDir, DEFAULT_FONT_ID, null)
        const printBytes = await readFile(printPath!)
        expect(Buffer.compare(preview.data!, printBytes)).toBe(0)
    })

    test('legacy id preserves account-first resolution for existing reports', async function () {
        const fontDir = await createFontDirectory()
        const accountPath = join(fontDir, LEGACY_DEFAULT_FONT_ID + '.ttf')
        await writeFile(accountPath, 'account-font-bytes')

        expect(resolveFontFilePath(LEGACY_DEFAULT_FONT_ID, fontDir)).toBe(accountPath)
        const preview = await ReportPreviewLogic.getFontBinary(fontDir, LEGACY_DEFAULT_FONT_ID, null)
        expect(preview.data!.toString('utf-8')).toBe('account-font-bytes')
    })

    test('preview catalog exposes canonical built-in and colliding account ids as distinct entries', async function () {
        const fontDir = await createFontDirectory()
        await writeFile(join(fontDir, LEGACY_DEFAULT_FONT_ID + '.ttf'), 'account-font-bytes')

        const fonts = ReportPreviewLogic.listFonts(fontDir)
        expect(fonts.filter(function (font) { return font.id === DEFAULT_FONT_ID })).toEqual([
            { id: DEFAULT_FONT_ID, fileName: 'NotoSansJP-VariableFont_wght.ttf' },
        ])
        expect(fonts.filter(function (font) { return font.id === LEGACY_DEFAULT_FONT_ID })).toEqual([
            { id: LEGACY_DEFAULT_FONT_ID, fileName: 'NotoSansJP.ttf' },
        ])
    })

    test('legacy id resolves to the built-in font when the account does not own the id', async function () {
        const fontDir = await createFontDirectory()
        expect(resolveFontFilePath(LEGACY_DEFAULT_FONT_ID, fontDir)).toBe(builtinFontFilePath(DEFAULT_FONT_ID))
    })

    test('duplicate account ids are rejected instead of depending on directory order', async function () {
        const fontDir = await createFontDirectory()
        await mkdir(join(fontDir, 'nested'))
        await writeFile(join(fontDir, 'Duplicate.ttf'), 'one')
        await writeFile(join(fontDir, 'nested', 'Duplicate.otf'), 'two')

        expect(function () { buildFontFileIndex(fontDir) }).toThrow('Duplicate account font id "Duplicate"')
    })
})
