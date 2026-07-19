// Unified color input helpers: one string is the source of truth
// ('#RRGGBB' | 'cmyk(...)' | 'spot(...)'); mode switches derive initial
// values with the naive conversion and never auto-round-trip.

import { describe, expect, it } from 'vitest'
import {
    colorModeOf, cmykComponentsOf, spotNameOf, displayHexOf,
    formatCmykColor, formatSpotColor, convertColorToMode, sanitizeSpotName,
    hexToHsv, hsvToHex, cmykSliderTrack,
    rgbComponentsOf, formatRgbHex, rgbSliderTrack, normalizeHexColorInput,
} from '../src/app/[lang]/editor/color_input_util'

describe('color mode detection', () => {
    it('classifies the three color forms', () => {
        expect(colorModeOf('#ff0000')).toBe('rgb')
        expect(colorModeOf('cmyk(0,100,100,0)')).toBe('cmyk')
        expect(colorModeOf('spot(Gold,0,20,60,20)')).toBe('spot')
    })

    it('a spot with a still-empty name stays in spot mode', () => {
        expect(colorModeOf('spot(,0,20,60,20)')).toBe('spot')
        expect(spotNameOf('spot(,0,20,60,20)')).toBe('')
        expect(cmykComponentsOf('spot(,0,20,60,20)')).toEqual([0, 20, 60, 20])
    })
})

describe('component extraction', () => {
    it('reads cmyk percentages', () => {
        expect(cmykComponentsOf('cmyk(0,100,100,0)')).toEqual([0, 100, 100, 0])
        expect(spotNameOf('spot(Gold,0,20,60,20)')).toBe('Gold')
    })

    it('derives cmyk from RGB with the naive model', () => {
        expect(cmykComponentsOf('#ff0000')).toEqual([0, 100, 100, 0])
        expect(cmykComponentsOf('#000000')).toEqual([0, 0, 0, 100])
    })
})

describe('formatting', () => {
    it('clamps components to 0-100 integers', () => {
        expect(formatCmykColor(-5, 100.4, 260, 0)).toBe('cmyk(0,100,100,0)')
        expect(formatSpotColor('Gold', 0, 20, 60, 20)).toBe('spot(Gold,0,20,60,20)')
    })

    it('strips syntax characters from spot names', () => {
        expect(sanitizeSpotName('Go,l(d)')).toBe('Gold')
    })
})

describe('mode conversion', () => {
    it('derives initial values when switching modes', () => {
        expect(convertColorToMode('#ff0000', 'cmyk')).toBe('cmyk(0,100,100,0)')
        expect(convertColorToMode('cmyk(0,100,100,0)', 'rgb')).toBe('#ff0000')
        expect(convertColorToMode('cmyk(0,20,60,20)', 'spot')).toBe('spot(,0,20,60,20)')
        expect(convertColorToMode('spot(Gold,0,20,60,20)', 'cmyk')).toBe('cmyk(0,20,60,20)')
    })

    it('keeps the value untouched when the mode does not change', () => {
        expect(convertColorToMode('cmyk(1,2,3,4)', 'cmyk')).toBe('cmyk(1,2,3,4)')
    })

    it('display hex approximates print colors for swatches', () => {
        expect(displayHexOf('cmyk(0,0,0,100)')).toBe('#000000')
        expect(displayHexOf('#123456')).toBe('#123456')
    })
})

describe('HSV conversion for the visual picker', () => {
    it('converts primary colors both ways', () => {
        expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
        expect(hexToHsv('#00ff00').h).toBe(120)
        expect(hexToHsv('#0000ff').h).toBe(240)
        expect(hsvToHex(0, 1, 1)).toBe('#ff0000')
        expect(hsvToHex(120, 1, 1)).toBe('#00ff00')
        expect(hsvToHex(240, 1, 1)).toBe('#0000ff')
    })

    it('round trips arbitrary colors', () => {
        for (const hex of ['#123456', '#a1b2c3', '#000000', '#ffffff', '#808080']) {
            const hsv = hexToHsv(hex)
            expect(hsvToHex(hsv.h, hsv.s, hsv.v)).toBe(hex)
        }
    })

    it('builds two-stop CMYK slider tracks', () => {
        const track = cmykSliderTrack([0, 100, 100, 0], 3)
        // K from 0 to 100 with M=Y=100: red to black
        expect(track).toBe('linear-gradient(to right, #ff0000, #000000)')
    })
})

describe('RGB channel editing', () => {
    it('extracts and formats 0-255 components', () => {
        expect(rgbComponentsOf('#ff8000')).toEqual([255, 128, 0])
        expect(formatRgbHex(255, 128, 0)).toBe('#ff8000')
        expect(formatRgbHex(-10, 300, NaN)).toBe('#00ff00')
    })

    it('builds two-stop RGB slider tracks', () => {
        expect(rgbSliderTrack([255, 128, 0], 0)).toBe('linear-gradient(to right, #008000, #ff8000)')
    })

    it('normalizes manual hex input', () => {
        expect(normalizeHexColorInput(' #A1B2C3 ')).toBe('#a1b2c3')
        expect(normalizeHexColorInput('a1b2c3')).toBe('#a1b2c3')
        expect(normalizeHexColorInput('#f00')).toBe('#ff0000')
        expect(normalizeHexColorInput('red')).toBeUndefined()
        expect(normalizeHexColorInput('#12345')).toBeUndefined()
    })
})
