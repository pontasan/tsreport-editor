import { describe, expect, it } from 'vitest'
import { clipSubpathsToRect } from '../src/app/[lang]/editor/path_clip'
import { computePathBounds, createCornerAnchor, type PathSubpath } from '../src/app/[lang]/editor/path_model'
import { ellipseSubpaths } from '../src/app/[lang]/editor/pdf_import_slicer'

function square(size: number): PathSubpath[] {
    return [{
        closed: true,
        anchors: [
            createCornerAnchor(0, 0),
            createCornerAnchor(size, 0),
            createCornerAnchor(size, size),
            createCornerAnchor(0, size),
        ],
    }]
}

describe('clipSubpathsToRect', () => {
    it('keeps a subpath fully inside the rect unchanged', () => {
        const subpaths = square(10)
        const result = clipSubpathsToRect(subpaths, { x: -5, y: -5, width: 20, height: 20 })
        expect(result).toEqual(subpaths)
    })

    it('drops a subpath fully outside the rect', () => {
        const result = clipSubpathsToRect(square(10), { x: 20, y: 20, width: 5, height: 5 })
        expect(result).toEqual([])
    })

    it('clips a closed square to the right half', () => {
        const result = clipSubpathsToRect(square(10), { x: 5, y: 0, width: 5, height: 10 })
        expect(result).toHaveLength(1)
        expect(result[0]!.closed).toBe(true)
        const bounds = computePathBounds(result)
        expect(bounds.x).toBeCloseTo(5, 6)
        expect(bounds.y).toBeCloseTo(0, 6)
        expect(bounds.width).toBeCloseTo(5, 6)
        expect(bounds.height).toBeCloseTo(10, 6)
    })

    it('clips a closed square by a middle cell to all four boundaries', () => {
        const result = clipSubpathsToRect(square(10), { x: 2, y: 3, width: 4, height: 5 })
        expect(result).toHaveLength(1)
        const bounds = computePathBounds(result)
        expect(bounds.x).toBeCloseTo(2, 6)
        expect(bounds.y).toBeCloseTo(3, 6)
        expect(bounds.width).toBeCloseTo(4, 6)
        expect(bounds.height).toBeCloseTo(5, 6)
    })

    it('splits an open polyline into runs inside the rect', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [
                createCornerAnchor(0, 5),
                createCornerAnchor(10, 5),
                createCornerAnchor(10, 20),
                createCornerAnchor(0, 20),
            ],
        }]
        // The rect covers x in [2, 6]: the first horizontal segment produces
        // one run, the second horizontal segment (y=20) lies outside
        const result = clipSubpathsToRect(subpaths, { x: 2, y: 0, width: 4, height: 10 })
        expect(result).toHaveLength(1)
        expect(result[0]!.closed).toBe(false)
        const bounds = computePathBounds(result)
        expect(bounds.x).toBeCloseTo(2, 6)
        expect(bounds.width).toBeCloseTo(4, 6)
        expect(bounds.y).toBeCloseTo(5, 6)
        expect(bounds.height).toBeCloseTo(0, 6)
    })

    it('produces two runs when an open polyline leaves and re-enters', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [
                createCornerAnchor(0, 0),
                createCornerAnchor(10, 0),
                createCornerAnchor(10, 10),
                createCornerAnchor(0, 10),
            ],
        }]
        // Rect keeps x in [0, 5]: the polyline starts inside, leaves through
        // the right edge and re-enters on the bottom segment
        const result = clipSubpathsToRect(subpaths, { x: 0, y: -1, width: 5, height: 12 })
        expect(result).toHaveLength(2)
        expect(result.every(function (s) { return !s.closed })).toBe(true)
    })

    it('clips a bezier circle to the left half with exact boundary endpoints', () => {
        // 10x10 ellipse (circle) centered at (5,5)
        const result = clipSubpathsToRect(ellipseSubpaths(10, 10), { x: 0, y: 0, width: 5, height: 10 })
        expect(result).toHaveLength(1)
        expect(result[0]!.closed).toBe(true)
        const bounds = computePathBounds(result)
        expect(bounds.x).toBeCloseTo(0, 3)
        expect(bounds.width).toBeCloseTo(5, 3)
        expect(bounds.y).toBeCloseTo(0, 3)
        expect(bounds.height).toBeCloseTo(10, 3)
        // The cut edge anchors must sit exactly on the boundary x = 5
        const onBoundary = result[0]!.anchors.filter(function (a) { return Math.abs(a.x - 5) < 1e-6 })
        expect(onBoundary.length).toBeGreaterThanOrEqual(2)
    })

    it('clips a diagonal line segment across a corner', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [createCornerAnchor(0, 0), createCornerAnchor(10, 10)],
        }]
        const result = clipSubpathsToRect(subpaths, { x: 4, y: 4, width: 10, height: 10 })
        expect(result).toHaveLength(1)
        const anchors = result[0]!.anchors
        expect(anchors[0]!.x).toBeCloseTo(4, 6)
        expect(anchors[0]!.y).toBeCloseTo(4, 6)
        expect(anchors[anchors.length - 1]!.x).toBeCloseTo(10, 6)
        expect(anchors[anchors.length - 1]!.y).toBeCloseTo(10, 6)
    })

    it('keeps the fill closed when a concave shape is split by the rect', () => {
        // U-shape: two prongs joined at the bottom; clipping off the bottom
        // strip leaves the two prongs connected by boundary edges
        const subpaths: PathSubpath[] = [{
            closed: true,
            anchors: [
                createCornerAnchor(0, 0),
                createCornerAnchor(2, 0),
                createCornerAnchor(2, 8),
                createCornerAnchor(8, 8),
                createCornerAnchor(8, 0),
                createCornerAnchor(10, 0),
                createCornerAnchor(10, 10),
                createCornerAnchor(0, 10),
            ],
        }]
        const result = clipSubpathsToRect(subpaths, { x: 0, y: 0, width: 10, height: 5 })
        expect(result).toHaveLength(1)
        expect(result[0]!.closed).toBe(true)
        const bounds = computePathBounds(result)
        expect(bounds.height).toBeCloseTo(5, 6)
        expect(bounds.width).toBeCloseTo(10, 6)
    })

    it('drops zero-area slivers hugging the boundary', () => {
        // The square only touches the clip rect along the edge x = 10
        const result = clipSubpathsToRect(square(10), { x: 10, y: 0, width: 5, height: 10 })
        expect(result).toEqual([])
    })

    it('clips multiple subpaths independently', () => {
        const subpaths: PathSubpath[] = [...square(4), ...[{
            closed: true,
            anchors: [
                createCornerAnchor(6, 6),
                createCornerAnchor(9, 6),
                createCornerAnchor(9, 9),
                createCornerAnchor(6, 9),
            ],
        }]]
        const result = clipSubpathsToRect(subpaths, { x: 0, y: 0, width: 5, height: 5 })
        expect(result).toHaveLength(1)
        const bounds = computePathBounds(result)
        expect(bounds.width).toBeCloseTo(4, 6)
        expect(bounds.height).toBeCloseTo(4, 6)
    })
})
