import { Font, type ImportedFontInfo } from 'tsreport-core'
import { DEFAULT_FONT_ID } from '@/lib/common/font_ids'

export type FontCandidate = {
    /** Account font id (file name without extension) — the value assigned on match */
    name: string
    /** name-table metadata read from the font file, if available */
    familyName?: string
    postScriptName?: string
    fullName?: string
}

export type FontMatchResult = {
    fontName: string
    score: number
    warning: boolean
}

type ParsedFontName = {
    raw: string,
    base: string,
    normalized: string,
    bold: boolean,
    italic: boolean,
    tokens: string[]
}

const STYLE_TOKENS = new Set([
    'bold', 'black', 'heavy', 'semibold', 'demibold', 'medium',
    'italic', 'oblique', 'regular', 'normal', 'light', 'thin'
])

export function matchFontName(info: ImportedFontInfo, candidates: FontCandidate[], defaultFontName: string = DEFAULT_FONT_ID): FontMatchResult {
    if (candidates.length === 0) return { fontName: defaultFontName, score: 0, warning: true }

    const sourceNames = collectSourceNames(info)
    let bestName = candidates[0]!.name
    let bestScore = -1
    for (let ci = 0; ci < candidates.length; ci++) {
        // Compare against the account font's id/file name AND its name-table
        // metadata (family / PostScript / full name), since either side may
        // carry the recognizable name.
        const candidateNames = collectCandidateNames(candidates[ci]!)
        for (let cn = 0; cn < candidateNames.length; cn++) {
            const candidate = candidateNames[cn]!
            for (let si = 0; si < sourceNames.length; si++) {
                const source = sourceNames[si]!
                const score = scoreFontMatch(source, candidate, info.bold || source.bold, info.italic || source.italic)
                if (score > bestScore) {
                    bestScore = score
                    bestName = candidates[ci]!.name
                }
            }
        }
    }
    if (bestScore < 0.5) {
        return { fontName: defaultFontName, score: Math.max(0, bestScore), warning: true }
    }
    return { fontName: bestName, score: bestScore, warning: false }
}

function collectSourceNames(info: ImportedFontInfo): ParsedFontName[] {
    const names: ParsedFontName[] = []
    const seen = new Set<string>()
    function add(name: string | undefined): void {
        if (name === undefined) return
        const trimmed = name.trim()
        if (trimmed === '' || seen.has(trimmed)) return
        seen.add(trimmed)
        names.push(parseFontName(trimmed, info.bold, info.italic))
    }
    // Prefer the embedded font's real name-table metadata over the (often
    // subset-prefixed) /BaseFont string.
    const embedded = embeddedFontNames(info)
    add(embedded.familyName)
    add(embedded.fullName)
    add(embedded.postScriptName)
    add(info.familyName)
    add(info.baseFont)
    return names
}

/** Reads name-table metadata from the embedded font program, if present. */
function embeddedFontNames(info: ImportedFontInfo): { familyName?: string, postScriptName?: string, fullName?: string } {
    if (info.fontFile === undefined || info.fontFileFormat === 'type1') return {}
    try {
        const bytes = info.fontFile
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

function collectCandidateNames(candidate: FontCandidate): ParsedFontName[] {
    const names: ParsedFontName[] = []
    const seen = new Set<string>()
    function add(name: string | undefined): void {
        if (name === undefined) return
        const trimmed = name.trim()
        if (trimmed === '' || seen.has(trimmed)) return
        seen.add(trimmed)
        names.push(parseFontName(trimmed, false, false))
    }
    add(candidate.familyName)
    add(candidate.fullName)
    add(candidate.postScriptName)
    add(candidate.name)
    return names
}

function parseFontName(rawName: string, boldFlag: boolean, italicFlag: boolean): ParsedFontName {
    let raw = rawName.replace(/^[A-Z]{6}\+/, '')
    raw = raw.replace(/,/g, '-')
    const spaced = raw
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
    const rawTokens = spaced.split(/\s+/).filter(function (v) { return v !== '' })
    let bold = boldFlag
    let italic = italicFlag
    const baseTokens: string[] = []
    for (let i = 0; i < rawTokens.length; i++) {
        const normalized = normalizeToken(rawTokens[i]!)
        if (normalized === '') continue
        if (normalized === 'bold' || normalized === 'black' || normalized === 'heavy' || normalized === 'semibold' || normalized === 'demibold') bold = true
        if (normalized === 'italic' || normalized === 'oblique') italic = true
        if (!STYLE_TOKENS.has(normalized)) baseTokens.push(normalized)
    }
    const base = baseTokens.join('')
    return {
        raw,
        base,
        normalized: normalizeToken(raw),
        bold,
        italic,
        tokens: baseTokens,
    }
}

function scoreFontMatch(source: ParsedFontName, candidate: ParsedFontName, bold: boolean, italic: boolean): number {
    let score = 0
    if (source.base !== '' && source.base === candidate.base) score = 1
    else if (source.base !== '' && candidate.base !== '' && (source.base.includes(candidate.base) || candidate.base.includes(source.base))) {
        score = 0.85 * Math.min(source.base.length, candidate.base.length) / Math.max(source.base.length, candidate.base.length)
    } else {
        const jaccard = tokenJaccard(source.tokens, candidate.tokens)
        const edit = normalizedEditScore(source.base, candidate.base)
        score = Math.max(jaccard * 0.7, edit * 0.5)
    }
    if (candidate.bold === bold) score += 0.05
    if (candidate.italic === italic) score += 0.05
    return Math.min(1.1, score)
}

function tokenJaccard(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0
    const setA = new Set(a)
    const setB = new Set(b)
    let intersection = 0
    setA.forEach(function (token) {
        if (setB.has(token)) intersection++
    })
    return intersection / (setA.size + setB.size - intersection)
}

function normalizedEditScore(a: string, b: string): number {
    if (a === '' || b === '') return 0
    const d = levenshtein(a, b)
    return 1 - d / Math.max(a.length, b.length)
}

function levenshtein(a: string, b: string): number {
    const prev = new Array<number>(b.length + 1)
    const curr = new Array<number>(b.length + 1)
    for (let j = 0; j <= b.length; j++) prev[j] = j
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        for (let j = 1; j <= b.length; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
            curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
        }
        for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!
    }
    return prev[b.length]!
}

function normalizeToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}
