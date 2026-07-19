import { describe, expect, test } from 'vitest'
import { DEFAULT_FONT_ID, MATH_FONT_ID } from '../src/lib/common/font_ids'
import { createDefaultElement, createDefaultStyle, createDefaultTableCellStyle } from '../src/app/[lang]/editor/reducer'

describe('editor default font ids', function () {
    test('new elements and table cells use canonical built-in ids', function () {
        expect(createDefaultStyle().fontFamily).toBe(DEFAULT_FONT_ID)
        expect(createDefaultTableCellStyle().fontFamily).toBe(DEFAULT_FONT_ID)
        expect(createDefaultElement('el_1', 'staticText', 0, 0, 100, 20).style.fontFamily).toBe(DEFAULT_FONT_ID)
        expect(createDefaultElement('el_2', 'math', 0, 0, 100, 20).mathFontFamily).toBe(MATH_FONT_ID)
    })
})
