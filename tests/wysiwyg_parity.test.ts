// WYSIWYG accuracy regression tests:
// Verify that the editor canvas single-element preview (element_renderer.buildRenderNodes)
// and the core final output (createReport) produce identical render results.
// The goal is to detect divergence between the editor view and the preview/PDF output.

import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, TextMeasurer, createReport, type RenderEllipse, type RenderNode, type RenderPath, type RenderRect, type RenderText } from 'tsreport-core'
import { buildRenderNodes } from '../src/app/[lang]/editor/element_renderer'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'
import { createDefaultElement, createDefaultTemplate, type TemplateElement } from '../src/app/[lang]/editor/reducer'
import type { FontResource } from '../src/app/[lang]/editor/font_loader'

const FONT_PATH = resolve(process.cwd(), 'app/[lang]/fonts/NotoSansJP-VariableFont_wght.ttf')
const FONT_ID = 'NotoSansJP'
const MATH_FONT_PATH = resolve(process.cwd(), 'public/fonts/STIXTwoMath.otf')
const MATH_FONT_ID = 'STIXTwoMath'

let fontRegistry: Map<string, FontResource>
let coreFontMap: Map<string, TextMeasurer>
let mathFonts: Record<string, Font>

function loadFont(path: string): Font {
    const buffer = readFileSync(path)
    return Font.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
}

beforeAll(() => {
    const font = loadFont(FONT_PATH)
    const measurer = new TextMeasurer(font)
    fontRegistry = new Map([[FONT_ID, { font, measurer, fontId: FONT_ID }]])
    const mathFont = loadFont(MATH_FONT_PATH)
    const mathMeasurer = new TextMeasurer(mathFont)
    coreFontMap = new Map([[FONT_ID, measurer], [MATH_FONT_ID, mathMeasurer]])
    mathFonts = { [MATH_FONT_ID]: mathFont }
})

// ─── Helpers ───

type PositionedText = {
    text: string
    x: number
    y: number
    fontSize: number
    color: string
    hAlign: string
}

type PositionedRect = { x: number, y: number, width: number, height: number, fill: RenderRect['fill'], stroke?: string }
type PositionedEllipse = { cx: number, cy: number, rx: number, ry: number, fill: RenderEllipse['fill'], stroke?: string, strokeWidth?: number }
type PositionedLine = { x1: number, y1: number, x2: number, y2: number, lineWidth: number, color: string, dash?: number[] }
type PositionedImage = { x: number, y: number, width: number, height: number, imageId: string, clipped: boolean }
type PositionedSvg = { x: number, y: number, width: number, height: number, svgData: string }
type PositionedPath = { commands: number[], coords: number[], fill: RenderPath['fill'], stroke: RenderPath['stroke'], strokeWidth: RenderPath['strokeWidth'] }

function collectPositioned(nodes: RenderNode[], offsetX: number, offsetY: number, clipped: boolean, out: {
    texts: PositionedText[], rects: PositionedRect[], ellipses: PositionedEllipse[], lines: PositionedLine[],
    images: PositionedImage[], svgs: PositionedSvg[], paths: PositionedPath[],
}): void {
    for (const node of nodes) {
        if (node.type === 'text') {
            const t = node as RenderText
            out.texts.push({
                text: t.text,
                x: offsetX + t.x,
                y: offsetY + t.y,
                fontSize: t.fontSize,
                color: t.color,
                hAlign: t.hAlign ?? 'left',
            })
        } else if (node.type === 'rect') {
            out.rects.push({
                x: offsetX + node.x, y: offsetY + node.y,
                width: node.width, height: node.height,
                fill: node.fill, stroke: node.stroke,
            })
        } else if (node.type === 'ellipse') {
            out.ellipses.push({
                cx: offsetX + node.cx,
                cy: offsetY + node.cy,
                rx: node.rx,
                ry: node.ry,
                fill: node.fill,
                stroke: node.stroke,
                strokeWidth: node.strokeWidth,
            })
        } else if (node.type === 'line') {
            out.lines.push({
                x1: offsetX + node.x1, y1: offsetY + node.y1,
                x2: offsetX + node.x2, y2: offsetY + node.y2,
                lineWidth: node.lineWidth, color: node.color,
                dash: node.dash,
            })
        } else if (node.type === 'image') {
            out.images.push({
                x: offsetX + node.x, y: offsetY + node.y,
                width: node.width, height: node.height,
                imageId: node.imageId, clipped,
            })
        } else if (node.type === 'svg') {
            out.svgs.push({
                x: offsetX + node.x, y: offsetY + node.y,
                width: node.width, height: node.height,
                svgData: node.svgData,
            })
        } else if (node.type === 'path') {
            out.paths.push({
                commands: Array.from(node.commands),
                coords: Array.from(node.coords),
                fill: node.fill,
                stroke: node.stroke,
                strokeWidth: node.strokeWidth,
            })
        } else if (node.type === 'group') {
            collectPositioned(node.children, offsetX + node.x, offsetY + node.y, clipped || node.clip === true, out)
        }
    }
}

function collectAll(nodes: RenderNode[]) {
    const out = {
        texts: [] as PositionedText[], rects: [] as PositionedRect[], ellipses: [] as PositionedEllipse[], lines: [] as PositionedLine[],
        images: [] as PositionedImage[], svgs: [] as PositionedSvg[], paths: [] as PositionedPath[],
    }
    collectPositioned(nodes, 0, 0, false, out)
    return out
}

function hasClippedGroup(nodes: RenderNode[]): boolean {
    for (const node of nodes) {
        if (node.type === 'group') {
            if (node.clip === true) return true
            if (hasClippedGroup(node.children)) return true
        }
    }
    return false
}

function hasClipPathGroup(nodes: RenderNode[]): boolean {
    for (const node of nodes) {
        if (node.type === 'group') {
            if (node.clipPath !== undefined) return true
            if (hasClipPathGroup(node.children)) return true
        }
    }
    return false
}

/** Create an editor template with a single element on a zero-margin page */
function singleElementTemplate(element: TemplateElement) {
    const template = createDefaultTemplate()
    template.pageSettings = {
        ...template.pageSettings,
        size: 'custom',
        width: element.width,
        height: element.height + 1,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
        columnWidth: element.width,
    }
    template.bands = [{
        id: 'band_title',
        type: 'title',
        height: element.height,
        startNewPage: false,
        splitType: 'Stretch',
        elements: [{ ...element, x: 0, y: 0 }],
        printWhenExpression: '',
        enabled: true,
    }]
    template.groups = []
    return template
}

/** Collect render nodes from both the editor preview and the core output */
function renderBothWays(element: TemplateElement) {
    const editorResult = buildRenderNodes(element, fontRegistry, FONT_ID, mathFonts, null)
    const editorNodes = collectAll(editorResult.nodes)

    const coreTemplate = convertEditorTemplateToCore(singleElementTemplate(element))
    const doc = createReport(coreTemplate, { rows: [{}] }, { fontMap: coreFontMap })
    const coreNodes = collectAll(doc.pages[0]!.children)
    return { editorResult, editorNodes, coreDoc: doc, coreNodes }
}

/** Minimal valid PNG (signature + IHDR chunk) sufficient for dimension extraction */
function makePng(width: number, height: number): Uint8Array {
    const buf = new Uint8Array(33)
    // PNG signature
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47
    buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A
    // IHDR chunk length (13 bytes)
    buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 13
    // 'IHDR'
    buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52
    // Width / height (4 bytes big-endian each)
    buf[16] = (width >>> 24) & 0xFF; buf[17] = (width >>> 16) & 0xFF
    buf[18] = (width >>> 8) & 0xFF; buf[19] = width & 0xFF
    buf[20] = (height >>> 24) & 0xFF; buf[21] = (height >>> 16) & 0xFF
    buf[22] = (height >>> 8) & 0xFF; buf[23] = height & 0xFF
    // bit depth=8, color type=2 (RGB), compression=0, filter=0, interlace=0
    buf[24] = 8; buf[25] = 2; buf[26] = 0; buf[27] = 0; buf[28] = 0
    // CRC (dummy, not needed for dimension extraction)
    buf[29] = 0; buf[30] = 0; buf[31] = 0; buf[32] = 0
    return buf
}

function pngDataUri(width: number, height: number): string {
    return 'data:image/png;base64,' + Buffer.from(makePng(width, height)).toString('base64')
}

function makeImageElement(width: number, height: number, imgWidth: number, imgHeight: number): TemplateElement {
    const el = createDefaultElement('el1', 'image', 0, 0, width, height)
    el.source = pngDataUri(imgWidth, imgHeight)
    return el
}

function makeTextElement(kind: 'staticText' | 'textField', text: string): TemplateElement {
    const el = createDefaultElement('el1', kind, 0, 0, 200, 40)
    if (kind === 'staticText') el.text = text
    else el.expression = JSON.stringify(text)
    el.style.fontFamily = FONT_ID
    return el
}

// ─── Tests ───

describe('WYSIWYG parity: editor 単要素プレビュー vs core 出力', () => {
    // Verify basic staticText renders with identical text, position, size, and color in both paths
    it('staticText: テキスト内容・座標・サイズ・色が一致する', () => {
        const el = makeTextElement('staticText', 'こんにちは World')
        const { editorNodes, coreNodes } = renderBothWays(el)

        expect(coreNodes.texts.length).toBeGreaterThan(0)
        expect(editorNodes.texts.length).toBe(coreNodes.texts.length)
        for (let i = 0; i < coreNodes.texts.length; i++) {
            expect(editorNodes.texts[i]).toEqual(coreNodes.texts[i])
        }
    })

    // Verify parity holds for center/right alignment and a non-default font size
    it('staticText: 中央揃え・右揃え・フォントサイズ変更でも一致する', () => {
        for (const hAlign of ['center', 'right'] as const) {
            const el = makeTextElement('staticText', '配置テスト')
            el.style.hAlign = hAlign
            el.style.fontSize = 14
            const { editorNodes, coreNodes } = renderBothWays(el)
            expect(editorNodes.texts).toEqual(coreNodes.texts)
        }
    })

    // Verify line positions match for long text with wrapping and Japanese line-break rules
    it('staticText: 折り返しを含む長文でも行位置が一致する', () => {
        const el = makeTextElement('staticText', '長いテキストの折り返し検証。日本語の禁則処理を含む文章がエディタとPDFで同じ位置に描画されること。')
        el.width = 120
        el.height = 80
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.texts.length).toBeGreaterThan(1) // multiple lines due to wrapping
        expect(editorNodes.texts).toEqual(coreNodes.texts)
    })

    // Verify textField design view shows the expression source while geometry/style match core
    it('textField: 設計ビューは式ソースを表示しつつ、位置・スタイルは core と一致する', () => {
        const el = makeTextElement('textField', 'フィールド値')
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.texts.length).toBe(1)
        expect(editorNodes.texts.length).toBe(1)
        // The design view (canvas) shows the raw expression source (like a common report designer)
        expect(editorNodes.texts[0]!.text).toBe('"フィールド値"')
        // Core outputs the evaluated expression value
        expect(coreNodes.texts[0]!.text).toBe('フィールド値')
        // Everything except the text (position, font size, color, alignment) matches
        const { text: _e, ...editorRest } = editorNodes.texts[0]!
        const { text: _c, ...coreRest } = coreNodes.texts[0]!
        expect(editorRest).toEqual(coreRest)
    })

    // Verify parity holds with letter spacing and vertical writing mode
    it('staticText: letterSpacing / 縦書きでも一致する', () => {
        const el = makeTextElement('staticText', '字間検証')
        el.letterSpacing = 2
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(editorNodes.texts).toEqual(coreNodes.texts)

        const vertical = makeTextElement('staticText', '縦書き')
        vertical.writingMode = 'vertical-rl'
        vertical.width = 40
        vertical.height = 120
        const both = renderBothWays(vertical)
        expect(both.editorNodes.texts).toEqual(both.coreNodes.texts)
    })

    // Verify rectangle fill and stroke render identically in both paths
    it('rectangle: 塗り・枠線の矩形が一致する', () => {
        const el = createDefaultElement('el1', 'rectangle', 0, 0, 100, 50)
        el.shapeFillType = 'solid'
        el.shapeFillColor = '#FFEE00'
        el.stroke = '#003366'
        el.strokeWidth = 2
        const { editorNodes, coreNodes } = renderBothWays(el)
        const editorFilled = editorNodes.rects.filter(r => r.fill !== undefined || r.stroke !== undefined)
        const coreFilled = coreNodes.rects.filter(r => r.fill !== undefined || r.stroke !== undefined)
        expect(editorFilled).toEqual(coreFilled)
    })

    it('ellipse: グラデーション塗りが一致する', () => {
        const el = createDefaultElement('el1', 'ellipse', 0, 0, 100, 50)
        el.shapeFillType = 'radial'
        el.shapeGradient = {
            ...el.shapeGradient,
            cx: 0.4,
            cy: 0.5,
            r: 0.7,
            stops: [
                { offset: 0, color: '#ffffff' },
                { offset: 1, color: '#0088cc', opacity: 0.8 },
            ],
        }
        el.stroke = '#003366'
        el.strokeWidth = 1.5
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(editorNodes.ellipses).toEqual(coreNodes.ellipses)
    })

    // Verify line segment coordinates, width, and color match between editor and core
    it('line: 線分の座標・線幅・色が一致する', () => {
        const el = createDefaultElement('el1', 'line', 0, 0, 150, 10)
        el.lineWidth = 1.5
        el.lineColor = '#CC0000'
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(editorNodes.lines).toEqual(coreNodes.lines)
    })

    it('path: パス形状・塗り・線が一致する', () => {
        const el = createDefaultElement('el1', 'path', 0, 0, 100, 80)
        el.pathSubpaths = [{
            closed: true,
            anchors: [
                { x: 0, y: 70, inX: 0, inY: 70, outX: 25, outY: 0, handleMode: 'independent' },
                { x: 100, y: 10, inX: 60, inY: 0, outX: 100, outY: 10, handleMode: 'independent' },
                { x: 80, y: 80, inX: 80, inY: 80, outX: 80, outY: 80, handleMode: 'independent' },
            ],
        }]
        el.pathFillType = 'linear'
        el.pathGradient = {
            ...el.pathGradient,
            stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
            ],
        }
        el.stroke = '#003366'
        el.strokeWidth = 2
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(editorNodes.paths).toEqual(coreNodes.paths)
    })

    // Verify styled markup (bold/color runs) renders identically in both paths
    it('staticText(markup=styled): スタイル付きテキストの描画が core と一致する', () => {
        const el = makeTextElement('staticText', '通常 <b>太字</b> と <font color="#ff0000">赤字</font>')
        el.markup = 'styled'
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.texts.length).toBeGreaterThan(0)
        expect(editorNodes.texts).toEqual(coreNodes.texts)
        // A red text run must exist
        expect(coreNodes.texts.some(t => t.color.toLowerCase() === '#ff0000')).toBe(true)
    })

    // Verify HTML markup (bold, line break, italic) renders identically in both paths
    it('staticText(markup=html): HTMLマークアップの描画が core と一致する', () => {
        const el = makeTextElement('staticText', '<b>強調</b><br/>次の行 <i>斜体</i>')
        el.markup = 'html'
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.texts.length).toBeGreaterThan(0)
        expect(editorNodes.texts).toEqual(coreNodes.texts)
    })

    // Verify dashed/dotted line patterns match core ([4,2] / [1,1], independent of line width)
    it('line: 破線・点線パターンが core と一致する', () => {
        for (const lineStyle of ['dashed', 'dotted'] as const) {
            const el = createDefaultElement('el1', 'line', 0, 0, 150, 10)
            el.lineWidth = 2
            el.lineColor = '#333333'
            el.lineStyle = lineStyle
            const { editorNodes, coreNodes } = renderBothWays(el)
            expect(coreNodes.lines.length).toBe(1)
            expect(coreNodes.lines[0]!.dash).toEqual(lineStyle === 'dashed' ? [4, 2] : [1, 1])
            expect(editorNodes.lines).toEqual(coreNodes.lines)
        }
    })

    // Verify retainShape image geometry (scale + alignment) matches core exactly
    it('image: scaleMode=retainShape の描画ジオメトリが core と一致する', () => {
        const el = makeImageElement(100, 80, 200, 100)
        el.scaleMode = 'retainShape'
        el.imageHAlign = 'center'
        el.imageVAlign = 'middle'
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.images.length).toBe(1)
        // Aspect-fit: 200x100 into 100x80 → 100x50, centered vertically
        expect(coreNodes.images[0]).toMatchObject({ x: 0, y: 15, width: 100, height: 50 })
        expect(editorNodes.images).toEqual(coreNodes.images)
    })

    // Verify each alignment combination in retainShape matches core
    it('image: retainShape の hAlign / vAlign が core と一致する', () => {
        for (const hAlign of ['left', 'center', 'right'] as const) {
            for (const vAlign of ['top', 'middle', 'bottom'] as const) {
                const el = makeImageElement(120, 90, 60, 60)
                el.scaleMode = 'retainShape'
                el.imageHAlign = hAlign
                el.imageVAlign = vAlign
                const { editorNodes, coreNodes } = renderBothWays(el)
                expect(coreNodes.images.length).toBe(1)
                expect(editorNodes.images).toEqual(coreNodes.images)
            }
        }
    })

    // Verify clip / realSize place the natural-size image in a clipped group like core
    it('image: scaleMode=clip / realSize が core と一致する', () => {
        for (const scaleMode of ['clip', 'realSize'] as const) {
            const el = makeImageElement(100, 80, 200, 100)
            el.scaleMode = scaleMode
            el.imageHAlign = 'left'
            el.imageVAlign = 'top'
            const { editorNodes, coreNodes } = renderBothWays(el)
            expect(coreNodes.images.length).toBe(1)
            // Natural size, clipped to the element frame
            expect(coreNodes.images[0]).toMatchObject({ width: 200, height: 100, clipped: true })
            expect(editorNodes.images).toEqual(coreNodes.images)
        }
    })

    // Verify fillFrame stretches to the element frame in both paths
    it('image: scaleMode=fillFrame が core と一致する', () => {
        const el = makeImageElement(100, 80, 200, 100)
        el.scaleMode = 'fillFrame'
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.images.length).toBe(1)
        expect(coreNodes.images[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 80 })
        expect(editorNodes.images).toEqual(coreNodes.images)
    })

    // Verify a quoted sourceExpression literal resolves to the same geometry as core
    it('image: sourceExpression の文字列リテラルでも core と一致する', () => {
        const el = createDefaultElement('el1', 'image', 0, 0, 100, 80)
        el.source = ''
        el.sourceExpression = '"' + pngDataUri(200, 100) + '"'
        el.scaleMode = 'retainShape'
        el.imageHAlign = 'center'
        el.imageVAlign = 'middle'
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.images.length).toBe(1)
        expect(editorNodes.images).toEqual(coreNodes.images)
    })

    // Verify math elements expand beyond the element box without clipping, like core
    it('math: 枠より大きい数式はクリップせずグループを拡張し core と一致する', () => {
        const el = createDefaultElement('el1', 'math', 0, 0, 60, 12)
        el.formula = '\\frac{x^2 + 1}{y - 2}'
        el.mathFontFamily = MATH_FONT_ID
        el.mathFontSize = 14
        el.mathColor = '#003366'
        const { editorResult, editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.texts.length).toBeGreaterThan(0)
        expect(editorNodes.texts).toEqual(coreNodes.texts)
        expect(editorNodes.lines).toEqual(coreNodes.lines)
        // The editor no longer clips the formula group
        expect(hasClippedGroup(editorResult.nodes)).toBe(false)
        // The group expands to the formula extent
        const group = editorResult.nodes.find(function (n) { return n.type === 'group' })
        expect(group).toBeDefined()
        expect((group as { height: number }).height).toBeGreaterThan(el.height)
    })

    // Verify a math formula smaller than the box keeps the element-sized group like core
    it('math: 枠内に収まる数式も core と一致する', () => {
        const el = createDefaultElement('el1', 'math', 0, 0, 200, 60)
        el.formula = 'x + y'
        el.mathFontFamily = MATH_FONT_ID
        el.mathFontSize = 12
        el.mathColor = '#000000'
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.texts.length).toBeGreaterThan(0)
        expect(editorNodes.texts).toEqual(coreNodes.texts)
    })

    // Verify an SVG string literal renders as a real svg node identical to core
    it('svg: 文字列リテラルの SVG が core と一致する', () => {
        const el = createDefaultElement('el1', 'svg', 0, 0, 80, 40)
        el.svgContent = '\'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#ff0000"/></svg>\''
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(coreNodes.svgs.length).toBe(1)
        expect(editorNodes.svgs).toEqual(coreNodes.svgs)
    })

    // Verify an imported frame clip path becomes a clipPath group without an
    // editor guide stroke, so imported clipped content renders like the original
    it('frame: 取込みクリップパスは clipPath グループになりガイド枠を出さない', () => {
        const el = createDefaultElement('el1', 'frame', 0, 0, 100, 100)
        el.frameClipPathD = 'M10 10 L90 10 L90 90 L10 90 Z'
        el.frameClipPathRule = 'nonzero'
        const child = createDefaultElement('el2', 'rectangle', 5, 5, 50, 50)
        child.shapeFillType = 'solid'
        child.shapeFillColor = '#ff0000'
        el.children = [child]
        const result = buildRenderNodes(el, fontRegistry, FONT_ID, mathFonts, null)
        const guideRects = result.nodes.filter(function (n) { return n.type === 'rect' && (n as RenderRect).stroke === '#999999' })
        expect(guideRects.length).toBe(0)
        expect(hasClipPathGroup(result.nodes)).toBe(true)
    })

    // Verify a plain hand-drawn frame still shows the guide stroke
    it('frame: クリップパスの無いフレームはガイド枠を表示する', () => {
        const el = createDefaultElement('el1', 'frame', 0, 0, 100, 100)
        const result = buildRenderNodes(el, fontRegistry, FONT_ID, mathFonts, null)
        const guideRects = result.nodes.filter(function (n) { return n.type === 'rect' && (n as RenderRect).stroke === '#999999' })
        expect(guideRects.length).toBe(1)
    })

    // Verify a dynamic SVG expression keeps the design-time placeholder
    it('svg: 動的式は設計時プレースホルダを表示する', () => {
        const el = createDefaultElement('el1', 'svg', 0, 0, 80, 40)
        el.svgContent = 'field.svgData'
        const editorResult = buildRenderNodes(el, fontRegistry, FONT_ID, mathFonts, null)
        const editorNodes = collectAll(editorResult.nodes)
        expect(editorNodes.svgs.length).toBe(0)
        expect(editorNodes.texts.some(function (t) { return t.text === '[SVG]' })).toBe(true)
    })

    // Verify text position and border lines match when padding and borders are applied
    it('staticText: パディングとボーダー付きでもテキスト位置が一致する', () => {
        const el = makeTextElement('staticText', 'パディング検証')
        el.style.padding = { top: 5, bottom: 5, left: 10, right: 10 }
        el.style.border = {
            top: { width: 1, color: '#000000', style: 'solid' },
            bottom: { width: 1, color: '#000000', style: 'solid' },
            left: { width: 1, color: '#000000', style: 'solid' },
            right: { width: 1, color: '#000000', style: 'solid' },
        }
        const { editorNodes, coreNodes } = renderBothWays(el)
        expect(editorNodes.texts).toEqual(coreNodes.texts)
        // Border lines also match (count and coordinates)
        expect(editorNodes.lines).toEqual(coreNodes.lines)
    })
})
