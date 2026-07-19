import { describe, expect, it } from 'vitest'
import { maximumPreviewScale, PREVIEW_ZOOM_LEVELS, previewAvailableWidth, resolvePreviewScale, stepPreviewZoom } from '../src/app/[lang]/editor/preview_zoom'

describe('preview modal zoom', () => {
    it('uses fit scale until an explicit percentage is selected', () => {
        expect(resolvePreviewScale(null, 0.72)).toBe(0.72)
        expect(resolvePreviewScale(100, 0.72)).toBeCloseTo(96 / 72)
        expect(resolvePreviewScale(200, 0.72)).toBeCloseTo(2 * 96 / 72)
        expect(resolvePreviewScale(500, 0.72)).toBeCloseTo(5 * 96 / 72)
    })

    it('fits wide pages without enlarging pages beyond 100 percent', () => {
        expect(previewAvailableWidth(1440)).toBe(1376)
        expect(maximumPreviewScale(1000, 800)).toBe(0.8)
        expect(maximumPreviewScale(500, 800)).toBeCloseTo(96 / 72)
    })

    it('steps from fit scale to the adjacent percentage', () => {
        const fitScale = 0.8

        expect(stepPreviewZoom(null, fitScale, -1)).toBe(50)
        expect(stepPreviewZoom(null, fitScale, 1)).toBe(75)
    })

    it('steps explicit percentages and stops at the supported limits', () => {
        expect(stepPreviewZoom(100, 1, -1)).toBe(75)
        expect(stepPreviewZoom(100, 1, 1)).toBe(125)
        expect(stepPreviewZoom(25, 1, -1)).toBe(25)
        expect(stepPreviewZoom(200, 1, 1)).toBe(300)
        expect(stepPreviewZoom(400, 1, 1)).toBe(500)
        expect(stepPreviewZoom(500, 1, 1)).toBe(500)
        expect(PREVIEW_ZOOM_LEVELS[PREVIEW_ZOOM_LEVELS.length - 1]).toBe(500)
    })
})
