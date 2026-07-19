import { describe, expect, it } from 'vitest'
import {
    computePathBounds,
    createCornerAnchor,
    hitTestPath,
    normalizePathBounds,
    removeAnchor,
    splitSegmentAt,
    toggleAnchorSmooth,
    type PathSubpath,
} from '../src/app/[lang]/editor/path_model'

describe('path model helpers', () => {
    it('computes cubic bounds from curve extrema instead of control points', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [
                { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 100, handleMode: 'independent' },
                { x: 100, y: 0, inX: 100, inY: 100, outX: 100, outY: 0, handleMode: 'independent' },
            ],
        }]

        const bounds = computePathBounds(subpaths)

        expect(bounds.x).toBeCloseTo(0)
        expect(bounds.y).toBeCloseTo(0)
        expect(bounds.width).toBeCloseTo(100)
        expect(bounds.height).toBeCloseTo(75)
    })

    it('normalizes anchors and handles relative to computed bounds', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [
                { x: 10, y: 20, inX: 10, inY: 20, outX: 10, outY: 20, handleMode: 'independent' },
                { x: 30, y: 60, inX: 30, inY: 60, outX: 30, outY: 60, handleMode: 'independent' },
            ],
        }]

        const normalized = normalizePathBounds(subpaths)

        expect(normalized.bounds).toEqual({ x: 10, y: 20, width: 20, height: 40 })
        expect(normalized.subpaths[0]!.anchors[0]).toMatchObject({ x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 })
        expect(normalized.subpaths[0]!.anchors[1]).toMatchObject({ x: 20, y: 40, inX: 20, inY: 40, outX: 20, outY: 40 })
    })

    it('splits a straight segment and preserves surrounding endpoints', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [createCornerAnchor(0, 0), createCornerAnchor(100, 0)],
        }]

        const split = splitSegmentAt(subpaths, 0, 0, 0.5)

        expect(split[0]!.anchors).toHaveLength(3)
        expect(split[0]!.anchors[0]).toMatchObject({ x: 0, y: 0, outX: 0, outY: 0 })
        expect(split[0]!.anchors[1]).toMatchObject({ x: 50, y: 0, inX: 25, inY: 0, outX: 75, outY: 0 })
        expect(split[0]!.anchors[2]).toMatchObject({ x: 100, y: 0, inX: 100, inY: 0 })
    })

    it('removes anchors and opens single-point remnants', () => {
        const subpaths: PathSubpath[] = [{
            closed: true,
            anchors: [createCornerAnchor(0, 0), createCornerAnchor(10, 0)],
        }]

        const one = removeAnchor(subpaths, 0, 1)
        const none = removeAnchor(one, 0, 0)

        expect(one[0]!.closed).toBe(false)
        expect(one[0]!.anchors).toHaveLength(1)
        expect(none).toHaveLength(0)
    })

    it('toggles smooth handles by mirroring the active side', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [
                { x: 10, y: 10, inX: 10, inY: 10, outX: 30, outY: 20, handleMode: 'independent' },
            ],
        }]

        const smooth = toggleAnchorSmooth(subpaths, 0, 0)
        const independent = toggleAnchorSmooth(smooth, 0, 0)

        expect(smooth[0]!.anchors[0]).toMatchObject({ inX: -10, inY: 0, outX: 30, outY: 20, handleMode: 'symmetric' })
        expect(independent[0]!.anchors[0]!.handleMode).toBe('independent')
    })

    it('hit-tests anchors before collapsed handles and detects nearby segments', () => {
        const subpaths: PathSubpath[] = [{
            closed: false,
            anchors: [createCornerAnchor(0, 0), createCornerAnchor(100, 0)],
        }]

        expect(hitTestPath(subpaths, 0, 0, 4)).toEqual({ type: 'anchor', subpathIndex: 0, anchorIndex: 0 })
        expect(hitTestPath(subpaths, 52, 2, 4)).toMatchObject({ type: 'segment', subpathIndex: 0, segmentIndex: 0 })
        expect(hitTestPath(subpaths, 52, 8, 4)).toBeNull()
    })
})
