// Per-account font management: list / upload / delete an account's fonts and
// download curated Google Fonts into the account's font directory.

import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { Font } from 'tsreport-core'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { isSupportedFontFileName, MAX_FONT_FILE_BYTES } from '@/lib/common/font_files'
import { BUILTIN_FONT_ID_PREFIX } from '@/lib/common/font_ids'
import { isSupportedLanguage, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@/lib/common/i18n/languages'
import { buildFontFileEntryIndex, buildFontFileIndex, fontDirForAccount, type FontFileEntry } from '@/lib/server/logic/font_resolver'
import { candidatesForLanguage, catalogEntryByFontId, type FontCatalogEntry } from '@/lib/server/logic/font_catalog'

export type AccountFontInfo = {
    fontId: string
    fileName: string
    extension: string
    size: number
    version: string
    /** Font name-table metadata used for similarity matching (best-effort) */
    familyName?: string
    postScriptName?: string
    fullName?: string
}

export type LanguageProposal = {
    languages: readonly LanguageCode[]
    candidates: FontCatalogEntry[]
    installed: string[]
}

export namespace FontAdminLogic {

    export async function listFonts(accountId: number): Promise<AccountFontInfo[]> {
        const dir = fontDirForAccount(accountId)
        let items: string[]
        try {
            items = await readdir(dir)
        } catch {
            return []
        }
        const result: AccountFontInfo[] = []
        for (let i = 0; i < items.length; i++) {
            const ext = extname(items[i]!).toLowerCase()
            if (!isSupportedFontFileName(items[i]!)) continue
            const fullPath = join(dir, items[i]!)
            const s = await stat(fullPath, { bigint: true }).catch(() => null)
            if (s === null || !s.isFile()) continue
            const meta = await readFontMetadata(fullPath)
            result.push({
                fontId: items[i]!.substring(0, items[i]!.length - ext.length),
                fileName: items[i]!,
                extension: ext,
                size: Number(s.size),
                version: fontFileVersion(s),
                familyName: meta.familyName,
                postScriptName: meta.postScriptName,
                fullName: meta.fullName,
            })
        }
        result.sort(function (a, b) { return a.fontId.localeCompare(b.fontId) })
        return result
    }

    export async function hasNoFonts(accountId: number): Promise<boolean> {
        return (await listFonts(accountId)).length === 0
    }

    export async function uploadFont(accountId: number, fileName: string, buffer: ArrayBuffer): Promise<AccountFontInfo> {
        const safeName = sanitizeFontFileName(fileName)
        const ext = extname(safeName).toLowerCase()
        const fontId = safeName.substring(0, safeName.length - ext.length)
        assertAccountFontId(fontId)
        if (buffer.byteLength === 0) {
            throw new BusinessException('フォントファイルが空です。')
        }
        if (buffer.byteLength > MAX_FONT_FILE_BYTES) {
            throw new BusinessException('フォントファイルが大きすぎます。')
        }
        const dir = fontDirForAccount(accountId)
        await mkdir(dir, { recursive: true })
        const fontFiles = buildFontFileEntryIndex(dir)
        const existing = fontFiles.get(fontId)
        const bytes = new Uint8Array(buffer)
        if (existing !== undefined) {
            if (await fileEquals(existing.filePath, bytes)) return await accountFontInfo(existing.filePath)
            throw new BusinessException('同じフォントIDが既に登録されています: ' + fontId)
        }
        const duplicatePath = await findIdenticalFontFile(fontFiles, bytes)
        if (duplicatePath !== undefined) {
            const duplicate = await accountFontInfo(duplicatePath)
            throw new BusinessException('同一内容のフォントが既に登録されています: ' + duplicate.fontId)
        }
        // Reject anything the engine cannot actually parse.
        assertLoadableFont(buffer, safeName)
        const target = join(dir, safeName)
        await writeNewFontFile(target, bytes)
        return await accountFontInfo(target)
    }

    export async function deleteFont(accountId: number, fileName: string): Promise<void> {
        const safeName = sanitizeFontFileName(fileName)
        const dir = fontDirForAccount(accountId)
        const target = join(dir, safeName)
        const s = await stat(target).catch(() => null)
        if (s === null || !s.isFile()) {
            throw new BusinessException('フォントが見つかりません。')
        }
        await rm(target)
    }

    // Candidate downloadable fonts for a language, plus which of them the account
    // already has (so the UI can pre-check / hide them).
    export async function proposeFonts(accountId: number, language: string): Promise<LanguageProposal> {
        if (!isSupportedLanguage(language)) {
            throw new BusinessException('Unsupported font catalog language: ' + language)
        }
        const installed = (await listFonts(accountId)).map(function (f) { return f.fontId })
        return {
            languages: SUPPORTED_LANGUAGE_CODES,
            candidates: candidatesForLanguage(language),
            installed,
        }
    }

    // Downloads the given catalog font ids from Google Fonts into the account dir.
    export async function downloadFonts(accountId: number, fontIds: string[]): Promise<AccountFontInfo[]> {
        const dir = fontDirForAccount(accountId)
        await mkdir(dir, { recursive: true })
        const index = buildFontFileIndex(dir)
        const entries: FontCatalogEntry[] = []
        for (let i = 0; i < fontIds.length; i++) {
            const entry = catalogEntryByFontId(fontIds[i]!)
            if (entry === undefined) {
                throw new BusinessException('不明なフォントです: ' + fontIds[i])
            }
            assertAccountFontId(entry.fontId)
            assertFontIdAvailable(index, entry.fontId)
            index.set(entry.fontId, '')
            entries.push(entry)
        }
        const saved: AccountFontInfo[] = []
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]!
            const buffer = await fetchFontBuffer(entry.url)
            assertLoadableFont(buffer, entry.fontId + '.ttf')
            const bytes = new Uint8Array(buffer)
            const fileName = entry.fontId + '.ttf'
            const target = join(dir, fileName)
            await writeNewFontFile(target, bytes)
            const s = await stat(target, { bigint: true })
            saved.push({ fontId: entry.fontId, fileName, extension: '.ttf', size: bytes.byteLength, version: fontFileVersion(s) })
        }
        return saved
    }

}

function fontFileVersion(s: { dev: bigint, ino: bigint, size: bigint, mtimeNs: bigint }): string {
    return s.dev.toString(16) + '-' + s.ino.toString(16) + '-' + s.size.toString(16) + '-' + s.mtimeNs.toString(16)
}

function assertAccountFontId(fontId: string): void {
    if (fontId.startsWith(BUILTIN_FONT_ID_PREFIX)) {
        throw new BusinessException('内蔵フォント用に予約されたIDは登録できません: ' + fontId)
    }
}

function assertFontIdAvailable(index: Map<string, string>, fontId: string): void {
    if (index.has(fontId)) {
        throw new BusinessException('同じフォントIDが既に登録されています: ' + fontId)
    }
}

async function writeNewFontFile(filePath: string, bytes: Uint8Array): Promise<void> {
    try {
        await writeFile(filePath, bytes, { flag: 'wx' })
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new BusinessException('同じフォントファイルが既に登録されています。')
        }
        throw error
    }
}

async function fetchFontBuffer(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) {
        throw new BusinessException('フォントのダウンロードに失敗しました (' + res.status + ')。')
    }
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_FONT_FILE_BYTES) {
        throw new BusinessException('ダウンロードしたフォントのサイズが不正です。')
    }
    return buffer
}

// A font file name reduced to a bare, extension-checked basename.
function sanitizeFontFileName(fileName: string): string {
    const base = basename(fileName.replace(/\\/g, '/'))
    if (base === '' || base === '.' || base === '..') {
        throw new BusinessException('フォントファイル名が不正です。')
    }
    if (!isSupportedFontFileName(base)) {
        throw new BusinessException('対応していないフォント形式です（ttf/otf/woff/woff2/ttc/otc）。')
    }
    return base
}

// Reads name-table metadata for similarity matching. Best-effort: any parse
// failure yields empty metadata so listing never breaks on an odd font.
async function readFontMetadata(fullPath: string): Promise<{ familyName?: string, postScriptName?: string, fullName?: string }> {
    try {
        const bytes = await readFile(fullPath)
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        const font = Font.load(copy.buffer)
        return {
            familyName: font.familyName || undefined,
            postScriptName: font.postScriptName || undefined,
            fullName: font.fullName || undefined,
        }
    } catch {
        return {}
    }
}

// Verifies the bytes are a font the engine can load and classifies invalid user
// input as a business error before it reaches the storage layer.
function assertLoadableFont(buffer: ArrayBuffer, fileName: string): void {
    try {
        Font.load(buffer)
    } catch (error) {
        throw new BusinessException('フォントファイルを解析できません: ' + fileName + ': ' + (error as Error).message)
    }
}

async function accountFontInfo(filePath: string): Promise<AccountFontInfo> {
    const fileName = basename(filePath)
    const extension = extname(fileName).toLowerCase()
    const fontId = fileName.substring(0, fileName.length - extension.length)
    const s = await stat(filePath, { bigint: true })
    return { fontId, fileName, extension, size: Number(s.size), version: fontFileVersion(s) }
}

async function fileEquals(filePath: string, expected: Uint8Array): Promise<boolean> {
    const handle = await open(filePath, 'r')
    try {
        const fileStat = await handle.stat()
        if (fileStat.size !== expected.byteLength) return false
        const chunk = new Uint8Array(64 * 1024)
        let position = 0
        while (position < expected.byteLength) {
            const length = Math.min(chunk.byteLength, expected.byteLength - position)
            const result = await handle.read(chunk, 0, length, position)
            if (result.bytesRead === 0) throw new Error('Font file ended before its recorded size: ' + filePath)
            for (let i = 0; i < result.bytesRead; i++) {
                if (chunk[i] !== expected[position + i]) return false
            }
            position += result.bytesRead
        }
        return true
    } finally {
        await handle.close()
    }
}

async function findIdenticalFontFile(fontFiles: ReadonlyMap<string, FontFileEntry>, expected: Uint8Array): Promise<string | undefined> {
    for (const entry of fontFiles.values()) {
        if (entry.size === expected.byteLength && await fileEquals(entry.filePath, expected)) return entry.filePath
    }
    return undefined
}
