// Slice model for the PDF import dialog. Every user click places a slice
// point holding a horizontal and a vertical cut line spanning the whole
// page. Cut lines are shared entities: dropping a point onto another line
// makes the point one of that line's control points, so a single horizontal
// line can be crossed by several independent vertical lines (and vice
// versa). The lines partition each graphic element (raster image, path,
// rectangle, ellipse) they cross into grid pieces; pieces toggled off by
// the user are dropped at import time. Raster images are cut pixel-exactly
// through a canvas, vector shapes are cut geometrically with bezier
// clipping.

import { materializePdfSourceVector, type ElementDef } from 'tsreport-core'
import { clipSubpathsToRect } from './path_clip'
import { createRectanglePath, normalizePathBounds, pathArraysToSubpaths, type PathAnchor, type PathSubpath } from './path_model'
import type { TemplateElement } from './reducer'

export type SlicePoint = {
    id: number,
    /** Handle position in page coordinates (pt) */
    x: number,
    y: number,
    /**
     * Shared cut line ids: every point with the same hLineId lies on the
     * same y (likewise vLineId / x). A line lives exactly as long as a
     * control point references it.
     */
    hLineId: number,
    vLineId: number
}

export type SliceLinePosition = { lineId: number, pos: number }

export type SliceRect = { x: number, y: number, width: number, height: number }

export type SliceTargetKind = 'image' | 'path' | 'rectangle' | 'ellipse'

export type SliceTarget = {
    /** Stable key derived from the element position in the imported tree */
    key: string,
    /** Child indices from the page root down to the element */
    indexPath: number[],
    kind: SliceTargetKind,
    /** Bounding box in page coordinates (pt) */
    rect: SliceRect
}

export type SlicePiece = {
    key: string,
    targetKey: string,
    row: number,
    col: number,
    /** Piece bounds in page coordinates (pt) */
    rect: SliceRect
}

export type SliceApplyResult = {
    elements: TemplateElement[],
    images: Record<string, Uint8Array>,
    nextElementIdCounter: number
}

/** Cuts closer than this to a target edge produce no piece (pt) */
const CUT_EDGE_MARGIN = 0.01
const KAPPA = 0.5522847498307936

// =====================================
// Target collection (from the imported core element tree)
// =====================================

export function collectSliceTargets(elements: ElementDef[]): SliceTarget[] {
    const targets: SliceTarget[] = []
    collectTargetsInto(elements, 0, 0, '', targets)
    return targets
}

function collectTargetsInto(elements: ElementDef[], offsetX: number, offsetY: number, prefix: string, out: SliceTarget[]): void {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        const key = prefix === '' ? String(i) : prefix + '-' + i
        if ((element.type === 'image' || element.type === 'path' || element.type === 'rectangle' || element.type === 'ellipse')
            && element.width > 0 && element.height > 0) {
            out.push({
                key,
                indexPath: key.split('-').map(Number),
                kind: element.type,
                rect: { x: offsetX + element.x, y: offsetY + element.y, width: element.width, height: element.height },
            })
        } else if (element.type === 'frame' && element.elements !== undefined) {
            collectTargetsInto(element.elements, offsetX + element.x, offsetY + element.y, key, out)
        }
    }
}

// =====================================
// Piece grid
// =====================================

/** Sorted cut positions strictly inside the target bounds. */
export function buildTargetCuts(rect: SliceRect, points: SlicePoint[]): { xs: number[], ys: number[] } {
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        if (point.x > rect.x + CUT_EDGE_MARGIN && point.x < rect.x + rect.width - CUT_EDGE_MARGIN) {
            pushUnique(xs, point.x)
        }
        if (point.y > rect.y + CUT_EDGE_MARGIN && point.y < rect.y + rect.height - CUT_EDGE_MARGIN) {
            pushUnique(ys, point.y)
        }
    }
    xs.sort(function (a, b) { return a - b })
    ys.sort(function (a, b) { return a - b })
    return { xs, ys }
}

function pushUnique(values: number[], value: number): void {
    for (let i = 0; i < values.length; i++) {
        if (Math.abs(values[i]! - value) <= CUT_EDGE_MARGIN) return
    }
    values.push(value)
}

export function pieceKey(targetKey: string, row: number, col: number): string {
    return targetKey + ':' + row + ':' + col
}

/**
 * Rebuilds the disabled-piece key set after the cut lines change. Piece
 * keys are grid positions (row/col), so adding, moving or deleting a cut
 * line shifts the indices of unrelated pieces; the disabled state must
 * follow the geometry instead. Every piece of the next grid inherits the
 * disabled state of the previous piece that contains its center point, so a
 * disabled region stays disabled when it is split further and untouched
 * pieces keep their state regardless of index shifts.
 */
export function remapDisabledPieces(
    targets: SliceTarget[],
    previousPoints: SlicePoint[],
    nextPoints: SlicePoint[],
    disabled: ReadonlySet<string>,
): ReadonlySet<string> {
    if (disabled.size === 0) return disabled
    const result = new Set<string>()
    for (let t = 0; t < targets.length; t++) {
        const target = targets[t]!
        const previousCuts = buildTargetCuts(target.rect, previousPoints)
        if (previousCuts.xs.length === 0 && previousCuts.ys.length === 0) continue
        const previousPieces: SlicePiece[] = []
        appendTargetPieces(target, previousCuts.xs, previousCuts.ys, previousPieces)
        const disabledRects: SliceRect[] = []
        for (let i = 0; i < previousPieces.length; i++) {
            if (disabled.has(previousPieces[i]!.key)) disabledRects.push(previousPieces[i]!.rect)
        }
        if (disabledRects.length === 0) continue
        const nextCuts = buildTargetCuts(target.rect, nextPoints)
        if (nextCuts.xs.length === 0 && nextCuts.ys.length === 0) continue
        const nextPieces: SlicePiece[] = []
        appendTargetPieces(target, nextCuts.xs, nextCuts.ys, nextPieces)
        for (let i = 0; i < nextPieces.length; i++) {
            const piece = nextPieces[i]!
            const cx = piece.rect.x + piece.rect.width / 2
            const cy = piece.rect.y + piece.rect.height / 2
            for (let j = 0; j < disabledRects.length; j++) {
                const rect = disabledRects[j]!
                if (cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height) {
                    result.add(piece.key)
                    break
                }
            }
        }
    }
    return result
}

// =====================================
// Point / line editing operations
// =====================================

function nextSliceId(points: SlicePoint[]): number {
    let next = 1
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        if (point.id >= next) next = point.id + 1
        if (point.hLineId >= next) next = point.hLineId + 1
        if (point.vLineId >= next) next = point.vLineId + 1
    }
    return next
}

/** Adds a slice point carrying a fresh horizontal + vertical cut line. */
export function addSlicePoint(points: SlicePoint[], x: number, y: number): SlicePoint[] {
    const id = nextSliceId(points)
    return [...points, { id, x, y, hLineId: id + 1, vLineId: id + 2 }]
}

/**
 * Moves a control point. The other control points of its lines follow on
 * the shared axis so each line always moves as one.
 */
export function moveSlicePoint(points: SlicePoint[], pointId: number, x: number, y: number): SlicePoint[] {
    let moved: SlicePoint | null = null
    for (let i = 0; i < points.length; i++) {
        if (points[i]!.id === pointId) moved = points[i]!
    }
    if (moved === null) return points
    const result: SlicePoint[] = []
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        if (point.id === pointId) {
            result.push({ ...point, x, y })
            continue
        }
        const followH = point.hLineId === moved.hLineId
        const followV = point.vLineId === moved.vLineId
        if (followH || followV) result.push({ ...point, x: followV ? x : point.x, y: followH ? y : point.y })
        else result.push(point)
    }
    return result
}

/**
 * Applied when a point drag ends. Dropping onto another point (within
 * thresholdPt on both axes) merges the two points and unifies their lines.
 * Dropping onto another line makes the point — together with the rest of
 * its own line's control points — a control point of that line, so one
 * line can be controlled by several points, each carrying its own
 * perpendicular line. Returns the input untouched when nothing overlaps.
 */
export function attachDroppedPoint(points: SlicePoint[], droppedId: number, thresholdPt: number): SlicePoint[] {
    let dropped: SlicePoint | null = null
    for (let i = 0; i < points.length; i++) {
        if (points[i]!.id === droppedId) dropped = points[i]!
    }
    if (dropped === null) return points
    // Point onto point: the dropped point disappears into the target point
    let pointTarget: SlicePoint | null = null
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        if (point.id === droppedId) continue
        if (Math.abs(point.x - dropped.x) <= thresholdPt && Math.abs(point.y - dropped.y) <= thresholdPt) {
            pointTarget = point
            break
        }
    }
    if (pointTarget !== null) {
        const result: SlicePoint[] = []
        for (let i = 0; i < points.length; i++) {
            const point = points[i]!
            if (point.id === droppedId) continue
            let hLineId = point.hLineId
            let vLineId = point.vLineId
            let x = point.x
            let y = point.y
            if (point.hLineId === dropped.hLineId) {
                hLineId = pointTarget.hLineId
                y = pointTarget.y
            }
            if (point.vLineId === dropped.vLineId) {
                vLineId = pointTarget.vLineId
                x = pointTarget.x
            }
            if (hLineId === point.hLineId && vLineId === point.vLineId && x === point.x && y === point.y) result.push(point)
            else result.push({ ...point, hLineId, vLineId, x, y })
        }
        return result
    }
    return attachToOverlappedLines(points, dropped, thresholdPt)
}

/**
 * Attaches a freshly placed point to any existing cut line it overlaps
 * (within thresholdPt per axis), making it a control point of that line.
 * Used when the user clicks on or near an existing line.
 */
export function attachPointToLines(points: SlicePoint[], pointId: number, thresholdPt: number): SlicePoint[] {
    let target: SlicePoint | null = null
    for (let i = 0; i < points.length; i++) {
        if (points[i]!.id === pointId) target = points[i]!
    }
    if (target === null) return points
    return attachToOverlappedLines(points, target, thresholdPt)
}

/** Merges the source point's lines into lines of other points it overlaps. */
function attachToOverlappedLines(points: SlicePoint[], source: SlicePoint, thresholdPt: number): SlicePoint[] {
    let hTarget: SliceLinePosition | null = null
    let vTarget: SliceLinePosition | null = null
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        if (point.id === source.id) continue
        if (hTarget === null && point.hLineId !== source.hLineId && Math.abs(point.y - source.y) <= thresholdPt) {
            hTarget = { lineId: point.hLineId, pos: point.y }
        }
        if (vTarget === null && point.vLineId !== source.vLineId && Math.abs(point.x - source.x) <= thresholdPt) {
            vTarget = { lineId: point.vLineId, pos: point.x }
        }
    }
    if (hTarget === null && vTarget === null) return points
    const result: SlicePoint[] = []
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        // The source point's whole line joins the target line (its other
        // control points already sit at the same position)
        let hLineId = point.hLineId
        let vLineId = point.vLineId
        let x = point.x
        let y = point.y
        if (hTarget !== null && point.hLineId === source.hLineId) {
            hLineId = hTarget.lineId
            y = hTarget.pos
        }
        if (vTarget !== null && point.vLineId === source.vLineId) {
            vLineId = vTarget.lineId
            x = vTarget.pos
        }
        if (hLineId === point.hLineId && vLineId === point.vLineId && x === point.x && y === point.y) result.push(point)
        else result.push({ ...point, hLineId, vLineId, x, y })
    }
    return result
}

/** Deletes a control point; a line disappears together with its last control point. */
export function deleteSlicePoint(points: SlicePoint[], pointId: number): SlicePoint[] {
    const result: SlicePoint[] = []
    for (let i = 0; i < points.length; i++) {
        if (points[i]!.id !== pointId) result.push(points[i]!)
    }
    return result
}

/** Unique cut lines for rendering, one entry per shared line id. */
export function collectSliceLines(points: SlicePoint[]): { h: SliceLinePosition[], v: SliceLinePosition[] } {
    const h: SliceLinePosition[] = []
    const v: SliceLinePosition[] = []
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        if (!containsLine(h, point.hLineId)) h.push({ lineId: point.hLineId, pos: point.y })
        if (!containsLine(v, point.vLineId)) v.push({ lineId: point.vLineId, pos: point.x })
    }
    return { h, v }
}

function containsLine(lines: SliceLinePosition[], lineId: number): boolean {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.lineId === lineId) return true
    }
    return false
}

/** Grid pieces for every target that at least one cut line crosses. */
export function computeSlicePieces(targets: SliceTarget[], points: SlicePoint[]): SlicePiece[] {
    const pieces: SlicePiece[] = []
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!
        const cuts = buildTargetCuts(target.rect, points)
        if (cuts.xs.length === 0 && cuts.ys.length === 0) continue
        appendTargetPieces(target, cuts.xs, cuts.ys, pieces)
    }
    return pieces
}

function appendTargetPieces(target: SliceTarget, xs: number[], ys: number[], out: SlicePiece[]): void {
    const cols = [target.rect.x, ...xs, target.rect.x + target.rect.width]
    const rows = [target.rect.y, ...ys, target.rect.y + target.rect.height]
    for (let r = 0; r < rows.length - 1; r++) {
        for (let c = 0; c < cols.length - 1; c++) {
            out.push({
                key: pieceKey(target.key, r, c),
                targetKey: target.key,
                row: r,
                col: c,
                rect: { x: cols[c]!, y: rows[r]!, width: cols[c + 1]! - cols[c]!, height: rows[r + 1]! - rows[r]! },
            })
        }
    }
}

// =====================================
// Raster piece source mapping
// =====================================

/**
 * Maps a piece rectangle (page coordinates) back to the source pixel
 * rectangle of the placed image. Imported images always use fillFrame
 * scaling, so the mapping is a pure axis swap/flip (rotation is limited to
 * 0/90/180/270 by the importer) plus a linear stretch. Pixel edges are
 * rounded so adjacent pieces share exact pixel boundaries.
 */
export function imagePieceSourceRect(
    elementRect: SliceRect,
    rotation: number,
    piece: SliceRect,
    imageWidth: number,
    imageHeight: number,
): { sx: number, sy: number, sw: number, sh: number } {
    const ax = elementRect.x
    const ay = elementRect.y
    const aw = elementRect.width
    const ah = elementRect.height
    let u0: number
    let u1: number
    let v0: number
    let v1: number
    if (rotation === 0) {
        u0 = (piece.x - ax) / aw
        u1 = (piece.x + piece.width - ax) / aw
        v0 = (piece.y - ay) / ah
        v1 = (piece.y + piece.height - ay) / ah
    } else if (rotation === 90) {
        u0 = (piece.y - ay) / ah
        u1 = (piece.y + piece.height - ay) / ah
        v0 = (ax + aw - piece.x - piece.width) / aw
        v1 = (ax + aw - piece.x) / aw
    } else if (rotation === 180) {
        u0 = (ax + aw - piece.x - piece.width) / aw
        u1 = (ax + aw - piece.x) / aw
        v0 = (ay + ah - piece.y - piece.height) / ah
        v1 = (ay + ah - piece.y) / ah
    } else if (rotation === 270) {
        u0 = (ay + ah - piece.y - piece.height) / ah
        u1 = (ay + ah - piece.y) / ah
        v0 = (piece.x - ax) / aw
        v1 = (piece.x + piece.width - ax) / aw
    } else {
        throw new Error('PDF import slice error: unsupported image rotation ' + rotation)
    }
    let sx = Math.round(u0 * imageWidth)
    let sy = Math.round(v0 * imageHeight)
    const sx1 = Math.round(u1 * imageWidth)
    const sy1 = Math.round(v1 * imageHeight)
    sx = Math.max(0, Math.min(imageWidth - 1, sx))
    sy = Math.max(0, Math.min(imageHeight - 1, sy))
    const sw = Math.max(1, Math.min(imageWidth - sx, sx1 - sx))
    const sh = Math.max(1, Math.min(imageHeight - sy, sy1 - sy))
    return { sx, sy, sw, sh }
}

// =====================================
// Shape outlines (rectangle / ellipse to subpaths)
// =====================================

export function ellipseSubpaths(width: number, height: number): PathSubpath[] {
    const cx = width / 2
    const cy = height / 2
    const rx = cx
    const ry = cy
    const kx = rx * KAPPA
    const ky = ry * KAPPA
    return [{
        closed: true,
        anchors: [
            { x: cx, y: 0, inX: cx - kx, inY: 0, outX: cx + kx, outY: 0, handleMode: 'symmetric' },
            { x: width, y: cy, inX: width, inY: cy - ky, outX: width, outY: cy + ky, handleMode: 'symmetric' },
            { x: cx, y: height, inX: cx + kx, inY: height, outX: cx - kx, outY: height, handleMode: 'symmetric' },
            { x: 0, y: cy, inX: 0, inY: cy + ky, outX: 0, outY: cy - ky, handleMode: 'symmetric' },
        ],
    }]
}

export function roundedRectangleSubpaths(width: number, height: number, topLeft: number, topRight: number, bottomRight: number, bottomLeft: number): PathSubpath[] {
    const limit = Math.min(width, height) / 2
    const tl = clampRadius(topLeft, limit)
    const tr = clampRadius(topRight, limit)
    const br = clampRadius(bottomRight, limit)
    const bl = clampRadius(bottomLeft, limit)
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return createRectanglePath(width, height)
    // Clockwise outline; each rounded corner contributes the quarter-circle
    // arc start and end anchors, a sharp corner contributes a single anchor
    const anchors: PathAnchor[] = []
    appendCorner(anchors, tl, 0, tl, 0, tl - tl * KAPPA, tl, 0, tl - tl * KAPPA, 0, 0, 0)
    appendCorner(anchors, tr, width - tr, 0, width - tr + tr * KAPPA, 0, width, tr, width, tr - tr * KAPPA, width, 0)
    appendCorner(anchors, br, width, height - br, width, height - br + br * KAPPA, width - br, height, width - br + br * KAPPA, height, width, height)
    appendCorner(anchors, bl, bl, height, bl - bl * KAPPA, height, 0, height - bl, 0, height - bl + bl * KAPPA, 0, height)
    return [{ closed: true, anchors }]
}

function clampRadius(radius: number, limit: number): number {
    if (!(radius > 0)) return 0
    return Math.min(radius, limit)
}

function appendCorner(
    anchors: PathAnchor[], radius: number,
    startX: number, startY: number, startOutX: number, startOutY: number,
    endX: number, endY: number, endInX: number, endInY: number,
    cornerX: number, cornerY: number,
): void {
    if (radius === 0) {
        anchors.push({ x: cornerX, y: cornerY, inX: cornerX, inY: cornerY, outX: cornerX, outY: cornerY, handleMode: 'independent' })
        return
    }
    anchors.push({ x: startX, y: startY, inX: startX, inY: startY, outX: startOutX, outY: startOutY, handleMode: 'independent' })
    anchors.push({ x: endX, y: endY, inX: endInX, inY: endInY, outX: endX, outY: endY, handleMode: 'independent' })
}

// =====================================
// Slice execution (applied to the converted editor elements at import time)
// =====================================

type ApplyContext = {
    images: Record<string, Uint8Array>,
    cutTargets: Map<string, { target: SliceTarget, xs: number[], ys: number[] }>,
    disabled: ReadonlySet<string>,
    counter: number,
    sliceImageCounter: number,
    bitmapCache: Map<string, ImageBitmap>,
    newImages: Record<string, Uint8Array>
}

/**
 * Cuts the converted elements along the slice lines, drops the pieces the
 * user disabled and returns the rebuilt tree together with the image byte
 * record referenced by it (cropped pieces added, unreferenced originals
 * removed). Element ids continue from firstElementId.
 */
export async function applySlicesToImport(
    elements: TemplateElement[],
    images: Record<string, Uint8Array>,
    targets: SliceTarget[],
    points: SlicePoint[],
    disabled: ReadonlySet<string>,
    firstElementId: number,
): Promise<SliceApplyResult> {
    const cutTargets = new Map<string, { target: SliceTarget, xs: number[], ys: number[] }>()
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!
        const cuts = buildTargetCuts(target.rect, points)
        if (cuts.xs.length === 0 && cuts.ys.length === 0) continue
        cutTargets.set(target.key, { target, xs: cuts.xs, ys: cuts.ys })
    }
    if (cutTargets.size === 0) return { elements, images, nextElementIdCounter: firstElementId }
    const context: ApplyContext = {
        images,
        cutTargets,
        disabled,
        counter: firstElementId,
        sliceImageCounter: 0,
        bitmapCache: new Map(),
        newImages: {},
    }
    const rebuilt = await rebuildElements(elements, 0, 0, '', context)
    const referenced = new Set<string>()
    collectImageSources(rebuilt, referenced)
    const outImages: Record<string, Uint8Array> = {}
    const originalKeys = Object.keys(images)
    for (let i = 0; i < originalKeys.length; i++) {
        const key = originalKeys[i]!
        if (referenced.has(key)) outImages[key] = images[key]!
    }
    const newKeys = Object.keys(context.newImages)
    for (let i = 0; i < newKeys.length; i++) {
        outImages[newKeys[i]!] = context.newImages[newKeys[i]!]!
    }
    return { elements: rebuilt, images: outImages, nextElementIdCounter: context.counter }
}

function nextElementId(context: ApplyContext): string {
    const id = 'el_' + context.counter
    context.counter++
    return id
}

async function rebuildElements(
    elements: TemplateElement[],
    offsetX: number,
    offsetY: number,
    prefix: string,
    context: ApplyContext,
): Promise<TemplateElement[]> {
    const result: TemplateElement[] = []
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        const key = prefix === '' ? String(i) : prefix + '-' + i
        const entry = context.cutTargets.get(key)
        if (entry !== undefined) {
            if (entry.target.kind === 'image') {
                const pieces = await sliceImageElement(element, entry.target, entry.xs, entry.ys, offsetX, offsetY, context)
                for (let j = 0; j < pieces.length; j++) result.push(pieces[j]!)
            } else {
                const pieces = sliceVectorElement(element, entry.target, entry.xs, entry.ys, offsetX, offsetY, context)
                for (let j = 0; j < pieces.length; j++) result.push(pieces[j]!)
            }
            continue
        }
        if (element.children.length > 0) {
            const children = await rebuildElements(element.children, offsetX + element.x, offsetY + element.y, key, context)
            result.push(children === element.children ? element : { ...element, children })
            continue
        }
        result.push(element)
    }
    return result
}

async function sliceImageElement(
    element: TemplateElement,
    target: SliceTarget,
    xs: number[],
    ys: number[],
    offsetX: number,
    offsetY: number,
    context: ApplyContext,
): Promise<TemplateElement[]> {
    const bytes = context.images[element.source]
    if (bytes === undefined) throw new Error('PDF import slice error: image bytes not found for ' + element.source)
    let bitmap = context.bitmapCache.get(element.source)
    if (bitmap === undefined) {
        bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
        context.bitmapCache.set(element.source, bitmap)
    }
    const rotation = element.style.rotation
    const pieces: SlicePiece[] = []
    appendTargetPieces(target, xs, ys, pieces)
    const result: TemplateElement[] = []
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!
        if (context.disabled.has(piece.key)) continue
        const source = imagePieceSourceRect(target.rect, rotation, piece.rect, bitmap.width, bitmap.height)
        const pngBytes = await cropBitmapToPng(bitmap, source.sx, source.sy, source.sw, source.sh)
        const sourceKey = 'slice_' + context.sliceImageCounter + '.png'
        context.sliceImageCounter++
        context.newImages[sourceKey] = pngBytes
        result.push({
            ...element,
            id: nextElementId(context),
            x: piece.rect.x - offsetX,
            y: piece.rect.y - offsetY,
            width: piece.rect.width,
            height: piece.rect.height,
            source: sourceKey,
        })
    }
    return result
}

async function cropBitmapToPng(bitmap: ImageBitmap, sx: number, sy: number, sw: number, sh: number): Promise<Uint8Array> {
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('PDF import slice error: canvas 2d context is unavailable')
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
    const blob = await new Promise<Blob>(function (resolve, reject) {
        canvas.toBlob(function (value) {
            if (value === null) reject(new Error('PDF import slice error: PNG encoding failed'))
            else resolve(value)
        }, 'image/png')
    })
    return new Uint8Array(await blob.arrayBuffer())
}

function sliceVectorElement(
    element: TemplateElement,
    target: SliceTarget,
    xs: number[],
    ys: number[],
    offsetX: number,
    offsetY: number,
    context: ApplyContext,
): TemplateElement[] {
    let base = element.kind === 'path' ? element : shapeToPathElement(element)
    const source = base.importedPdfRenderState?.path?.pdfSourceVector
    if (source !== undefined) {
        const materialized = materializePdfSourceVector(source)
        const { pdfSourceVector: _source, ...ordinaryPathState } = base.importedPdfRenderState!.path!
        base = {
            ...base,
            pathSubpaths: pathArraysToSubpaths(materialized.commands, materialized.coords),
            importedPdfRenderState: { ...base.importedPdfRenderState!, path: ordinaryPathState },
        }
    }
    const localX = offsetX + element.x
    const localY = offsetY + element.y
    const pieces: SlicePiece[] = []
    appendTargetPieces(target, xs, ys, pieces)
    const result: TemplateElement[] = []
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!
        if (context.disabled.has(piece.key)) continue
        const clipped = clipSubpathsToRect(base.pathSubpaths, {
            x: piece.rect.x - localX,
            y: piece.rect.y - localY,
            width: piece.rect.width,
            height: piece.rect.height,
        })
        if (clipped.length === 0) continue
        const normalized = normalizePathBounds(clipped)
        result.push({
            ...base,
            id: nextElementId(context),
            x: element.x + normalized.bounds.x,
            y: element.y + normalized.bounds.y,
            width: normalized.bounds.width,
            height: normalized.bounds.height,
            pathSubpaths: normalized.subpaths,
            pathGradient: remapPieceGradient(base.pathGradient, base.pathFillType, element.width, element.height, normalized.bounds),
            pathComplexFill: offsetComplexFill(base.pathComplexFill, normalized.bounds.x, normalized.bounds.y),
        })
    }
    return result
}

/**
 * Rebases a rectangle / ellipse element onto the path element model so its
 * pieces can carry the clipped outline. Shared stroke fields stay in place;
 * the shape fill moves to the path fill slots.
 */
function shapeToPathElement(element: TemplateElement): TemplateElement {
    const subpaths = element.kind === 'ellipse'
        ? ellipseSubpaths(element.width, element.height)
        : roundedRectangleSubpaths(
            element.width, element.height,
            element.topLeftRadius, element.topRightRadius, element.bottomRightRadius, element.bottomLeftRadius,
        )
    return {
        ...element,
        kind: 'path',
        pathSubpaths: subpaths,
        pathFillType: element.shapeFillType,
        pathFillColor: element.shapeFillColor,
        pathGradient: element.shapeGradient,
        pathStrokeDash: [],
        pathStrokeCap: 'butt',
        pathStrokeJoin: 'miter',
    }
}

type EditorGradient = TemplateElement['pathGradient']

/**
 * Gradient coordinates are normalized to the element bounds; a piece covers
 * only part of the original box, so the coordinates are rebased to keep the
 * painted gradient visually identical across the pieces.
 */
function remapPieceGradient(
    gradient: EditorGradient,
    fillType: TemplateElement['pathFillType'],
    originalWidth: number,
    originalHeight: number,
    bounds: { x: number, y: number, width: number, height: number },
): EditorGradient {
    if (fillType !== 'linear' && fillType !== 'radial') return gradient
    const bw = bounds.width > 0 ? bounds.width : 1
    const bh = bounds.height > 0 ? bounds.height : 1
    const shading = gradient.pdfShading
    const native = shading?.native
    return {
        x1: (gradient.x1 * originalWidth - bounds.x) / bw,
        y1: (gradient.y1 * originalHeight - bounds.y) / bh,
        x2: (gradient.x2 * originalWidth - bounds.x) / bw,
        y2: (gradient.y2 * originalHeight - bounds.y) / bh,
        cx: (gradient.cx * originalWidth - bounds.x) / bw,
        cy: (gradient.cy * originalHeight - bounds.y) / bh,
        r: gradient.r * originalWidth / bw,
        stops: gradient.stops,
        pdfShading: shading === undefined ? undefined : {
            ...shading,
            bbox: shading.bbox === undefined ? undefined : [
                shading.bbox[0] - bounds.x,
                shading.bbox[1] - bounds.y,
                shading.bbox[2] - bounds.x,
                shading.bbox[3] - bounds.y,
            ],
            native: native === undefined ? undefined : {
                ...native,
                patternMatrix: [
                    native.patternMatrix[0], native.patternMatrix[1],
                    native.patternMatrix[2], native.patternMatrix[3],
                    native.patternMatrix[4] - bounds.x,
                    native.patternMatrix[5] - bounds.y,
                ],
            },
        },
    }
}

/** Complex fills are element-local: pieces shift their geometry with the new origin. */
function offsetComplexFill(fill: TemplateElement['pathComplexFill'], dx: number, dy: number): TemplateElement['pathComplexFill'] {
    if (fill === null || (dx === 0 && dy === 0)) return fill
    if (fill.type === 'pdfSpecialColor') return fill
    if (fill.type === 'meshGradient') {
        const shift = function (points: number[]): number[] {
            const result: number[] = []
            for (let i = 0; i < points.length; i += 2) result.push(points[i]! - dx, points[i + 1]! - dy)
            return result
        }
        const shiftPacked = function (packed: { points: Float32Array, colors: Uint32Array } | undefined) {
            if (packed === undefined) return undefined
            const points = new Float32Array(packed.points.length)
            for (let i = 0; i < packed.points.length; i += 2) {
                points[i] = packed.points[i]! - dx
                points[i + 1] = packed.points[i + 1]! - dy
            }
            return { points, colors: packed.colors }
        }
        const native = fill.pdfShading?.native
        return {
            ...fill,
            patches: fill.patches?.map(function (patch) { return { points: shift(patch.points), colors: patch.colors } }),
            triangles: fill.triangles?.map(function (triangle) { return { points: shift(triangle.points), colors: triangle.colors } }),
            packedPatches: shiftPacked(fill.packedPatches),
            packedTriangles: shiftPacked(fill.packedTriangles),
            lattice: fill.lattice === undefined ? undefined : { ...fill.lattice, points: shift(fill.lattice.points) },
            pdfShading: fill.pdfShading === undefined ? undefined : {
                ...fill.pdfShading,
                bbox: fill.pdfShading.bbox === undefined ? undefined : [
                    fill.pdfShading.bbox[0] - dx, fill.pdfShading.bbox[1] - dy,
                    fill.pdfShading.bbox[2] - dx, fill.pdfShading.bbox[3] - dy,
                ],
                native: native === undefined ? undefined : {
                    ...native,
                    matrix: [
                        native.matrix[0], native.matrix[1], native.matrix[2], native.matrix[3],
                        native.matrix[4] - dx, native.matrix[5] - dy,
                    ],
                },
            },
        }
    }
    const m = fill.matrix ?? [1, 0, 0, 1, 0, 0]
    return { ...fill, matrix: [m[0], m[1], m[2], m[3], m[4] - dx, m[5] - dy] }
}

function collectImageSources(elements: TemplateElement[], out: Set<string>): void {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        if (element.kind === 'image' && element.source !== '') out.add(element.source)
        if (element.children.length > 0) collectImageSources(element.children, out)
    }
}
