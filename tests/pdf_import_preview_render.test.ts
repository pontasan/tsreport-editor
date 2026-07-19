import { describe, expect, it } from 'vitest'
import type { Font, ImportedPage, TextMeasurer } from 'tsreport-core'
import { renderImportedPageToCanvas, renderImportedPageToSvg } from '../src/app/[lang]/editor/pdf_import_preview'
import type { FontResource } from '../src/app/[lang]/editor/font_loader'

function createFontRegistry(): Map<string, FontResource> {
    return new Map([['default', {
        font: {} as Font,
        measurer: {} as TextMeasurer,
        fontId: 'default',
    }]])
}

describe('PDF import preview rendering', () => {
    it('paints the imported page through the core Canvas backend at the requested scale', () => {
        const canvas = { width: 0, height: 0, style: {} as Record<string, string> }
        const context = {
            canvas,
            setTransform: function () {},
            fillRect: function () {},
            save: function () {},
            restore: function () {},
            translate: function () {},
            transform: function () {},
            fillStyle: '',
            globalAlpha: 1,
        }
        const canvasElement = {
            ...canvas,
            getContext: function () { return context },
        }
        context.canvas = canvasElement
        const page: ImportedPage = {
            width: 100,
            height: 50,
            elements: [],
            images: {},
            fonts: [],
            styles: [],
        }

        renderImportedPageToCanvas(canvasElement as unknown as HTMLCanvasElement, page, createFontRegistry(), 'default', 2)

        expect(canvasElement.width).toBe(200)
        expect(canvasElement.height).toBe(100)
        expect(canvasElement.style).toEqual({ width: '200px', height: '100px' })
    })

    it('serializes a large imported page as one core-rendered SVG image', () => {
        const branches = []
        for (let branch = 0; branch < 5; branch++) {
            const elements = []
            for (let i = 0; i < 1500; i++) {
                elements.push({
                    type: 'rectangle' as const,
                    x: i % 100,
                    y: Math.floor(i / 100),
                    width: 1,
                    height: 1,
                    fill: '#123456',
                })
            }
            branches.push({
                type: 'frame' as const,
                x: branch,
                y: branch,
                width: 200,
                height: 200,
                elements,
            })
        }
        const page: ImportedPage = {
            width: 595,
            height: 842,
            elements: branches,
            images: {},
            fonts: [],
            styles: [],
        }

        const svg = renderImportedPageToSvg(page, createFontRegistry(), 'default')

        expect(svg).toMatch(/^<svg /)
        expect(svg).toContain('viewBox="0 0 595 842"')
        expect(svg.match(/fill="#123456"/g)).toHaveLength(7500)
    })

})
