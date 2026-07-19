// Account-scoped font resolution.
//
// Font model (SaaS / multi-tenant):
// - Internal fonts ship with the editor (public/fonts) under the reserved
//   "builtin:" namespace. They are ALWAYS available to the render engine as the
//   drawing fallback and math font. They are NOT user-selectable.
// - Account fonts live under /var/nfs/fonts/{accountId}/ and are the only fonts a
//   user can pick, upload, delete or download. Every render/preview/list resolves
//   against the acting account's directory.
// - Legacy unqualified internal ids retain the historical print behavior:
//   an account font wins, and the internal file is used only when no account font
//   has that id. New templates use reserved internal ids and are unambiguous.
//
// The font byte cache includes filesystem identity, so deleting and recreating a
// font at the same path cannot retain stale bytes.

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { extname, join } from 'path'
import { Font, TextMeasurer, type FontMap } from 'tsreport-core'
import { isSupportedFontFileName } from '@/lib/common/font_files'
import {
    DEFAULT_FONT_ID,
    LEGACY_DEFAULT_FONT_ID,
    LEGACY_MATH_FONT_ID,
    MATH_FONT_ID,
    builtinFontIdForLegacyAlias,
    isBuiltinFontId,
} from '@/lib/common/font_ids'

export { DEFAULT_FONT_ID, LEGACY_DEFAULT_FONT_ID, LEGACY_MATH_FONT_ID, MATH_FONT_ID }

export const FONTS_ROOT = '/var/nfs/fonts'

export const INTERNAL_FONT_IDS = new Set<string>([DEFAULT_FONT_ID, MATH_FONT_ID])

type ServerFontResource = {
    font: Font
    measurer: TextMeasurer
}

// filesystem identity -> loaded font (safe across accounts and replacements).
const fontRegistryByPath = new Map<string, ServerFontResource>()

// Absolute directory holding an account's uploaded/downloaded fonts.
export function fontDirForAccount(accountId: number): string {
    return join(FONTS_ROOT, String(accountId))
}

// Absolute path of an internal font bundled with the editor (public/fonts), or
// null when the id is not an internal font.
export function builtinFontFilePath(fontId: string): string | null {
    if (fontId === DEFAULT_FONT_ID) {
        return join(process.cwd(), 'public', 'fonts', 'NotoSansJP-VariableFont_wght.ttf')
    }
    if (fontId === MATH_FONT_ID) {
        return join(process.cwd(), 'public', 'fonts', 'STIXTwoMath.otf')
    }
    return null
}

// Scans a font directory recursively into fontId (basename without extension) ->
// absolute file path. Duplicate ids are rejected instead of selecting a file by
// filesystem enumeration order.
export function buildFontFileIndex(fontDir: string): Map<string, string> {
    const entries = buildFontFileEntryIndex(fontDir)
    const index = new Map<string, string>()
    entries.forEach(function (entry, fontId) { index.set(fontId, entry.filePath) })
    return index
}

export type FontFileEntry = {
    filePath: string
    size: number
}

export function buildFontFileEntryIndex(fontDir: string): Map<string, FontFileEntry> {
    const index = new Map<string, FontFileEntry>()
    if (!existsSync(fontDir)) return index
    indexFontDir(fontDir, index)
    return index
}

function indexFontDir(dir: string, index: Map<string, FontFileEntry>): void {
    const items = readdirSync(dir)
    for (let i = 0; i < items.length; i++) {
        const fullPath = join(dir, items[i]!)
        const s = statSync(fullPath)
        if (s.isDirectory()) {
            indexFontDir(fullPath, index)
        } else if (s.isFile()) {
            if (isSupportedFontFileName(items[i]!)) {
                const ext = extname(items[i]!).toLowerCase()
                const name = items[i]!.substring(0, items[i]!.length - ext.length)
                const existing = index.get(name)
                if (existing !== undefined) {
                    throw new Error('Duplicate account font id "' + name + '": ' + existing.filePath + ' and ' + fullPath)
                }
                index.set(name, { filePath: fullPath, size: s.size })
            }
        }
    }
}

// User-selectable font ids for an account (its directory only; internal fonts
// are excluded because they are drawing-only, not selectable).
export function listAccountFontIds(fontDir: string): string[] {
    const ids = new Set<string>()
    buildFontFileIndex(fontDir).forEach(function (_path, fontId) {
        if (!isBuiltinFontId(fontId)) ids.add(fontId)
    })
    return Array.from(ids).sort()
}

// Resolves every preview and print font id through the same contract.
export function resolveFontFilePath(fontId: string, fontDir: string): string | null {
    return resolveFontFilePathFromIndex(fontId, buildFontFileIndex(fontDir))
}

export function resolveFontFilePathFromIndex(fontId: string, accountFonts: ReadonlyMap<string, string>): string | null {
    const builtinPath = builtinFontFilePath(fontId)
    if (builtinPath !== null) return builtinPath

    const accountFont = accountFonts.get(fontId)
    if (accountFont !== undefined) return accountFont

    const canonicalBuiltinId = builtinFontIdForLegacyAlias(fontId)
    return canonicalBuiltinId === null ? null : builtinFontFilePath(canonicalBuiltinId)
}

// Loads a font id into the font map (drawing measurer) from the account dir or
// the internal fonts. Missing ids are skipped (the engine falls back).
export function ensureFont(fontMap: FontMap, fontId: string, fontDir: string): void {
    if (fontMap.has(fontId)) return
    const filePath = resolveFontFilePath(fontId, fontDir)
    if (filePath === null) return
    const resource = loadFontResourceByPath(filePath)
    fontMap.set(fontId, resource.measurer)
}

export function loadFontResourceByPath(filePath: string): ServerFontResource {
    const s = statSync(filePath, { bigint: true })
    const cacheKey = filePath + '\0' + s.dev + ':' + s.ino + ':' + s.size + ':' + s.mtimeNs
    const cached = fontRegistryByPath.get(cacheKey)
    if (cached !== undefined) return cached
    const bytes = readFileSync(filePath)
    const font = Font.load(toContiguousArrayBuffer(bytes))
    const resource: ServerFontResource = { font, measurer: new TextMeasurer(font) }
    fontRegistryByPath.set(cacheKey, resource)
    return resource
}

// Returns the loaded Font objects for the ids present in the font map (for the
// render backend). Ids that failed to resolve are simply absent.
export function collectLoadedFonts(fontMap: FontMap, fontDir: string): Record<string, Font> {
    const fonts: Record<string, Font> = {}
    fontMap.forEach(function (_measurer, fontId) {
        const filePath = resolveFontFilePath(fontId, fontDir)
        if (filePath === null) return
        fonts[fontId] = loadFontResourceByPath(filePath).font
    })
    return fonts
}

function toContiguousArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const contiguous = new Uint8Array(bytes.byteLength)
    contiguous.set(bytes)
    return contiguous.buffer
}
