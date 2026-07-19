import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { ElementCanvas } from '../src/app/[lang]/editor/canvas'
import { createDefaultElement, createDefaultTemplate } from '../src/app/[lang]/editor/reducer'
import { getElementCanvasOverflowPadding } from '../src/app/[lang]/editor/element_renderer'

// Regression test for the small-element vertical displacement on the design
// canvas: the element <canvas> is rendered inside a positioned wrapper, and a
// default (inline) canvas is baseline-aligned by the browser. Any canvas
// shorter than the line-box ascent (~15px) then shifts downward by
// "ascent - height" — e.g. a 9.9px flow-step label drifted ~5px below its
// band while PDF/preview (core rendering) stayed correct, and the shift
// disappeared when the element height or the zoom grew past the threshold.
// display:block removes the canvas from baseline layout entirely; this test
// pins that contract at the rendered-markup level (jsdom/node cannot measure
// real baseline layout, so the browser-level measurement lives in the task
// record of 2026-07-05).
describe('editor element canvas display mode', function () {
    test('the element canvas is display:block so baseline alignment never offsets it', function () {
        const element = createDefaultElement('el_1', 'staticText', 10, 12, 131, 9.9)
        const markup = renderToStaticMarkup(createElement(ElementCanvas, {
            element,
            fontRegistry: new Map(),
            defaultFontId: 'NotoSansJP',
            mathFonts: {},
            mathFontResource: null,
            currentFile: null,
            rootTemplate: createDefaultTemplate(),
            openReportTemplates: [],
            zoom: 1,
        }))
        expect(markup).toContain('<canvas')
        expect(markup).toMatch(/display\s*:\s*block/)
    })

    test('stroke-based shapes reserve canvas overflow padding for unclipped design rendering', function () {
        const ellipse = createDefaultElement('el_ellipse', 'ellipse', 0, 0, 100, 50)
        ellipse.strokeWidth = 6
        const path = createDefaultElement('el_path', 'path', 0, 0, 100, 50)
        path.strokeWidth = 4
        const line = createDefaultElement('el_line', 'line', 0, 0, 100, 1)
        line.lineWidth = 3

        expect(getElementCanvasOverflowPadding(ellipse)).toBe(3)
        expect(getElementCanvasOverflowPadding(path)).toBe(2)
        expect(getElementCanvasOverflowPadding(line)).toBe(1.5)
    })
})
