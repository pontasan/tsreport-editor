import { describe, expect, it } from 'vitest'
import { buildElementHitStack, collectBatchInteractionElementIds, collectElementHitCandidates, collectSelectedElementCanvasPlacements, exceedsDragActivationDistance, findTopmostElementEdgeHit, isBandOnlySelected } from '../src/app/[lang]/editor/canvas'
import { bandElementIntersectsTile, buildRenderNodes, filterBandElementForTile, planBandCanvasTiles, prepareBandRender } from '../src/app/[lang]/editor/element_renderer'
import { createDefaultElement, type Band, type TemplateElement } from '../src/app/[lang]/editor/reducer'

describe('band canvas tiling', () => {
    it('does not turn click jitter into an element drag', () => {
        expect(exceedsDragActivationDistance(100, 100, 102, 101)).toBe(false)
        expect(exceedsDragActivationDistance(100, 100, 103, 100)).toBe(true)
    })

    it('hits the imported dashed message border at its transformed position', () => {
        const border = createDefaultElement('message-border', 'path', 723.219, 4177.1518, 456.271, 189.5942)
        border.pathSubpaths = [{
            closed: true,
            anchors: [
                cornerAnchor(456.271, 0),
                cornerAnchor(0, 0),
                cornerAnchor(0, 189.5942),
                cornerAnchor(456.271, 189.5942),
            ],
        }]
        border.pathFillType = 'none'
        border.stroke = '#0064b4'
        border.strokeWidth = 0.828
        border.pathStrokeDash = [8.835, 4.418]
        border.importedPdfRenderState = {
            common: {},
            path: { affineTransform: [1, 0, 0, -1, -423.954, -3987.1436] },
        }
        const frame = createDefaultElement('message-group', 'frame', 63.423, 49.6409, 1349.4176, 309.315)
        frame.children = [border]

        const stack = buildElementHitStack([frame], 363.7, 145, 4)
        const placements = collectSelectedElementCanvasPlacements([frame], new Set(['message-border']))

        expect(stack.elements[0]!.id).toBe('message-border')
        expect(stack.visibleCount).toBe(1)
        expect(placements).toHaveLength(1)
        expect(placements[0]!.transform.slice(0, 4)).toEqual([1, 0, 0, -1])
        expect(placements[0]!.transform[4]).toBeCloseTo(362.688)
        expect(placements[0]!.transform[5]).toBeCloseTo(239.6491)
    })

    it('prioritizes a painted outline over an overlapping fill surface', () => {
        const outline = createDefaultElement('outline', 'rectangle', 0, 0, 100, 100)
        outline.stroke = '#000000'
        outline.strokeWidth = 2
        const translucentFill = createDefaultElement('fill', 'rectangle', 0, 0, 100, 100)
        translucentFill.shapeFillType = 'solid'
        translucentFill.shapeFillColor = '#ffffff'
        translucentFill.style.opacity = 0.5
        translucentFill.stroke = ''
        translucentFill.strokeWidth = 0

        const edge = buildElementHitStack([outline, translucentFill], 1, 50, 2)
        const center = buildElementHitStack([outline, translucentFill], 50, 50, 2)

        expect(edge.elements.map(function (element) { return element.id })).toEqual(['outline', 'fill'])
        expect(center.elements.map(function (element) { return element.id })).toEqual(['fill', 'outline'])
    })

    it('selects outlined glyph artwork ahead of its background through a narrow glyph gap', () => {
        const background = createDefaultElement('message-background', 'rectangle', 0, 0, 100, 30)
        background.shapeFillType = 'solid'
        background.shapeFillColor = '#ffffff'
        background.stroke = ''
        background.strokeWidth = 0
        const outlinedText = createDefaultElement('outlined-text', 'path', 10, 10, 20, 10)
        outlinedText.pathFillType = 'solid'
        outlinedText.pathFillColor = '#000000'
        outlinedText.stroke = ''
        outlinedText.strokeWidth = 0
        outlinedText.pathSubpaths = [
            {
                closed: true,
                anchors: [cornerAnchor(0, 0), cornerAnchor(8, 0), cornerAnchor(8, 10), cornerAnchor(0, 10)],
            },
            {
                closed: true,
                anchors: [cornerAnchor(12, 0), cornerAnchor(20, 0), cornerAnchor(20, 10), cornerAnchor(12, 10)],
            },
        ]

        const stack = buildElementHitStack([background, outlinedText], 20, 15, 3)

        expect(stack.elements.map(function (element) { return element.id })).toEqual(['outlined-text', 'message-background'])
        expect(stack.visibleCount).toBe(2)
    })

    it('hits visible PDF vectors before structural frame rectangles', () => {
        const vector = createDefaultElement('vector', 'rectangle', 10, 10, 20, 20)
        vector.shapeFillType = 'solid'
        vector.shapeFillColor = '#000000'
        const frame = createDefaultElement('page-sized-frame', 'frame', 0, 0, 1000, 1000)
        frame.children = [vector]

        const visible = collectElementHitCandidates([frame], 15, 15, 1, 'visible')
        const fallback = collectElementHitCandidates([frame], 15, 15, 1, 'bbox')

        expect(visible.map(function (element) { return element.id })).toEqual(['vector'])
        expect(fallback.map(function (element) { return element.id })).toEqual(['page-sized-frame', 'vector'])
    })

    it('hit-tests PDF vectors through their inherited affine transform', () => {
        const vector = createDefaultElement('transformed-vector', 'rectangle', 5, 5, 20, 20)
        vector.shapeFillType = 'solid'
        vector.shapeFillColor = '#000000'
        const frame = createDefaultElement('transformed-frame', 'frame', 100, 50, 1000, 1000)
        frame.children = [vector]
        frame.importedPdfRenderState = {
            common: {},
            frame: { affineTransform: [2, 0, 0, 2, 10, 20] },
        }

        const visible = collectElementHitCandidates([frame], 140, 100, 1, 'visible')

        expect(visible.map(function (element) { return element.id })).toEqual(['transformed-vector'])
    })

    it('prioritizes only the four edges of the topmost background element', () => {
        const back = createDefaultElement('back', 'rectangle', 10, 10, 100, 60)
        const front = createDefaultElement('front', 'rectangle', 30, 20, 100, 60)

        expect(findTopmostElementEdgeHit([back, front], 31, 45, 4)?.id).toBe('front')
        expect(findTopmostElementEdgeHit([back, front], 70, 50, 4)).toBeNull()
        expect(findTopmostElementEdgeHit([back, front], 10, 45, 4)?.id).toBe('back')
    })

    it('does not keep the background band selected when one of its elements is selected', () => {
        expect(isBandOnlySelected('background', 'background', [])).toBe(true)
        expect(isBandOnlySelected('background', 'background', ['rectangle'])).toBe(false)
    })

    it('does not prioritize the model box of an affine-transformed PDF path', () => {
        const path = createDefaultElement('transformed-path', 'path', 10, 10, 100, 60)
        path.importedPdfRenderState = {
            common: {},
            path: { affineTransform: [1, 0, 0, 1, 200, 100] },
        }

        expect(findTopmostElementEdgeHit([path], 10, 15, 4)).toBeNull()
    })

    it('keeps only active branches and tables in the interaction DOM of a heavy band', () => {
        const selected = pathElement('selected', 0, 10)
        const inactive = pathElement('inactive', 20, 10)
        const nestedFrame = frameElement('nested', [selected, inactive])
        const emptyFrame = frameElement('empty', [pathElement('hidden', 40, 10)])
        const table = { ...pathElement('table', 60, 10), kind: 'table' as const }

        const ids = collectBatchInteractionElementIds(
            [frameElement('root', [nestedFrame, emptyFrame]), table],
            new Set(['selected']),
        )

        expect([...ids].sort()).toEqual(['nested', 'root', 'selected', 'table'])
    })

    it('splits a tall imported PDF band at 500 percent zoom', () => {
        const tiles = planBandCanvasTiles(2142.22, 10815.9, 5, 2)

        expect(tiles.length).toBeGreaterThan(1)
        for (const tile of tiles) {
            const pixelWidth = Math.ceil(tile.width * 5 * 2)
            const pixelHeight = Math.ceil(tile.height * 5 * 2)
            expect(pixelWidth).toBeLessThanOrEqual(16384)
            expect(pixelHeight).toBeLessThanOrEqual(16384)
            expect(pixelWidth * pixelHeight).toBeLessThanOrEqual(4194304)
        }
        expect(tiles[0]!.x).toBe(0)
        expect(tiles[0]!.y).toBe(0)
        const last = tiles[tiles.length - 1]!
        expect(last.y + last.height).toBeCloseTo(10815.9)
    })

    it('keeps normal bands as a single canvas', () => {
        const tiles = planBandCanvasTiles(595.28, 841.89, 1, 2)

        expect(tiles).toEqual([{ x: 0, y: 0, width: 595.28, height: 841.89 }])
    })

    it('spatially tiles a heavy A4 band at viewport scale', () => {
        const tiles = planBandCanvasTiles(595.28, 841.89, 1, 2, true)

        expect(tiles.length).toBeGreaterThan(1)
        for (const tile of tiles) {
            expect(tile.width).toBeLessThanOrEqual(256)
            expect(tile.height).toBeLessThanOrEqual(256)
        }
        const last = tiles[tiles.length - 1]!
        expect(last.y + last.height).toBeCloseTo(841.89)
    })

    it('splits an oversized wide band horizontally', () => {
        const tiles = planBandCanvasTiles(12000, 100, 1, 2)

        expect(tiles.length).toBeGreaterThan(1)
        for (const tile of tiles) {
            expect(Math.ceil(tile.width * 2)).toBeLessThanOrEqual(16384)
            expect(Math.ceil(tile.height * 2)).toBeLessThanOrEqual(16384)
        }
        expect(tiles[0]!.x).toBe(0)
        const last = tiles[tiles.length - 1]!
        expect(last.x + last.width).toBeCloseTo(12000)
    })

    it('keeps only elements intersecting the tile band', () => {
        const above = pathElement('above', 0, 10)
        const inside = pathElement('inside', 120, 20)
        const touching = pathElement('touching', 80, 20)
        const below = pathElement('below', 210, 20)
        const fonts = new Map()

        expect(bandElementIntersectsTile(above, 0, 100, 100, 100, fonts)).toBe(false)
        expect(bandElementIntersectsTile(inside, 0, 100, 100, 100, fonts)).toBe(true)
        expect(bandElementIntersectsTile(touching, 0, 100, 100, 100, fonts)).toBe(true)
        expect(bandElementIntersectsTile(below, 0, 100, 100, 100, fonts)).toBe(false)
        expect(bandElementIntersectsTile(inside, 200, 100, 100, 100, fonts)).toBe(false)
    })

    it('prunes non-intersecting descendants while preserving their frame branch', () => {
        const visible = pathElement('visible', 120, 20)
        const hidden = pathElement('hidden', 20, 20)
        const nested = frameElement('nested-frame', [visible, hidden])
        const root = frameElement('root-frame', [nested, pathElement('outside', 250, 20)])
        const filtered = filterBandElementForTile(root, 0, 100, 100, 100, new Map())

        expect(filtered?.id).toBe('root-frame')
        expect(filtered?.children.map(function (element) { return element.id })).toEqual(['nested-frame'])
        expect(filtered?.children[0]?.children.map(function (element) { return element.id })).toEqual(['visible'])
    })

    it('culls with affine shear while preserving vector and gradient coordinates', () => {
        const gradient = pathElement('gradient', 0, 80)
        gradient.pathFillType = 'linear'
        gradient.pathGradient = {
            x1: 0, y1: 0, x2: 1, y2: 1, cx: 0.5, cy: 0.5, r: 0.5,
            stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }],
        }
        const shear = frameElement('shear', [gradient])
        shear.width = 100
        shear.height = 100
        shear.importedPdfRenderState = {
            common: {},
            frame: { affineTransform: [1, 0, 2, 1, 0, 0] },
        }

        const visible = filterBandElementForTile(shear, 165, 75, 40, 40, new Map())
        const outside = filterBandElementForTile(shear, 310, 0, 20, 20, new Map())

        expect(visible).not.toBeNull()
        expect(visible!.importedPdfRenderState!.frame!.affineTransform).toEqual([1, 0, 2, 1, 0, 0])
        expect(visible!.children[0]).toBe(gradient)
        expect(visible!.children[0]!.pathSubpaths).toBe(gradient.pathSubpaths)
        expect(visible!.children[0]!.pathGradient).toBe(gradient.pathGradient)
        expect(outside).toBeNull()
    })

    it('culls mesh patches outside the tile without mutating the source fill', () => {
        const path = createDefaultElement('mesh', 'path', 10, 20, 200, 100)
        path.pathFillType = 'mesh'
        path.pathComplexFill = {
            type: 'meshGradient',
            patches: [
                tensorPatch(0, '#000000'),
                tensorPatch(100, '#ffffff'),
            ],
            pdfShading: { antiAlias: true },
        }

        const filtered = filterBandElementForTile(path, 5, 15, 50, 50, new Map())

        expect(filtered).not.toBeNull()
        expect(filtered!.pathComplexFill?.type).toBe('meshGradient')
        if (filtered!.pathComplexFill?.type !== 'meshGradient') throw new Error('mesh fill expected')
        expect(filtered!.pathComplexFill.patches).toHaveLength(1)
        expect(filtered!.pathComplexFill.pdfShading).toEqual({ antiAlias: true })
        expect(path.pathComplexFill.patches).toHaveLength(2)
    })

    it('keeps transformed children outside a non-clipping PDF state frame', () => {
        const child = pathElement('outside-frame', 120, 20)
        const scope = frameElement('device-scope', [child])
        scope.x = 0
        scope.y = 0
        scope.width = 20
        scope.height = 20
        scope.importedPdfRenderState = {
            common: {},
            frame: { clip: false, deviceParams: { strokeAdjustment: true } },
        }

        const filtered = filterBandElementForTile(scope, 0, 100, 100, 100, new Map())

        expect(filtered).not.toBeNull()
        expect(filtered!.children).toEqual([child])
        expect(filtered!.importedPdfRenderState!.frame!.clip).toBe(false)
    })

    it('omits non-printing frame guides from batch canvas render nodes', () => {
        const path = createDefaultElement('path', 'path', 0, 0, 10, 10)
        const nested = createDefaultElement('nested-frame', 'frame', 0, 0, 10, 10)
        nested.children = [path]
        const root = createDefaultElement('root-frame', 'frame', 0, 0, 10, 10)
        root.children = [nested]
        const result = buildRenderNodes(root, new Map(), 'NotoSansJP', {}, null, false)
        const nodeTypes: string[] = []
        function collect(nodes: typeof result.nodes): void {
            for (const node of nodes) {
                nodeTypes.push(node.type)
                if (node.type === 'group') collect(node.children)
            }
        }
        collect(result.nodes)

        expect(nodeTypes.filter(function (type) { return type === 'path' })).toEqual(['path'])
    })

    it('lays out a PDF import segment once in its band coordinate system', () => {
        const child = createDefaultElement('child', 'rectangle', 4, 5, 20, 10)
        child.shapeFillType = 'solid'
        child.shapeFillColor = '#ff0000'
        const frame = createDefaultElement('frame', 'frame', 30, 40, 100, 80)
        frame.children = [child]
        frame.importedPdfRenderState = {
            common: { renderingIntent: 'Perceptual' },
            frame: { affineTransform: [2, 0, 0, 2, 10, 20] },
        }
        const band: Band = {
            id: 'detail', type: 'detail', height: 200, startNewPage: false,
            splitType: 'Stretch', elements: [frame], printWhenExpression: '', enabled: true,
        }

        const prepared = prepareBandRender(band, 300, 200, new Map(), 'NotoSansJP', {}, null)
        const root = findGroup(prepared.page.children, function (node) {
            return node.renderingIntent === 'Perceptual'
        })

        expect(root).toMatchObject({
            type: 'group',
            x: 30,
            y: 40,
            affineTransform: [2, 0, 0, 2, 10, 20],
            renderingIntent: 'Perceptual',
        })
    })
})

function cornerAnchor(x: number, y: number) {
    return { x, y, inX: x, inY: y, outX: x, outY: y, handleMode: 'corner' as const }
}

function tensorPatch(offsetX: number, color: string) {
    const points: number[] = []
    for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) points.push(offsetX + column * 10, row * 10)
    }
    return { points, colors: [color, color, color, color] as [string, string, string, string] }
}

function findGroup(
    nodes: ReturnType<typeof prepareBandRender>['page']['children'],
    predicate: (node: Extract<ReturnType<typeof prepareBandRender>['page']['children'][number], { type: 'group' }>) => boolean,
): Extract<ReturnType<typeof prepareBandRender>['page']['children'][number], { type: 'group' }> | undefined {
    for (const node of nodes) {
        if (node.type !== 'group') continue
        if (predicate(node)) return node
        const nested = findGroup(node.children, predicate)
        if (nested !== undefined) return nested
    }
    return undefined
}

function pathElement(id: string, y: number, height: number): TemplateElement {
    return {
        id,
        kind: 'path',
        x: 0,
        y,
        width: 100,
        height,
        rotation: 0,
        children: [],
        pathSubpaths: [],
        pathFillType: 'solid',
        fill: '#000000',
        stroke: '',
        strokeWidth: 0,
        strokeStyle: 'solid',
    }
}

function frameElement(id: string, children: TemplateElement[]): TemplateElement {
    return {
        ...pathElement(id, 0, 100),
        kind: 'frame',
        frameClipPathD: '',
        frameClipPathRule: 'nonzero',
        children,
    }
}
