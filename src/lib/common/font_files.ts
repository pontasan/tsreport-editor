export const MAX_FONT_FILE_BYTES = 256 * 1024 * 1024

export const FONT_FILE_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.ttc', '.otc'] as const

export function isSupportedFontFileName(fileName: string): boolean {
    const lower = fileName.toLowerCase()
    for (let i = 0; i < FONT_FILE_EXTENSIONS.length; i++) {
        if (lower.endsWith(FONT_FILE_EXTENSIONS[i]!)) return true
    }
    return false
}
