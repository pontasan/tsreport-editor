'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { buildSvgPathD, type Font, type PdfSourceVectorDef } from 'tsreport-core'
import { Action } from './action'
import { isModalDialogOpen } from './modal_state'
import styles from './canvas.module.css'
import {
    renderBandTileToCanvas, renderElementToCanvas, planBandCanvasTiles,
    computeTableRenderHeight, elementCanvasTransform, invertAffine, resolveImageSourceRef, transformPoint,
    type AffineMatrix, type BandCanvasTile, type FitResult,
} from './element_renderer'
import type { FontResource } from './font_loader'
import { getImageStoreVersion, subscribeImageStore } from './image_store'
import { resolveEditorImageRef, type EditorCurrentFile } from './resource_resolver'
import type { OpenReportTemplate } from './subreport_support'
import {
    buildTablePlacements,
    cloneTableColumn,
    cloneTableRow,
    computeTableColumnPositions,
    computeTableRowOffsets,
    createDefaultCanvasTableColumn,
    getTableCellContainerSize,
    getTableColumnCount,
    getTableColumns,
    getTableSectionRows,
    insertTableColumn,
    insertTableRow,
    removeTableColumn,
    removeTableRow,
    setTableColumns,
    setTableSectionRows,
    updateTableChildren,
} from './table_editor_model'
import {
    ActionType, Band, ElementKind, getBandColor, State, TemplateElement,
    createDefaultElement, createDefaultTableCellStyle, createDefaultTableRow,
    findElementInTree, findParentElement, getElementAbsolutePosition, type TableRow,
    type TableSelection, type TableSectionKey,
} from './reducer'
import {
    buildPathD,
    hitTestPath,
    normalizePathBounds,
    removeAnchor,
    splitSegmentAt,
    toggleAnchorSmooth,
    type PathAnchor,
    type PathSubpath,
} from './path_model'
import { UnitUtils } from '@/lib/common/utils/unit_utils'
import type { UiMessages } from '@/lib/common/i18n/ui_messages'
import { getLocalizedBandDisplayLabel } from './localized_editor_labels'

// Ratio of the major (bold) grid line spacing to the configured minor spacing.
const GRID_MAJOR_MULTIPLE = 10

// Bands with more elements than this are painted in a single canvas instead of
// one canvas per element, keeping large imported pages responsive.
const BATCH_RENDER_THRESHOLD = 60
const DRAG_ACTIVATION_DISTANCE_PX = 3
const ELEMENT_EDGE_PRIORITY_DISTANCE_PX = 6

export function partitionEnabledCanvasBands(bands: Band[]): { background: Band | null, flow: Band[] } {
    let background: Band | null = null
    const flow: Band[] = []
    for (let i = 0; i < bands.length; i++) {
        const band = bands[i]!
        if (!band.enabled) continue
        if (band.type === 'background') {
            background = band
        } else {
            flow.push(band)
        }
    }
    return { background, flow }
}

export function isBandOnlySelected(
    bandId: string,
    selectedBandId: string | null,
    selectedElementIds: readonly string[],
): boolean {
    return selectedBandId === bandId && selectedElementIds.length === 0
}

export function isPointInsideCanvasBand(
    clientX: number,
    clientY: number,
    left: number,
    top: number,
    width: number,
    height: number,
): boolean {
    return clientX >= left && clientX <= left + width
        && clientY >= top && clientY <= top + height
}

export function exceedsDragActivationDistance(startX: number, startY: number, currentX: number, currentY: number): boolean {
    return Math.hypot(currentX - startX, currentY - startY) >= DRAG_ACTIVATION_DISTANCE_PX
}

function countBandElements(elements: TemplateElement[]): number {
    let count = 0
    for (let i = 0; i < elements.length; i++) {
        count++
        if (elements[i]!.children.length > 0) count += countBandElements(elements[i]!.children)
    }
    return count
}

/**
 * Returns the minimal element branches that need DOM interaction layers in a
 * batch-rendered band. Pixels and point picking are handled by the band canvas;
 * only active editor branches and tables retain DOM wrappers.
 */
export function collectBatchInteractionElementIds(
    elements: TemplateElement[],
    activeIds: ReadonlySet<string>,
): Set<string> {
    const result = new Set<string>()
    collectBatchInteractionBranches(elements, activeIds, result)
    return result
}

function collectBatchInteractionBranches(
    elements: TemplateElement[],
    activeIds: ReadonlySet<string>,
    result: Set<string>,
): boolean {
    let hasRequiredElement = false
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        const childRequired = element.children.length > 0
            && collectBatchInteractionBranches(element.children, activeIds, result)
        if (activeIds.has(element.id) || element.kind === 'table' || childRequired) {
            result.add(element.id)
            hasRequiredElement = true
        }
    }
    return hasRequiredElement
}

export type ElementCanvasPlacement = {
    element: TemplateElement,
    transform: AffineMatrix,
}

/**
 * Resolves selected elements in the same band coordinate system used by the
 * renderer and hit tester. Imported PDF paths can carry their geometry far
 * outside their model box before an affine transform maps it onto the page,
 * so a DOM box based on x/y/width/height cannot represent their selection.
 */
export function collectSelectedElementCanvasPlacements(
    elements: TemplateElement[],
    selectedIds: ReadonlySet<string>,
    parentTransform: AffineMatrix = [1, 0, 0, 1, 0, 0],
    out: ElementCanvasPlacement[] = [],
): ElementCanvasPlacement[] {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        const transform = elementCanvasTransform(element, parentTransform)
        if (selectedIds.has(element.id)) out.push({ element, transform })
        if (element.children.length > 0) {
            collectSelectedElementCanvasPlacements(element.children, selectedIds, transform, out)
        }
    }
    return out
}

function usesTransformedPathSelection(element: TemplateElement): boolean {
    return element.kind === 'path'
        && element.importedPdfRenderState?.path?.affineTransform !== undefined
}

// Shared offscreen context for precise path point-in-shape testing.
let hitTestCtx: CanvasRenderingContext2D | null = null
const sourceVectorPathCache = new WeakMap<PdfSourceVectorDef, Path2D>()
function getHitTestContext(): CanvasRenderingContext2D {
    if (hitTestCtx === null) {
        hitTestCtx = document.createElement('canvas').getContext('2d')!
    }
    return hitTestCtx
}

function getSourceVectorPath(source: PdfSourceVectorDef): Path2D {
    const cached = sourceVectorPathCache.get(source)
    if (cached !== undefined) return cached
    let commandCount = 0
    let coordinateCount = 0
    for (let i = 0; i < source.instances.length; i++) {
        const definition = source.definitions[source.instances[i]!.definitionIndex]
        if (definition === undefined) throw new Error(`PDF source vector definition ${source.instances[i]!.definitionIndex} is missing`)
        commandCount += definition.commands.length
        coordinateCount += definition.coords.length
    }
    const commands = new Uint8Array(commandCount)
    const coords = new Float32Array(coordinateCount)
    let commandOffset = 0
    let coordinateOffset = 0
    for (let i = 0; i < source.instances.length; i++) {
        const instance = source.instances[i]!
        const definition = source.definitions[instance.definitionIndex]!
        commands.set(definition.commands, commandOffset)
        commandOffset += definition.commands.length
        const matrix = instance.matrix
        for (let c = 0; c < definition.coords.length; c += 2) {
            const x = definition.coords[c]!
            const y = definition.coords[c + 1]!
            coords[coordinateOffset++] = matrix[0] * x + matrix[2] * y + matrix[4]
            coords[coordinateOffset++] = matrix[1] * x + matrix[3] * y + matrix[5]
        }
    }
    const path = new Path2D(buildSvgPathD(commands, coords))
    sourceVectorPathCache.set(source, path)
    return path
}

// Collects elements at the point, in paint order (back to front). With
// mode 'stroke', only actual painted outlines are collected. With mode
// 'visible', paths and shapes are tested against their real fill / stroke
// geometry. With mode 'bbox', any element whose box contains the point is
// collected as a fallback. Frame children are collected on top of the frame.
function collectHitElements(
    elements: TemplateElement[], px: number, py: number, parentTransform: AffineMatrix,
    tolerance: number, mode: 'stroke' | 'visible' | 'bbox' | 'edge', out: TemplateElement[]
): void {
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]!
        if (el.style.opacity <= 0) continue
        const transform = elementCanvasTransform(el, parentTransform)
        const inverse = invertAffine(transform)
        if (inverse === null) continue
        const localPoint = transformPoint(inverse, px, py)
        const scaleX = Math.hypot(transform[0], transform[1])
        const scaleY = Math.hypot(transform[2], transform[3])
        const localTolerance = tolerance / Math.max(1e-6, Math.min(scaleX, scaleY))
        if (el.kind === 'frame') {
            // A clipping frame only paints inside its clip path; points outside
            // must not hit the (possibly page-sized) content it contains.
            if (el.frameClipPathD !== '' && !pointInFrameClip(el, localPoint.x, localPoint.y, localTolerance)) continue
            // Frames are structural containers and do not paint their bounding
            // rectangle. Keep them only in the bbox fallback, behind children.
            if (mode === 'bbox' && pointInBbox(el, localPoint.x, localPoint.y, localTolerance)) out.push(el)
            if (mode === 'edge' && pointNearBboxEdge(el, localPoint.x, localPoint.y, localTolerance)) out.push(el)
            if (el.children.length > 0) {
                collectHitElements(el.children, px, py, transform, tolerance, mode, out)
            }
            continue
        }
        if (mode === 'bbox') {
            if (pointInBbox(el, localPoint.x, localPoint.y, localTolerance)) out.push(el)
        } else if (mode === 'edge') {
            if (!usesTransformedPathSelection(el) && pointNearBboxEdge(el, localPoint.x, localPoint.y, localTolerance)) out.push(el)
        } else if (mode === 'stroke') {
            if (elementStrokeHitAt(el, localPoint.x, localPoint.y, localTolerance)) out.push(el)
        } else if (elementHitAt(el, localPoint.x, localPoint.y, localTolerance)) {
            out.push(el)
        }
    }
}

export function collectElementHitCandidates(
    elements: TemplateElement[], px: number, py: number, tolerance: number, mode: 'stroke' | 'visible' | 'bbox' | 'edge',
): TemplateElement[] {
    const result: TemplateElement[] = []
    collectHitElements(elements, px, py, [1, 0, 0, 1, 0, 0], tolerance, mode, result)
    return result
}

export function findTopmostElementEdgeHit(
    elements: TemplateElement[], px: number, py: number, tolerance: number,
): TemplateElement | null {
    const candidates = collectElementHitCandidates(elements, px, py, tolerance, 'edge')
    return candidates.length === 0 ? null : candidates[candidates.length - 1]!
}

export function buildElementHitStack(
    elements: TemplateElement[], px: number, py: number, tolerance: number,
): { elements: TemplateElement[], visibleCount: number } {
    const strokes = collectElementHitCandidates(elements, px, py, tolerance, 'stroke').reverse()
    const visible = collectElementHitCandidates(elements, px, py, tolerance, 'visible').reverse()
    const bbox = collectElementHitCandidates(elements, px, py, tolerance, 'bbox').reverse()
    const seen = new Set<string>()
    const painted: TemplateElement[] = []
    for (let i = 0; i < strokes.length; i++) {
        const element = strokes[i]!
        if (seen.has(element.id)) continue
        seen.add(element.id)
        painted.push(element)
    }
    for (let i = 0; i < visible.length; i++) {
        const element = visible[i]!
        if (seen.has(element.id)) continue
        seen.add(element.id)
        painted.push(element)
    }
    const result = painted.slice()
    for (let i = 0; i < bbox.length; i++) {
        const element = bbox[i]!
        if (seen.has(element.id)) continue
        seen.add(element.id)
        result.push(element)
    }
    return { elements: result, visibleCount: painted.length }
}

function pointInFrameClip(el: TemplateElement, lx: number, ly: number, tolerance: number): boolean {
    const ctx = getHitTestContext()
    const path = new Path2D(el.frameClipPathD)
    if (ctx.isPointInPath(path, lx, ly, el.frameClipPathRule)) return true
    // Treat the clip outline itself as inside so border clicks still work
    ctx.lineWidth = tolerance * 2
    return ctx.isPointInStroke(path, lx, ly)
}

function pointInBbox(el: TemplateElement, x: number, y: number, tolerance: number): boolean {
    return x >= -tolerance && x <= el.width + tolerance
        && y >= -tolerance && y <= el.height + tolerance
}

function pointNearBboxEdge(el: TemplateElement, x: number, y: number, tolerance: number): boolean {
    if (!pointInBbox(el, x, y, tolerance)) return false
    return Math.abs(x) <= tolerance
        || Math.abs(x - el.width) <= tolerance
        || Math.abs(y) <= tolerance
        || Math.abs(y - el.height) <= tolerance
}

// True when the element visibly paints at (px, py): inside its fill, or within
// tolerance of its outline/stroke. Fully invisible shapes (no fill, no stroke)
// return false so they never block what is behind them.
function elementHitAt(el: TemplateElement, x: number, y: number, tolerance: number): boolean {
    if (!pointInBbox(el, x, y, tolerance)) return false
    if (el.kind === 'path') {
        const hasFill = el.pathFillType !== 'none' && el.pathFillOpacity > 0
        const hasStroke = el.stroke !== '' && el.strokeWidth > 0 && el.pathStrokeOpacity > 0
        if (!hasFill && !hasStroke) return false
        const source = el.pdfSourceLocked ? el.importedPdfRenderState?.path?.pdfSourceVector : undefined
        if (source !== undefined) {
            const ctx = getHitTestContext()
            const path = getSourceVectorPath(source)
            const fillRule = el.importedPdfRenderState?.path?.fillRule ?? 'nonzero'
            if (hasFill && ctx.isPointInPath(path, x, y, fillRule)) return true
            if (hasFill) {
                ctx.lineWidth = tolerance * 2
                if (ctx.isPointInStroke(path, x, y)) return true
            }
            if (hasStroke) {
                ctx.lineWidth = el.strokeWidth + tolerance * 2
                return ctx.isPointInStroke(path, x, y)
            }
            return false
        }
        // Filled outline artwork needs the same screen-space edge tolerance as
        // stroked paths. Without it, clicks on antialiased glyph edges, counters,
        // or narrow gaps fall through to a broad background fill behind the
        // outlined text and require overlap cycling to reach the foreground.
        if (hasFill && hitTestPath(el.pathSubpaths, x, y, tolerance) !== null) return true
        if (!hasFill) return elementStrokeHitAt(el, x, y, tolerance)
        const ctx = getHitTestContext()
        const path = new Path2D(buildPathD(el.pathSubpaths))
        const fillRule = el.importedPdfRenderState?.path?.fillRule ?? 'nonzero'
        if (hasFill && ctx.isPointInPath(path, x, y, fillRule)) return true
        return hasStroke && elementStrokeHitAt(el, x, y, tolerance)
    }
    if (el.kind === 'rectangle') {
        const hasFill = el.shapeFillType !== 'none' || el.fill !== ''
        const hasStroke = el.stroke !== '' && el.strokeWidth > 0
        if (hasFill) return true
        if (!hasStroke) return false
        // Stroke-only rectangle: hit only near its border
        const inner = x >= tolerance && x <= el.width - tolerance
            && y >= tolerance && y <= el.height - tolerance
        return !inner
    }
    if (el.kind === 'ellipse') {
        const hasFill = el.shapeFillType !== 'none' || el.fill !== ''
        const hasStroke = el.stroke !== '' && el.strokeWidth > 0
        if (!hasFill && !hasStroke) return false
        const rx = el.width / 2
        const ry = el.height / 2
        if (rx <= 0 || ry <= 0) return false
        const nx = (x - rx) / rx
        const ny = (y - ry) / ry
        const d = nx * nx + ny * ny
        if (hasFill) return d <= 1
        // Stroke-only: hit only near the ellipse outline
        const inset = Math.min(1 - tolerance / rx, 1 - tolerance / ry)
        return d <= 1 && d >= inset * inset
    }
    if (el.kind === 'line') {
        // A line paints a thin segment across its box diagonal, not the whole box
        const ctx = getHitTestContext()
        const path = new Path2D('M0 0 L' + el.width + ' ' + el.height)
        ctx.lineWidth = Math.max(el.lineWidth, tolerance * 2)
        return ctx.isPointInStroke(path, x, y)
    }
    return true
}

function elementStrokeHitAt(el: TemplateElement, x: number, y: number, tolerance: number): boolean {
    if (!pointInBbox(el, x, y, tolerance)) return false
    if (el.kind === 'path') {
        if (el.stroke === '' || el.strokeWidth <= 0 || el.pathStrokeOpacity <= 0) return false
        const source = el.pdfSourceLocked ? el.importedPdfRenderState?.path?.pdfSourceVector : undefined
        if (source !== undefined) {
            const ctx = getHitTestContext()
            ctx.lineWidth = el.strokeWidth + tolerance * 2
            return ctx.isPointInStroke(getSourceVectorPath(source), x, y)
        }
        return hitTestPath(el.pathSubpaths, x, y, tolerance + el.strokeWidth / 2) !== null
    }
    if (el.kind === 'rectangle') {
        if (el.stroke === '' || el.strokeWidth <= 0) return false
        const edgeTolerance = tolerance + el.strokeWidth / 2
        const insideOuter = x >= -edgeTolerance && x <= el.width + edgeTolerance
            && y >= -edgeTolerance && y <= el.height + edgeTolerance
        const insideInner = x > edgeTolerance && x < el.width - edgeTolerance
            && y > edgeTolerance && y < el.height - edgeTolerance
        return insideOuter && !insideInner
    }
    if (el.kind === 'ellipse') {
        if (el.stroke === '' || el.strokeWidth <= 0) return false
        const rx = el.width / 2
        const ry = el.height / 2
        if (rx <= 0 || ry <= 0) return false
        const nx = (x - rx) / rx
        const ny = (y - ry) / ry
        const distance = nx * nx + ny * ny
        const edgeTolerance = tolerance + el.strokeWidth / 2
        const inset = Math.max(0, Math.min(1 - edgeTolerance / rx, 1 - edgeTolerance / ry))
        const outset = Math.max(1 + edgeTolerance / rx, 1 + edgeTolerance / ry)
        return distance >= inset * inset && distance <= outset * outset
    }
    if (el.kind === 'line') {
        const ctx = getHitTestContext()
        const path = new Path2D('M0 0 L' + el.width + ' ' + el.height)
        ctx.lineWidth = Math.max(el.lineWidth, tolerance * 2)
        return ctx.isPointInStroke(path, x, y)
    }
    return false
}

function sameIds(ids: string[], elements: TemplateElement[]): boolean {
    if (ids.length !== elements.length) return false
    for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== elements[i]!.id) return false
    }
    return true
}

type PenDraft = {
    bandId: string,
    parentId: string,
    anchors: PathAnchor[],
    pointer: { x: number, y: number } | null,
    closed: boolean
}

type Props = {
    state: State,
    dispatch: React.Dispatch<ActionType>,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    mathFontResource: FontResource | null,
    currentFile: EditorCurrentFile | null,
    openReportTemplates: OpenReportTemplate[],
    suspended: boolean,
    onPlaceSubreport: (elementId: string, bandId: string) => void,
    onOpenImageSlice: (elementId: string, bandId: string) => void,
    messages: UiMessages,
}

// Canvas rendering component inside an element
// useLayoutEffect updates the canvas before the browser paints, preventing a flash on resize
// Exported for the regression test that pins the canvas display mode
// (an inline canvas is baseline-aligned and shifts small elements downward).
export function ElementCanvas(props: {
    element: TemplateElement,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    mathFontResource: FontResource | null,
    currentFile: EditorCurrentFile | null,
    rootTemplate: State['template'],
    openReportTemplates: OpenReportTemplate[],
    zoom: number
}) {
    const ref = useRef<HTMLCanvasElement>(null)
    const { element, fontRegistry, defaultFontId, mathFonts, mathFontResource, currentFile, rootTemplate, openReportTemplates, zoom } = props

    // Redraw when image bytes finish loading so image geometry (scaleMode /
    // alignment) is laid out with the real image size.
    const imageStoreVersion = useSyncExternalStore(subscribeImageStore, getImageStoreVersion, getImageStoreVersion)

    // Redraw when the canvas backend finishes decoding raster images that were
    // still loading during the draw (e.g. data URI sources decoded via Image).
    const [imageDecodeTick, setImageDecodeTick] = useState(0)

    useLayoutEffect(() => {
        if (ref.current === null || fontRegistry.size === 0) return
        const handleImagesReady = function () {
            setImageDecodeTick(function (tick) { return tick + 1 })
        }
        const fitResult = renderElementToCanvas(ref.current, element, fontRegistry, defaultFontId, mathFonts, mathFontResource, currentFile, rootTemplate, openReportTemplates, zoom, handleImagesReady)
        // When fitWidth / renderHeight apply: adjust the canvas's CSS size and offset
        const c = ref.current
        if (fitResult !== null) {
            c.style.width = fitResult.fitWidth * zoom + 'px'
            c.style.marginLeft = fitResult.fitX * zoom + 'px'
            c.style.marginTop = (fitResult.fitY ?? 0) * zoom + 'px'
            if (fitResult.renderHeight !== undefined) {
                c.style.height = fitResult.renderHeight * zoom + 'px'
            } else {
                c.style.height = element.height * zoom + 'px'
            }
        } else {
            c.style.width = element.width * zoom + 'px'
            c.style.marginLeft = '0px'
            c.style.marginTop = '0px'
            c.style.height = element.height * zoom + 'px'
        }
    }, [element, fontRegistry, defaultFontId, mathFonts, mathFontResource, currentFile, rootTemplate, openReportTemplates, zoom, imageStoreVersion, imageDecodeTick])

    return (
        <canvas
            ref={ref}
            style={{
                // Block display: an inline canvas sits on the text baseline, which
                // pushes canvases shorter than the line-box ascent downward.
                display: 'block',
                width: element.width * zoom,
                height: element.height * zoom,
                pointerEvents: 'none',
            }}
        />
    )
}

// Batch-renders a whole band into one canvas. Used instead of per-element
// canvases when a band holds many elements (e.g. an imported PDF page), so the
// design view stays responsive and honors overlap order / frame clip paths.
export function BandCanvas(props: {
    band: Band,
    bandWidth: number,
    bandHeight: number,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    currentFile: EditorCurrentFile | null,
    zoom: number,
    frozen: boolean,
    suspended: boolean,
}) {
    const { band, bandWidth, bandHeight, fontRegistry, defaultFontId, mathFonts, currentFile, zoom, frozen, suspended } = props
    const dpr = globalThis.devicePixelRatio ?? 1
    const imageStoreVersion = useSyncExternalStore(subscribeImageStore, getImageStoreVersion, getImageStoreVersion)
    const tiles = planBandCanvasTiles(bandWidth, bandHeight, zoom, dpr, true)
    return (
        <>
            {tiles.map(function (tile) {
                return (
                    <BandCanvasTileView
                        key={tile.x + ':' + tile.y}
                        tile={tile}
                        band={band}
                        bandWidth={bandWidth}
                        fontRegistry={fontRegistry}
                        defaultFontId={defaultFontId}
                        mathFonts={mathFonts}
                        currentFile={currentFile}
                        zoom={zoom}
                        frozen={frozen}
                        suspended={suspended}
                        imageStoreVersion={imageStoreVersion}
                    />
                )
            })}
        </>
    )
}

function BandCanvasTileView(props: {
    tile: BandCanvasTile,
    band: Band,
    bandWidth: number,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFonts: Record<string, Font>,
    currentFile: EditorCurrentFile | null,
    zoom: number,
    frozen: boolean,
    suspended: boolean,
    imageStoreVersion: number,
}) {
    const ref = useRef<HTMLCanvasElement>(null)
    const viewportRef = useRef<HTMLDivElement>(null)
    const { tile, band, bandWidth, fontRegistry, defaultFontId, mathFonts, currentFile, zoom, frozen, suspended, imageStoreVersion } = props
    const [imageDecodeTick, setImageDecodeTick] = useState(0)
    const [visible, setVisible] = useState(false)
    // Inputs of the last paint; repainting a heavy band is expensive, so the
    // effect skips when nothing that affects pixels has changed (e.g. selection
    // clicks toggling the frozen flag).
    const lastPaintRef = useRef<{
        canvas: HTMLCanvasElement,
        band: Band, bandWidth: number, bandHeight: number, zoom: number, dpr: number,
        tileX: number, tileY: number, tileWidth: number, tileHeight: number,
        fontRegistry: Map<string, FontResource>, imageStoreVersion: number, imageDecodeTick: number
    } | null>(null)

    useEffect(function () {
        const element = viewportRef.current
        if (element === null) return
        const observer = new IntersectionObserver(function (entries) {
            if (entries[0]?.isIntersecting === true) {
                setVisible(true)
                observer.disconnect()
            }
        }, { rootMargin: '128px' })
        observer.observe(element)
        return function () { observer.disconnect() }
    }, [])

    useEffect(function () {
        // While an interaction is in progress, keep the last painted frame so a
        // heavy band is not repainted on every drag frame; it repaints once the
        // interaction ends (frozen flips back to false).
        if (!visible || ref.current === null || fontRegistry.size === 0 || frozen || suspended) return
        let disposed = false
        const timer = window.setTimeout(function paintBandTile() {
            if (disposed || ref.current === null) return
            const dpr = globalThis.devicePixelRatio ?? 1
            const last = lastPaintRef.current
            if (last !== null && last.canvas === ref.current
                && last.band === band && last.bandWidth === bandWidth && last.bandHeight === tile.height
                && last.tileX === tile.x && last.tileY === tile.y && last.tileWidth === tile.width && last.tileHeight === tile.height
                && last.zoom === zoom && last.dpr === dpr && last.fontRegistry === fontRegistry
                && last.imageStoreVersion === imageStoreVersion && last.imageDecodeTick === imageDecodeTick) {
                return
            }
            renderBandTileToCanvas(
                ref.current, band, tile.x, tile.y, tile.width, tile.height,
                fontRegistry, defaultFontId, mathFonts, currentFile, zoom, dpr,
                function () { setImageDecodeTick(function (tick) { return tick + 1 }) },
            )
            lastPaintRef.current = {
                canvas: ref.current,
                band, bandWidth, bandHeight: tile.height, tileX: tile.x, tileY: tile.y, tileWidth: tile.width, tileHeight: tile.height,
                zoom, dpr, fontRegistry, imageStoreVersion, imageDecodeTick,
            }
        }, 0)
        return function () {
            disposed = true
            window.clearTimeout(timer)
        }
    }, [tile, band, bandWidth, fontRegistry, defaultFontId, mathFonts, currentFile, zoom, imageStoreVersion, imageDecodeTick, frozen, suspended, visible])

    return (
        <div
            ref={viewportRef}
            style={{
                position: 'absolute',
                top: tile.y * zoom,
                left: tile.x * zoom,
                pointerEvents: 'none',
                width: tile.width * zoom,
                height: tile.height * zoom,
            }}
        >
            {visible && <canvas ref={ref} style={{ display: 'block', pointerEvents: 'none' }} />}
        </div>
    )
}

function CanvasTooltip(props: { label: string, anchorRect: DOMRect }) {
    const left = props.anchorRect.left + props.anchorRect.width / 2
    const top = props.anchorRect.bottom + 6
    return createPortal(
        <div className={styles.tooltip} style={{ left, top }}>{props.label}</div>,
        document.body
    )
}

export default function Canvas(props: Props) {
    const ui = props.messages
    const { state, dispatch, fontRegistry, defaultFontId, mathFonts, mathFontResource, currentFile, openReportTemplates, onPlaceSubreport, onOpenImageSlice } = props
    const { template, zoom, selectedElementIds, selectedBandId, activeTool, editingElementId, isGridEnabled, gridSizePt } = state
    const { pageSettings, bands } = template
    const canvasBands = useMemo(function () { return partitionEnabledCanvasBands(bands) }, [bands])
    const backgroundBandSelected = canvasBands.background !== null
        && isBandOnlySelected(canvasBands.background.id, selectedBandId, selectedElementIds)
    const backgroundElementSelected = canvasBands.background !== null
        && selectedBandId === canvasBands.background.id
        && selectedElementIds.length > 0
    const canvasRef = useRef<HTMLDivElement>(null)
    const stateRef = useRef(state)
    stateRef.current = state
    const [btnHover, setBtnHover] = useState<{ label: string, rect: DOMRect } | null>(null)
    const [backgroundEdgeHover, setBackgroundEdgeHover] = useState(false)

    useEffect(function () {
        if (activeTool !== 'select' || editingElementId !== null || canvasBands.background === null) {
            setBackgroundEdgeHover(false)
        }
    }, [activeTool, editingElementId, canvasBands.background])

    // Snaps a pt value to the user-configured grid spacing. gridSizePt is kept
    // strictly positive by the reducer, so this never divides by zero.
    function snapToGrid(value: number): number {
        return Math.round(value / gridSizePt) * gridSizePt
    }

    function tip(label: string) {
        return {
            onMouseEnter: function (e: React.MouseEvent) {
                setBtnHover({ label, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
            },
            onMouseLeave: function () { setBtnHover(null) },
        }
    }

    // Set of selected IDs (rendering optimization)
    const selectedSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds])

    // Non-render data for the creation drag (referenced during mousemove/mouseup)
    const creationDragRef = useRef<{
        tool: ElementKind,
        bandId: string,
        parentId: string,
        startPtX: number,
        startPtY: number,
        containerRect: DOMRect,
        containerWidth: number,
        containerHeight: number
    } | null>(null)

    // State for rendering the preview rectangle
    const [creationDrag, setCreationDrag] = useState<{
        bandId: string,
        parentId: string,
        x: number, y: number, width: number, height: number
    } | null>(null)

    const [penDraft, setPenDraft] = useState<PenDraft | null>(null)
    const penDraftRef = useRef<PenDraft | null>(null)

    // State for rendering the marquee selection
    const [marquee, setMarquee] = useState<{
        bandId: string,
        x: number, y: number, width: number, height: number
    } | null>(null)

    // While an element is being dragged or resized, batch-rendered bands freeze
    // their canvas (repainting hundreds of elements per frame is too slow); the
    // moving elements are shown live through their own per-element canvas.
    const [isInteracting, setIsInteracting] = useState(false)

    // Remembers the last hit-test pick so repeated clicks at the same spot cycle
    // through overlapping elements.
    const pickCycleRef = useRef<{ x: number, y: number, ids: string[], index: number, time: number } | null>(null)
    // Fallback pick for a plain click on space where nothing is visibly painted;
    // the marquee mouseup applies it when the gesture turns out to be a click.
    const bboxFallbackPickRef = useRef<{ element: TemplateElement, bandId: string } | null>(null)

    // Non-render data for the marquee selection
    const marqueeRef = useRef<{
        bandId: string,
        startPtX: number,
        startPtY: number,
        containerRect: DOMRect
    } | null>(null)

    // Global marquee (multi-select that can start outside the paper)
    const bandsContainerRef = useRef<HTMLDivElement>(null)
    const [globalMarquee, setGlobalMarquee] = useState<{
        x: number, y: number, width: number, height: number
    } | null>(null)
    const globalMarqueeStartRef = useRef<{
        startX: number, startY: number, containerRect: DOMRect, bandsRect: DOMRect
    } | null>(null)

    const tableSelection = state.tableSelection
    const pathEditing = state.pathEditing

    useEffect(function () {
        if (activeTool === 'path') return
        if (penDraftRef.current !== null) setCurrentPenDraft(null)
    }, [activeTool])

    useEffect(function () {
        function handleKeyDown(e: KeyboardEvent) {
            if (penDraftRef.current === null || isModalDialogOpen()) return
            if (e.key === 'Enter') {
                e.preventDefault()
                finishPenDraft()
            } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelPenDraft()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return function () { document.removeEventListener('keydown', handleKeyDown) }
    }, [])

    useEffect(function () {
        function handleKeyDown(e: KeyboardEvent) {
            const editing = stateRef.current.pathEditing
            if (editing === null || isModalDialogOpen()) return
            const tag = (document.activeElement as HTMLElement | null)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

            if (e.key === 'Escape') {
                e.preventDefault()
                Action.setPathEdit(dispatch, null)
                return
            }
            if (e.key !== 'Delete' && e.key !== 'Backspace') return
            e.preventDefault()
            if (editing.anchor === null) return

            const band = stateRef.current.template.bands.find(function (entry) { return entry.id === editing.bandId })
            if (band === undefined) return
            const element = findElementInTree(band.elements, editing.elementId)
            if (element === undefined || element.kind !== 'path') return

            const next = removeAnchor(element.pathSubpaths, editing.anchor.subpathIndex, editing.anchor.anchorIndex)
            if (next.length === 0) {
                Action.deleteElement(dispatch, element.id, editing.bandId)
                return
            }

            updatePathElementGeometry(element, editing.bandId, next)
            Action.commitHistory(dispatch)
            const nextSubpath = next[Math.min(editing.anchor.subpathIndex, next.length - 1)]
            const nextAnchorIndex = nextSubpath === undefined ? 0 : Math.min(editing.anchor.anchorIndex, nextSubpath.anchors.length - 1)
            Action.setPathEdit(dispatch, {
                elementId: element.id,
                bandId: editing.bandId,
                anchor: { subpathIndex: Math.min(editing.anchor.subpathIndex, next.length - 1), anchorIndex: nextAnchorIndex, handle: 'point' },
            })
        }
        document.addEventListener('keydown', handleKeyDown)
        return function () { document.removeEventListener('keydown', handleKeyDown) }
    }, [dispatch])

    // Click suppression flag (ignores the following click event after an element is created on mouseup)
    const skipNextClickRef = useRef(false)

    // Printable area width
    const printableWidth = pageSettings.width - pageSettings.marginLeft - pageSettings.marginRight

    // Printable area height
    const printableHeight = pageSettings.height - pageSettings.marginTop - pageSettings.marginBottom

    const selectedTableElement = useMemo(function () {
        if (selectedElementIds.length !== 1 || selectedBandId === null) return null
        const band = bands.find(function (entry) { return entry.id === selectedBandId })
        if (band === undefined) return null
        const element = findElementInTree(band.elements, selectedElementIds[0])
        if (element === undefined || element.kind !== 'table') return null
        return element
    }, [bands, selectedBandId, selectedElementIds])

    useEffect(function () {
        if (selectedTableElement === null) return
    }, [selectedTableElement?.id])

    // Cache of the source image's natural aspect ratio: sourceRef → { w, h }
    const imageNaturalSizeRef = useRef<Map<string, { w: number, h: number }>>(new Map())
    // Track image sources currently loading (prevents duplicate requests)
    const imageLoadingRef = useRef<Set<string>>(new Set())

    /** Get the source image's natural aspect ratio (only if already cached) */
    function getImageNaturalAspect(element: TemplateElement): number | undefined {
        const ref = resolveImageSourceRef(element)
        if (ref === null) return undefined
        const ns = imageNaturalSizeRef.current.get(ref)
        if (ns === undefined) return undefined
        return ns.w / ns.h
    }

    /** Resize an image element with lockAspectRatio ON, using the source image's aspect ratio */
    function applyNaturalAspectRatio(elementId: string, bandId: string, curW: number, curH: number, curX: number, curY: number, naturalW: number, naturalH: number) {
        const aspect = naturalW / naturalH
        let newW: number, newH: number
        if (curW >= curH) {
            newW = curW
            newH = Math.round(newW / aspect)
        } else {
            newH = curH
            newW = Math.round(newH * aspect)
        }
        if (newW !== curW || newH !== curH) {
            Action.resizeElement(dispatch, elementId, bandId, curX, curY, newW, newH)
        }
    }

    /** Load and cache the image's natural size. On load, auto-adjust if lockAspectRatio is ON */
    function ensureImageNaturalSize(element: TemplateElement, bandId: string) {
        const ref = resolveImageSourceRef(element)
        if (ref === null) return
        const sizeMap = imageNaturalSizeRef.current
        if (sizeMap.has(ref)) return
        if (imageLoadingRef.current.has(ref)) return
        const resolved = resolveEditorImageRef(ref, currentFile)
        if (resolved === null) return
        imageLoadingRef.current.add(ref)
        const img = new Image()
        const elId = element.id
        const elBand = bandId
        img.onload = function () {
            imageLoadingRef.current.delete(ref)
            const nw = img.naturalWidth || img.width
            const nh = img.naturalHeight || img.height
            if (nw <= 0 || nh <= 0) return
            sizeMap.set(ref, { w: nw, h: nh })
            // On image load complete: auto-adjust if lockAspectRatio is ON
            const band = state.template.bands.find(b => b.id === elBand)
            if (band === undefined) return
            const el = findElementInTree(band.elements, elId)
            if (el !== undefined && el.lockAspectRatio) {
                applyNaturalAspectRatio(elId, elBand, el.width, el.height, el.x, el.y, nw, nh)
            }
        }
        img.src = resolved
    }

    // Load the natural size of the selected image element
    useEffect(function () {
        if (selectedBandId === null) return
        for (let i = 0; i < selectedElementIds.length; i++) {
            const band = bands.find(b => b.id === selectedBandId)
            if (band === undefined) continue
            const el = findElementInTree(band.elements, selectedElementIds[i])
            if (el !== undefined && el.kind === 'image') {
                ensureImageNaturalSize(el, selectedBandId)
                // lockAspectRatio ON + already cached → apply immediately (handles toggling ON)
                if (el.lockAspectRatio) {
                    const ref = resolveImageSourceRef(el)
                    if (ref !== null) {
                        const ns = imageNaturalSizeRef.current.get(ref)
                        if (ns !== undefined) {
                            applyNaturalAspectRatio(el.id, selectedBandId, el.width, el.height, el.x, el.y, ns.w, ns.h)
                        }
                    }
                }
            }
        }
    }, [selectedElementIds, selectedBandId, bands])

    // Get the default size
    function getDefaultSize(tool: ElementKind, containerWidth: number): { w: number, h: number } {
        switch (tool) {
            case 'line':
                return { w: 150, h: 1 }
            case 'break':
                return { w: containerWidth, h: 1 }
            case 'barcode':
                return { w: 100, h: 50 }
            case 'table': case 'crosstab': case 'subreport': case 'frame':
                return { w: 200, h: 100 }
            case 'image': case 'svg': case 'path':
                return { w: 100, h: 100 }
            default:
                return { w: 100, h: 20 }
        }
    }

    // Start of element-creation drag
    function handleCreationMouseDown(
        tool: ElementKind, bandId: string, parentId: string,
        containerWidth: number, containerHeight: number, e: React.MouseEvent
    ) {
        e.stopPropagation()
        e.preventDefault()

        const containerRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const startPtX = (e.clientX - containerRect.left) / zoom
        const startPtY = (e.clientY - containerRect.top) / zoom

        creationDragRef.current = {
            tool, bandId, parentId,
            startPtX, startPtY,
            containerRect, containerWidth, containerHeight
        }
        setCreationDrag({ bandId, parentId, x: 0, y: 0, width: 0, height: 0 })

        function handleMouseMove(moveEvent: MouseEvent) {
            const drag = creationDragRef.current
            if (drag === null) return

            const currentPtX = (moveEvent.clientX - drag.containerRect.left) / zoom
            const currentPtY = (moveEvent.clientY - drag.containerRect.top) / zoom

            // Normalize based on the top-left corner
            const rawX = Math.min(drag.startPtX, currentPtX)
            const rawY = Math.min(drag.startPtY, currentPtY)
            const rawW = Math.abs(currentPtX - drag.startPtX)
            const rawH = Math.abs(currentPtY - drag.startPtY)

            // Clamp within the container (supports grid snapping)
            const snap = isGridEnabled ? snapToGrid : Math.round
            const x = Math.max(0, snap(rawX))
            const y = Math.max(0, snap(rawY))
            const w = snap(Math.min(rawW, drag.containerWidth - x))
            const h = snap(Math.min(rawH, drag.containerHeight - y))

            setCreationDrag({ bandId: drag.bandId, parentId: drag.parentId, x, y, width: w, height: h })
        }

        function handleMouseUp(upEvent: MouseEvent) {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            const drag = creationDragRef.current
            creationDragRef.current = null
            setCreationDrag(null)

            if (drag === null) return

            const currentPtX = (upEvent.clientX - drag.containerRect.left) / zoom
            const currentPtY = (upEvent.clientY - drag.containerRect.top) / zoom
            const dragDistX = Math.abs(currentPtX - drag.startPtX)
            const dragDistY = Math.abs(currentPtY - drag.startPtY)

            let x: number, y: number, w: number, h: number

            const snap = isGridEnabled ? snapToGrid : Math.round

            if (dragDistX < 5 && dragDistY < 5) {
                // Treat as a click → use the default size
                const def = getDefaultSize(drag.tool, drag.containerWidth)
                w = def.w
                h = def.h
                x = Math.max(0, Math.min(snap(drag.startPtX), drag.containerWidth - w))
                y = Math.max(0, Math.min(snap(drag.startPtY), drag.containerHeight - h))
            } else {
                // Treat as a drag → use the size determined by the drag
                const rawX = Math.min(drag.startPtX, currentPtX)
                const rawY = Math.min(drag.startPtY, currentPtY)
                x = Math.max(0, snap(rawX))
                y = Math.max(0, snap(rawY))
                w = Math.max(1, snap(Math.min(Math.abs(currentPtX - drag.startPtX), drag.containerWidth - x)))
                h = Math.max(1, snap(Math.min(Math.abs(currentPtY - drag.startPtY), drag.containerHeight - y)))
            }

            // addElement/addElementToParent assign the id `el_${elementIdCounter}`.
            const newElementId = 'el_' + state.elementIdCounter
            if (drag.parentId === '') {
                Action.addElement(dispatch, drag.bandId, drag.tool, x, y, w, h, state.elementIdCounter)
            } else {
                Action.addElementToParent(dispatch, drag.bandId, drag.parentId, drag.tool, x, y, w, h, state.elementIdCounter)
            }

            // A subreport auto-creates its own report file in the host report's
            // folder; the async orchestration (server-assigned unique name +
            // wiring the reference) lives in the parent so its errors surface.
            if (drag.tool === 'subreport') {
                onPlaceSubreport(newElementId, drag.bandId)
            }

            skipNextClickRef.current = true
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function setCurrentPenDraft(draft: PenDraft | null): void {
        penDraftRef.current = draft
        setPenDraft(draft)
    }

    function createPenAnchor(x: number, y: number): PathAnchor {
        return { x, y, inX: x, inY: y, outX: x, outY: y, handleMode: 'independent' }
    }

    function pointerToLocalPoint(e: { clientX: number, clientY: number }, containerRect: DOMRect, containerWidth: number, containerHeight: number): { x: number, y: number } {
        const snap = isGridEnabled ? snapToGrid : Math.round
        const x = Math.max(0, Math.min(snap((e.clientX - containerRect.left) / zoom), containerWidth))
        const y = Math.max(0, Math.min(snap((e.clientY - containerRect.top) / zoom), containerHeight))
        return { x, y }
    }

    function isNearPoint(a: { x: number, y: number }, b: { x: number, y: number }, tolerance: number): boolean {
        return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance
    }

    function finishPenDraft(forceClosed?: boolean, fromClick?: boolean): void {
        const draft = penDraftRef.current
        if (draft === null) return
        setCurrentPenDraft(null)
        if (draft.anchors.length < 2) return

        const sourceSubpaths: PathSubpath[] = [{ anchors: draft.anchors, closed: forceClosed === true || draft.closed }]
        const normalized = normalizePathBounds(sourceSubpaths)
        const elementIdCounter = stateRef.current.elementIdCounter
        const element = createDefaultElement(
            'el_' + elementIdCounter,
            'path',
            normalized.bounds.x,
            normalized.bounds.y,
            Math.max(1, normalized.bounds.width),
            Math.max(1, normalized.bounds.height),
        )
        element.pathSubpaths = normalized.subpaths
        if (draft.parentId === '') {
            dispatch({ type: 'ADD_ELEMENT', payload: { bandId: draft.bandId, element } })
        } else {
            dispatch({ type: 'ADD_ELEMENT_TO_PARENT', payload: { bandId: draft.bandId, parentId: draft.parentId, element } })
        }
        if (fromClick === true) skipNextClickRef.current = true
    }

    function cancelPenDraft(fromClick?: boolean): void {
        setCurrentPenDraft(null)
        if (fromClick === true) skipNextClickRef.current = true
    }

    function handlePenMouseDown(
        bandId: string,
        parentId: string,
        containerWidth: number,
        containerHeight: number,
        e: React.MouseEvent
    ): void {
        e.stopPropagation()
        e.preventDefault()

        if (e.detail > 1) {
            finishPenDraft(false, true)
            return
        }

        const containerRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const start = pointerToLocalPoint(e, containerRect, containerWidth, containerHeight)
        const currentDraft = penDraftRef.current
        if (currentDraft !== null && (currentDraft.bandId !== bandId || currentDraft.parentId !== parentId)) return

        if (currentDraft !== null && currentDraft.anchors.length >= 2 && isNearPoint(start, currentDraft.anchors[0]!, 6 / zoom)) {
            setCurrentPenDraft({ ...currentDraft, closed: true, pointer: null })
            finishPenDraft(true, true)
            return
        }

        const baseDraft: PenDraft = currentDraft ?? { bandId, parentId, anchors: [], pointer: null, closed: false }
        const anchorIndex = baseDraft.anchors.length
        const anchors = baseDraft.anchors.concat([createPenAnchor(start.x, start.y)])
        setCurrentPenDraft({ ...baseDraft, anchors, pointer: null })

        function handleMouseMove(moveEvent: MouseEvent) {
            const draft = penDraftRef.current
            if (draft === null) return
            const point = pointerToLocalPoint(moveEvent, containerRect, containerWidth, containerHeight)
            const dx = point.x - start.x
            const dy = point.y - start.y
            const nextAnchors = draft.anchors.slice()
            if (Math.hypot(dx, dy) > 1 / zoom) {
                nextAnchors[anchorIndex] = {
                    x: start.x,
                    y: start.y,
                    inX: start.x - dx,
                    inY: start.y - dy,
                    outX: point.x,
                    outY: point.y,
                    handleMode: 'symmetric',
                }
            }
            setCurrentPenDraft({ ...draft, anchors: nextAnchors, pointer: point })
        }

        function handleMouseUp(upEvent: MouseEvent) {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            const draft = penDraftRef.current
            if (draft === null) return
            const point = pointerToLocalPoint(upEvent, containerRect, containerWidth, containerHeight)
            setCurrentPenDraft({ ...draft, pointer: point })
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function handlePenPointerMove(
        bandId: string,
        parentId: string,
        containerWidth: number,
        containerHeight: number,
        e: React.MouseEvent
    ): void {
        const draft = penDraftRef.current
        if (activeTool !== 'path' || draft === null) return
        if (draft.bandId !== bandId || draft.parentId !== parentId) return
        const containerRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const point = pointerToLocalPoint(e, containerRect, containerWidth, containerHeight)
        setCurrentPenDraft({ ...draft, pointer: point })
    }

    // Start marquee selection (dragging an empty band area in select mode)
    function handleMarqueeMouseDown(bandId: string, e: React.MouseEvent) {
        e.stopPropagation()
        e.preventDefault()

        const containerRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const startPtX = (e.clientX - containerRect.left) / zoom
        const startPtY = (e.clientY - containerRect.top) / zoom

        marqueeRef.current = { bandId, startPtX, startPtY, containerRect }
        setMarquee({ bandId, x: startPtX, y: startPtY, width: 0, height: 0 })

        function handleMouseMove(moveEvent: MouseEvent) {
            const m = marqueeRef.current
            if (m === null) return
            const curX = (moveEvent.clientX - m.containerRect.left) / zoom
            const curY = (moveEvent.clientY - m.containerRect.top) / zoom
            const x = Math.min(m.startPtX, curX)
            const y = Math.min(m.startPtY, curY)
            const w = Math.abs(curX - m.startPtX)
            const h = Math.abs(curY - m.startPtY)
            setMarquee({ bandId: m.bandId, x, y, width: w, height: h })
        }

        function handleMouseUp(upEvent: MouseEvent) {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            const m = marqueeRef.current
            marqueeRef.current = null
            setMarquee(null)
            if (m === null) return

            const curX = (upEvent.clientX - m.containerRect.left) / zoom
            const curY = (upEvent.clientY - m.containerRect.top) / zoom
            const mx = Math.min(m.startPtX, curX)
            const my = Math.min(m.startPtY, curY)
            const mw = Math.abs(curX - m.startPtX)
            const mh = Math.abs(curY - m.startPtY)

            // Treat a small drag distance as a click
            if (mw < 3 && mh < 3) {
                const fallback = bboxFallbackPickRef.current
                bboxFallbackPickRef.current = null
                if (fallback !== null) {
                    // Nothing visibly painted, but a box was under the cursor:
                    // select it instead of deselecting to the band
                    skipNextClickRef.current = true
                    Action.selectElement(dispatch, fallback.element.id, fallback.bandId)
                }
                // Otherwise don't set skipNextClickRef, so the following click
                // fires handleBandClick -> selectBand (deselecting elements)
                return
            }
            bboxFallbackPickRef.current = null

            // Rectangle intersection test against the absolute coordinates of all elements in the band
            const band = bands.find(b => b.id === m.bandId)
            if (band === undefined) return
            const intersecting: string[] = []
            collectIntersecting(band.elements, 0, 0, mx, my, mw, mh, intersecting)

            if (intersecting.length > 0) {
                Action.selectElements(dispatch, intersecting, m.bandId)
            }
            skipNextClickRef.current = true
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // Band mousedown handler
    function handleBandMouseDown(bandId: string, e: React.MouseEvent, forcePointPicking: boolean = false) {
        // Return early during inline editing so blur fires naturally
        if (editingElementId !== null) return
        const band = bands.find(b => b.id === bandId)
        if (band === undefined) return
        if (activeTool === 'select') {
            // In batch-rendered bands element wrappers are click-through, so the
            // band resolves selection by hit-testing the point. Overlapping
            // elements are cycled through on repeated clicks at the same spot.
            if (forcePointPicking || countBandElements(band.elements) > BATCH_RENDER_THRESHOLD) {
                const point = bandPointFromEvent(e)
                if (point !== null) {
                    const picked = pickElementAt(band.elements, point.x, point.y)
                    if (picked !== null && picked.visibleHit) {
                        // The wrapper is click-through, so the click after this
                        // mousedown reaches the band. Suppress it so the band's
                        // onClick does not reselect the band and clear this pick.
                        skipNextClickRef.current = true
                        handleElementMouseDown(picked.element, bandId, e)
                        return
                    }
                    // Nothing visibly painted here: a drag becomes a marquee,
                    // a plain click selects the front-most box under the cursor
                    bboxFallbackPickRef.current = picked !== null ? { element: picked.element, bandId } : null
                }
            }
            // Empty space: start marquee selection
            handleMarqueeMouseDown(bandId, e)
            return
        }
        if (activeTool === 'path') {
            handlePenMouseDown(bandId, '', printableWidth, band.height, e)
            return
        }
        handleCreationMouseDown(activeTool, bandId, '', printableWidth, band.height, e)
    }

    // Converts a mouse event on the band content into band-local pt coordinates.
    function bandPointFromEvent(e: React.MouseEvent): { x: number, y: number } | null {
        const rect = e.currentTarget.getBoundingClientRect()
        return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
    }

    // Picks the element to select at a point, cycling through overlapping
    // elements on repeated clicks. Painted outlines are preferred over filled
    // surfaces, followed by other visible artwork and finally bbox fallback.
    // Nearby repeated clicks advance to the element behind.
    // When advance is false the pick does not move the overlap cycle forward
    // (used by double-click, which fires after two mousedowns already advanced it).
    function pickElementAt(elements: TemplateElement[], px: number, py: number, advance: boolean = true): { element: TemplateElement, visibleHit: boolean } | null {
        // Click tolerance in pt: at least ~4px on screen so thin lines are easy to hit
        const tolerance = 4 / zoom
        const stack = buildElementHitStack(elements, px, py, tolerance)
        const hits = stack.elements
        if (hits.length === 0) return null
        const cycle = pickCycleRef.current
        const now = performance.now()
        const sameStack = cycle !== null
            && Math.hypot(cycle.x - px, cycle.y - py) * zoom < 5
            && sameIds(cycle.ids, hits)
        // Only a deliberate re-click (past the double-click window) advances the
        // cycle; the two rapid mousedowns of a double-click keep the same pick.
        const isReclick = sameStack && now - cycle!.time > 350
        let index = sameStack ? cycle!.index : 0
        if (advance && isReclick) {
            index = (cycle!.index + 1) % hits.length
        }
        pickCycleRef.current = { x: px, y: py, ids: hits.map(function (h) { return h.id }), index, time: now }
        return { element: hits[index]!, visibleHit: index < stack.visibleCount }
    }

    // Band double-click: in batch bands (click-through wrappers) resolve the
    // element under the cursor and start editing it, mirroring the per-element
    // double-click behavior.
    function handleBandDoubleClick(bandId: string, e: React.MouseEvent, forcePointPicking: boolean = false) {
        if (activeTool !== 'select') return
        const band = bands.find(b => b.id === bandId)
        if (band === undefined || (!forcePointPicking && countBandElements(band.elements) <= BATCH_RENDER_THRESHOLD)) return
        const point = bandPointFromEvent(e)
        if (point === null) return
        // Do not advance the cycle: the two mousedowns of this double-click
        // already resolved to the intended (front) element
        const picked = pickElementAt(band.elements, point.x, point.y, false)
        if (picked === null) return
        handleElementDoubleClick(picked.element, bandId, e)
    }

    // Band click handler
    function handleBandClick(bandId: string, e: React.MouseEvent) {
        e.stopPropagation()
        if (skipNextClickRef.current) { skipNextClickRef.current = false; return }
        if (activeTool !== 'select') return
        Action.selectBand(dispatch, bandId)
    }

    // Element click handler
    function handleElementClick(element: TemplateElement, bandId: string, e: React.MouseEvent) {
        if (skipNextClickRef.current) { skipNextClickRef.current = false; e.stopPropagation(); return }
        if (activeTool !== 'select') return
        e.stopPropagation()
        if (e.shiftKey) {
            Action.toggleElementSelection(dispatch, element.id, bandId)
        } else {
            Action.selectElement(dispatch, element.id, bandId)
        }
    }

    // Element double-click handler (inline editing)
    function handleElementDoubleClick(element: TemplateElement, bandId: string, e: React.MouseEvent) {
        if (activeTool !== 'select') return
        if (element.kind === 'image' && element.source !== '') {
            // Double-clicking a placed image opens the slice tool for it
            e.stopPropagation()
            e.preventDefault()
            Action.selectElement(dispatch, element.id, bandId)
            onOpenImageSlice(element.id, bandId)
            return
        }
        if (element.kind === 'path') {
            e.stopPropagation()
            e.preventDefault()
            Action.selectElement(dispatch, element.id, bandId)
            Action.setPathEdit(dispatch, { elementId: element.id, bandId, anchor: null })
            return
        }
        if (element.kind !== 'staticText' && element.kind !== 'textField') return
        e.stopPropagation()
        e.preventDefault()
        Action.startEditing(dispatch, element.id)
    }

    // Parent-child relationship filter: exclude selected elements that are descendants of another selected element
    function filterDescendants(elementIds: string[], bandElements: TemplateElement[]): string[] {
        const idSet = new Set(elementIds)
        const result: string[] = []
        for (let i = 0; i < elementIds.length; i++) {
            const parent = findParentElement(bandElements, elementIds[i])
            let isDescendantOfSelected = false
            let cur = parent
            while (cur !== undefined) {
                if (idSet.has(cur.id)) { isDescendantOfSelected = true; break }
                cur = findParentElement(bandElements, cur.id)
            }
            if (!isDescendantOfSelected) result.push(elementIds[i])
        }
        return result
    }

    // Start of element drag
    function handleElementMouseDown(element: TemplateElement, bandId: string, e: React.MouseEvent) {
        if (activeTool !== 'select') {
            if (element.kind === 'frame') {
                if (activeTool === 'path') {
                    handlePenMouseDown(bandId, element.id, element.width, element.height, e)
                    return
                }
                handleCreationMouseDown(activeTool, bandId, element.id, element.width, element.height, e)
            }
            return
        }
        // Return early during inline editing so blur fires naturally
        if (editingElementId !== null) return
        e.stopPropagation()
        e.preventDefault()

        const band = bands.find(b => b.id === bandId)
        if (band === undefined) return
        const bandRef = band
        const bandHeight = band.height
        const startX = e.clientX
        const startY = e.clientY

        // When multiple elements are selected and the clicked element is among them → move multiple elements
        const isMultiDrag = selectedElementIds.length > 1 && selectedSet.has(element.id)

        if (isMultiDrag) {
            // Move multiple elements
            const movedIds = filterDescendants(selectedElementIds, band.elements)
            const origPositions: Array<{ elementId: string, absX: number, absY: number, parentAbsX: number, parentAbsY: number }> = []
            for (let i = 0; i < movedIds.length; i++) {
                const absPos = getElementAbsolutePosition(band.elements, movedIds[i])
                if (absPos === undefined) continue
                const parent = findParentElement(band.elements, movedIds[i])
                const parentAbs = parent !== undefined ? getElementAbsolutePosition(band.elements, parent.id)! : { x: 0, y: 0 }
                origPositions.push({ elementId: movedIds[i], absX: absPos.x, absY: absPos.y, parentAbsX: parentAbs.x, parentAbsY: parentAbs.y })
            }

            let dragStarted = false
            function handleMouseMove(moveEvent: MouseEvent) {
                if (!exceedsDragActivationDistance(startX, startY, moveEvent.clientX, moveEvent.clientY)) return
                dragStarted = true
                const dx = (moveEvent.clientX - startX) / zoom
                const dy = (moveEvent.clientY - startY) / zoom
                const deltas: Array<{ elementId: string, bandId: string, x: number, y: number }> = []
                for (let i = 0; i < origPositions.length; i++) {
                    const p = origPositions[i]
                    const el = findElementInTree(bandRef.elements, p.elementId)
                    if (el === undefined) continue
                    const rawX = p.absX + dx
                    const rawY = p.absY + dy
                    const newAbsX = Math.max(0, Math.min(isGridEnabled ? snapToGrid(rawX) : Math.round(rawX), printableWidth - el.width))
                    const newAbsY = Math.max(0, Math.min(isGridEnabled ? snapToGrid(rawY) : Math.round(rawY), bandHeight - el.height))
                    deltas.push({ elementId: p.elementId, bandId, x: newAbsX - p.parentAbsX, y: newAbsY - p.parentAbsY })
                }
                setIsInteracting(true)
                Action.moveElements(dispatch, deltas)
            }

            function handleMouseUp() {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
                setIsInteracting(false)
                if (dragStarted) Action.commitHistory(dispatch)
            }

            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            return
        }

        // Shift toggles selection. In batch bands the click that used to do
        // this is suppressed, so it must happen here on mousedown; there is no
        // drag for a toggle, so bail out afterwards.
        if (e.shiftKey) {
            Action.toggleElementSelection(dispatch, element.id, bandId)
            return
        }
        // Clicking an element already in a multi-selection keeps the selection
        // (so the group can be dragged); otherwise select just this element.
        if (!selectedSet.has(element.id)) {
            Action.selectElement(dispatch, element.id, bandId)
        }

        // Single-element drag
        const absPos = getElementAbsolutePosition(band.elements, element.id)
        if (absPos === undefined) return
        const origAbsX = absPos.x
        const origAbsY = absPos.y
        let lastAbsX = origAbsX
        let lastAbsY = origAbsY
        let dragStarted = false

        const parentAtStart = findParentElement(band.elements, element.id)
        const parentAbsAtStart = parentAtStart !== undefined
            ? getElementAbsolutePosition(band.elements, parentAtStart.id)!
            : { x: 0, y: 0 }

        // Determine the parent element's container size (children are constrained within the parent's bounds)
        let constraintWidth = printableWidth
        let constraintHeight = bandHeight
        if (parentAtStart !== undefined) {
            if (parentAtStart.kind === 'tableColumn' || parentAtStart.kind === 'tableCell') {
                const cellSize = getTableCellContainerSize(band.elements, parentAtStart)
                if (cellSize !== undefined) {
                    constraintWidth = cellSize.width
                    constraintHeight = cellSize.height
                }
            } else {
                constraintWidth = parentAtStart.width
                constraintHeight = parentAtStart.height
            }
        }

        function handleMouseMove(moveEvent: MouseEvent) {
            if (!exceedsDragActivationDistance(startX, startY, moveEvent.clientX, moveEvent.clientY)) return
            dragStarted = true
            setIsInteracting(true)
            const dx = (moveEvent.clientX - startX) / zoom
            const dy = (moveEvent.clientY - startY) / zoom
            if (parentAtStart !== undefined) {
                // Child element: constrained within the parent's bounds (relative-coordinate based)
                const rawRelX = element.x + dx
                const rawRelY = element.y + dy
                const snapFn = isGridEnabled ? snapToGrid : Math.round
                const relX = Math.max(0, Math.min(snapFn(rawRelX), constraintWidth - element.width))
                const relY = Math.max(0, Math.min(snapFn(rawRelY), constraintHeight - element.height))
                lastAbsX = parentAbsAtStart.x + relX
                lastAbsY = parentAbsAtStart.y + relY
                Action.moveElement(dispatch, element.id, bandId, relX, relY)
            } else {
                // Top-level element: constrained within the band's bounds
                const rawX = origAbsX + dx
                const rawY = origAbsY + dy
                lastAbsX = Math.max(0, Math.min(isGridEnabled ? snapToGrid(rawX) : Math.round(rawX), constraintWidth - element.width))
                lastAbsY = Math.max(0, Math.min(isGridEnabled ? snapToGrid(rawY) : Math.round(rawY), constraintHeight - element.height))
                Action.moveElement(dispatch, element.id, bandId,
                    lastAbsX - parentAbsAtStart.x, lastAbsY - parentAbsAtStart.y)
            }
        }

        function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            setIsInteracting(false)
            if (dragStarted) Action.commitHistory(dispatch)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }


    // Band height resize (dragging the separator)
    function handleSeparatorMouseDown(bandId: string, currentHeight: number, e: React.MouseEvent) {
        // Return early during inline editing so blur fires naturally
        if (editingElementId !== null) return
        e.stopPropagation()
        e.preventDefault()

        const startY = e.clientY
        const origHeight = currentHeight

        function handleMouseMove(moveEvent: MouseEvent) {
            const dy = (moveEvent.clientY - startY) / zoom
            const raw = origHeight + dy
            const newHeight = Math.max(0, isGridEnabled ? snapToGrid(raw) : Math.round(raw))
            Action.updateBandHeight(dispatch, bandId, newHeight)
        }

        function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            Action.commitHistory(dispatch)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // Direction definitions for resize handles
    type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

    const RESIZE_CURSORS: Record<ResizeDirection, string> = {
        n: 'ns-resize', s: 'ns-resize',
        e: 'ew-resize', w: 'ew-resize',
        ne: 'nesw-resize', sw: 'nesw-resize',
        nw: 'nwse-resize', se: 'nwse-resize'
    }

    // Start of element resize
    function handleResizeMouseDown(
        element: TemplateElement, bandId: string, direction: ResizeDirection, e: React.MouseEvent
    ) {
        // Return early during inline editing so blur fires naturally
        if (editingElementId !== null) return
        e.stopPropagation()
        e.preventDefault()

        const band = bands.find(b => b.id === bandId)
        if (band === undefined) return

        // Get the parent element and determine the container size
        const parent = findParentElement(band.elements, element.id)
        let containerWidth = parent !== undefined ? parent.width : printableWidth
        let containerHeight = parent !== undefined ? parent.height : band.height
        // Child element inside a table cell: use the cell's content area size
        if (parent !== undefined && (parent.kind === 'tableColumn' || parent.kind === 'tableCell')) {
            const cellSize = getTableCellContainerSize(band.elements, parent)
            if (cellSize !== undefined) {
                containerWidth = cellSize.width
                containerHeight = cellSize.height
            }
        }

        const startX = e.clientX
        const startY = e.clientY
        const origX = element.x
        const origY = element.y
        const origW = element.width
        const origH = element.height

        // Container elements like frames: use the bounding area of their children as the minimum size
        let minW = 1
        let minH = 1
        if (element.children.length > 0) {
            for (let i = 0; i < element.children.length; i++) {
                const c = element.children[i]
                const right = c.x + c.width
                const bottom = c.y + c.height
                if (right > minW) minW = right
                if (bottom > minH) minH = bottom
            }
        }

        function handleMouseMove(moveEvent: MouseEvent) {
            const dx = (moveEvent.clientX - startX) / zoom
            const dy = (moveEvent.clientY - startY) / zoom
            const snap = isGridEnabled ? snapToGrid : Math.round

            let newX = origX
            let newY = origY
            let newW = origW
            let newH = origH

            // Horizontal direction
            if (direction === 'w' || direction === 'nw' || direction === 'sw') {
                newX = Math.max(0, snap(origX + dx))
                newW = Math.max(minW, origW - (newX - origX))
                // If constrained by the minimum width, back-calculate x
                if (newW === minW) newX = origX + origW - minW
            }
            if (direction === 'e' || direction === 'ne' || direction === 'se') {
                // Snap the moving right edge to a grid line (like the west/north
                // handles snap their edge), not the width, so the edge lands on
                // the grid even when the opposite edge is off-grid.
                newW = Math.max(minW, snap(newX + origW + dx) - newX)
                if (newX + newW > containerWidth) newW = containerWidth - newX
            }

            // Vertical direction
            if (direction === 'n' || direction === 'nw' || direction === 'ne') {
                newY = Math.max(0, snap(origY + dy))
                newH = Math.max(minH, origH - (newY - origY))
                if (newH === minH) newY = origY + origH - minH
            }
            if (direction === 's' || direction === 'sw' || direction === 'se') {
                // Snap the moving bottom edge to a grid line (not the height).
                newH = Math.max(minH, snap(newY + origH + dy) - newY)
                if (newY + newH > containerHeight) newH = containerHeight - newY
            }

            // Maintain aspect ratio (image elements use the source image's aspect ratio)
            const naturalAspect = element.kind === 'image' ? getImageNaturalAspect(element) : undefined
            const aspect = naturalAspect ?? (origW > 0 && origH > 0 ? origW / origH : 0)
            if (element.lockAspectRatio && aspect > 0) {
                const isCorner = direction === 'nw' || direction === 'ne' || direction === 'sw' || direction === 'se'
                const isHorizontalOnly = direction === 'w' || direction === 'e'
                const isVerticalOnly = direction === 'n' || direction === 's'
                if (isCorner || isHorizontalOnly) {
                    newH = snap(newW / aspect)
                    if (newH < 1) newH = 1
                    if (direction === 'nw' || direction === 'ne') {
                        newY = origY + origH - newH
                        if (newY < 0) { newY = 0; newH = origY + origH; newW = snap(newH * aspect) }
                    }
                    if (newY + newH > containerHeight) { newH = containerHeight - newY; newW = snap(newH * aspect) }
                } else if (isVerticalOnly) {
                    newW = snap(newH * aspect)
                    if (newW < 1) newW = 1
                    if (newX + newW > containerWidth) { newW = containerWidth - newX; newH = snap(newW / aspect) }
                }
            }

            setIsInteracting(true)
            Action.resizeElement(dispatch, element.id, bandId, newX, newY, newW, newH)
        }

        function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            setIsInteracting(false)
            Action.commitHistory(dispatch)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // Render resize handles
    function renderResizeHandles(element: TemplateElement, bandId: string) {
        const w = element.width * zoom
        const h = (element.kind === 'table' ? computeTableRenderHeight(element, fontRegistry) : element.height) * zoom
        const s = 8 // Handle size
        const half = s / 2

        const handles: { dir: ResizeDirection, left: number, top: number }[] = [
            { dir: 'nw', left: -half,        top: -half },
            { dir: 'n',  left: w / 2 - half, top: -half },
            { dir: 'ne', left: w - half,      top: -half },
            { dir: 'w',  left: -half,        top: h / 2 - half },
            { dir: 'e',  left: w - half,      top: h / 2 - half },
            { dir: 'sw', left: -half,        top: h - half },
            { dir: 's',  left: w / 2 - half, top: h - half },
            { dir: 'se', left: w - half,      top: h - half }
        ]

        return handles.map(h => (
            <div
                key={h.dir}
                className={styles.resizeHandle}
                style={{
                    left: h.left,
                    top: h.top,
                    cursor: RESIZE_CURSORS[h.dir],
                    // Re-enable interaction even when the wrapper is click-through
                    pointerEvents: 'auto'
                }}
                onMouseDown={(e) => handleResizeMouseDown(element, bandId, h.dir, e)}
            />
        ))
    }

    // Render the inline editor
    function renderInlineEditor(element: TemplateElement) {
        const value = element.kind === 'staticText' ? element.text : element.expression
        return (
            <textarea
                className={styles.inlineEditor}
                defaultValue={value}
                autoFocus
                style={{
                    fontFamily: element.style.fontFamily,
                    fontSize: element.style.fontSize * zoom,
                    color: element.style.forecolor,
                    fontWeight: element.style.bold ? 'bold' : 'normal',
                    fontStyle: element.style.italic ? 'italic' : 'normal',
                    textAlign: element.style.hAlign === 'justified' ? 'justify' : element.style.hAlign,
                }}
                onBlur={(e) => Action.stopEditing(dispatch, e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        // Cancel: commit the original text.
                        Action.stopEditing(dispatch, value)
                        e.preventDefault()
                    }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            />
        )
    }

    // Foreground bands and elements stop propagation before this fallback.
    // Therefore the background is selected only when nothing above it handled
    // the click, preserving its lowest selection priority.
    function handleCanvasClick(e: React.MouseEvent) {
        if (skipNextClickRef.current) { skipNextClickRef.current = false; return }
        const background = canvasBands.background
        const bandsElement = bandsContainerRef.current
        if (activeTool === 'select' && background !== null && bandsElement !== null) {
            const rect = bandsElement.getBoundingClientRect()
            if (isPointInsideCanvasBand(
                e.clientX,
                e.clientY,
                rect.left,
                rect.top,
                printableWidth * zoom,
                background.height * zoom,
            )) {
                Action.selectBand(dispatch, background.id)
                return
            }
        }
        Action.deselectAll(dispatch)
    }

    function handleBackgroundPriorityMouseDown(e: React.MouseEvent) {
        if (activeTool !== 'select' || editingElementId !== null) return
        if ((e.target as HTMLElement).closest('[data-background-element-interaction]') !== null) return
        const background = canvasBands.background
        const bandsElement = bandsContainerRef.current
        if (background === null || bandsElement === null) return
        const rect = bandsElement.getBoundingClientRect()
        const x = (e.clientX - rect.left) / zoom
        const y = (e.clientY - rect.top) / zoom
        if (x < 0 || x > printableWidth || y < 0 || y > background.height) return
        const element = findTopmostElementEdgeHit(
            background.elements,
            x,
            y,
            ELEMENT_EDGE_PRIORITY_DISTANCE_PX / zoom,
        )
        if (element === null) return
        skipNextClickRef.current = true
        handleElementMouseDown(element, background.id, e)
    }

    function handleBackgroundPriorityMouseMove(e: React.MouseEvent) {
        if (activeTool !== 'select' || editingElementId !== null
            || (e.target as HTMLElement).closest('[data-background-element-interaction]') !== null) {
            setBackgroundEdgeHover(false)
            return
        }
        const background = canvasBands.background
        const bandsElement = bandsContainerRef.current
        if (background === null || bandsElement === null) {
            setBackgroundEdgeHover(false)
            return
        }
        const rect = bandsElement.getBoundingClientRect()
        const x = (e.clientX - rect.left) / zoom
        const y = (e.clientY - rect.top) / zoom
        const element = x >= 0 && x <= printableWidth && y >= 0 && y <= background.height
            ? findTopmostElementEdgeHit(background.elements, x, y, ELEMENT_EDGE_PRIORITY_DISTANCE_PX / zoom)
            : null
        setBackgroundEdgeHover(element !== null)
    }

    // Band boundary height in px: 3px height plus 1px border-bottom.
    const BAND_SEPARATOR_PX = 4

    // Start global marquee selection from paper exterior or margins.
    function handleCanvasMouseDown(e: React.MouseEvent) {
        if (activeTool !== 'select') return
        // Return early during inline editing so blur fires naturally.
        if (editingElementId !== null) return
        // Band and element propagation is stopped, so only empty areas reach this handler.
        e.preventDefault()

        const container = canvasRef.current
        const bandsEl = bandsContainerRef.current
        if (!container || !bandsEl) return

        const containerRect = container.getBoundingClientRect()
        const bandsRect = bandsEl.getBoundingClientRect()
        const startX = e.clientX - containerRect.left + container.scrollLeft
        const startY = e.clientY - containerRect.top + container.scrollTop

        globalMarqueeStartRef.current = { startX, startY, containerRect, bandsRect }
        setGlobalMarquee({ x: startX, y: startY, width: 0, height: 0 })

        function handleMouseMove(moveEvent: MouseEvent) {
            const g = globalMarqueeStartRef.current
            if (!g) return
            const curX = moveEvent.clientX - g.containerRect.left + container!.scrollLeft
            const curY = moveEvent.clientY - g.containerRect.top + container!.scrollTop
            setGlobalMarquee({
                x: Math.min(g.startX, curX),
                y: Math.min(g.startY, curY),
                width: Math.abs(curX - g.startX),
                height: Math.abs(curY - g.startY),
            })
        }

        function handleMouseUp(upEvent: MouseEvent) {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            const g = globalMarqueeStartRef.current
            globalMarqueeStartRef.current = null
            setGlobalMarquee(null)
            if (!g) return

            const curX = upEvent.clientX - g.containerRect.left + container!.scrollLeft
            const curY = upEvent.clientY - g.containerRect.top + container!.scrollTop
            const w = Math.abs(curX - g.startX)
            const h = Math.abs(curY - g.startY)
            if (w < 3 && h < 3) return // Equivalent to a click; delegate to the click handler.

            // Convert canvasContainer coordinates to bandsContainer point coordinates.
            const bandsOffsetX = g.bandsRect.left - g.containerRect.left + container!.scrollLeft
            const bandsOffsetY = g.bandsRect.top - g.containerRect.top + container!.scrollTop
            const mx = (Math.min(g.startX, curX) - bandsOffsetX) / zoom
            const my = (Math.min(g.startY, curY) - bandsOffsetY) / zoom
            const mw = w / zoom
            const mh = h / zoom

            // Background is fixed behind the flow and never contributes to the
            // vertical band offset. It participates only while explicitly being
            // edited, so it cannot steal selection from foreground bands.
            let bandTopY = 0
            const results: { bandId: string, ids: string[] }[] = []
            const marqueeBands = backgroundBandSelected && canvasBands.background !== null
                ? [canvasBands.background]
                : canvasBands.flow
            for (let bi = 0; bi < marqueeBands.length; bi++) {
                const band = marqueeBands[bi]!
                const bandBottomY = bandTopY + band.height
                // Check whether the marquee intersects this band.
                if (my < bandBottomY && my + mh > bandTopY) {
                    const ids: string[] = []
                    collectIntersecting(band.elements, 0, 0, mx, my - bandTopY, mw, mh, ids)
                    if (ids.length > 0) results.push({ bandId: band.id, ids })
                }
                if (!backgroundBandSelected) bandTopY = bandBottomY + BAND_SEPARATOR_PX / zoom
            }

            // Select the band with the most intersecting elements.
            if (results.length > 0) {
                let best = results[0]
                for (let i = 1; i < results.length; i++) {
                    if (results[i].ids.length > best.ids.length) best = results[i]
                }
                Action.selectElements(dispatch, best.ids, best.bandId)
            }
            skipNextClickRef.current = true
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // Recursively test element intersection.
    function collectIntersecting(
        elements: TemplateElement[], offsetX: number, offsetY: number,
        mx: number, my: number, mw: number, mh: number,
        result: string[],
    ): void {
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i]
            const ax = offsetX + el.x
            const ay = offsetY + el.y
            if (ax < mx + mw && ax + el.width > mx && ay < my + mh && ay + el.height > my) {
                result.push(el.id)
            }
            if (el.children.length > 0) {
                collectIntersecting(el.children, ax, ay, mx, my, mw, mh, result)
            }
        }
    }

    function computeSectionHeight(rows: TableRow[]): number {
        let total = 0
        for (let i = 0; i < rows.length; i++) total += rows[i]!.height
        return total
    }

    function computeSectionTop(element: TemplateElement, section: TableSectionKey): number {
        if (section === 'header') return 0
        if (section === 'detail') return computeSectionHeight(getTableSectionRows(element, 'header'))
        return computeSectionHeight(getTableSectionRows(element, 'header')) + computeSectionHeight(getTableSectionRows(element, 'detail'))
    }

    function computeTableHeightForSectionRows(element: TemplateElement, section: TableSectionKey, rows: TableRow[]): number {
        if (section === 'header') return computeSectionHeight(rows) + computeSectionHeight(getTableSectionRows(element, 'detail')) + computeSectionHeight(getTableSectionRows(element, 'footer'))
        if (section === 'detail') return computeSectionHeight(getTableSectionRows(element, 'header')) + computeSectionHeight(rows) + computeSectionHeight(getTableSectionRows(element, 'footer'))
        return computeSectionHeight(getTableSectionRows(element, 'header')) + computeSectionHeight(getTableSectionRows(element, 'detail')) + computeSectionHeight(rows)
    }

    function updateTableElement(element: TemplateElement, props: Partial<TemplateElement>) {
        if (selectedBandId === null) return
        Action.updateElement(dispatch, element.id, selectedBandId, props)
    }

    function clonePathSubpaths(subpaths: PathSubpath[]): PathSubpath[] {
        return subpaths.map(function (subpath) {
            return {
                closed: subpath.closed,
                anchors: subpath.anchors.map(function (anchor) { return { ...anchor } }),
            }
        })
    }

    function updatePathElementGeometry(element: TemplateElement, bandId: string, subpaths: PathSubpath[]) {
        const normalized = normalizePathBounds(subpaths)
        Action.updatePathGeometry(dispatch, element.id, bandId, normalized.subpaths, {
            x: element.x + normalized.bounds.x,
            y: element.y + normalized.bounds.y,
            width: Math.max(1, normalized.bounds.width),
            height: Math.max(1, normalized.bounds.height),
        })
    }

    function movePathAnchor(anchor: PathAnchor, dx: number, dy: number): PathAnchor {
        return {
            ...anchor,
            x: anchor.x + dx,
            y: anchor.y + dy,
            inX: anchor.inX + dx,
            inY: anchor.inY + dy,
            outX: anchor.outX + dx,
            outY: anchor.outY + dy,
        }
    }

    function movePathHandle(anchor: PathAnchor, handle: 'in' | 'out', x: number, y: number): PathAnchor {
        if (handle === 'in') {
            const next = { ...anchor, inX: x, inY: y }
            if (anchor.handleMode === 'symmetric') {
                next.outX = anchor.x * 2 - x
                next.outY = anchor.y * 2 - y
            }
            return next
        }
        const next = { ...anchor, outX: x, outY: y }
        if (anchor.handleMode === 'symmetric') {
            next.inX = anchor.x * 2 - x
            next.inY = anchor.y * 2 - y
        }
        return next
    }

    function handlePathPartMouseDown(
        element: TemplateElement,
        bandId: string,
        subpathIndex: number,
        anchorIndex: number,
        handle: 'point' | 'in' | 'out',
        e: React.MouseEvent
    ) {
        e.stopPropagation()
        e.preventDefault()
        Action.setPathEdit(dispatch, { elementId: element.id, bandId, anchor: { subpathIndex, anchorIndex, handle } })
        const startX = e.clientX
        const startY = e.clientY
        const originalSubpaths = clonePathSubpaths(element.pathSubpaths)
        const startAnchor = originalSubpaths[subpathIndex]?.anchors[anchorIndex]
        if (startAnchor === undefined) return

        function handleMouseMove(moveEvent: MouseEvent) {
            const dx = (moveEvent.clientX - startX) / zoom
            const dy = (moveEvent.clientY - startY) / zoom
            const next = clonePathSubpaths(originalSubpaths)
            const target = next[subpathIndex]!.anchors[anchorIndex]!
            if (handle === 'point') {
                next[subpathIndex]!.anchors[anchorIndex] = movePathAnchor(target, dx, dy)
            } else if (handle === 'in') {
                next[subpathIndex]!.anchors[anchorIndex] = movePathHandle(
                    moveEvent.altKey ? { ...target, handleMode: 'independent' } : target,
                    'in',
                    target.inX + dx,
                    target.inY + dy,
                )
            } else {
                next[subpathIndex]!.anchors[anchorIndex] = movePathHandle(
                    moveEvent.altKey ? { ...target, handleMode: 'independent' } : target,
                    'out',
                    target.outX + dx,
                    target.outY + dy,
                )
            }
            updatePathElementGeometry(element, bandId, next)
        }

        function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            Action.commitHistory(dispatch)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function handlePathAnchorDoubleClick(
        element: TemplateElement,
        bandId: string,
        subpathIndex: number,
        anchorIndex: number,
        e: React.MouseEvent
    ) {
        e.stopPropagation()
        e.preventDefault()
        const next = toggleAnchorSmooth(element.pathSubpaths, subpathIndex, anchorIndex)
        updatePathElementGeometry(element, bandId, next)
        Action.commitHistory(dispatch)
        Action.setPathEdit(dispatch, { elementId: element.id, bandId, anchor: { subpathIndex, anchorIndex, handle: 'point' } })
    }

    function handlePathSegmentClick(element: TemplateElement, bandId: string, e: React.MouseEvent<SVGPathElement>) {
        e.stopPropagation()
        e.preventDefault()
        const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
        const localX = (e.clientX - rect.left) / zoom
        const localY = (e.clientY - rect.top) / zoom
        const hit = hitTestPath(element.pathSubpaths, localX, localY, 8 / zoom)
        if (hit === null || hit.type !== 'segment') return
        const next = splitSegmentAt(element.pathSubpaths, hit.subpathIndex, hit.segmentIndex, hit.t)
        updatePathElementGeometry(element, bandId, next)
        Action.commitHistory(dispatch)
        Action.setPathEdit(dispatch, {
            elementId: element.id,
            bandId,
            anchor: { subpathIndex: hit.subpathIndex, anchorIndex: hit.segmentIndex + 1, handle: 'point' },
        })
    }

    function renderPathEditorOverlay(element: TemplateElement, bandId: string) {
        const d = buildPathD(element.pathSubpaths)
        const active = pathEditing !== null && pathEditing.elementId === element.id && pathEditing.bandId === bandId
            ? pathEditing.anchor
            : null
        const controls: React.ReactElement[] = []
        const handleLines: React.ReactElement[] = []

        for (let si = 0; si < element.pathSubpaths.length; si++) {
            const subpath = element.pathSubpaths[si]!
            for (let ai = 0; ai < subpath.anchors.length; ai++) {
                const anchor = subpath.anchors[ai]!
                const pointActive = active !== null && active.subpathIndex === si && active.anchorIndex === ai && active.handle === 'point'
                const inActive = active !== null && active.subpathIndex === si && active.anchorIndex === ai && active.handle === 'in'
                const outActive = active !== null && active.subpathIndex === si && active.anchorIndex === ai && active.handle === 'out'
                const hasIn = Math.hypot(anchor.inX - anchor.x, anchor.inY - anchor.y) > 0.01
                const hasOut = Math.hypot(anchor.outX - anchor.x, anchor.outY - anchor.y) > 0.01
                if (hasIn) {
                    handleLines.push(<line
                        key={`in_line_${si}_${ai}`}
                        className={styles.pathHandleLine}
                        x1={anchor.x * zoom}
                        y1={anchor.y * zoom}
                        x2={anchor.inX * zoom}
                        y2={anchor.inY * zoom}
                    />)
                    controls.push(<button
                        key={`in_${si}_${ai}`}
                        type="button"
                        className={`${styles.pathHandle} ${inActive ? styles.pathHandleActive : ''}`}
                        style={{ left: anchor.inX * zoom, top: anchor.inY * zoom }}
                        onMouseDown={(e) => handlePathPartMouseDown(element, bandId, si, ai, 'in', e)}
                    />)
                }
                if (hasOut) {
                    handleLines.push(<line
                        key={`out_line_${si}_${ai}`}
                        className={styles.pathHandleLine}
                        x1={anchor.x * zoom}
                        y1={anchor.y * zoom}
                        x2={anchor.outX * zoom}
                        y2={anchor.outY * zoom}
                    />)
                    controls.push(<button
                        key={`out_${si}_${ai}`}
                        type="button"
                        className={`${styles.pathHandle} ${outActive ? styles.pathHandleActive : ''}`}
                        style={{ left: anchor.outX * zoom, top: anchor.outY * zoom }}
                        onMouseDown={(e) => handlePathPartMouseDown(element, bandId, si, ai, 'out', e)}
                    />)
                }
                controls.push(<button
                    key={`point_${si}_${ai}`}
                    type="button"
                    className={`${styles.pathAnchor} ${pointActive ? styles.pathAnchorActive : ''}`}
                    style={{ left: anchor.x * zoom, top: anchor.y * zoom }}
                    onMouseDown={(e) => handlePathPartMouseDown(element, bandId, si, ai, 'point', e)}
                    onDoubleClick={(e) => handlePathAnchorDoubleClick(element, bandId, si, ai, e)}
                />)
            }
        }

        return (
            <div className={styles.pathEditOverlay}>
                <svg
                    className={styles.pathEditSvg}
                    width={element.width * zoom}
                    height={element.height * zoom}
                    viewBox={`0 0 ${element.width * zoom} ${element.height * zoom}`}
                >
                    {handleLines}
                    <path
                        d={d}
                        transform={`scale(${zoom})`}
                        className={styles.pathSegmentHitArea}
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                        onClick={(e) => handlePathSegmentClick(element, bandId, e)}
                    />
                </svg>
                {controls}
            </div>
        )
    }

    function renderPenDraftOverlay(bandId: string, parentId: string, width: number, height: number) {
        if (penDraft === null || penDraft.bandId !== bandId || penDraft.parentId !== parentId) return null
        const previewAnchors = penDraft.pointer !== null && penDraft.anchors.length > 0
            ? penDraft.anchors.concat([createPenAnchor(penDraft.pointer.x, penDraft.pointer.y)])
            : penDraft.anchors
        const d = buildPathD([{ anchors: previewAnchors, closed: penDraft.closed }])
        return (
            <div className={styles.penDraftOverlay}>
                <svg
                    className={styles.penDraftSvg}
                    width={width * zoom}
                    height={height * zoom}
                    viewBox={`0 0 ${width * zoom} ${height * zoom}`}
                >
                    <path d={d} transform={`scale(${zoom})`} className={styles.penDraftPath} />
                </svg>
                {penDraft.anchors.map(function (anchor, index) {
                    return (
                        <span
                            key={index}
                            className={`${styles.penDraftAnchor} ${index === 0 && penDraft.anchors.length >= 2 ? styles.penDraftStartAnchor : ''}`}
                            style={{ left: anchor.x * zoom, top: anchor.y * zoom }}
                        />
                    )
                })}
            </div>
        )
    }

    function handleTableColumnResize(element: TemplateElement, leftColumnIndex: number, e: React.MouseEvent) {
        e.stopPropagation()
        e.preventDefault()
        const columns = getTableColumns(element)
        const positions = computeTableColumnPositions(columns, element.width)
        if (leftColumnIndex < 0 || leftColumnIndex >= columns.length - 1) return
        const leftDisplayedWidth = positions[leftColumnIndex + 1]! - positions[leftColumnIndex]!
        const rightDisplayedWidth = positions[leftColumnIndex + 2] !== undefined
            ? positions[leftColumnIndex + 2]! - positions[leftColumnIndex + 1]!
            : element.width - positions[leftColumnIndex + 1]!
        const totalBaseWidth = columns.reduce(function (sum, column) { return sum + column.width }, 0)
        const scale = totalBaseWidth > 0 ? element.width / totalBaseWidth : 1
        const startX = e.clientX

        function handleMouseMove(moveEvent: MouseEvent) {
            const rawDelta = (moveEvent.clientX - startX) / zoom
            const delta = isGridEnabled ? snapToGrid(rawDelta) : rawDelta
            const nextLeftDisplayed = Math.max(24, leftDisplayedWidth + delta)
            const nextRightDisplayed = Math.max(24, rightDisplayedWidth - delta)
            const nextColumns = columns.map(cloneTableColumn)
            nextColumns[leftColumnIndex] = { ...nextColumns[leftColumnIndex]!, width: nextLeftDisplayed / scale }
            nextColumns[leftColumnIndex + 1] = { ...nextColumns[leftColumnIndex + 1]!, width: nextRightDisplayed / scale }
            updateTableElement(element, setTableColumns(element, nextColumns))
        }

        function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            Action.commitHistory(dispatch)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function handleTableRowResize(element: TemplateElement, section: TableSectionKey, rowIndex: number, e: React.MouseEvent) {
        e.stopPropagation()
        e.preventDefault()
        const rows = getTableSectionRows(element, section)
        if (rowIndex < 0 || rowIndex >= rows.length) return
        const originalHeight = rows[rowIndex]!.height
        const startY = e.clientY

        // Calculate the maximum table row height from the band height.
        let maxRowHeight = Infinity
        if (selectedBandId !== null) {
            for (let i = 0; i < bands.length; i++) {
                if (bands[i].id === selectedBandId) {
                    const bandHeight = bands[i].height
                    // Total height of other sections and other rows in the same section.
                    let otherRowsHeight = computeTableHeightForSectionRows(element, section, [])
                    for (let r = 0; r < rows.length; r++) {
                        if (r !== rowIndex) otherRowsHeight += rows[r]!.height
                    }
                    maxRowHeight = bandHeight - element.y - otherRowsHeight
                    break
                }
            }
        }

        function handleMouseMove(moveEvent: MouseEvent) {
            const rawDelta = (moveEvent.clientY - startY) / zoom
            const delta = isGridEnabled ? snapToGrid(rawDelta) : rawDelta
            const nextHeight = Math.max(12, Math.min(originalHeight + delta, maxRowHeight))
            const nextRows = rows.map(cloneTableRow)
            nextRows[rowIndex] = { ...nextRows[rowIndex]!, height: nextHeight }
            updateTableElement(element, {
                ...setTableSectionRows(element, section, nextRows),
                height: computeTableHeightForSectionRows(element, section, nextRows),
            })
        }

        function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            Action.commitHistory(dispatch)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function handleTableInsertColumn(element: TemplateElement, insertAt: number) {
        const columns = getTableColumns(element)
        const columnCount = columns.length
        const nextColumns = columns.map(cloneTableColumn)
        nextColumns.splice(insertAt, 0, createDefaultCanvasTableColumn())
        updateTableElement(element, updateTableChildren(element, {
            columns: nextColumns,
            headerRows: insertTableColumn(getTableSectionRows(element, 'header'), columnCount, insertAt),
            detailRows: insertTableColumn(getTableSectionRows(element, 'detail'), columnCount, insertAt),
            footerRows: insertTableColumn(getTableSectionRows(element, 'footer'), columnCount, insertAt),
        }))
        Action.setTableSelection(dispatch, { type: 'column', col: insertAt })
    }

    function handleTableRemoveColumn(element: TemplateElement, removeAt: number) {
        const columns = getTableColumns(element)
        if (columns.length <= 1) return
        const columnCount = columns.length
        const nextColumns = columns.map(cloneTableColumn)
        nextColumns.splice(removeAt, 1)
        updateTableElement(element, updateTableChildren(element, {
            columns: nextColumns,
            headerRows: removeTableColumn(getTableSectionRows(element, 'header'), columnCount, removeAt),
            detailRows: removeTableColumn(getTableSectionRows(element, 'detail'), columnCount, removeAt),
            footerRows: removeTableColumn(getTableSectionRows(element, 'footer'), columnCount, removeAt),
        }))
        Action.setTableSelection(dispatch, { type: 'column', col: Math.max(0, removeAt - 1) })
    }

    function handleTableInsertRow(element: TemplateElement, section: TableSectionKey, insertAt: number) {
        const sectionRows = getTableSectionRows(element, section)
        const columnCount = getTableColumnCount(element)
        const nextRows = insertTableRow(sectionRows, columnCount, insertAt)
        updateTableElement(element, {
            ...setTableSectionRows(element, section, nextRows),
            height: computeTableHeightForSectionRows(element, section, nextRows),
        })
        Action.setTableSelection(dispatch, { type: 'row', section, row: insertAt })
    }

    function handleTableRemoveRow(element: TemplateElement, section: TableSectionKey, removeAt: number) {
        const sectionRows = getTableSectionRows(element, section)
        if (sectionRows.length === 0) return
        // Header and detail require at least one row; footer may have zero rows.
        if (sectionRows.length <= 1) {
            if (section !== 'footer') return
            // Deleting the last footer row leaves the footer empty.
            const nextRows: TableRow[] = []
            updateTableElement(element, {
                ...setTableSectionRows(element, section, nextRows),
                height: computeTableHeightForSectionRows(element, section, nextRows),
            })
            Action.setTableSelection(dispatch, null)
            return
        }
        const columnCount = getTableColumnCount(element)
        const nextRows = removeTableRow(sectionRows, columnCount, removeAt)
        updateTableElement(element, {
            ...setTableSectionRows(element, section, nextRows),
            height: computeTableHeightForSectionRows(element, section, nextRows),
        })
        Action.setTableSelection(dispatch, { type: 'row', section, row: Math.max(0, removeAt - 1) })
    }

    function handleTableAddFirstRow(element: TemplateElement, section: TableSectionKey) {
        const columnCount = getTableColumnCount(element)
        const cells = []
        for (let i = 0; i < columnCount; i++) {
            cells.push({ expression: '', text: '', colSpan: 1, rowSpan: 1, style: createDefaultTableCellStyle(), children: [] })
        }
        const newRow = createDefaultTableRow(cells, 18)
        const nextRows = [newRow]
        updateTableElement(element, {
            ...setTableSectionRows(element, section, nextRows),
            height: computeTableHeightForSectionRows(element, section, nextRows),
        })
        Action.setTableSelection(dispatch, { type: 'row', section, row: 0 })
    }

    function renderTableCellChildren(element: TemplateElement, bandId: string) {
        const columns = getTableColumns(element)
        const columnPositions = computeTableColumnPositions(columns, element.width)
        const sections: TableSectionKey[] = ['header', 'detail', 'footer']
        const result: React.ReactNode[] = []
        for (let si = 0; si < sections.length; si++) {
            const section = sections[si]!
            const sectionRows = getTableSectionRows(element, section)
            if (sectionRows.length === 0) continue
            const sectionTop = computeSectionTop(element, section)
            const rowOffsets = computeTableRowOffsets(sectionRows)
            const placements = buildTablePlacements(sectionRows, columns.length)
            for (let pi = 0; pi < placements.length; pi++) {
                const placement = placements[pi]!
                const cell = placement.cell
                if (cell.children.length === 0) continue
                const cellLeft = columnPositions[placement.col]!
                const cellRight = placement.col + cell.colSpan < columnPositions.length ? columnPositions[placement.col + cell.colSpan]! : element.width
                const cellWidth = cellRight - cellLeft
                let cellHeight = 0
                for (let r = 0; r < cell.rowSpan; r++) {
                    const row = sectionRows[placement.row + r]
                    if (row !== undefined) cellHeight += row.height
                }
                const pad = cell.style.padding
                result.push(
                    <div
                        key={section + '_' + placement.row + '_' + placement.col}
                        style={{
                            position: 'absolute',
                            left: (cellLeft + pad) * zoom,
                            top: (sectionTop + rowOffsets[placement.row]! + pad) * zoom,
                            width: (cellWidth - pad * 2) * zoom,
                            height: (cellHeight - pad * 2) * zoom,
                            overflow: 'hidden',
                        }}
                    >
                        {cell.children.map(child => renderElement(child, bandId, null))}
                    </div>
                )
            }
        }
        return result.length > 0 ? result : null
    }

    function renderTableSectionOverlay(
        element: TemplateElement, section: TableSectionKey, sectionTop: number,
        columnPositions: number[], sectionLabel: string
    ) {
        const sectionRows = getTableSectionRows(element, section)
        if (sectionRows.length === 0) {
            return (
                <div key={section} style={{ position: 'absolute', top: sectionTop * zoom, left: -30 * zoom }}>
                    <button
                        type="button"
                        className={styles.tableActionButton}
                        {...tip(sectionLabel + ' ' + ui.addRow)}
                        style={{ width: 'auto', padding: '0 4px', fontSize: '0.5rem' }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); handleTableAddFirstRow(element, section) }}
                    >
                        +{sectionLabel}
                    </button>
                </div>
            )
        }
        const rowOffsets = computeTableRowOffsets(sectionRows)
        const placements = buildTablePlacements(sectionRows, getTableColumnCount(element))
        const sectionHeight = computeSectionHeight(sectionRows)
        const isRowSelected = tableSelection !== null && tableSelection.type === 'row' && tableSelection.section === section

        return (
            <div key={section} style={{ position: 'absolute', top: sectionTop * zoom, left: 0, width: element.width * zoom, height: sectionHeight * zoom }}>
                {/* Section label. */}
                <div className={styles.tableSectionLabel}
                    style={{ top: 0, left: -30 * zoom }}>
                    {sectionLabel}
                </div>
                {}
                <div className={styles.tableRowSelectors} onMouseDown={(e) => e.stopPropagation()}>
                    {sectionRows.map(function (row, rowIndex) {
                        const isActive = isRowSelected && tableSelection!.row === rowIndex
                        return (
                            <button
                                key={rowIndex}
                                type="button"
                                className={`${styles.tableRowSelector} ${isActive ? styles.tableRowSelectorActive : ''}`}
                                style={{ top: rowOffsets[rowIndex]! * zoom, height: row.height * zoom }}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    Action.setTableSelection(dispatch, { type: 'row', section, row: rowIndex })
                                }}
                            >
                                {rowIndex + 1}
                            </button>
                        )
                    })}
                </div>
                {}
                {sectionRows.map(function (_row, rowIndex) {
                    const top = rowOffsets[rowIndex]! + sectionRows[rowIndex]!.height
                    return (
                        <div
                            key={rowIndex}
                            className={styles.tableRowHandle}
                            style={{ top: top * zoom - 3, left: 0, width: element.width * zoom }}
                            onMouseDown={(e) => handleTableRowResize(element, section, rowIndex, e)}
                        />
                    )
                })}
                {}
                {placements.map(function (placement, placementIndex) {
                    const left = columnPositions[placement.col]!
                    const right = placement.col + placement.cell.colSpan < columnPositions.length ? columnPositions[placement.col + placement.cell.colSpan]! : element.width
                    let height = 0
                    for (let rowOffset = 0; rowOffset < placement.cell.rowSpan; rowOffset++) {
                        const row = sectionRows[placement.row + rowOffset]
                        if (row !== undefined) height += row.height
                    }
                    const isActive = tableSelection !== null && tableSelection.type === 'cell'
                        && tableSelection.section === section
                        && tableSelection.row === placement.row
                        && tableSelection.col === placement.col
                    return (
                        <div
                            key={placementIndex}
                            className={`${styles.tableCellOverlay} ${isActive ? styles.tableCellOverlayActive : ''}`}
                            style={{
                                left: left * zoom,
                                top: rowOffsets[placement.row]! * zoom,
                                width: (right - left) * zoom,
                                height: height * zoom,
                            }}
                            onClick={(e) => {
                                e.stopPropagation()
                                Action.setTableSelection(dispatch, { type: 'cell', section, row: placement.row, col: placement.col })
                            }}
                        />
                    )
                })}
                {}
                {isRowSelected && (
                    <div className={styles.tableRowActions}
                        style={{ top: rowOffsets[tableSelection!.row]! * zoom }}
                        onMouseDown={(e) => e.stopPropagation()}>
                        <button type="button" className={styles.tableActionButton}
                            {...tip(ui.insertRowAbove)}
                            onClick={() => handleTableInsertRow(element, section, tableSelection!.row)}>
                            <i className="pi pi-arrow-up" />
                        </button>
                        <button type="button" className={styles.tableActionButton}
                            {...tip(ui.insertRowBelow)}
                            onClick={() => handleTableInsertRow(element, section, tableSelection!.row + 1)}>
                            <i className="pi pi-arrow-down" />
                        </button>
                        <button type="button" className={styles.tableActionButton + ' ' + styles.tableActionButtonDanger}
                            {...tip(ui.deleteRow)}
                            onClick={() => handleTableRemoveRow(element, section, tableSelection!.row)}>
                            <i className="pi pi-trash" />
                        </button>
                    </div>
                )}
            </div>
        )
    }

    function renderTableEditorOverlay(element: TemplateElement, bandId: string) {
        const columns = getTableColumns(element)
        const columnPositions = computeTableColumnPositions(columns, element.width)
        const isColumnSelected = tableSelection !== null && tableSelection.type === 'column'

        return (
            <>
                {}
                <div className={styles.tableColumnSelectors} onMouseDown={(e) => e.stopPropagation()}>
                    {columns.map(function (_column, columnIndex) {
                        const left = columnPositions[columnIndex]!
                        const right = columnPositions[columnIndex + 1] !== undefined ? columnPositions[columnIndex + 1]! : element.width
                        const isActive = isColumnSelected && tableSelection!.col === columnIndex
                        return (
                            <button
                                key={columnIndex}
                                type="button"
                                className={`${styles.tableColumnSelector} ${isActive ? styles.tableColumnSelectorActive : ''}`}
                                style={{ left: left * zoom, width: (right - left) * zoom }}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    Action.setTableSelection(dispatch, { type: 'column', col: columnIndex })
                                }}
                            >
                                C{columnIndex + 1}
                            </button>
                        )
                    })}
                </div>

                {}
                {columns.slice(0, -1).map(function (_column, columnIndex) {
                    const left = columnPositions[columnIndex + 1]!
                    return (
                        <div
                            key={columnIndex}
                            className={styles.tableColumnHandle}
                            style={{ left: left * zoom - 3, top: 0, height: (computeSectionHeight(getTableSectionRows(element, 'header')) + computeSectionHeight(getTableSectionRows(element, 'detail')) + computeSectionHeight(getTableSectionRows(element, 'footer'))) * zoom }}
                            onMouseDown={(e) => handleTableColumnResize(element, columnIndex, e)}
                        />
                    )
                })}

                {}
                {isColumnSelected && (
                    <div className={styles.tableColumnActions}
                        style={{ left: columnPositions[tableSelection!.col]! * zoom }}
                        onMouseDown={(e) => e.stopPropagation()}>
                        <button type="button" className={styles.tableActionButton}
                            {...tip(ui.insertColumnLeft)}
                            onClick={() => handleTableInsertColumn(element, tableSelection!.col)}>
                            <i className="pi pi-arrow-left" />
                        </button>
                        <button type="button" className={styles.tableActionButton}
                            {...tip(ui.insertColumnRight)}
                            onClick={() => handleTableInsertColumn(element, tableSelection!.col + 1)}>
                            <i className="pi pi-arrow-right" />
                        </button>
                        <button type="button" className={styles.tableActionButton + ' ' + styles.tableActionButtonDanger}
                            {...tip(ui.deleteColumn)}
                            onClick={() => handleTableRemoveColumn(element, tableSelection!.col)}>
                            <i className="pi pi-trash" />
                        </button>
                    </div>
                )}

                {}
                {renderTableSectionOverlay(element, 'header', computeSectionTop(element, 'header'), columnPositions, 'H')}
                {renderTableSectionOverlay(element, 'detail', computeSectionTop(element, 'detail'), columnPositions, 'D')}
                {renderTableSectionOverlay(element, 'footer', computeSectionTop(element, 'footer'), columnPositions, 'F')}
            </>
        )
    }

    function renderTransformedPathSelectionOverlay(band: Band, elevated: boolean = false) {
        if (selectedBandId !== band.id || selectedElementIds.length === 0) return null
        const placements = collectSelectedElementCanvasPlacements(band.elements, selectedSet)
        const paths = placements.filter(function (placement) {
            return usesTransformedPathSelection(placement.element)
        })
        if (paths.length === 0) return null

        return (
            <svg
                className={`${styles.transformedPathSelectionOverlay} ${elevated ? styles.backgroundTransformedPathSelectionOverlay : ''}`}
                width={printableWidth * zoom}
                height={band.height * zoom}
                viewBox={`0 0 ${printableWidth} ${band.height}`}
                aria-hidden="true"
            >
                {paths.map(function (placement) {
                    const matrix = placement.transform
                    const transform = `matrix(${matrix[0]} ${matrix[1]} ${matrix[2]} ${matrix[3]} ${matrix[4]} ${matrix[5]})`
                    const d = buildPathD(placement.element.pathSubpaths)
                    return (
                        <g key={placement.element.id} transform={transform}>
                            <path d={d} className={styles.transformedPathSelectionHalo} />
                            <path d={d} className={styles.transformedPathSelectionOutline} />
                        </g>
                    )
                })}
            </svg>
        )
    }

    function renderBackgroundElementInteractions(band: Band) {
        if (!backgroundElementSelected || activeTool !== 'select') return null
        const interactions: React.ReactNode[] = []
        for (let i = 0; i < selectedElementIds.length; i++) {
            const element = findElementInTree(band.elements, selectedElementIds[i]!)
            if (element === undefined || usesTransformedPathSelection(element)) continue
            const position = getElementAbsolutePosition(band.elements, element.id)
            if (position === undefined) continue
            const height = element.kind === 'table' ? computeTableRenderHeight(element, fontRegistry) : element.height
            interactions.push(
                <div
                    key={element.id}
                    className={styles.backgroundElementInteraction}
                    data-background-element-interaction={element.id}
                    style={{
                        left: position.x * zoom,
                        top: position.y * zoom,
                        width: element.width * zoom,
                        height: height * zoom,
                    }}
                    onClick={(e) => handleElementClick(element, band.id, e)}
                    onDoubleClick={(e) => handleElementDoubleClick(element, band.id, e)}
                    onMouseDown={(e) => handleElementMouseDown(element, band.id, e)}
                >
                    {selectedElementIds.length === 1 && editingElementId === null && renderResizeHandles(element, band.id)}
                </div>
            )
        }
        return interactions
    }

    // Elementdraw (support)
    
    function renderElement(element: TemplateElement, bandId: string, batchInteractionIds: ReadonlySet<string> | null) {
        const batchRendered = batchInteractionIds !== null
        const isSelected = selectedSet.has(element.id)
        const isEditing = editingElementId === element.id
        const isSingleSelected = isSelected && selectedElementIds.length === 1
        const usesGeometrySelection = isSelected && usesTransformedPathSelection(element)
        const elementRenderHeight = element.kind === 'table' ? computeTableRenderHeight(element, fontRegistry) : element.height
        // In batch bands the wrapper bboxes overlap heavily and would steal
        // clicks from each other, so they are click-through and the band does
        // hit-testing. Resize handles re-enable pointer events on themselves.
        // Tables keep their wrapper interactive: their row/column/cell overlay
        // UI relies on pointer events, which would be disabled by inheritance.
        const clickThrough = batchRendered && !isEditing && element.kind !== 'table'
        const wrapperStyle: React.CSSProperties = {
            position: 'absolute',
            left: element.x * zoom,
            top: element.y * zoom,
            width: element.width * zoom,
            height: elementRenderHeight * zoom,
            cursor: activeTool === 'select' ? (isEditing ? 'text' : 'move') : (element.kind === 'frame' ? 'crosshair' : 'default'),
            boxSizing: 'border-box',
            pointerEvents: clickThrough ? 'none' : undefined,
        }

        return (
            <div
                key={element.id}
                style={wrapperStyle}
                onClick={(e) => handleElementClick(element, bandId, e)}
                onDoubleClick={(e) => handleElementDoubleClick(element, bandId, e)}
                onMouseDown={(e) => handleElementMouseDown(element, bandId, e)}
                onMouseMove={(e) => {
                    if (element.kind === 'frame') handlePenPointerMove(bandId, element.id, element.width, element.height, e)
                }}

            >
                {/* When the band is batch-rendered into one canvas, elements
                    keep only their interaction/selection layer; painting is done
                    once at the band level. The selected element still paints its
                    own canvas while interacting so drags/resizes are live even
                    though the batch canvas is frozen. */}
                {!isEditing && (!batchRendered || (isInteracting && isSelected)) && (
                    <ElementCanvas
                        element={element}
                        fontRegistry={fontRegistry}
                        defaultFontId={defaultFontId}
                        mathFonts={mathFonts}
                        mathFontResource={mathFontResource}
                        currentFile={currentFile}
                        rootTemplate={state.template}
                        openReportTemplates={openReportTemplates}
                        zoom={zoom}
                    />
                )}
                {/* Inline editor. */}
                {isEditing && renderInlineEditor(element)}
                {}
                {element.kind === 'frame' && element.children.length > 0 && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                        {element.children.map(function (child) {
                            if (batchInteractionIds !== null && !batchInteractionIds.has(child.id)) return null
                            return renderElement(child, bandId, batchInteractionIds)
                        })}
                    </div>
                )}
                {element.kind === 'frame' && renderPenDraftOverlay(bandId, element.id, element.width, element.height)}
                {}
                {element.kind === 'table' && renderTableCellChildren(element, bandId)}
                {element.kind === 'table' && isSingleSelected && renderTableEditorOverlay(element, bandId)}
                {element.kind === 'path' && isSingleSelected && !isEditing && !usesGeometrySelection && renderPathEditorOverlay(element, bandId)}
                {}
                {creationDrag !== null && creationDrag.parentId === element.id && (
                    <div
                        className={styles.creationPreview}
                        style={{
                            left: creationDrag.x * zoom,
                            top: creationDrag.y * zoom,
                            width: creationDrag.width * zoom,
                            height: creationDrag.height * zoom
                        }}
                    />
                )}
                {}
                {!usesGeometrySelection && <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    border: isSelected ? '2px solid #2196F3' : '1px dashed rgba(153, 153, 153, 0.4)',
                    borderRadius: element.kind === 'ellipse' ? '50%' : undefined,
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                }} />}
                {isSingleSelected && !isEditing && !usesGeometrySelection && renderResizeHandles(element, bandId)}
            </div>
        )
    }

    // Banddraw.
    
    function renderBand(band: Band, background: boolean = false) {
        const isSelected = selectedBandId === band.id && selectedElementIds.length === 0
        const bandHeight = band.height * zoom
        const bandColor = getBandColor(band.type)
        // Above this element count, paint the whole band in one canvas instead of
        // one canvas per element (imported PDF pages can hold hundreds).
        const batchRendered = countBandElements(band.elements) > BATCH_RENDER_THRESHOLD
        const batchInteractionIds = batchRendered
            ? collectBatchInteractionElementIds(band.elements, new Set([
                ...selectedElementIds,
                ...(editingElementId === null ? [] : [editingElementId]),
            ]))
            : null

        return (
            <div
                key={band.id}
                className={`${styles.band} ${background ? styles.backgroundBand : styles.foregroundBand}`}
                data-canvas-band={band.type}
                style={{ pointerEvents: background && !backgroundBandSelected && activeTool === 'select' ? 'none' : undefined }}
            >
                {}
                <div
                    className={`${styles.bandContent} ${isSelected ? styles.bandSelected : ''}`}
                    style={{
                        height: bandHeight,
                        cursor: activeTool !== 'select' ? 'crosshair' : 'default'
                    }}
                    onClick={(e) => handleBandClick(band.id, e)}
                    onDoubleClick={(e) => handleBandDoubleClick(band.id, e)}
                    onMouseDown={(e) => handleBandMouseDown(band.id, e)}
                    onMouseMove={(e) => handlePenPointerMove(band.id, '', printableWidth, band.height, e)}
                >
                    {}
                    <div
                        className={styles.bandTint}
                        style={{ backgroundColor: bandColor }}
                    />
                    {/* Grid drawn from the band content origin (0,0), i.e. the same
                        origin as element x/y, so snapped elements align with it. */}
                    {isGridEnabled && <div
                        className={styles.gridOverlay}
                        style={{
                            backgroundSize: `${gridSizePt * GRID_MAJOR_MULTIPLE * zoom}px 100%, 100% ${gridSizePt * GRID_MAJOR_MULTIPLE * zoom}px, ${gridSizePt * zoom}px 100%, 100% ${gridSizePt * zoom}px`,
                        }}
                    />}
                    {}
                    <span className={styles.bandLabel}>
                        {getLocalizedBandDisplayLabel(band, props.messages)}
                    </span>
                    {/* One-pass band painting for element-heavy bands. */}
                    {batchRendered && (
                        <BandCanvas
                            band={band}
                            bandWidth={printableWidth}
                            bandHeight={band.height}
                            fontRegistry={fontRegistry}
                            defaultFontId={defaultFontId}
                            mathFonts={mathFonts}
                            currentFile={currentFile}
                            zoom={zoom}
                            frozen={isInteracting}
                            suspended={props.suspended}
                        />
                    )}
                    {/* Element. */}
                    {band.elements.map(function (element) {
                        if (batchInteractionIds !== null && !batchInteractionIds.has(element.id)) return null
                        return renderElement(element, band.id, batchInteractionIds)
                    })}
                    {renderTransformedPathSelectionOverlay(band)}
                    {renderPenDraftOverlay(band.id, '', printableWidth, band.height)}
                    {/* Creation preview rectangle. */}
                    {creationDrag !== null && creationDrag.bandId === band.id && creationDrag.parentId === '' && (
                        <div
                            className={styles.creationPreview}
                            style={{
                                left: creationDrag.x * zoom,
                                top: creationDrag.y * zoom,
                                width: creationDrag.width * zoom,
                                height: creationDrag.height * zoom
                            }}
                        />
                    )}
                    {/* Marquee selection rectangle. */}
                    {marquee !== null && marquee.bandId === band.id && (
                        <div
                            className={styles.marqueeSelection}
                            style={{
                                left: marquee.x * zoom,
                                top: marquee.y * zoom,
                                width: marquee.width * zoom,
                                height: marquee.height * zoom
                            }}
                        />
                    )}
                    {/* Band boundary line and resize handle. */}
                    <div
                        className={styles.bandBorder}
                        onMouseDown={(e) => handleSeparatorMouseDown(band.id, band.height, e)}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className={styles.canvasContainer} onClick={handleCanvasClick} onMouseDown={handleCanvasMouseDown} ref={canvasRef}>
            <div className={styles.pageWrapper}>
                {}
                <div
                    className={styles.page}
                    style={{
                        width: pageSettings.width * zoom,
                        minHeight: pageSettings.height * zoom
                    }}
                >
                    {}
                    <div
                        className={styles.marginGuide}
                        style={{
                            top: pageSettings.marginTop * zoom,
                            left: pageSettings.marginLeft * zoom,
                            right: pageSettings.marginRight * zoom,
                            bottom: pageSettings.marginBottom * zoom
                        }}
                    />

                    {}
                    <div
                        className={`${styles.bandsContainer} ${backgroundEdgeHover ? styles.backgroundElementEdgeHover : ''}`}
                        ref={bandsContainerRef}
                        onMouseDownCapture={handleBackgroundPriorityMouseDown}
                        onMouseMoveCapture={handleBackgroundPriorityMouseMove}
                        onMouseLeave={() => setBackgroundEdgeHover(false)}
                        style={{
                            marginTop: pageSettings.marginTop * zoom,
                            marginLeft: pageSettings.marginLeft * zoom,
                            width: printableWidth * zoom
                        }}
                    >
                        {canvasBands.background !== null && renderBand(canvasBands.background, true)}
                        {canvasBands.flow.map(function (band) { return renderBand(band) })}
                        {backgroundBandSelected && activeTool === 'select' && (
                            <div
                                className={styles.backgroundSelectionInput}
                                data-background-selection-input="true"
                                style={{ height: canvasBands.background!.height * zoom }}
                                onClick={(e) => handleBandClick(canvasBands.background!.id, e)}
                                onDoubleClick={(e) => handleBandDoubleClick(canvasBands.background!.id, e, true)}
                                onMouseDown={(e) => handleBandMouseDown(canvasBands.background!.id, e, true)}
                            />
                        )}
                        {backgroundBandSelected && activeTool !== 'select' && (
                            <div
                                className={styles.backgroundToolInput}
                                data-background-tool-input="true"
                                style={{ height: canvasBands.background!.height * zoom }}
                                onClick={(e) => handleBandClick(canvasBands.background!.id, e)}
                                onMouseDown={(e) => handleBandMouseDown(canvasBands.background!.id, e)}
                                onMouseMove={(e) => handlePenPointerMove(
                                    canvasBands.background!.id,
                                    '',
                                    printableWidth,
                                    canvasBands.background!.height,
                                    e,
                                )}
                            />
                        )}
                        {backgroundBandSelected && (
                            <div
                                className={styles.backgroundSelectionOutline}
                                style={{ height: canvasBands.background!.height * zoom }}
                            />
                        )}
                        {canvasBands.background !== null && renderBackgroundElementInteractions(canvasBands.background)}
                        {canvasBands.background !== null && backgroundElementSelected && activeTool === 'select'
                            && renderTransformedPathSelectionOverlay(canvasBands.background, true)}
                    </div>
                </div>
            </div>
            {}
            {globalMarquee !== null && (
                <div
                    className={styles.marqueeSelection}
                    style={{
                        left: globalMarquee.x,
                        top: globalMarquee.y,
                        width: globalMarquee.width,
                        height: globalMarquee.height,
                    }}
                />
            )}
            {btnHover !== null && <CanvasTooltip label={btnHover.label} anchorRect={btnHover.rect} />}
        </div>
    )
}
