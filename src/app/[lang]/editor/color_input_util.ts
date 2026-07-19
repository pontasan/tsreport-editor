// Helpers for the unified color input. Colors travel as a single string:
// '#RRGGBB' (RGB), 'cmyk(C,M,Y,K)' (process, percent) or
// 'spot(Name,C,M,Y,K)' (spot with its CMYK alternate). Exactly one
// representation is the source of truth; the others are derived for display.

import { parseTemplateColor, toDisplayColor } from 'tsreport-core'

export type ColorMode = 'rgb' | 'cmyk' | 'spot'

export function colorModeOf(color: string): ColorMode {
    // Classified by syntax, not by parse result: a spot() with a still-empty
    // name (transient while the user types it) must stay in spot mode
    const trimmed = color.trim()
    if (/^spot\(/i.test(trimmed)) return 'spot'
    if (/^cmyk\(/i.test(trimmed)) return 'cmyk'
    return 'rgb'
}

/** CMYK components in percent (0-100) for editing; derives from RGB when needed. */
export function cmykComponentsOf(color: string): [number, number, number, number] {
    const parsed = parseTemplateColor(color)
    if (parsed.cmyk !== null) {
        return [
            Math.round(parsed.cmyk[0] * 100),
            Math.round(parsed.cmyk[1] * 100),
            Math.round(parsed.cmyk[2] * 100),
            Math.round(parsed.cmyk[3] * 100),
        ]
    }
    const k = 1 - Math.max(parsed.r, parsed.g, parsed.b)
    if (k >= 1) return [0, 0, 0, 100]
    return [
        Math.round((1 - parsed.r - k) / (1 - k) * 100),
        Math.round((1 - parsed.g - k) / (1 - k) * 100),
        Math.round((1 - parsed.b - k) / (1 - k) * 100),
        Math.round(k * 100),
    ]
}

export function spotNameOf(color: string): string {
    return parseTemplateColor(color).spotName ?? ''
}

export function formatCmykColor(c: number, m: number, y: number, k: number): string {
    return `cmyk(${clampPercent(c)},${clampPercent(m)},${clampPercent(y)},${clampPercent(k)})`
}

export function formatSpotColor(name: string, c: number, m: number, y: number, k: number): string {
    return `spot(${sanitizeSpotName(name)},${clampPercent(c)},${clampPercent(m)},${clampPercent(y)},${clampPercent(k)})`
}

/** #RRGGBB approximation for swatches and the native color picker. */
export function displayHexOf(color: string): string {
    return toDisplayColor(color)
}

/** Converts a color string to the given mode, deriving initial values. */
export function convertColorToMode(color: string, mode: ColorMode): string {
    const current = colorModeOf(color)
    if (current === mode) return color
    if (mode === 'rgb') return toDisplayColor(color)
    const [c, m, y, k] = cmykComponentsOf(color)
    if (mode === 'cmyk') return formatCmykColor(c, m, y, k)
    return formatSpotColor(spotNameOf(color), c, m, y, k)
}

function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(100, Math.round(value)))
}

/** Spot names ride inside the function syntax: commas and parens are stripped. */
export function sanitizeSpotName(name: string): string {
    return name.replace(/[,()]/g, '').trim()
}

/**
 * Normalizes a manually typed RGB value to '#rrggbb'. Accepts 3- or 6-digit
 * hex with or without the leading '#'; anything else is rejected.
 */
export function normalizeHexColorInput(raw: string): string | undefined {
    const trimmed = raw.trim().replace(/^#/, '').toLowerCase()
    if (/^[0-9a-f]{6}$/.test(trimmed)) return '#' + trimmed
    if (/^[0-9a-f]{3}$/.test(trimmed)) {
        return '#' + trimmed[0]! + trimmed[0]! + trimmed[1]! + trimmed[1]! + trimmed[2]! + trimmed[2]!
    }
    return undefined
}

/** RGB components 0-255 for editing (print colors give their approximation). */
export function rgbComponentsOf(color: string): [number, number, number] {
    const parsed = parseTemplateColor(color)
    const to255 = function (v: number): number { return Math.max(0, Math.min(255, Math.round(v * 255))) }
    return [to255(parsed.r), to255(parsed.g), to255(parsed.b)]
}

export function formatRgbHex(r: number, g: number, b: number): string {
    const hex = function (v: number): string {
        const byte = Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)))
        return (byte < 16 ? '0' : '') + byte.toString(16)
    }
    return '#' + hex(r) + hex(g) + hex(b)
}

/** CSS gradient for an RGB channel slider track (linear per channel: two stops). */
export function rgbSliderTrack(comps: [number, number, number], channel: number): string {
    const low: [number, number, number] = [...comps]
    const high: [number, number, number] = [...comps]
    low[channel] = 0
    high[channel] = 255
    return `linear-gradient(to right, ${formatRgbHex(low[0], low[1], low[2])}, ${formatRgbHex(high[0], high[1], high[2])})`
}

// ─── HSV helpers for the visual picker ───

export interface HsvColor {
    /** Hue 0-360 */
    h: number,
    /** Saturation 0-1 */
    s: number,
    /** Value 0-1 */
    v: number
}

export function hexToHsv(hex: string): HsvColor {
    const parsed = parseTemplateColor(hex)
    const r = parsed.r
    const g = parsed.g
    const b = parsed.b
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    let h = 0
    if (delta > 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6)
        else if (max === g) h = 60 * ((b - r) / delta + 2)
        else h = 60 * ((r - g) / delta + 4)
    }
    if (h < 0) h += 360
    return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c
    let r = 0
    let g = 0
    let b = 0
    if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
    else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
    else if (h < 300) { r = x; b = c } else { r = c; b = x }
    const toHex = function (value: number): string {
        const byte = Math.max(0, Math.min(255, Math.round((value + m) * 255)))
        return (byte < 16 ? '0' : '') + byte.toString(16)
    }
    return '#' + toHex(r) + toHex(g) + toHex(b)
}

/**
 * CSS gradient for a CMYK channel slider track: the display color is linear
 * in each single channel (r = (1-c)(1-k) etc.), so two stops suffice.
 */
export function cmykSliderTrack(comps: [number, number, number, number], channel: number): string {
    const low: [number, number, number, number] = [...comps]
    const high: [number, number, number, number] = [...comps]
    low[channel] = 0
    high[channel] = 100
    return `linear-gradient(to right, ${displayHexOf(formatCmykColor(low[0], low[1], low[2], low[3]))}, ${displayHexOf(formatCmykColor(high[0], high[1], high[2], high[3]))})`
}
