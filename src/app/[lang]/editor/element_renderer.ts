// Element renderer.
// Draw each element on canvas through the core print pipeline: layoutText, renderPage, and CanvasBackend.

import {
    Font, TextMeasurer, CanvasBackend, createReport, renderPage,
    renderBarcode, parseMathLaTeX, layoutMathFormula, parseSvg,
    renderTextToGroup, type TextContentStyle, type ReportResources,
    type RenderNode, type RenderPage, type RenderGroup,
    type RenderLine, type RenderRect, type RenderEllipse,
    type RenderPath,
    layoutTable, type TableDef, type TableCellStyleDef, type LineSpacingDef,
    appendBorderNodes, buildBackgroundRect, lineStyleDash, type BorderDef,
} from 'tsreport-core'
import type { FontResource } from './font_loader'
import type { ReportTemplate, TemplateElement, TableRow } from './reducer'
import { getTableColumns, getTableSectionRows } from './table_editor_model'
import { resolveEditorCanvasImage, resolveEditorWorkspacePath, type EditorCurrentFile } from './resource_resolver'
import { type OpenReportTemplate } from './subreport_support'
import { convertEditorTemplateToCore } from './template_converter'
import { dirnamePosix } from '@/lib/common/utils/workspace_path'
import { buildRenderPathArrays } from './path_model'
import type { Band } from './reducer'

export type FitResult = { fitX: number, fitWidth: number, fitY?: number, renderHeight?: number }
export type BandCanvasTile = { x: number, y: number, width: number, height: number }
export type PreparedBandRender = {
    page: RenderPage,
    images?: Record<string, string | Uint8Array>,
}
export type AffineMatrix = [number, number, number, number, number, number]

const MAX_CANVAS_SIDE = 16384
const MAX_CANVAS_AREA = 4194304
const MAX_BATCH_TILE_CSS_SIZE = 256

/**
  * Tableelementdrawheight.
  * Text / fitWidth / shrinkToFit heightcase.
 */

export function computeTableRenderHeight(
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
): number {
    if (element.kind !== 'table') return element.height
    const fontMap = new Map<string, import('tsreport-core').TextMeasurer>()
    fontRegistry.forEach(function (res, id) { fontMap.set(id, res.measurer) })
    const tableDef = convertTableForPreview(element)
    const rows = buildTablePreviewRows(element)
    const group = layoutTable(tableDef, 0, 0, element.width, rows, {
        fontMap,
        resolveExpression: function resolveExpression(expression: string): string { return expression },
        measureCellElements: function measureCellElements(elements: unknown[], cellWidth: number): number {
            const elems = elements as TemplateElement[]
            let maxBottom = 0
            for (let i = 0; i < elems.length; i++) {
                const el = elems[i]!
                const bottom = el.y + el.height
                if (bottom > maxBottom) maxBottom = bottom
            }
            return maxBottom
        },
    })
    return group.height
}

// Element canvas draw.fitWidth case, canvas FitResult.

export function renderElementToCanvas(
    canvas: HTMLCanvasElement,
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    mathFontResource: FontResource | null,
    currentFile: EditorCurrentFile | null,
    rootTemplate: ReportTemplate,
    openReportTemplates: OpenReportTemplate[],
    zoom: number,
    onImagesReady?: () => void,
): FitResult | null {
    const dpr = globalThis.devicePixelRatio ?? 1

    if (element.kind === 'subreport' && renderSubreportElementToCanvas(
        canvas,
        element,
        fontRegistry,
        defaultFontId,
        mathFonts,
        mathFontResource,
        currentFile,
        rootTemplate,
        openReportTemplates,
        zoom,
        dpr,
        onImagesReady,
    )) {
        return null
    }

    const buildResult = buildRenderNodes(element, fontRegistry, defaultFontId, mathFonts, currentFile)
    const overflowPadding = getElementCanvasOverflowPadding(element)
    const renderWidth = buildResult.fitWidth + overflowPadding * 2
    const h = buildResult.renderHeight ?? element.height
    const renderHeight = h + overflowPadding * 2

    canvas.width = Math.ceil(renderWidth * zoom * dpr)
    canvas.height = Math.ceil(renderHeight * zoom * dpr)

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const pageChildren = overflowPadding > 0 ? [{
        type: 'group' as const,
        x: overflowPadding,
        y: overflowPadding,
        width: buildResult.fitWidth,
        height: h,
        children: buildResult.nodes,
    }] : buildResult.nodes
    const page: RenderPage = { width: renderWidth, height: renderHeight, children: pageChildren }

    // Pass all registered fonts to the backend.
    const fontsMap: Record<string, Font> = {}
    fontRegistry.forEach(function (res, id) { fontsMap[id] = res.font })
    const mathFontIds = Object.keys(mathFonts)
    for (let i = 0; i < mathFontIds.length; i++) {
        fontsMap[mathFontIds[i]] = mathFonts[mathFontIds[i]]
    }

    const backend = new CanvasBackend(ctx, {
        scale: zoom,
        devicePixelRatio: dpr,
        fonts: fontsMap,
        background: null,
        images: buildResult.images,
        onImagesReady,
    })
    backend.beginDocument()
    renderPage(page, backend)
    backend.endDocument()

    // Width can shrink (fitWidth text) or grow (math overflow, matching core).
    const hasWidthChange = renderWidth !== element.width
    const hasHeightChange = renderHeight !== element.height
    if (hasWidthChange || hasHeightChange) {
        return {
            fitX: buildResult.fitX - overflowPadding,
            fitWidth: renderWidth,
            fitY: -overflowPadding,
            renderHeight,
        }
    }
    return null
}

/**
 * Renders every element of a band through the core pipeline. Heavy bands use
 * one or more canvas tiles instead of per-element canvases, so imported vector
 * pages keep frame clip paths / overlap order aligned with preview and PDF
 * output without exceeding browser canvas limits.
 */
export function renderBandToCanvas(
    canvas: HTMLCanvasElement,
    band: Band,
    bandWidth: number,
    bandHeight: number,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    currentFile: EditorCurrentFile | null,
    zoom: number,
    onImagesReady?: () => void,
): void {
    const dpr = globalThis.devicePixelRatio ?? 1
    renderBandTileToCanvas(canvas, band, 0, 0, bandWidth, bandHeight, fontRegistry, defaultFontId, mathFonts, currentFile, zoom, dpr, onImagesReady)
}

export function planBandCanvasTiles(
    bandWidth: number,
    bandHeight: number,
    zoom: number,
    devicePixelRatio: number,
    spatialCull: boolean = false,
): BandCanvasTile[] {
    const pixelWidth = Math.max(1, Math.ceil(bandWidth * zoom * devicePixelRatio))
    const pixelHeight = Math.max(1, Math.ceil(bandHeight * zoom * devicePixelRatio))
    const scale = zoom * devicePixelRatio
    if (!spatialCull && pixelWidth <= MAX_CANVAS_SIDE && pixelHeight <= MAX_CANVAS_SIDE && pixelWidth * pixelHeight <= MAX_CANVAS_AREA) {
        return [{ x: 0, y: 0, width: bandWidth, height: bandHeight }]
    }
    const spatialPixelLimit = spatialCull
        ? Math.max(1, Math.ceil(MAX_BATCH_TILE_CSS_SIZE * devicePixelRatio))
        : MAX_CANVAS_SIDE
    const tilePixelWidth = Math.min(pixelWidth, MAX_CANVAS_SIDE, spatialPixelLimit)
    const maxHeightByArea = Math.max(1, Math.floor(MAX_CANVAS_AREA / tilePixelWidth))
    const tilePixelHeight = Math.max(1, Math.min(pixelHeight, MAX_CANVAS_SIDE, maxHeightByArea, spatialPixelLimit))
    const tileWidth = Math.max(1, tilePixelWidth / scale)
    const tileHeight = Math.max(1, tilePixelHeight / scale)
    const tiles: BandCanvasTile[] = []
    for (let y = 0; y < bandHeight; y += tileHeight) {
        for (let x = 0; x < bandWidth; x += tileWidth) {
            tiles.push({
                x,
                y,
                width: Math.min(tileWidth, bandWidth - x),
                height: Math.min(tileHeight, bandHeight - y),
            })
        }
    }
    return tiles
}

export function renderBandTileToCanvas(
    canvas: HTMLCanvasElement,
    band: Band,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    currentFile: EditorCurrentFile | null,
    zoom: number,
    dpr: number,
    onImagesReady?: () => void,
): void {
    const visibleElements: TemplateElement[] = []
    for (let i = 0; i < band.elements.length; i++) {
        const visible = filterBandElementForTile(
            band.elements[i]!, tileX, tileY, tileWidth, tileHeight, fontRegistry,
        )
        if (visible !== null) visibleElements.push(visible)
    }
    const visibleBand = visibleElements.length === band.elements.length
        && visibleElements.every(function (element, index) { return element === band.elements[index] })
        ? band
        : { ...band, elements: visibleElements }
    const prepared = prepareBandRender(
        visibleBand, tileX + tileWidth, Math.max(band.height, tileY + tileHeight),
        fontRegistry, defaultFontId, mathFonts, currentFile,
    )
    renderPreparedBandTileToCanvas(
        canvas, prepared, tileX, tileY, tileWidth, tileHeight,
        fontRegistry, mathFonts, zoom, dpr, onImagesReady,
    )
}

export function prepareBandRender(
    band: Band,
    bandWidth: number,
    bandHeight: number,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    currentFile: EditorCurrentFile | null,
): PreparedBandRender {
    const children: RenderNode[] = []
    let images: Record<string, string | Uint8Array> | undefined
    let importedStart = -1

    function flushImported(end: number): void {
        if (importedStart < 0) return
        const importedElements = band.elements.slice(importedStart, end)
        const hostTemplate = createBandHostTemplate(importedElements, bandWidth, bandHeight)
        const coreTemplate = convertEditorTemplateToCore(hostTemplate)
        const fontMap = buildFontMap(fontRegistry, null)
        const workingDirectory = currentFile !== null ? dirnamePosix(currentFile.path) : undefined
        const report = createReport(coreTemplate, { rows: [{}] }, {
            fontMap,
            workingDirectory,
            resources: {
                resolveImage: function resolveImage(ref: string): string | Uint8Array | null {
                    return resolveEditorCanvasImage(ref, currentFile)
                },
            },
        })
        if (report.pages.length === 0) throw new Error('Imported PDF band produced no render page')
        const pageChildren = report.pages[0]!.children
        for (let i = 0; i < pageChildren.length; i++) children.push(pageChildren[i]!)
        images = mergeImages(images, report.images)
        importedStart = -1
    }

    for (let i = 0; i < band.elements.length; i++) {
        const element = band.elements[i]!
        if (element.importedPdfRenderState !== null) {
            if (importedStart < 0) importedStart = i
            continue
        }
        flushImported(i)
        const built = buildRenderNodes(element, fontRegistry, defaultFontId, mathFonts, currentFile, false)
        children.push({
            type: 'group',
            x: element.x + (built.fitX ?? 0),
            y: element.y,
            width: built.fitWidth,
            height: built.renderHeight ?? element.height,
            children: built.nodes,
        })
        images = mergeImages(images, built.images)
    }
    flushImported(band.elements.length)
    return { page: { width: bandWidth, height: bandHeight, children }, images }
}

export function renderPreparedBandTileToCanvas(
    canvas: HTMLCanvasElement,
    prepared: PreparedBandRender,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    fontRegistry: Map<string, FontResource>,
    mathFonts: Record<string, Font>,
    zoom: number,
    dpr: number,
    onImagesReady?: () => void,
): void {
    canvas.width = Math.max(1, Math.ceil(tileWidth * zoom * dpr))
    canvas.height = Math.max(1, Math.ceil(tileHeight * zoom * dpr))
    canvas.style.width = tileWidth * zoom + 'px'
    canvas.style.height = tileHeight * zoom + 'px'

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const fontsMap: Record<string, Font> = {}
    fontRegistry.forEach(function (res, id) { fontsMap[id] = res.font })
    const mathFontIds = Object.keys(mathFonts)
    for (let i = 0; i < mathFontIds.length; i++) fontsMap[mathFontIds[i]!] = mathFonts[mathFontIds[i]!]!

    const backend = new CanvasBackend(ctx, {
        scale: zoom,
        devicePixelRatio: dpr,
        fonts: fontsMap,
        background: null,
        images: prepared.images,
        viewport: { x: tileX, y: tileY, width: tileWidth, height: tileHeight },
        onImagesReady,
    })
    backend.beginDocument()
    renderPage(prepared.page, backend)
    backend.endDocument()
}

/**
 * Keeps only the branches that can paint inside one band tile. Imported PDF
 * frames expose their transformed visual bounds in the editor model, so the
 * hierarchy can be pruned without changing local geometry or clip semantics.
 */
export function filterBandElementForTile(
    element: TemplateElement,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    fontRegistry: Map<string, FontResource>,
    parentTransform: AffineMatrix = [1, 0, 0, 1, 0, 0],
): TemplateElement | null {
    const elementTransform = elementCanvasTransform(element, parentTransform)
    const intersects = elementBoundsIntersectTile(
        element, elementTransform, tileX, tileY, tileWidth, tileHeight, fontRegistry,
    )
    if (element.kind !== 'frame') {
        if (!intersects) return null
        return filterElementMeshForTile(element, elementTransform, tileX, tileY, tileWidth, tileHeight)
    }

    // Ordinary frames clip to their rectangular bounds. Imported PDF frames
    // used only to scope device parameters explicitly do not: transformed
    // children may paint outside the frame's allocation hint and must be
    // tested independently against the tile.
    const clipsChildren = element.importedPdfRenderState?.frame?.clip !== false
    if (clipsChildren && !intersects) return null
    const children: TemplateElement[] = []
    for (let i = 0; i < element.children.length; i++) {
        const child = filterBandElementForTile(
            element.children[i]!, tileX, tileY, tileWidth, tileHeight, fontRegistry, elementTransform,
        )
        if (child !== null) children.push(child)
    }
    // A non-empty frame is a structural container. Its editor guide is not
    // printable content and must not keep an otherwise empty tile branch.
    if (element.children.length > 0 && children.length === 0) return null
    if (!intersects && children.length === 0) return null
    return children.length === element.children.length ? element : { ...element, children }
}

function filterElementMeshForTile(
    element: TemplateElement,
    transform: AffineMatrix,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
): TemplateElement {
    if (element.kind !== 'path' || element.pathComplexFill?.type !== 'meshGradient') return element
    const fill = element.pathComplexFill
    const patches = fill.patches?.filter(function (patch) {
        return pointArrayIntersectsTile(patch.points, transform, tileX, tileY, tileWidth, tileHeight)
    })
    const triangles = fill.triangles?.filter(function (triangle) {
        return pointArrayIntersectsTile(triangle.points, transform, tileX, tileY, tileWidth, tileHeight)
    })
    if ((patches === undefined || patches.length === fill.patches?.length)
        && (triangles === undefined || triangles.length === fill.triangles?.length)) {
        return element
    }
    return { ...element, pathComplexFill: { ...fill, patches, triangles } }
}

function pointArrayIntersectsTile(
    points: number[],
    transform: AffineMatrix,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
): boolean {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (let i = 0; i < points.length; i += 2) {
        const point = transformPoint(transform, points[i]!, points[i + 1]!)
        left = Math.min(left, point.x)
        top = Math.min(top, point.y)
        right = Math.max(right, point.x)
        bottom = Math.max(bottom, point.y)
    }
    // Tessellated mesh triangles are slightly inflated to hide antialiasing
    // seams. Retain a one-point overlap so adjacent canvas tiles remain exact.
    const overlap = 1
    return right + overlap >= tileX
        && left - overlap <= tileX + tileWidth
        && bottom + overlap >= tileY
        && top - overlap <= tileY + tileHeight
}

export function bandElementIntersectsTile(
    element: TemplateElement,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    fontRegistry: Map<string, FontResource>,
): boolean {
    return elementBoundsIntersectTile(
        element, elementCanvasTransform(element, [1, 0, 0, 1, 0, 0]),
        tileX, tileY, tileWidth, tileHeight, fontRegistry,
    )
}

function elementBoundsIntersectTile(
    element: TemplateElement,
    transform: AffineMatrix,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    fontRegistry: Map<string, FontResource>,
): boolean {
    const padding = getElementCanvasOverflowPadding(element)
    const width = estimateElementRenderWidth(element)
    const height = estimateElementRenderHeight(element, fontRegistry)
    const p0 = transformPoint(transform, -padding, -padding)
    const p1 = transformPoint(transform, width + padding, -padding)
    const p2 = transformPoint(transform, -padding, height + padding)
    const p3 = transformPoint(transform, width + padding, height + padding)
    const left = Math.min(p0.x, p1.x, p2.x, p3.x)
    const top = Math.min(p0.y, p1.y, p2.y, p3.y)
    const right = Math.max(p0.x, p1.x, p2.x, p3.x)
    const bottom = Math.max(p0.y, p1.y, p2.y, p3.y)
    const tileRight = tileX + tileWidth
    const tileBottom = tileY + tileHeight
    return right >= tileX && left <= tileRight && bottom >= tileY && top <= tileBottom
}

export function elementCanvasTransform(element: TemplateElement, parent: AffineMatrix): AffineMatrix {
    const imported = element.importedPdfRenderState
    if (element.kind === 'path' && imported?.path?.affineTransform !== undefined) {
        const matrix = imported.path.affineTransform
        return multiplyAffine(parent, [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4] + element.x, matrix[5] + element.y])
    }
    if (element.kind === 'image' && imported?.image?.affineTransform !== undefined) {
        return multiplyAffine(parent, imported.image.affineTransform)
    }
    let result = multiplyAffine(parent, [1, 0, 0, 1, element.x, element.y])
    if (element.kind !== 'frame') return result
    const frame = imported?.frame
    if (frame?.affineTransform !== undefined) result = multiplyAffine(result, frame.affineTransform)
    if (frame?.rotation !== undefined && frame.rotation !== 0) {
        const originX = frame.rotationOriginX ?? 0
        const originY = frame.rotationOriginY ?? 0
        const radians = -frame.rotation * Math.PI / 180
        const cos = Math.cos(radians)
        const sin = Math.sin(radians)
        result = multiplyAffine(result, [1, 0, 0, 1, originX, originY])
        result = multiplyAffine(result, [cos, sin, -sin, cos, 0, 0])
        result = multiplyAffine(result, [1, 0, 0, 1, -originX, -originY])
    }
    return result
}

function multiplyAffine(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
    return [
        left[0] * right[0] + left[2] * right[1],
        left[1] * right[0] + left[3] * right[1],
        left[0] * right[2] + left[2] * right[3],
        left[1] * right[2] + left[3] * right[3],
        left[0] * right[4] + left[2] * right[5] + left[4],
        left[1] * right[4] + left[3] * right[5] + left[5],
    ]
}

export function transformPoint(matrix: AffineMatrix, x: number, y: number): { x: number, y: number } {
    return {
        x: matrix[0] * x + matrix[2] * y + matrix[4],
        y: matrix[1] * x + matrix[3] * y + matrix[5],
    }
}

export function invertAffine(matrix: AffineMatrix): AffineMatrix | null {
    const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
    if (Math.abs(determinant) < 1e-12) return null
    const a = matrix[3] / determinant
    const b = -matrix[1] / determinant
    const c = -matrix[2] / determinant
    const d = matrix[0] / determinant
    return [
        a,
        b,
        c,
        d,
        -(a * matrix[4] + c * matrix[5]),
        -(b * matrix[4] + d * matrix[5]),
    ]
}

function estimateElementRenderWidth(element: TemplateElement): number {
    return element.width
}

function estimateElementRenderHeight(
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
): number {
    if (element.kind === 'table') return computeTableRenderHeight(element, fontRegistry)
    return element.height
}

export function getElementCanvasOverflowPadding(element: TemplateElement): number {
    if (element.kind === 'line') return Math.max(0, element.lineWidth * 0.5)
    if (element.kind === 'rectangle' || element.kind === 'ellipse' || element.kind === 'path') {
        return Math.max(0, element.strokeWidth * 0.5)
    }
    return 0
}

function buildFontMap(
    fontRegistry: Map<string, FontResource>,
    mathFontResource: FontResource | null,
): Map<string, TextMeasurer> {
    const fontMap = new Map<string, TextMeasurer>()
    fontRegistry.forEach(function (resource, fontId) {
        fontMap.set(fontId, resource.measurer)
    })
    if (mathFontResource !== null) {
        fontMap.set(mathFontResource.fontId, mathFontResource.measurer)
    }
    return fontMap
}

function buildFontsMap(
    fontRegistry: Map<string, FontResource>,
    mathFonts: Record<string, Font>,
): Record<string, Font> {
    const fontsMap: Record<string, Font> = {}
    fontRegistry.forEach(function (resource, fontId) {
        fontsMap[fontId] = resource.font
    })
    const mathFontIds = Object.keys(mathFonts)
    for (let i = 0; i < mathFontIds.length; i++) {
        const fontId = mathFontIds[i]!
        fontsMap[fontId] = mathFonts[fontId]!
    }
    return fontsMap
}

function createSubreportHostTemplate(element: TemplateElement): ReportTemplate {
    return {
        name: '',
        pageSettings: {
            size: 'custom',
            width: element.width,
            height: element.height,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            orientation: 'portrait',
            columnCount: 1,
            columnWidth: element.width,
            columnSpacing: 0,
            columnPrintOrder: 'vertical',
        },
        bands: [{
            id: 'band_title',
            type: 'title',
            height: element.height,
            startNewPage: false,
            splitType: 'Stretch',
            elements: [{ ...element, x: 0, y: 0 }],
            printWhenExpression: '',
            enabled: true,
        }],
        titleNewPage: false,
        summaryNewPage: false,
        summaryWithPageHeaderAndFooter: false,
        testDataPath: '',
        groups: [],
    }
}

function createBandHostTemplate(elements: TemplateElement[], width: number, height: number): ReportTemplate {
    return {
        name: '',
        pageSettings: {
            size: 'custom',
            width,
            height,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            orientation: 'portrait',
            columnCount: 1,
            columnWidth: width,
            columnSpacing: 0,
            columnPrintOrder: 'vertical',
        },
        bands: [{
            id: 'band_title',
            type: 'title',
            height,
            startNewPage: false,
            splitType: 'Stretch',
            elements,
            printWhenExpression: '',
            enabled: true,
        }],
        titleNewPage: false,
        summaryNewPage: false,
        summaryWithPageHeaderAndFooter: false,
        testDataPath: '',
        groups: [],
    }
}

function convertTableBorderForPreview(element: TemplateElement) {
    return {
        top: element.style.border.top !== null ? { ...element.style.border.top } : null,
        bottom: element.style.border.bottom !== null ? { ...element.style.border.bottom } : null,
        left: element.style.border.left !== null ? { ...element.style.border.left } : null,
        right: element.style.border.right !== null ? { ...element.style.border.right } : null,
    }
}

function convertTableCellBorderForPreview(border: TemplateElement['style']['border']) {
    if (border.top === null && border.bottom === null && border.left === null && border.right === null) return undefined
    return {
        top: border.top !== null ? { width: border.top.width, color: border.top.color, style: border.top.style } : null,
        bottom: border.bottom !== null ? { width: border.bottom.width, color: border.bottom.color, style: border.bottom.style } : null,
        left: border.left !== null ? { width: border.left.width, color: border.left.color, style: border.left.style } : null,
        right: border.right !== null ? { width: border.right.width, color: border.right.color, style: border.right.style } : null,
    }
}

function cellExpressionToTextAndExpression(expression: string): { text?: string, expression?: string } {
    const trimmed = expression.trim()
    if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
        return { text: trimmed.substring(1, trimmed.length - 1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') }
    }
    if (trimmed !== '') return { expression: trimmed }
    return {}
}

function buildTablePreviewRows(element: TemplateElement): Record<string, unknown>[] {
    const row: Record<string, unknown> = {}
    const sectionKeys: ('header' | 'detail' | 'footer')[] = ['header', 'detail', 'footer']
    for (let si = 0; si < sectionKeys.length; si++) {
        const rows = getTableSectionRows(element, sectionKeys[si])
        for (let ri = 0; ri < rows.length; ri++) {
            const cells = rows[ri]!.cells
            for (let ci = 0; ci < cells.length; ci++) {
                const expression = cells[ci]!.expression.trim()
                const match = expression.match(/^field\.(\w+)$/)
                if (match) {
                    row[match[1]!] = match[1]!
                }
            }
        }
    }
    return [row]
}

function convertCellStyleForPreview(style: TableRow['cells'][number]['style']): TableCellStyleDef {
    return {
        hAlign: style.hAlign,
        vAlign: style.vAlign,
        rotation: style.rotation || undefined,
        backcolor: style.backcolor !== '#FFFFFF' ? style.backcolor : undefined,
        forecolor: style.forecolor,
        fontId: style.fontFamily,
        fontSize: style.fontSize,
        bold: style.bold || undefined,
        italic: style.italic || undefined,
        underline: style.underline || undefined,
        strikethrough: style.strikethrough || undefined,
        lineSpacing: convertLineSpacingForPreview(style),
        letterSpacing: style.letterSpacing || undefined,
        wordSpacing: style.wordSpacing || undefined,
        firstLineIndent: style.firstLineIndent || undefined,
        leftIndent: style.leftIndent || undefined,
        rightIndent: style.rightIndent || undefined,
        wrap: style.wrap === false ? false : undefined,
        shrinkToFit: style.shrinkToFit || undefined,
        minFontSize: style.shrinkToFit && style.minFontSize !== 4 ? style.minFontSize : undefined,
        fitWidth: style.fitWidth || undefined,
        outlineText: style.outlineText || undefined,
        padding: style.padding,
        opacity: style.opacity < 1 ? style.opacity : undefined,
        border: convertTableCellBorderForPreview(style.border),
    }
}

function convertLineSpacingForPreview(style: { lineSpacingType: string; lineSpacingValue: number }): LineSpacingDef | undefined {
    if (style.lineSpacingType === 'single') return undefined
    return { type: style.lineSpacingType as LineSpacingDef['type'], value: style.lineSpacingValue }
}

function convertSectionRowsForPreview(rows: TableRow[]) {
    return rows.map(function (row) {
        return {
            height: row.height,
            cells: row.cells.map(function (cell) {
                return {
                    ...cellExpressionToTextAndExpression(cell.expression),
                    colSpan: cell.colSpan !== 1 ? cell.colSpan : undefined,
                    rowSpan: cell.rowSpan !== 1 ? cell.rowSpan : undefined,
                    ...convertCellStyleForPreview(cell.style),
                    elements: cell.children.length > 0 ? cell.children : undefined,
                }
            }),
        }
    })
}

function convertTableForPreview(element: TemplateElement): TableDef {
    const columns = getTableColumns(element)
    return {
        columns: columns.map(function (column) {
            return {
                width: column.width,
                style: convertCellStyleForPreview(column.style),
            }
        }),
        headerRows: convertSectionRowsForPreview(getTableSectionRows(element, 'header')),
        detailRows: convertSectionRowsForPreview(getTableSectionRows(element, 'detail')),
        footerRows: convertSectionRowsForPreview(getTableSectionRows(element, 'footer')),
        border: convertTableBorderForPreview(element),
    }
}

function buildTableNodes(
    nodes: RenderNode[],
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    currentFile: EditorCurrentFile | null,
): number {
    const fontMap = new Map<string, import('tsreport-core').TextMeasurer>()
    fontRegistry.forEach(function (res, id) { fontMap.set(id, res.measurer) })
    const tableDef = convertTableForPreview(element)
    const rows = buildTablePreviewRows(element)
    const group = layoutTable(tableDef, 0, 0, element.width, rows, {
        fontMap,
        resolveExpression: function resolveExpression(expression: string): string { return expression },
        renderCellElements: function renderCellElements(elements: unknown[], cellWidth: number, cellHeight: number): RenderNode[] {
            const result: RenderNode[] = []
            const elems = elements as TemplateElement[]
            for (let i = 0; i < elems.length; i++) {
                const child = elems[i]!
                const childResult = buildRenderNodes(child, fontRegistry, defaultFontId, mathFonts, currentFile)
                const childGroup: RenderGroup = {
                    type: 'group',
                    x: child.x, y: child.y,
                    width: child.width, height: child.height,
                    clip: true,
                    children: childResult.nodes,
                }
                result.push(childGroup)
            }
            return result
        },
        measureCellElements: function measureCellElements(elements: unknown[], cellWidth: number): number {
            const elems = elements as TemplateElement[]
            let maxBottom = 0
            for (let i = 0; i < elems.length; i++) {
                const el = elems[i]!
                const bottom = el.y + el.height
                if (bottom > maxBottom) maxBottom = bottom
            }
            return maxBottom
        },
    })
    nodes.push(group)
    return group.height
}

function renderSubreportElementToCanvas(
    canvas: HTMLCanvasElement,
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    mathFontResource: FontResource | null,
    currentFile: EditorCurrentFile | null,
    rootTemplate: ReportTemplate,
    openReportTemplates: OpenReportTemplate[],
    zoom: number,
    dpr: number,
    onImagesReady?: () => void,
): boolean {
    if (element.templateExpression.trim() === '') return false

    // Render the referenced subreport with the SAME design-view appearance as its
    // own editor tab (expression sources for text fields, placeholders for
    // images/tables, etc.) rather than its evaluated output, so what is designed
    // in the subreport is what is shown inside the host. The subreport element's
    // box acts as a 1:1 viewport onto the subreport design (clipped to the box).
    const subreportTemplate = resolveSubreportEditorTemplate(element.templateExpression, currentFile, rootTemplate, openReportTemplates)
    if (subreportTemplate === null) return false

    const children: RenderNode[] = []
    let images: Record<string, string | Uint8Array> | undefined
    let bandY = 0
    for (let bi = 0; bi < subreportTemplate.bands.length; bi++) {
        const band = subreportTemplate.bands[bi]
        if (!band.enabled) continue
        for (let ei = 0; ei < band.elements.length; ei++) {
            const el = band.elements[ei]
            const built = buildRenderNodes(el, fontRegistry, defaultFontId, mathFonts, currentFile)
            children.push({
                type: 'group',
                x: el.x,
                y: bandY + el.y,
                width: el.width,
                height: built.renderHeight ?? el.height,
                clip: true,
                children: built.nodes,
            })
            images = mergeImages(images, built.images)
        }
        bandY += band.height
    }
    // Nothing to draw (empty subreport): let the [Subreport] placeholder show.
    if (children.length === 0) return false

    canvas.width = Math.ceil(element.width * zoom * dpr)
    canvas.height = Math.ceil(element.height * zoom * dpr)

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const page: RenderPage = { width: element.width, height: element.height, children }
    const backend = new CanvasBackend(ctx, {
        scale: zoom,
        devicePixelRatio: dpr,
        fonts: buildFontsMap(fontRegistry, mathFonts),
        background: null,
        images: images ?? {},
        onImagesReady,
    })
    backend.beginDocument()
    renderPage(page, backend)
    backend.endDocument()
    return true
}

// Resolves the subreport reference (a static string expression) to the editor
// template to render, matching by template name first, then by workspace path —
// the same matching the core subreport resolver uses.
function resolveSubreportEditorTemplate(
    templateExpression: string,
    currentFile: EditorCurrentFile | null,
    rootTemplate: ReportTemplate,
    availableTemplates: OpenReportTemplate[],
): ReportTemplate | null {
    const ref = staticStringFromExpression(templateExpression)
    if (ref === null) return null

    const byPath = new Map<string, ReportTemplate>()
    const byName = new Map<string, ReportTemplate>()
    if (currentFile !== null) {
        byPath.set(currentFile.path, rootTemplate)
        if (rootTemplate.name !== '') byName.set(rootTemplate.name, rootTemplate)
    }
    for (let i = 0; i < availableTemplates.length; i++) {
        const entry = availableTemplates[i]
        byPath.set(entry.path, entry.template)
        if (entry.template.name !== '') byName.set(entry.template.name, entry.template)
    }

    const named = byName.get(ref)
    if (named !== undefined) return named

    const resolvedPath = resolveEditorWorkspacePath(ref, currentFile)
    if (resolvedPath === null) return null
    return byPath.get(resolvedPath) ?? null
}

// Extracts the literal from a quoted static string expression (e.g. 'sub.report'
// or "sub.report"); returns null for dynamic expressions we cannot resolve at
// design time.
function staticStringFromExpression(expression: string): string | null {
    const t = expression.trim()
    if (t.length >= 2) {
        const first = t.charAt(0)
        const last = t.charAt(t.length - 1)
        if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
            return t.substring(1, t.length - 1)
        }
    }
    return null
}

type BuildResult = {
    nodes: RenderNode[]
    fitX: number
    fitWidth: number
    renderHeight?: number
    images?: Record<string, string | Uint8Array>
}

/**
 * Render a single element through core createReport and return its nodes.
 * Use this for elements that must exactly match the core layout path, such as styled or HTML markup.
 */
function buildCoreHostNodes(
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
    currentFile: EditorCurrentFile | null,
    resources?: ReportResources,
): { nodes: RenderNode[], images?: Record<string, string | Uint8Array> } | null {
    const hostTemplate = convertEditorTemplateToCore(createSubreportHostTemplate(element))
    const fontMap = buildFontMap(fontRegistry, null)
    const workingDirectory = currentFile !== null ? dirnamePosix(currentFile.path) : undefined
    const report = createReport(hostTemplate, { rows: [{}] }, { fontMap, workingDirectory, resources })
    if (report.pages.length === 0) return null
    return { nodes: report.pages[0].children, images: report.images }
}

function getRectangleCornerRadii(element: TemplateElement): RenderRect['cornerRadii'] | undefined {
    if (
        element.topLeftRadius === 0
        && element.topRightRadius === 0
        && element.bottomRightRadius === 0
        && element.bottomLeftRadius === 0
    ) {
        return undefined
    }
    return {
        topLeft: element.topLeftRadius,
        topRight: element.topRightRadius,
        bottomRight: element.bottomRightRadius,
        bottomLeft: element.bottomLeftRadius,
    }
}

// Build RenderNode[] for the element type.
// Exported for direct WYSIWYG parity regression tests.
export function buildRenderNodes(
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    currentFile: EditorCurrentFile | null,
    showFrameGuides = true,
): BuildResult {
    const nodes: RenderNode[] = []
    const { style } = element
    const w = element.width
    const h = element.height
    if (element.importedPdfRenderState !== null) {
        const coreResult = buildCoreHostNodes(element, fontRegistry, currentFile, {
            resolveImage: function resolveImage(ref: string): string | Uint8Array | null {
                return resolveEditorCanvasImage(ref, currentFile)
            },
        })
        if (coreResult === null) throw new Error('Imported PDF element produced no render page')
        return {
            nodes: coreResult.nodes,
            fitX: 0,
            fitWidth: w,
            renderHeight: h,
            images: coreResult.images,
        }
    }
    const isText = element.kind === 'staticText' || element.kind === 'textField'
    let fitX = 0
    let fitWidth = w
    let images: Record<string, string | Uint8Array> | undefined
    // Actual render height for elements whose internal height can vary, such as tables.
    let renderHeight = h
    // Height used for background/border decorations. Tables follow the actual
    // table height (matching the core decoration wrapper); other elements keep
    // the element height even when their content overflows (e.g. math).
    let decorationHeight = h
    // True when the element was rendered through core createReport including
    // its decorations (background/border/opacity), so the generic decoration
    // code below must not apply them a second time.
    let decoratedByCore = false

    // Background for opaque mode; text elements draw fitWidth-adjusted backgrounds in buildTextNodes.
    // Tables are handled later so the background can match the actual height.
    // Images draw decorations through the core path or in buildImageNodes.
    if (!isText && element.kind !== 'table' && element.kind !== 'image' && element.kind !== 'frame' && style.mode === 'opaque') {
        nodes.push(buildBackgroundRect(w, h, style.backcolor))
    }

    // Build render nodes per element type.
    switch (element.kind) {
        case 'staticText':
        case 'textField': {
            // Render staticText with styled/HTML markup, or any rotation, through
            // core createReport so it matches preview and PDF output exactly.
            // buildTextNodes has no rotation handling, so rotated plain text must
            // take this path too. textField is excluded because the design view
            // shows the expression source as-is.
            if (element.kind === 'staticText' && (element.markup !== 'none' || style.rotation !== 0)) {
                const coreResult = buildCoreHostNodes(element, fontRegistry, currentFile)
                if (coreResult !== null) {
                    for (let i = 0; i < coreResult.nodes.length; i++) nodes.push(coreResult.nodes[i]!)
                    images = mergeImages(images, coreResult.images)
                    break
                }
            }
            // Resolve the font for the element fontFamily and fall back to the default when unloaded.
            const resource = fontRegistry.get(style.fontFamily) ?? fontRegistry.get(defaultFontId)
            if (resource) {
                const textFit = buildTextNodes(nodes, element, resource.measurer, resource.fontId)
                if (textFit !== null) {
                    fitX = textFit.fitX
                    fitWidth = textFit.fitWidth
                }
            } else {
                // When the font is not loaded, draw only background and border.
                if (style.mode === 'opaque') {
                    nodes.push(buildBackgroundRect(w, h, style.backcolor))
                }
                pushBorderNodes(nodes, style.border, w, h)
            }
            break
        }
        case 'line':
            buildLineNodes(nodes, element)
            break
        case 'rectangle': {
            const rect: RenderRect = { type: 'rect', x: 0, y: 0, width: w, height: h, stroke: element.stroke, strokeWidth: element.strokeWidth }
            rect.fill = buildShapeRenderFill(element)
            const cornerRadii = getRectangleCornerRadii(element)
            if (cornerRadii !== undefined) {
                if (
                    cornerRadii.topLeft === cornerRadii.topRight
                    && cornerRadii.topLeft === cornerRadii.bottomRight
                    && cornerRadii.topLeft === cornerRadii.bottomLeft
                ) {
                    rect.radius = cornerRadii.topLeft
                } else {
                    rect.cornerRadii = cornerRadii
                }
            }
            nodes.push(rect)
            break
        }
        case 'ellipse': {
            const ell: RenderEllipse = { type: 'ellipse', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, stroke: element.stroke, strokeWidth: element.strokeWidth }
            ell.fill = buildShapeRenderFill(element)
            nodes.push(ell)
            break
        }
        case 'path': {
            const arrays = buildRenderPathArrays(element.pathSubpaths)
            const path: RenderPath = {
                type: 'path',
                commands: arrays.commands,
                coords: arrays.coords,
                fill: buildPathRenderFill(element),
                fillOpacity: element.pathFillOpacity,
                stroke: element.stroke,
                strokeWidth: element.strokeWidth,
                strokeOpacity: element.pathStrokeOpacity,
                strokeDasharray: element.pathStrokeDash.length > 0 ? element.pathStrokeDash : undefined,
                strokeLinecap: element.pathStrokeCap,
                strokeLinejoin: element.pathStrokeJoin,
            }
            nodes.push(path)
            break
        }
        case 'barcode':
            buildBarcodeNodes(nodes, element)
            break
        case 'formField': {
            const ft = element.formFieldType
            const valueBearing = ft === 'text' || ft === 'dropdown' || ft === 'listbox'
            const toggle = ft === 'checkbox' || ft === 'radio'
            const choice = ft === 'dropdown' || ft === 'listbox'
            nodes.push({
                type: 'formField',
                x: 0, y: 0, width: w, height: h,
                fieldType: ft,
                name: element.formFieldName,
                // Design view shows the value/caption source as-is (like textField)
                value: valueBearing && element.formFieldValue !== '' ? element.formFieldValue : undefined,
                checked: toggle ? element.formFieldChecked.trim() === 'true' : undefined,
                exportValue: toggle && element.formFieldExportValue !== '' ? element.formFieldExportValue : undefined,
                options: choice ? element.formFieldOptions.map((o) => ({ value: o.value, label: o.label !== '' ? o.label : o.value })) : undefined,
                editable: ft === 'dropdown' ? element.formFieldEditable : undefined,
                multiSelect: ft === 'listbox' ? element.formFieldMultiSelect : undefined,
                caption: ft === 'pushbutton' && element.formFieldCaption !== '' ? element.formFieldCaption : undefined,
                action: ft === 'pushbutton' && element.formFieldAction !== '' ? element.formFieldAction : undefined,
                fontId: style.fontFamily || defaultFontId,
                fontSize: style.fontSize,
                color: style.forecolor,
                multiline: ft === 'text' ? element.formFieldMultiline || undefined : undefined,
                borderColor: element.formFieldBorderColor !== '' ? element.formFieldBorderColor : undefined,
                backgroundColor: element.formFieldBackgroundColor !== '' ? element.formFieldBackgroundColor : undefined,
            })
            break
        }
        case 'math': {
            const expr = element.formula || element.expression
            const mFont = mathFonts[element.mathFontFamily]
            if (!expr || mFont === undefined) {
                buildPlaceholderNodes(nodes, w, h, expr ? '[Math]' : '[f(x)]', defaultFontId, style.forecolor)
            } else {
                const mathSize = buildMathNodes(nodes, element, mFont, element.mathFontFamily)
                // Match the core engine: a formula larger than the element box
                // expands the group instead of being clipped, so grow the canvas
                // area accordingly (decorations stay at the element size).
                if (mathSize !== null) {
                    if (mathSize.height > h) renderHeight = mathSize.height
                    if (mathSize.width > w) fitWidth = mathSize.width
                }
            }
            break
        }
        case 'image': {
            const imageResult = buildImageNodes(nodes, element, fontRegistry, currentFile, defaultFontId)
            images = mergeImages(images, imageResult.images)
            decoratedByCore = imageResult.handledByCore
            break
        }
        case 'svg':
            buildSvgNodes(nodes, element, defaultFontId, style.forecolor)
            break
        case 'frame': {
            const hasClipPath = element.frameClipPathD !== ''
            const coreResult = buildCoreHostNodes(element, fontRegistry, currentFile, {
                resolveImage: function resolveImage(ref: string): string | Uint8Array | null {
                    return resolveEditorCanvasImage(ref, currentFile)
                },
            })
            if (coreResult !== null) {
                for (let i = 0; i < coreResult.nodes.length; i++) nodes.push(coreResult.nodes[i]!)
                images = mergeImages(images, coreResult.images)
            }
            decoratedByCore = true
            // The guide belongs to the editor interaction surface, not to the
            // printable frame. Imported clipped frames never receive one.
            if (!hasClipPath && showFrameGuides) {
                nodes.push({ type: 'rect', x: 0, y: 0, width: w, height: h, stroke: '#999999', strokeWidth: 1 })
            }
            break
        }
        case 'table': {
            const tableHeight = buildTableNodes(nodes, element, fontRegistry, defaultFontId, mathFonts, currentFile)
            renderHeight = tableHeight
            decorationHeight = tableHeight
            if (style.mode === 'opaque') {
                nodes.unshift(buildBackgroundRect(w, renderHeight, style.backcolor))
            }
            break
        }
        case 'crosstab':
            buildCrosstabSchematicNodes(nodes, element, w, h, defaultFontId)
            break
        case 'subreport':
            buildPlaceholderNodes(nodes, w, h, '[Subreport]', defaultFontId, style.forecolor)
            break
        case 'break':
            nodes.push({ type: 'line', x1: 0, y1: h / 2, x2: w, y2: h / 2, lineWidth: 1, color: '#FF6600', dash: [4, 4] })
            break
    }

    // Border; text elements draw fitWidth-adjusted borders in buildTextNodes.
    if (!isText && !decoratedByCore) {
        pushBorderNodes(nodes, style.border, w, decorationHeight)
    }

    if (style.opacity < 1 && !decoratedByCore) {
        return {
            nodes: [{
                type: 'group',
                x: 0,
                y: 0,
                width: w,
                height: renderHeight,
                opacity: style.opacity,
                children: nodes,
            }],
            fitX,
            fitWidth,
            renderHeight: renderHeight !== h ? renderHeight : undefined,
            images,
        }
    }

    return { nodes, fitX, fitWidth, renderHeight: renderHeight !== h ? renderHeight : undefined, images }
}

function buildPathRenderFill(element: TemplateElement): RenderPath['fill'] {
    if (element.pathFillType === 'none') return undefined
    if (element.pathFillType === 'solid') return element.pathFillColor
    if (element.pathFillType === 'special') {
        if (element.pathComplexFill === null || element.pathComplexFill.type !== 'pdfSpecialColor') {
            throw new Error('パス要素のPDF特殊色定義がありません')
        }
        return element.pathComplexFill
    }
    if (element.pathFillType === 'mesh' || element.pathFillType === 'pattern') {
        throw new Error('PDF複合塗りはCore描画経路で処理する必要があります')
    }
    if (element.pathFillType === 'linear') {
        return {
            type: 'linear-gradient',
            x1: element.pathGradient.x1 * element.width,
            y1: element.pathGradient.y1 * element.height,
            x2: element.pathGradient.x2 * element.width,
            y2: element.pathGradient.y2 * element.height,
            stops: element.pathGradient.stops,
        }
    }
    return {
        type: 'radial-gradient',
        cx: element.pathGradient.cx * element.width,
        cy: element.pathGradient.cy * element.height,
        r: element.pathGradient.r * Math.max(element.width, element.height),
        fx: element.pathGradient.cx * element.width,
        fy: element.pathGradient.cy * element.height,
        fr: 0,
        stops: element.pathGradient.stops,
    }
}

function buildShapeRenderFill(element: TemplateElement): RenderRect['fill'] {
    if (element.shapeFillType === 'special') {
        if (element.shapeComplexFill === null) throw new Error('図形要素のPDF特殊色定義がありません')
        return element.shapeComplexFill
    }
    if (element.shapeFillType !== 'none' && element.shapeFillType !== 'solid' && element.shapeFillType !== 'linear' && element.shapeFillType !== 'radial') return element.fill || undefined
    if (element.shapeFillType === 'none') return undefined
    if (element.shapeFillType === 'solid') return element.shapeFillColor
    if (element.shapeFillType === 'linear') {
        return {
            type: 'linear-gradient',
            x1: element.shapeGradient.x1 * element.width,
            y1: element.shapeGradient.y1 * element.height,
            x2: element.shapeGradient.x2 * element.width,
            y2: element.shapeGradient.y2 * element.height,
            stops: element.shapeGradient.stops,
        }
    }
    return {
        type: 'radial-gradient',
        cx: element.shapeGradient.cx * element.width,
        cy: element.shapeGradient.cy * element.height,
        r: element.shapeGradient.r * Math.max(element.width, element.height),
        fx: element.shapeGradient.cx * element.width,
        fy: element.shapeGradient.cy * element.height,
        fr: 0,
        stops: element.shapeGradient.stops,
    }
}

// Render an image element through core createReport so scaleMode / alignment
// geometry (retainShape / clip / realSize / fillFrame) is computed by the same
// engine code path as the preview and the PDF output.
function buildImageNodes(
    nodes: RenderNode[],
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
    currentFile: EditorCurrentFile | null,
    defaultFontId: string,
): { images?: Record<string, string | Uint8Array>, handledByCore: boolean } {
    const sourceRef = resolveImageSourceRef(element)
    if (sourceRef !== null && resolveEditorCanvasImage(sourceRef, currentFile) !== null) {
        // Fix the design-time source on the host element: dynamic expressions
        // were already reduced to a static reference by resolveImageSourceRef.
        const hostElement: TemplateElement = { ...element, source: sourceRef, sourceExpression: '' }
        const coreResult = buildCoreHostNodes(hostElement, fontRegistry, currentFile, {
            resolveImage: function (ref: string): string | Uint8Array | null {
                return resolveEditorCanvasImage(ref, currentFile)
            },
        })
        if (coreResult !== null) {
            for (let i = 0; i < coreResult.nodes.length; i++) nodes.push(coreResult.nodes[i]!)
            return { images: coreResult.images, handledByCore: true }
        }
    }

    // The source cannot be determined at design time; draw the placeholder.
    const { style } = element
    if (style.mode === 'opaque') {
        nodes.push(buildBackgroundRect(element.width, element.height, style.backcolor))
    }
    buildPlaceholderNodes(nodes, element.width, element.height, '[Image]', defaultFontId, style.forecolor)
    return { handledByCore: false }
}

// Design-time SVG rendering: only a statically determinable string literal can
// be shown; dynamic expressions keep the placeholder like image elements do.
function buildSvgNodes(
    nodes: RenderNode[],
    element: TemplateElement,
    defaultFontId: string,
    color: string,
): void {
    const svgData = resolveSvgLiteral(element.svgContent)
    if (svgData === null) {
        buildPlaceholderNodes(nodes, element.width, element.height, '[SVG]', defaultFontId, color)
        return
    }
    nodes.push({
        type: 'svg',
        x: 0,
        y: 0,
        width: element.width,
        height: element.height,
        svgData,
    })
}

export function resolveSvgLiteral(svgContent: string): string | null {
    const expr = svgContent.trim()
    if (expr === '') return null
    const literal = extractQuotedLiteral(expr)
    if (literal === null) return null
    const svgData = unescapeExpressionStringLiteral(literal)
    // While the user is typing, the literal is often an incomplete SVG
    // document. Validate with the core parser and keep the placeholder until
    // the markup becomes renderable; the backends parse it with the same
    // parser at draw time.
    try {
        parseSvg(svgData)
    } catch {
        return null
    }
    return svgData
}

// Decode the escape sequences of the expression-language string literal
// (mirrors the core expression lexer's readEscapedCharacter).
function unescapeExpressionStringLiteral(value: string): string {
    if (value.indexOf('\\') === -1) return value
    let out = ''
    for (let i = 0; i < value.length; i++) {
        const ch = value[i]!
        if (ch !== '\\' || i + 1 >= value.length) {
            out += ch
            continue
        }
        i++
        const escaped = value[i]!
        switch (escaped) {
            case 'b': out += '\b'; break
            case 'f': out += '\f'; break
            case 'n': out += '\n'; break
            case 'r': out += '\r'; break
            case 't': out += '\t'; break
            case 'v': out += '\v'; break
            case '0': out += '\0'; break
            default: out += escaped
        }
    }
    return out
}

export function resolveImageSourceRef(element: TemplateElement): string | null {
    const source = element.source.trim()
    if (source !== '') return source

    const expr = element.sourceExpression.trim()
    if (expr === '') return null

    const literal = extractQuotedLiteral(expr)
    if (literal !== null) return literal

    // Expressions cannot be evaluated at design time, so accept only values that look like simple paths.
    if (expr.indexOf('$') !== -1 || expr.indexOf('{') !== -1 || expr.indexOf('}') !== -1) return null
    return expr
}

function extractQuotedLiteral(expr: string): string | null {
    if (expr.length < 2) return null
    const first = expr.charCodeAt(0)
    const last = expr.charCodeAt(expr.length - 1)
    if ((first === 0x22 && last === 0x22) || (first === 0x27 && last === 0x27)) {
        return expr.substring(1, expr.length - 1)
    }
    return null
}

function mergeImages(
    base: Record<string, string | Uint8Array> | undefined,
    extra: Record<string, string | Uint8Array> | undefined,
): Record<string, string | Uint8Array> | undefined {
    if (!extra) return base
    if (!base) {
        const copied: Record<string, string | Uint8Array> = {}
        const keys = Object.keys(extra)
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]!
            copied[key] = extra[key]!
        }
        return copied
    }
    const keys = Object.keys(extra)
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!
        base[key] = extra[key]!
    }
    return base
}

// Build render nodes for text elements.
// Build the text group with core renderTextToGroup, then add background and border.
// Match core renderElement by drawing decoration with the fitWidth-adjusted group size.
function buildTextNodes(
    nodes: RenderNode[],
    element: TemplateElement,
    measurer: TextMeasurer,
    fontId: string,
): FitResult | null {
    const { style } = element
    const text = element.kind === 'staticText' ? element.text : element.expression
    const w = element.width
    const h = element.height
    const contentWidth = w - style.padding.left - style.padding.right

    // No text or content area; draw only background and border with the original size.
    if (!text || contentWidth <= 0) {
        if (style.mode === 'opaque') {
            nodes.push(buildBackgroundRect(w, h, style.backcolor))
        }
        pushBorderNodes(nodes, style.border, w, h)
        return null
    }

    // Build text render nodes with core renderTextToGroup.
    const textStyle: TextContentStyle = {
        fontFamily: fontId,
        fontSize: style.fontSize,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikethrough: style.strikethrough,
        forecolor: style.forecolor,
        hAlign: style.hAlign === 'justified' ? 'justify' : style.hAlign,
        vAlign: style.vAlign,
        padding: style.padding,
        writingMode: element.writingMode,
        direction: element.direction,
    }

    const textNode = renderTextToGroup(text, {
        x: 0, y: 0, width: w, height: h,
        lineSpacing: {
            type: element.lineSpacingType,
            value: element.lineSpacingValue,
        },
        letterSpacing: element.letterSpacing,
        wordSpacing: element.wordSpacing,
        horizontalScale: element.horizontalScale,
        firstLineIndent: element.firstLineIndent,
        leftIndent: element.leftIndent,
        rightIndent: element.rightIndent,
        textTruncate: element.textTruncate,
        tabStopWidth: element.tabStopWidth,
        direction: element.direction,
        wrap: element.wrap,
        shrinkToFit: element.shrinkToFit,
        minFontSize: element.minFontSize,
        fitWidth: element.fitWidth,
        outlineText: element.pdfTextMode === 'outline' || element.outlineText,
        pdfFontMode: element.pdfTextMode === 'system' ? 'reference' : undefined,
    }, textStyle, measurer, false)

    if (textNode.type === 'group') {
        const group = textNode as RenderGroup
        // Extract fitX and reset the group x to local canvas coordinates.
        const fitX = group.x
        group.x = 0

        // Background inserted first, matching core renderElement.
        if (style.mode === 'opaque') {
            group.children.unshift(buildBackgroundRect(group.width, group.height, style.backcolor))
        }

        // Border appended last.
        pushBorderNodes(group.children, style.border, group.width, group.height)

        nodes.push(group)

        if (group.width < w) {
            return { fitX, fitWidth: group.width }
        }
    } else {
        // No measurer case returns a single text node; this normally does not happen in the editor.
        if (style.mode === 'opaque') {
            nodes.push(buildBackgroundRect(w, h, style.backcolor))
        }
        nodes.push(textNode)
        pushBorderNodes(nodes, style.border, w, h)
    }

    return null
}

// Build render nodes for line elements.
function buildLineNodes(nodes: RenderNode[], element: TemplateElement): void {
    // Lines are rendered diagonally from top-left to bottom-right.
    const line: RenderLine = {
        type: 'line',
        x1: 0, y1: 0,
        x2: element.width, y2: element.height,
        lineWidth: element.lineWidth,
        color: element.lineColor,
    }
    // Dash patterns come from the shared core builder (independent of line width).
    const dash = lineStyleDash(element.lineStyle)
    if (dash !== undefined) line.dash = dash
    nodes.push(line)
}

// Build render nodes for barcode elements.
function buildBarcodeNodes(nodes: RenderNode[], element: TemplateElement): void {
    const data = element.expression
    if (!data) return
    const node = renderBarcode(element.barcodeType, data, {
        x: 0, y: 0,
        width: element.width, height: element.height,
    })
    nodes.push(node)
}

// Build render nodes for math elements.
// Matches the core engine's math element rendering: when the formula's actual
// extent exceeds the element box, the group expands (no clipping) and the
// baseline stays vertically centered within the expanded group.
function buildMathNodes(
    nodes: RenderNode[],
    element: TemplateElement,
    font: Font,
    fontId: string,
): { width: number, height: number } | null {
    const expr = element.formula || element.expression
    if (!expr) return null

    const fontSize = element.mathFontSize || element.style.fontSize
    const color = element.mathColor || element.style.forecolor
    const ast = parseMathLaTeX(expr)
    const box = layoutMathFormula(ast, font, fontId, fontSize, color)

    // MathBox origin is the baseline; box.height is baseline to top and box.depth is baseline to bottom.
    // RenderText.y is converted to the text top by textTopY(),
    // so RenderText placed at the baseline uses the y < 0 area.
    const mathHeight = box.height + box.depth
    const groupHeight = Math.max(element.height, mathHeight)
    const groupWidth = Math.max(element.width, box.width)
    const baselineY = (groupHeight + box.height - box.depth) / 2

    const group: RenderGroup = {
        type: 'group',
        x: 0, y: 0,
        width: groupWidth, height: groupHeight,
        children: [{
            type: 'group' as const,
            x: 0, y: baselineY,
            width: box.width, height: mathHeight,
            children: box.nodes,
        }],
    }
    nodes.push(group)
    return { width: groupWidth, height: groupHeight }
}

// Draw a crosstab schematic grid reflecting row groups, column groups, measures, and dimensions.
function buildCrosstabSchematicNodes(
    nodes: RenderNode[],
    element: TemplateElement,
    w: number, h: number,
    fontId: string,
): void {
    const headerW = Math.min(element.rowHeaderWidth, w)
    const headerH = Math.min(element.columnHeaderHeight, h)
    const borderColor = element.crosstabBorderColor
    const borderWidth = element.crosstabBorderWidth

    // Outer border.
    nodes.push({ type: 'rect', x: 0, y: 0, width: w, height: h, stroke: borderColor, strokeWidth: borderWidth })
    // Corner divider lines.
    nodes.push({ type: 'line', x1: headerW, y1: 0, x2: headerW, y2: h, lineWidth: borderWidth, color: borderColor })
    nodes.push({ type: 'line', x1: 0, y1: headerH, x2: w, y2: headerH, lineWidth: borderWidth, color: borderColor })

    // Cell grid for the data area.
    for (let x = headerW + element.cellWidth; x < w; x += element.cellWidth) {
        nodes.push({ type: 'line', x1: x, y1: headerH, x2: x, y2: h, lineWidth: borderWidth * 0.5, color: borderColor, dash: [2, 2] })
    }
    for (let y = headerH + element.cellHeight; y < h; y += element.cellHeight) {
        nodes.push({ type: 'line', x1: headerW, y1: y, x2: w, y2: y, lineWidth: borderWidth * 0.5, color: borderColor, dash: [2, 2] })
    }

    // Labels for row groups, column groups, and measures.
    const rowFields = element.crosstabRowGroups.map(function (g) { return g.field }).filter(function (f) { return f !== '' }).join(', ')
    const colFields = element.crosstabColumnGroups.map(function (g) { return g.field }).filter(function (f) { return f !== '' }).join(', ')
    const measureFields = element.crosstabMeasures.map(function (m) { return m.calculation + '(' + m.field + ')' }).filter(function (f) { return f !== '()' }).join(', ')
    nodes.push({
        type: 'text', x: 2, y: headerH + 10, text: rowFields !== '' ? rowFields : '(行グループ)',
        fontId, fontSize: 7, color: '#666666', hAlign: 'left', width: headerW - 4,
    })
    nodes.push({
        type: 'text', x: headerW + 2, y: 10, text: colFields !== '' ? colFields : '(列グループ)',
        fontId, fontSize: 7, color: '#666666', hAlign: 'left', width: w - headerW - 4,
    })
    nodes.push({
        type: 'text', x: headerW + 2, y: headerH + 10, text: measureFields !== '' ? measureFields : '(メジャー)',
        fontId, fontSize: 7, color: '#999999', hAlign: 'left', width: w - headerW - 4,
    })
}

// Draw placeholders for image, svg, table, and subreport.
function buildPlaceholderNodes(
    nodes: RenderNode[],
    w: number, h: number,
    label: string,
    fontId: string,
    color: string,
): void {
    nodes.push({ type: 'rect', x: 0, y: 0, width: w, height: h, stroke: '#999999', strokeWidth: 1 })
    // Centered label text.
    nodes.push({
        type: 'text',
        x: 0, y: h / 2,
        text: label,
        fontId: fontId,
        fontSize: 8,
        color: '#999999',
        hAlign: 'center',
        width: w,
    })
}

// Build border render nodes through the shared core builder.
// The editor border model uses explicit per-side values (null = no line), so
// every side maps directly onto a BorderDef side with no default inheritance.
function pushBorderNodes(
    nodes: RenderNode[],
    border: TemplateElement['style']['border'],
    w: number, h: number,
): void {
    const borderDef: BorderDef = {
        top: border.top,
        bottom: border.bottom,
        left: border.left,
        right: border.right,
    }
    appendBorderNodes(nodes, w, h, borderDef)
}
