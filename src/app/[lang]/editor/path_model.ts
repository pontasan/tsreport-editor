import { PathCommand, buildSvgPathD } from 'tsreport-core'

export type PathAnchor = {
    x: number,
    y: number,
    inX: number,
    inY: number,
    outX: number,
    outY: number,
    handleMode: 'symmetric' | 'independent'
}

export type PathSubpath = {
    anchors: PathAnchor[],
    closed: boolean
}

export type PathSegment = {
    subpathIndex: number,
    segmentIndex: number,
    from: PathAnchor,
    to: PathAnchor
}

export type PathHit =
    | { type: 'anchor', subpathIndex: number, anchorIndex: number }
    | { type: 'inHandle', subpathIndex: number, anchorIndex: number }
    | { type: 'outHandle', subpathIndex: number, anchorIndex: number }
    | { type: 'segment', subpathIndex: number, segmentIndex: number, t: number }

export function createCornerAnchor(x: number, y: number): PathAnchor {
    return { x, y, inX: x, inY: y, outX: x, outY: y, handleMode: 'independent' }
}

export function createRectanglePath(width: number, height: number): PathSubpath[] {
    return [{
        closed: true,
        anchors: [
            createCornerAnchor(0, 0),
            createCornerAnchor(width, 0),
            createCornerAnchor(width, height),
            createCornerAnchor(0, height),
        ],
    }]
}

export function anchorsToSegments(subpaths: PathSubpath[]): PathSegment[] {
    const segments: PathSegment[] = []
    for (let si = 0; si < subpaths.length; si++) {
        const subpath = subpaths[si]!
        const count = subpath.anchors.length
        const segmentCount = subpath.closed ? count : count - 1
        for (let i = 0; i < segmentCount; i++) {
            segments.push({
                subpathIndex: si,
                segmentIndex: i,
                from: subpath.anchors[i]!,
                to: subpath.anchors[(i + 1) % count]!,
            })
        }
    }
    return segments
}

export function buildRenderPathArrays(subpaths: PathSubpath[]): { commands: Uint8Array, coords: Float32Array } {
    const commands: number[] = []
    const coords: number[] = []
    for (let si = 0; si < subpaths.length; si++) {
        const subpath = subpaths[si]!
        if (subpath.anchors.length === 0) continue
        const first = subpath.anchors[0]!
        commands.push(PathCommand.MoveTo)
        coords.push(first.x, first.y)
        const segmentCount = subpath.closed ? subpath.anchors.length : subpath.anchors.length - 1
        for (let i = 0; i < segmentCount; i++) {
            const a = subpath.anchors[i]!
            const b = subpath.anchors[(i + 1) % subpath.anchors.length]!
            if (a.outX !== a.x || a.outY !== a.y || b.inX !== b.x || b.inY !== b.y) {
                commands.push(PathCommand.CubicTo)
                coords.push(a.outX, a.outY, b.inX, b.inY, b.x, b.y)
            } else {
                commands.push(PathCommand.LineTo)
                coords.push(b.x, b.y)
            }
        }
        if (subpath.closed) commands.push(PathCommand.Close)
    }
    return { commands: new Uint8Array(commands), coords: new Float32Array(coords) }
}

export function buildPathD(subpaths: PathSubpath[]): string {
    const arrays = buildRenderPathArrays(subpaths)
    return buildSvgPathD(arrays.commands, arrays.coords)
}

export function pathArraysToSubpaths(commands: Uint8Array, coords: Float32Array): PathSubpath[] {
    const subpaths: PathSubpath[] = []
    let current: PathSubpath | null = null
    let coordIndex = 0
    function pushCurrent(): void {
        if (current !== null && current.anchors.length > 0) subpaths.push(current)
        current = null
    }
    for (let i = 0; i < commands.length; i++) {
        const command = commands[i]
        if (command === PathCommand.MoveTo) {
            pushCurrent()
            const x = coords[coordIndex++]!
            const y = coords[coordIndex++]!
            current = { closed: false, anchors: [createCornerAnchor(x, y)] }
        } else if (command === PathCommand.LineTo) {
            if (current === null) throw new Error('Path geometry error: LineTo before MoveTo')
            current.anchors.push(createCornerAnchor(coords[coordIndex++]!, coords[coordIndex++]!))
        } else if (command === PathCommand.CubicTo) {
            if (current === null || current.anchors.length === 0) throw new Error('Path geometry error: CubicTo before MoveTo')
            const x1 = coords[coordIndex++]!
            const y1 = coords[coordIndex++]!
            const x2 = coords[coordIndex++]!
            const y2 = coords[coordIndex++]!
            const x = coords[coordIndex++]!
            const y = coords[coordIndex++]!
            const previous = current.anchors[current.anchors.length - 1]!
            previous.outX = x1
            previous.outY = y1
            current.anchors.push({ x, y, inX: x2, inY: y2, outX: x, outY: y, handleMode: 'independent' })
        } else if (command === PathCommand.Close) {
            if (current !== null) current.closed = true
        } else {
            throw new Error(`Unknown path command: ${command}`)
        }
    }
    if (coordIndex !== coords.length) throw new Error('Path coordinate count does not match commands')
    pushCurrent()
    return subpaths
}

export function computePathBounds(subpaths: PathSubpath[]): { x: number, y: number, width: number, height: number } {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const segments = anchorsToSegments(subpaths)
    for (let si = 0; si < subpaths.length; si++) {
        const anchors = subpaths[si]!.anchors
        for (let i = 0; i < anchors.length; i++) {
            const a = anchors[i]!
            minX = Math.min(minX, a.x)
            minY = Math.min(minY, a.y)
            maxX = Math.max(maxX, a.x)
            maxY = Math.max(maxY, a.y)
        }
    }
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i]!
        const xRoots = cubicExtrema(s.from.x, s.from.outX, s.to.inX, s.to.x)
        const yRoots = cubicExtrema(s.from.y, s.from.outY, s.to.inY, s.to.y)
        for (let ri = 0; ri < xRoots.length; ri++) {
            const t = xRoots[ri]!
            const x = cubicAt(s.from.x, s.from.outX, s.to.inX, s.to.x, t)
            if (x < minX) minX = x
            if (x > maxX) maxX = x
        }
        for (let ri = 0; ri < yRoots.length; ri++) {
            const t = yRoots[ri]!
            const y = cubicAt(s.from.y, s.from.outY, s.to.inY, s.to.y, t)
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function normalizePathBounds(subpaths: PathSubpath[]): { subpaths: PathSubpath[], bounds: { x: number, y: number, width: number, height: number } } {
    const bounds = computePathBounds(subpaths)
    const normalized: PathSubpath[] = subpaths.map(function (subpath) {
        return {
            closed: subpath.closed,
            anchors: subpath.anchors.map(function (a) {
                return {
                    x: a.x - bounds.x,
                    y: a.y - bounds.y,
                    inX: a.inX - bounds.x,
                    inY: a.inY - bounds.y,
                    outX: a.outX - bounds.x,
                    outY: a.outY - bounds.y,
                    handleMode: a.handleMode,
                }
            }),
        }
    })
    return { subpaths: normalized, bounds }
}

export function splitSegmentAt(subpaths: PathSubpath[], subpathIndex: number, segmentIndex: number, t: number): PathSubpath[] {
    const subpath = subpaths[subpathIndex]
    if (subpath === undefined) return subpaths
    const count = subpath.anchors.length
    const segmentCount = subpath.closed ? count : count - 1
    if (segmentIndex < 0 || segmentIndex >= segmentCount) return subpaths
    const clampedT = Math.max(0, Math.min(1, t))
    const fromIndex = segmentIndex
    const toIndex = (segmentIndex + 1) % count
    const from = subpath.anchors[fromIndex]!
    const to = subpath.anchors[toIndex]!

    const p01 = lerpPoint(from.x, from.y, from.outX, from.outY, clampedT)
    const p12 = lerpPoint(from.outX, from.outY, to.inX, to.inY, clampedT)
    const p23 = lerpPoint(to.inX, to.inY, to.x, to.y, clampedT)
    const p012 = lerpPoint(p01.x, p01.y, p12.x, p12.y, clampedT)
    const p123 = lerpPoint(p12.x, p12.y, p23.x, p23.y, clampedT)
    const p = lerpPoint(p012.x, p012.y, p123.x, p123.y, clampedT)

    const anchors = subpath.anchors.slice()
    anchors[fromIndex] = { ...from, outX: p01.x, outY: p01.y }
    anchors[toIndex] = { ...to, inX: p23.x, inY: p23.y }
    const inserted: PathAnchor = {
        x: p.x,
        y: p.y,
        inX: p012.x,
        inY: p012.y,
        outX: p123.x,
        outY: p123.y,
        handleMode: 'independent',
    }
    anchors.splice(segmentIndex + 1, 0, inserted)

    const next = subpaths.slice()
    next[subpathIndex] = { ...subpath, anchors }
    return next
}

export function removeAnchor(subpaths: PathSubpath[], subpathIndex: number, anchorIndex: number): PathSubpath[] {
    const subpath = subpaths[subpathIndex]
    if (subpath === undefined || anchorIndex < 0 || anchorIndex >= subpath.anchors.length) return subpaths
    const anchors = subpath.anchors.slice()
    anchors.splice(anchorIndex, 1)
    const next = subpaths.slice()
    if (anchors.length === 0) {
        next.splice(subpathIndex, 1)
    } else {
        next[subpathIndex] = { ...subpath, anchors, closed: anchors.length > 1 ? subpath.closed : false }
    }
    return next
}

export function toggleAnchorSmooth(subpaths: PathSubpath[], subpathIndex: number, anchorIndex: number): PathSubpath[] {
    const subpath = subpaths[subpathIndex]
    if (subpath === undefined) return subpaths
    const anchor = subpath.anchors[anchorIndex]
    if (anchor === undefined) return subpaths
    const anchors = subpath.anchors.slice()
    if (anchor.handleMode === 'symmetric') {
        anchors[anchorIndex] = { ...anchor, handleMode: 'independent' }
    } else {
        const outDx = anchor.outX - anchor.x
        const outDy = anchor.outY - anchor.y
        const inDx = anchor.inX - anchor.x
        const inDy = anchor.inY - anchor.y
        if (outDx !== 0 || outDy !== 0) {
            anchors[anchorIndex] = {
                ...anchor,
                inX: anchor.x - outDx,
                inY: anchor.y - outDy,
                handleMode: 'symmetric',
            }
        } else if (inDx !== 0 || inDy !== 0) {
            anchors[anchorIndex] = {
                ...anchor,
                outX: anchor.x - inDx,
                outY: anchor.y - inDy,
                handleMode: 'symmetric',
            }
        } else {
            anchors[anchorIndex] = { ...anchor, handleMode: 'symmetric' }
        }
    }
    const next = subpaths.slice()
    next[subpathIndex] = { ...subpath, anchors }
    return next
}

export function hitTestPath(subpaths: PathSubpath[], x: number, y: number, tolerance: number): PathHit | null {
    let best: PathHit | null = null
    let bestDistance = tolerance
    for (let si = 0; si < subpaths.length; si++) {
        const anchors = subpaths[si]!.anchors
        for (let ai = 0; ai < anchors.length; ai++) {
            const a = anchors[ai]!
            const anchorDistance = distance(x, y, a.x, a.y)
            if (anchorDistance <= bestDistance) {
                bestDistance = anchorDistance
                best = { type: 'anchor', subpathIndex: si, anchorIndex: ai }
            }
            const inDistance = distance(x, y, a.inX, a.inY)
            if (inDistance < bestDistance) {
                bestDistance = inDistance
                best = { type: 'inHandle', subpathIndex: si, anchorIndex: ai }
            }
            const outDistance = distance(x, y, a.outX, a.outY)
            if (outDistance < bestDistance) {
                bestDistance = outDistance
                best = { type: 'outHandle', subpathIndex: si, anchorIndex: ai }
            }
        }
    }
    if (best !== null) return best

    const segments = anchorsToSegments(subpaths)
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!
        const hit = nearestSegmentSample(segment, x, y, tolerance)
        if (hit !== null && hit.distance <= bestDistance) {
            bestDistance = hit.distance
            best = { type: 'segment', subpathIndex: segment.subpathIndex, segmentIndex: segment.segmentIndex, t: hit.t }
        }
    }
    return best
}

function lerpPoint(x1: number, y1: number, x2: number, y2: number, t: number): { x: number, y: number } {
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const mt = 1 - t
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
    const a = -p0 + 3 * p1 - 3 * p2 + p3
    const b = 2 * (p0 - 2 * p1 + p2)
    const c = -p0 + p1
    const roots: number[] = []
    if (Math.abs(a) < 1e-9) {
        if (Math.abs(b) >= 1e-9) addRoot(roots, -c / b)
        return roots
    }
    const d = b * b - 4 * a * c
    if (d < 0) return roots
    const s = Math.sqrt(d)
    addRoot(roots, (-b + s) / (2 * a))
    addRoot(roots, (-b - s) / (2 * a))
    return roots
}

function addRoot(roots: number[], t: number): void {
    if (t <= 0 || t >= 1) return
    for (let i = 0; i < roots.length; i++) {
        if (Math.abs(roots[i]! - t) < 1e-9) return
    }
    roots.push(t)
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.hypot(x2 - x1, y2 - y1)
}

function nearestSegmentSample(segment: PathSegment, x: number, y: number, tolerance: number): { distance: number, t: number } | null {
    const samples = 32
    let bestDistance = Number.POSITIVE_INFINITY
    let bestT = 0
    for (let i = 0; i <= samples; i++) {
        const t = i / samples
        const sx = cubicAt(segment.from.x, segment.from.outX, segment.to.inX, segment.to.x, t)
        const sy = cubicAt(segment.from.y, segment.from.outY, segment.to.inY, segment.to.y, t)
        const d = distance(x, y, sx, sy)
        if (d <= bestDistance) {
            bestDistance = d
            bestT = t
        }
    }
    return bestDistance <= tolerance ? { distance: bestDistance, t: bestT } : null
}
