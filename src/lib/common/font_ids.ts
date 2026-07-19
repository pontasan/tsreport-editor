export const BUILTIN_FONT_ID_PREFIX = 'builtin:'

export const DEFAULT_FONT_ID = BUILTIN_FONT_ID_PREFIX + 'NotoSansJP'
export const MATH_FONT_ID = BUILTIN_FONT_ID_PREFIX + 'STIXTwoMath'

export const LEGACY_DEFAULT_FONT_ID = 'NotoSansJP'
export const LEGACY_MATH_FONT_ID = 'STIXTwoMath'

export function isBuiltinFontId(fontId: string): boolean {
    return fontId.startsWith(BUILTIN_FONT_ID_PREFIX)
}

export function builtinFontIdForLegacyAlias(fontId: string): string | null {
    if (fontId === LEGACY_DEFAULT_FONT_ID) return DEFAULT_FONT_ID
    if (fontId === LEGACY_MATH_FONT_ID) return MATH_FONT_ID
    return null
}
