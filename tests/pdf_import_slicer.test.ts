import { describe, expect, it } from 'vitest'
import type { ElementDef } from 'tsreport-core'
import { computePathBounds } from '../src/app/[lang]/editor/path_model'
import {
    addSlicePoint, applySlicesToImport, attachDroppedPoint, attachPointToLines, buildTargetCuts, collectSliceLines,
    collectSliceTargets, computeSlicePieces, deleteSlicePoint, ellipseSubpaths, imagePieceSourceRect, moveSlicePoint,
    pieceKey, remapDisabledPieces, roundedRectangleSubpaths, type SlicePoint, type SliceTarget,
} from '../src/app/[lang]/editor/pdf_import_slicer'
import { createDefaultElement, type TemplateElement } from '../src/app/[lang]/editor/reducer'

/** A slice point carrying its own h/v cut line (line ids derived from the point id) */
function point(id: number, x: number, y: number): SlicePoint {
    return { id, x, y, hLineId: id * 100 + 1, vLineId: id * 100 + 2 }
}

describe('collectSliceTargets', () => {
    it('collects graphic elements with frame offsets applied', () => {
        const elements: ElementDef[] = [
            { type: 'image', x: 10, y: 20, width: 100, height: 50, source: '0.png' },
            {
                type: 'frame', x: 0, y: 100, width: 200, height: 100,
                elements: [
                    { type: 'path', x: 5, y: 6, width: 20, height: 30, d: 'M0 0 L10 10' },
                    { type: 'staticText', x: 0, y: 0, width: 50, height: 10, text: 'x' },
                ],
            },
            { type: 'staticText', x: 0, y: 0, width: 50, height: 10, text: 'y' },
            { type: 'rectangle', x: 30, y: 40, width: 10, height: 10 },
            { type: 'ellipse', x: 60, y: 40, width: 10, height: 10 },
        ]
        const targets = collectSliceTargets(elements)
        expect(targets.map(function (t) { return t.key })).toEqual(['0', '1-0', '3', '4'])
        expect(targets[0]).toMatchObject({ kind: 'image', rect: { x: 10, y: 20, width: 100, height: 50 } })
        expect(targets[1]).toMatchObject({ kind: 'path', indexPath: [1, 0], rect: { x: 5, y: 106, width: 20, height: 30 } })
    })
})

describe('remapDisabledPieces', () => {
    const target: SliceTarget = { key: '0', indexPath: [0], kind: 'image', rect: { x: 0, y: 0, width: 100, height: 100 } }

    it('keeps the disabled region when a new cut shifts the grid indices', () => {
        // One vertical cut at x=60, right half (0:0:1) disabled; adding a cut
        // at x=30 renumbers the right half to 0:0:2 and 0:0:1 becomes the
        // middle region, which must stay enabled
        const previous = [point(1, 60, 200)]
        const next = [...previous, point(2, 30, 200)]
        const remapped = remapDisabledPieces([target], previous, next, new Set(['0:0:1']))
        expect([...remapped].sort()).toEqual(['0:0:2'])
    })

    it('disables both halves when a disabled piece is split further', () => {
        const previous = [point(1, 60, 200)]
        const next = [...previous, point(2, 200, 50)]
        const remapped = remapDisabledPieces([target], previous, next, new Set(['0:0:1']))
        expect([...remapped].sort()).toEqual(['0:0:1', '0:1:1'])
    })

    it('follows the region when a cut line is moved', () => {
        const previous = [point(1, 60, 200)]
        const next = [point(1, 40, 200)]
        const remapped = remapDisabledPieces([target], previous, next, new Set(['0:0:1']))
        expect([...remapped].sort()).toEqual(['0:0:1'])
    })

    it('drops the state when the last cut of the target is removed', () => {
        const previous = [point(1, 60, 200)]
        const remapped = remapDisabledPieces([target], previous, [], new Set(['0:0:1']))
        expect(remapped.size).toBe(0)
    })

    it('keeps states of other targets independent', () => {
        // Placed outside the x range of the vertical cuts so only the
        // horizontal line at y=250 slices it
        const second: SliceTarget = { key: '1', indexPath: [1], kind: 'path', rect: { x: 150, y: 200, width: 100, height: 100 } }
        const previous = [point(1, 300, 250), point(2, 60, 400)]
        const next = [...previous, point(3, 30, 400)]
        const remapped = remapDisabledPieces([target, second], previous, next, new Set(['0:0:1', '1:1:0']))
        expect([...remapped].sort()).toEqual(['0:0:2', '1:1:0'])
    })
})

describe('slice point operations', () => {
    it('addSlicePoint allocates non-colliding ids for the point and its lines', () => {
        const points = addSlicePoint(addSlicePoint([], 10, 20), 30, 40)
        expect(points).toHaveLength(2)
        const first = points[0]!
        const second = points[1]!
        expect(second).toMatchObject({ x: 30, y: 40 })
        const ids = [first.id, first.hLineId, first.vLineId, second.id, second.hLineId, second.vLineId]
        expect(new Set(ids).size).toBe(6)
    })

    it('moveSlicePoint moves sibling control points along the shared line', () => {
        const points: SlicePoint[] = [
            { id: 1, x: 10, y: 50, hLineId: 7, vLineId: 11 },
            { id: 2, x: 80, y: 50, hLineId: 7, vLineId: 12 },
        ]
        const moved = moveSlicePoint(points, 1, 20, 60)
        expect(moved[0]).toMatchObject({ x: 20, y: 60 })
        // The sibling follows on the shared horizontal line but keeps its own x
        expect(moved[1]).toMatchObject({ x: 80, y: 60 })
    })

    it('attachDroppedPoint makes the dropped point a control point of an overlapped horizontal line', () => {
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 40, y: 104, hLineId: 5, vLineId: 6 },
        ]
        const attached = attachDroppedPoint(points, 4, 10)
        // One shared horizontal line with two control points, two vertical lines
        expect(attached[1]).toMatchObject({ x: 40, y: 100, hLineId: 2, vLineId: 6 })
        const lines = collectSliceLines(attached)
        expect(lines.h).toHaveLength(1)
        expect(lines.v).toHaveLength(2)
    })

    it('attachDroppedPoint merges the dropped point into an overlapped point', () => {
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 104, y: 97, hLineId: 5, vLineId: 6 },
            // Shares the dropped point's horizontal line: follows the merge
            { id: 7, x: 200, y: 97, hLineId: 5, vLineId: 8 },
        ]
        const merged = attachDroppedPoint(points, 4, 10)
        expect(merged).toEqual([
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 7, x: 200, y: 100, hLineId: 2, vLineId: 8 },
        ])
    })

    it('attachDroppedPoint carries the other control points of the dropped line to the target line', () => {
        // Points 4 and 7 share the horizontal line 5; dropping 4 onto line 2 merges the lines
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 40, y: 103, hLineId: 5, vLineId: 6 },
            { id: 7, x: 70, y: 103, hLineId: 5, vLineId: 8 },
        ]
        const attached = attachDroppedPoint(points, 4, 10)
        expect(attached[1]).toMatchObject({ y: 100, hLineId: 2 })
        expect(attached[2]).toMatchObject({ y: 100, hLineId: 2 })
        expect(collectSliceLines(attached).h).toHaveLength(1)
    })

    it('attachDroppedPoint returns the input untouched when nothing overlaps', () => {
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 40, y: 130, hLineId: 5, vLineId: 6 },
        ]
        expect(attachDroppedPoint(points, 4, 10)).toBe(points)
    })

    it('attachPointToLines attaches a clicked point onto the line under the click', () => {
        // A point added by clicking on the horizontal line 2 keeps its own
        // fresh vertical line and becomes a control point of line 2
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 40, y: 99.5, hLineId: 5, vLineId: 6 },
        ]
        const attached = attachPointToLines(points, 4, 10)
        expect(attached[1]).toMatchObject({ x: 40, y: 100, hLineId: 2, vLineId: 6 })
        expect(collectSliceLines(attached).h).toHaveLength(1)
        expect(collectSliceLines(attached).v).toHaveLength(2)
    })

    it('attachPointToLines attaches to both lines near an intersection', () => {
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 104, y: 96, hLineId: 5, vLineId: 6 },
        ]
        const attached = attachPointToLines(points, 4, 10)
        expect(attached[1]).toMatchObject({ x: 100, y: 100, hLineId: 2, vLineId: 3 })
    })

    it('attachPointToLines returns the input untouched away from every line', () => {
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 40, y: 130, hLineId: 5, vLineId: 6 },
        ]
        expect(attachPointToLines(points, 4, 10)).toBe(points)
    })

    it('deleteSlicePoint keeps a shared line alive through its remaining control points', () => {
        const points: SlicePoint[] = [
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 40, y: 100, hLineId: 2, vLineId: 6 },
        ]
        const removed = deleteSlicePoint(points, 4)
        expect(removed).toEqual([points[0]])
        const lines = collectSliceLines(removed)
        // Line 2 survives via point 1; line 6 died with point 4
        expect(lines.h).toHaveLength(1)
        expect(lines.v).toHaveLength(1)
    })

    it('cuts with one horizontal and two vertical lines after attaching', () => {
        // The requested workflow: one horizontal line controlled by two
        // points, each carrying its own vertical line
        const target: SliceTarget = { key: '0', indexPath: [0], kind: 'image', rect: { x: 0, y: 0, width: 200, height: 200 } }
        const points = attachDroppedPoint([
            { id: 1, x: 100, y: 100, hLineId: 2, vLineId: 3 },
            { id: 4, x: 40, y: 104, hLineId: 5, vLineId: 6 },
        ], 4, 10)
        const cuts = buildTargetCuts(target.rect, points)
        expect(cuts.ys).toEqual([100])
        expect(cuts.xs).toEqual([40, 100])
        expect(computeSlicePieces([target], points)).toHaveLength(6)
    })
})

describe('buildTargetCuts / computeSlicePieces', () => {
    it('keeps only cut lines strictly crossing the target bounds', () => {
        const rect = { x: 10, y: 10, width: 100, height: 50 }
        const points = [
            point(1, 50, 30),  // inside: vertical + horizontal cut
            point(2, 5, 5),    // outside both axes
            point(3, 10, 10),  // exactly on the edges: no cut
        ]
        const cuts = buildTargetCuts(rect, points)
        expect(cuts.xs).toEqual([50])
        expect(cuts.ys).toEqual([30])
    })

    it('builds a row-major piece grid per crossed target', () => {
        const targets: SliceTarget[] = [
            { key: '0', indexPath: [0], kind: 'image', rect: { x: 0, y: 0, width: 100, height: 100 } },
            { key: '1', indexPath: [1], kind: 'image', rect: { x: 200, y: 200, width: 10, height: 10 } },
        ]
        const pieces = computeSlicePieces(targets, [point(1, 40, 60)])
        // Only the first target is crossed: 2 columns x 2 rows
        expect(pieces).toHaveLength(4)
        expect(pieces.map(function (p) { return p.key })).toEqual(['0:0:0', '0:0:1', '0:1:0', '0:1:1'])
        expect(pieces[0]!.rect).toEqual({ x: 0, y: 0, width: 40, height: 60 })
        expect(pieces[3]!.rect).toEqual({ x: 40, y: 60, width: 60, height: 40 })
    })

    it('slices all targets crossing the same line position', () => {
        const targets: SliceTarget[] = [
            { key: '0', indexPath: [0], kind: 'image', rect: { x: 0, y: 40, width: 20, height: 20 } },
            { key: '1', indexPath: [1], kind: 'image', rect: { x: 30, y: 40, width: 20, height: 20 } },
            { key: '2', indexPath: [2], kind: 'image', rect: { x: 60, y: 40, width: 20, height: 20 } },
        ]
        // One click inside the middle image: its horizontal line slices all
        // three images, the vertical line slices only the middle one
        const pieces = computeSlicePieces(targets, [point(1, 40, 50)])
        const byTarget = new Map<string, number>()
        for (const piece of pieces) byTarget.set(piece.targetKey, (byTarget.get(piece.targetKey) ?? 0) + 1)
        expect(byTarget.get('0')).toBe(2)
        expect(byTarget.get('1')).toBe(4)
        expect(byTarget.get('2')).toBe(2)
    })
})

describe('imagePieceSourceRect', () => {
    const element = { x: 0, y: 0, width: 100, height: 50 }
    const piece = { x: 0, y: 0, width: 50, height: 50 }

    it('maps a piece linearly at rotation 0', () => {
        expect(imagePieceSourceRect(element, 0, piece, 200, 100)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 })
    })

    it('maps a piece with the axes swapped at rotation 90', () => {
        expect(imagePieceSourceRect(element, 90, piece, 200, 100)).toEqual({ sx: 0, sy: 50, sw: 200, sh: 50 })
    })

    it('maps a piece flipped at rotation 180', () => {
        expect(imagePieceSourceRect(element, 180, piece, 200, 100)).toEqual({ sx: 100, sy: 0, sw: 100, sh: 100 })
    })

    it('maps a piece with the axes swapped at rotation 270', () => {
        expect(imagePieceSourceRect(element, 270, piece, 200, 100)).toEqual({ sx: 0, sy: 0, sw: 200, sh: 50 })
    })

    it('shares exact pixel boundaries between adjacent pieces', () => {
        const left = imagePieceSourceRect(element, 0, { x: 0, y: 0, width: 33.4, height: 50 }, 200, 100)
        const right = imagePieceSourceRect(element, 0, { x: 33.4, y: 0, width: 66.6, height: 50 }, 200, 100)
        expect(left.sx + left.sw).toBe(right.sx)
        expect(right.sx + right.sw).toBe(200)
    })

    it('rejects unsupported rotations', () => {
        expect(function () { imagePieceSourceRect(element, 45, piece, 200, 100) }).toThrow()
    })
})

describe('shape outlines', () => {
    it('builds an ellipse outline matching its box', () => {
        const bounds = computePathBounds(ellipseSubpaths(40, 20))
        expect(bounds.x).toBeCloseTo(0, 6)
        expect(bounds.y).toBeCloseTo(0, 6)
        expect(bounds.width).toBeCloseTo(40, 6)
        expect(bounds.height).toBeCloseTo(20, 6)
    })

    it('builds a plain rectangle outline when all radii are zero', () => {
        const subpaths = roundedRectangleSubpaths(30, 20, 0, 0, 0, 0)
        expect(subpaths).toHaveLength(1)
        expect(subpaths[0]!.anchors).toHaveLength(4)
        expect(subpaths[0]!.closed).toBe(true)
    })

    it('builds a rounded rectangle outline inside its box', () => {
        const subpaths = roundedRectangleSubpaths(30, 20, 5, 5, 5, 5)
        expect(subpaths[0]!.anchors).toHaveLength(8)
        const bounds = computePathBounds(subpaths)
        expect(bounds.x).toBeCloseTo(0, 6)
        expect(bounds.y).toBeCloseTo(0, 6)
        expect(bounds.width).toBeCloseTo(30, 6)
        expect(bounds.height).toBeCloseTo(20, 6)
    })

    it('clamps corner radii to half the box size', () => {
        const bounds = computePathBounds(roundedRectangleSubpaths(10, 10, 50, 50, 50, 50))
        expect(bounds.width).toBeCloseTo(10, 6)
        expect(bounds.height).toBeCloseTo(10, 6)
    })
})

describe('applySlicesToImport', () => {
    it('returns the input untouched when no target is crossed', async () => {
        const element = createDefaultElement('el_0', 'path', 0, 0, 10, 10)
        const images = { '0.png': new Uint8Array([1]) }
        const targets: SliceTarget[] = [{ key: '0', indexPath: [0], kind: 'path', rect: { x: 0, y: 0, width: 10, height: 10 } }]
        const result = await applySlicesToImport([element], images, targets, [point(1, 50, 50)], new Set(), 1)
        expect(result.elements).toEqual([element])
        expect(result.images).toBe(images)
        expect(result.nextElementIdCounter).toBe(1)
    })

    it('cuts a path element geometrically and drops disabled pieces', async () => {
        const element = createDefaultElement('el_0', 'path', 0, 0, 10, 10)
        const targets: SliceTarget[] = [{ key: '0', indexPath: [0], kind: 'path', rect: { x: 0, y: 0, width: 10, height: 10 } }]
        const crosses = [point(1, 4, 100)]
        const disabled = new Set([pieceKey('0', 0, 1)])
        const result = await applySlicesToImport([element], {}, targets, crosses, disabled, 1)
        expect(result.elements).toHaveLength(1)
        const piece = result.elements[0]!
        expect(piece.kind).toBe('path')
        expect(piece.id).toBe('el_1')
        expect(piece.x).toBeCloseTo(0, 6)
        expect(piece.width).toBeCloseTo(4, 6)
        expect(piece.height).toBeCloseTo(10, 6)
        expect(result.nextElementIdCounter).toBe(2)
    })

    it('converts a sliced rectangle to path pieces carrying its fill', async () => {
        const element = createDefaultElement('el_0', 'rectangle', 0, 0, 20, 10)
        element.shapeFillType = 'solid'
        element.shapeFillColor = '#ff0000'
        element.fill = '#ff0000'
        element.stroke = '#0000ff'
        element.strokeWidth = 2
        const targets: SliceTarget[] = [{ key: '0', indexPath: [0], kind: 'rectangle', rect: { x: 0, y: 0, width: 20, height: 10 } }]
        const result = await applySlicesToImport([element], {}, targets, [point(1, 5, 100)], new Set(), 10)
        expect(result.elements).toHaveLength(2)
        for (const piece of result.elements) {
            expect(piece.kind).toBe('path')
            expect(piece.pathFillType).toBe('solid')
            expect(piece.pathFillColor).toBe('#ff0000')
            expect(piece.stroke).toBe('#0000ff')
            expect(piece.strokeWidth).toBe(2)
        }
        expect(result.elements[0]!.width).toBeCloseTo(5, 6)
        expect(result.elements[1]!.width).toBeCloseTo(15, 6)
        expect(result.elements[1]!.x).toBeCloseTo(5, 6)
    })

    it('cuts an ellipse into closed bezier pieces', async () => {
        const element = createDefaultElement('el_0', 'ellipse', 0, 0, 10, 10)
        const targets: SliceTarget[] = [{ key: '0', indexPath: [0], kind: 'ellipse', rect: { x: 0, y: 0, width: 10, height: 10 } }]
        const result = await applySlicesToImport([element], {}, targets, [point(1, 5, 100)], new Set(), 0)
        expect(result.elements).toHaveLength(2)
        for (const piece of result.elements) {
            expect(piece.kind).toBe('path')
            expect(piece.pathSubpaths.every(function (s) { return s.closed })).toBe(true)
            expect(piece.width).toBeCloseTo(5, 2)
            expect(piece.height).toBeCloseTo(10, 2)
        }
    })

    it('removes the element entirely when every piece is disabled', async () => {
        const element = createDefaultElement('el_0', 'path', 0, 0, 10, 10)
        const targets: SliceTarget[] = [{ key: '0', indexPath: [0], kind: 'path', rect: { x: 0, y: 0, width: 10, height: 10 } }]
        const disabled = new Set([pieceKey('0', 0, 0), pieceKey('0', 0, 1)])
        const result = await applySlicesToImport([element], {}, targets, [point(1, 5, 100)], disabled, 0)
        expect(result.elements).toEqual([])
    })

    it('slices nested elements inside a frame with local coordinates', async () => {
        const frame = createDefaultElement('el_0', 'frame', 0, 100, 200, 100)
        const child = createDefaultElement('el_1', 'path', 10, 10, 10, 10)
        frame.children = [child]
        const targets: SliceTarget[] = [{ key: '0-0', indexPath: [0, 0], kind: 'path', rect: { x: 10, y: 110, width: 10, height: 10 } }]
        // The horizontal cut at page y = 115 crosses the child (local y = 15 in the frame)
        const result = await applySlicesToImport([frame], {}, targets, [point(1, 500, 115)], new Set(), 5)
        expect(result.elements).toHaveLength(1)
        const children = result.elements[0]!.children
        expect(children).toHaveLength(2)
        expect(children[0]!.y).toBeCloseTo(10, 6)
        expect(children[0]!.height).toBeCloseTo(5, 6)
        expect(children[1]!.y).toBeCloseTo(15, 6)
        expect(children[1]!.height).toBeCloseTo(5, 6)
    })

    it('keeps image bytes referenced by elements that were not sliced', async () => {
        const image = createDefaultElement('el_0', 'image', 0, 0, 10, 10)
        image.source = 'keep.png'
        const pathElement = createDefaultElement('el_1', 'path', 20, 0, 10, 10)
        const images = { 'keep.png': new Uint8Array([7]), 'orphan.png': new Uint8Array([8]) }
        const targets: SliceTarget[] = [
            { key: '0', indexPath: [0], kind: 'image', rect: { x: 0, y: 0, width: 10, height: 10 } },
            { key: '1', indexPath: [1], kind: 'path', rect: { x: 20, y: 0, width: 10, height: 10 } },
        ]
        // Only the path is crossed; the image element and its bytes survive
        const result = await applySlicesToImport([image, pathElement], images, targets, [point(1, 25, 100)], new Set(), 2)
        expect(result.elements).toHaveLength(3)
        expect(result.images['keep.png']).toBe(images['keep.png'])
        expect(result.images['orphan.png']).toBeUndefined()
    })

    it('remaps a linear gradient onto each piece', async () => {
        const element = createDefaultElement('el_0', 'path', 0, 0, 10, 10)
        element.pathFillType = 'linear'
        element.pathGradient = {
            x1: 0, y1: 0, x2: 1, y2: 0, cx: 0.5, cy: 0.5, r: 0.5,
            stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
            pdfShading: {
                domain: [0, 1], extend: [true, true],
                native: { shadingType: 2, coords: [0, 0, 1, 0], patternMatrix: [10, 0, 0, 10, 2, 3], paintOperator: 'sh' },
            },
        }
        const targets: SliceTarget[] = [{ key: '0', indexPath: [0], kind: 'path', rect: { x: 0, y: 0, width: 10, height: 10 } }]
        const result = await applySlicesToImport([element], {}, targets, [point(1, 5, 100)], new Set(), 0)
        expect(result.elements).toHaveLength(2)
        // Left piece keeps the gradient start, its end extends past the piece
        expect(result.elements[0]!.pathGradient.x1).toBeCloseTo(0, 6)
        expect(result.elements[0]!.pathGradient.x2).toBeCloseTo(2, 6)
        // Right piece starts mid-gradient
        expect(result.elements[1]!.pathGradient.x1).toBeCloseTo(-1, 6)
        expect(result.elements[1]!.pathGradient.x2).toBeCloseTo(1, 6)
        expect(result.elements[0]!.pathGradient.pdfShading?.native?.patternMatrix).toEqual([10, 0, 0, 10, 2, 3])
        expect(result.elements[1]!.pathGradient.pdfShading?.native?.patternMatrix).toEqual([10, 0, 0, 10, -3, 3])
    })
})
