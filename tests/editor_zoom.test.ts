import { describe, expect, it } from 'vitest'
import { EDITOR_ZOOM_LEVELS, stepEditorZoom } from '../src/app/[lang]/editor/editor_zoom'

describe('editor zoom', () => {
    it('steps through 300, 400, and 500 percent and stops at 500 percent', () => {
        expect(stepEditorZoom(3, 1)).toBe(4)
        expect(stepEditorZoom(4, 1)).toBe(5)
        expect(stepEditorZoom(5, 1)).toBe(5)
        expect(stepEditorZoom(5, -1)).toBe(4)
        expect(EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1]).toBe(5)
    })
})
