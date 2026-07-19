// Geometric clipping of editor path subpaths against an axis-aligned
// rectangle. Cubic segments are split exactly at the boundary crossings and
// the kept portions of a closed subpath are reconnected with straight edges
// that lie on the boundary line (Sutherland-Hodgman generalized to bezier
// outlines). Open subpaths are split into separate runs without reconnection.

import type { PathAnchor, PathSubpath } from './path_model'

export type ClipRect = { x: number, y: number, width: number, height: number }

/** axis 0 = x, 1 = y. Inside when keep * (coord - value) >= -SIDE_EPS. */
type HalfPlane = { axis: 0 | 1, value: number, keep: 1 | -1 }

/** One cubic (or straight, when control points are degenerate) segment. */
type ClipSeg = {
    x0: number, y0: number,
    c1x: number, c1y: number,
    c2x: number, c2y: number,
    x1: number, y1: number
}

type ClipPiece = { seg: ClipSeg, inside: boolean }

const SIDE_EPS = 1e-6
const JOIN_EPS = 1e-6
const ROOT_EPS = 1e-9

export function clipSubpathsToRect(subpaths: PathSubpath[], rect: ClipRect): PathSubpath[] {
    const planes: HalfPlane[] = [
        { axis: 0, value: rect.x, keep: 1 },
        { axis: 0, value: rect.x + rect.width, keep: -1 },
        { axis: 1, value: rect.y, keep: 1 },
        { axis: 1, value: rect.y + rect.height, keep: -1 },
    ]
    let current = subpaths
    for (let p = 0; p < planes.length; p++) {
        const next: PathSubpath[] = []
        for (let i = 0; i < current.length; i++) {
            const clipped = clipSubpathByPlane(current[i]!, planes[p]!)
            for (let j = 0; j < clipped.length; j++) next.push(clipped[j]!)
        }
        current = next
    }
    const result: PathSubpath[] = []
    for (let i = 0; i < current.length; i++) {
        if (!isZeroAreaClosed(current[i]!)) result.push(current[i]!)
    }
    return result
}

function clipSubpathByPlane(subpath: PathSubpath, plane: HalfPlane): PathSubpath[] {
    const anchors = subpath.anchors
    if (anchors.length === 0) return []
    if (anchors.length === 1) {
        const coord = plane.axis === 0 ? anchors[0]!.x : anchors[0]!.y
        return plane.keep * (coord - plane.value) >= -SIDE_EPS ? [subpath] : []
    }
    const count = anchors.length
    const segmentCount = subpath.closed ? count : count - 1
    const pieces: ClipPiece[] = []
    let allInside = true
    let anyInside = false
    for (let i = 0; i < segmentCount; i++) {
        const a = anchors[i]!
        const b = anchors[(i + 1) % count]!
        const seg: ClipSeg = { x0: a.x, y0: a.y, c1x: a.outX, c1y: a.outY, c2x: b.inX, c2y: b.inY, x1: b.x, y1: b.y }
        const parts = splitSegByPlane(seg, plane)
        for (let j = 0; j < parts.length; j++) {
            const part = parts[j]!
            if (part.inside) anyInside = true
            else allInside = false
            pieces.push(part)
        }
    }
    if (allInside) return [subpath]
    if (!anyInside) return []
    if (subpath.closed) {
        const result = assembleClosed(pieces)
        return result === null ? [] : [result]
    }
    return assembleOpenRuns(pieces)
}

function splitSegByPlane(seg: ClipSeg, plane: HalfPlane): ClipPiece[] {
    if (isLineSeg(seg)) return splitLineSegByPlane(seg, plane)
    const q0 = axisCoord(seg.x0, seg.y0, plane.axis)
    const q1 = axisCoord(seg.c1x, seg.c1y, plane.axis)
    const q2 = axisCoord(seg.c2x, seg.c2y, plane.axis)
    const q3 = axisCoord(seg.x1, seg.y1, plane.axis)
    const roots = cubicCrossings(q0, q1, q2, q3, plane.value)
    if (roots.length === 0) {
        return [{ seg, inside: classifyWholeSeg(q0, q1, q2, q3, plane) }]
    }
    const parts = splitCubicAt(seg, roots)
    // Snap the split joints exactly onto the boundary line so that later
    // reconnection edges stay collinear with the boundary
    for (let i = 0; i < parts.length - 1; i++) {
        const a = parts[i]!
        const b = parts[i + 1]!
        if (plane.axis === 0) {
            a.x1 = plane.value
            b.x0 = plane.value
        } else {
            a.y1 = plane.value
            b.y0 = plane.value
        }
    }
    const result: ClipPiece[] = []
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!
        const mid = cubicPoint(part, 0.5)
        const side = plane.keep * (axisCoord(mid.x, mid.y, plane.axis) - plane.value)
        result.push({ seg: part, inside: side >= -SIDE_EPS })
    }
    return result
}

function splitLineSegByPlane(seg: ClipSeg, plane: HalfPlane): ClipPiece[] {
    const a0 = axisCoord(seg.x0, seg.y0, plane.axis)
    const a1 = axisCoord(seg.x1, seg.y1, plane.axis)
    const s0 = plane.keep * (a0 - plane.value)
    const s1 = plane.keep * (a1 - plane.value)
    if (s0 >= -SIDE_EPS && s1 >= -SIDE_EPS) return [{ seg, inside: true }]
    if (s0 <= SIDE_EPS && s1 <= SIDE_EPS) return [{ seg, inside: false }]
    const t = (plane.value - a0) / (a1 - a0)
    let mx = seg.x0 + (seg.x1 - seg.x0) * t
    let my = seg.y0 + (seg.y1 - seg.y0) * t
    if (plane.axis === 0) mx = plane.value
    else my = plane.value
    return [
        { seg: lineSeg(seg.x0, seg.y0, mx, my), inside: s0 > 0 },
        { seg: lineSeg(mx, my, seg.x1, seg.y1), inside: s1 > 0 },
    ]
}

/**
 * Classifies a segment that has no interior boundary crossing. The whole
 * curve lies on one side; sample several points and use the one farthest
 * from the boundary so a curve hugging the line is still classified stably.
 */
function classifyWholeSeg(q0: number, q1: number, q2: number, q3: number, plane: HalfPlane): boolean {
    let best = 0
    let bestAbs = -1
    for (let i = 0; i <= 4; i++) {
        const t = i / 4
        const v = cubicValue(q0, q1, q2, q3, t)
        const side = plane.keep * (v - plane.value)
        const abs = Math.abs(side)
        if (abs > bestAbs) {
            bestAbs = abs
            best = side
        }
    }
    return best >= -SIDE_EPS
}

function assembleClosed(pieces: ClipPiece[]): PathSubpath | null {
    const out: ClipSeg[] = []
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!
        if (!piece.inside) continue
        if (isEmptySeg(piece.seg)) continue
        if (out.length > 0) {
            const prev = out[out.length - 1]!
            if (Math.abs(prev.x1 - piece.seg.x0) > JOIN_EPS || Math.abs(prev.y1 - piece.seg.y0) > JOIN_EPS) {
                out.push(lineSeg(prev.x1, prev.y1, piece.seg.x0, piece.seg.y0))
            }
        }
        out.push(piece.seg)
    }
    // The gap between the last and the first kept segment (if any) is closed
    // by the subpath's implicit closing line, which lies on the boundary
    return segsToSubpath(out, true)
}

function assembleOpenRuns(pieces: ClipPiece[]): PathSubpath[] {
    const result: PathSubpath[] = []
    let run: ClipSeg[] = []
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!
        const connected = piece.inside && !isEmptySeg(piece.seg)
            && (run.length === 0
                || (Math.abs(run[run.length - 1]!.x1 - piece.seg.x0) <= JOIN_EPS
                    && Math.abs(run[run.length - 1]!.y1 - piece.seg.y0) <= JOIN_EPS))
        if (connected) {
            run.push(piece.seg)
            continue
        }
        const subpath = segsToSubpath(run, false)
        if (subpath !== null) result.push(subpath)
        run = piece.inside && !isEmptySeg(piece.seg) ? [piece.seg] : []
    }
    const last = segsToSubpath(run, false)
    if (last !== null) result.push(last)
    return result
}

function segsToSubpath(segs: ClipSeg[], closed: boolean): PathSubpath | null {
    if (segs.length === 0) return null
    const anchors: PathAnchor[] = []
    const first = segs[0]!
    anchors.push({ x: first.x0, y: first.y0, inX: first.x0, inY: first.y0, outX: first.c1x, outY: first.c1y, handleMode: 'independent' })
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]!
        anchors[anchors.length - 1]!.outX = seg.c1x
        anchors[anchors.length - 1]!.outY = seg.c1y
        anchors.push({ x: seg.x1, y: seg.y1, inX: seg.c2x, inY: seg.c2y, outX: seg.x1, outY: seg.y1, handleMode: 'independent' })
    }
    if (closed) {
        const last = anchors[anchors.length - 1]!
        const head = anchors[0]!
        if (Math.abs(last.x - head.x) <= JOIN_EPS && Math.abs(last.y - head.y) <= JOIN_EPS) {
            head.inX = last.inX
            head.inY = last.inY
            anchors.pop()
        }
        if (anchors.length < 2) return null
        return { closed: true, anchors }
    }
    if (anchors.length < 2) return null
    return { closed: false, anchors }
}

/** A closed piece whose bounds collapse to a boundary-line sliver paints nothing. */
function isZeroAreaClosed(subpath: PathSubpath): boolean {
    if (!subpath.closed) return false
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let i = 0; i < subpath.anchors.length; i++) {
        const a = subpath.anchors[i]!
        minX = Math.min(minX, a.x, a.inX, a.outX)
        minY = Math.min(minY, a.y, a.inY, a.outY)
        maxX = Math.max(maxX, a.x, a.inX, a.outX)
        maxY = Math.max(maxY, a.y, a.inY, a.outY)
    }
    return maxX - minX < SIDE_EPS || maxY - minY < SIDE_EPS
}

function isLineSeg(seg: ClipSeg): boolean {
    return seg.c1x === seg.x0 && seg.c1y === seg.y0 && seg.c2x === seg.x1 && seg.c2y === seg.y1
}

function isEmptySeg(seg: ClipSeg): boolean {
    return Math.abs(seg.x1 - seg.x0) <= ROOT_EPS && Math.abs(seg.y1 - seg.y0) <= ROOT_EPS
        && Math.abs(seg.c1x - seg.x0) <= ROOT_EPS && Math.abs(seg.c1y - seg.y0) <= ROOT_EPS
        && Math.abs(seg.c2x - seg.x0) <= ROOT_EPS && Math.abs(seg.c2y - seg.y0) <= ROOT_EPS
}

function lineSeg(x0: number, y0: number, x1: number, y1: number): ClipSeg {
    return { x0, y0, c1x: x0, c1y: y0, c2x: x1, c2y: y1, x1, y1 }
}

function axisCoord(x: number, y: number, axis: 0 | 1): number {
    return axis === 0 ? x : y
}

function cubicValue(q0: number, q1: number, q2: number, q3: number, t: number): number {
    const mt = 1 - t
    return mt * mt * mt * q0 + 3 * mt * mt * t * q1 + 3 * mt * t * t * q2 + t * t * t * q3
}

function cubicPoint(seg: ClipSeg, t: number): { x: number, y: number } {
    return {
        x: cubicValue(seg.x0, seg.c1x, seg.c2x, seg.x1, t),
        y: cubicValue(seg.y0, seg.c1y, seg.c2y, seg.y1, t),
    }
}

/**
 * Finds the parameters in (0, 1) where the cubic component crosses `value`.
 * The cubic is separated into monotonic intervals at its derivative roots;
 * a sign change over a monotonic interval brackets exactly one crossing,
 * found by bisection. Tangential touches (no sign change) do not need a
 * split because the curve stays on one side of the boundary there.
 */
function cubicCrossings(q0: number, q1: number, q2: number, q3: number, value: number): number[] {
    const a = -q0 + 3 * q1 - 3 * q2 + q3
    const b = 3 * q0 - 6 * q1 + 3 * q2
    const c = -3 * q0 + 3 * q1
    const d = q0 - value
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1)
    const zero = scale * 1e-12

    const stops: number[] = [0]
    // Derivative roots: 3a t^2 + 2b t + c = 0
    const da = 3 * a
    const db = 2 * b
    if (Math.abs(da) > zero) {
        const disc = db * db - 4 * da * c
        if (disc > 0) {
            const s = Math.sqrt(disc)
            addStop(stops, (-db + s) / (2 * da))
            addStop(stops, (-db - s) / (2 * da))
        }
    } else if (Math.abs(db) > zero) {
        addStop(stops, -c / db)
    }
    stops.push(1)
    stops.sort(function (p, q) { return p - q })

    const roots: number[] = []
    for (let i = 0; i < stops.length - 1; i++) {
        let lo = stops[i]!
        let hi = stops[i + 1]!
        if (hi - lo <= ROOT_EPS) continue
        let flo = ((a * lo + b) * lo + c) * lo + d
        let fhi = ((a * hi + b) * hi + c) * hi + d
        if (Math.abs(flo) <= zero || Math.abs(fhi) <= zero) {
            // The interval endpoint sits on the boundary (an anchor or an
            // extremum touching the line); no interior crossing to split at
            continue
        }
        if ((flo > 0) === (fhi > 0)) continue
        for (let iter = 0; iter < 80; iter++) {
            const mid = (lo + hi) / 2
            const fmid = ((a * mid + b) * mid + c) * mid + d
            if (fmid === 0) {
                lo = mid
                hi = mid
                break
            }
            if ((fmid > 0) === (flo > 0)) {
                lo = mid
                flo = fmid
            } else {
                hi = mid
                fhi = fmid
            }
        }
        const t = (lo + hi) / 2
        if (t > ROOT_EPS && t < 1 - ROOT_EPS) roots.push(t)
    }
    roots.sort(function (p, q) { return p - q })
    const deduped: number[] = []
    for (let i = 0; i < roots.length; i++) {
        if (deduped.length === 0 || roots[i]! - deduped[deduped.length - 1]! > 1e-7) deduped.push(roots[i]!)
    }
    return deduped
}

function addStop(stops: number[], t: number): void {
    if (t > ROOT_EPS && t < 1 - ROOT_EPS) stops.push(t)
}

function splitCubicAt(seg: ClipSeg, ts: number[]): ClipSeg[] {
    const result: ClipSeg[] = []
    let current = seg
    let consumed = 0
    for (let i = 0; i < ts.length; i++) {
        const local = (ts[i]! - consumed) / (1 - consumed)
        const halves = subdivideCubic(current, local)
        result.push(halves[0])
        current = halves[1]
        consumed = ts[i]!
    }
    result.push(current)
    return result
}

function subdivideCubic(seg: ClipSeg, t: number): [ClipSeg, ClipSeg] {
    const p01x = seg.x0 + (seg.c1x - seg.x0) * t
    const p01y = seg.y0 + (seg.c1y - seg.y0) * t
    const p12x = seg.c1x + (seg.c2x - seg.c1x) * t
    const p12y = seg.c1y + (seg.c2y - seg.c1y) * t
    const p23x = seg.c2x + (seg.x1 - seg.c2x) * t
    const p23y = seg.c2y + (seg.y1 - seg.c2y) * t
    const p012x = p01x + (p12x - p01x) * t
    const p012y = p01y + (p12y - p01y) * t
    const p123x = p12x + (p23x - p12x) * t
    const p123y = p12y + (p23y - p12y) * t
    const px = p012x + (p123x - p012x) * t
    const py = p012y + (p123y - p012y) * t
    return [
        { x0: seg.x0, y0: seg.y0, c1x: p01x, c1y: p01y, c2x: p012x, c2y: p012y, x1: px, y1: py },
        { x0: px, y0: py, c1x: p123x, c1y: p123y, c2x: p23x, c2y: p23y, x1: seg.x1, y1: seg.y1 },
    ]
}
