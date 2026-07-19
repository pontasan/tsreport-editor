import { describe, expect, it } from 'vitest'
import { createReport, type ImportedPage } from 'tsreport-core'
import {
    compactImportedPageMeshes,
    convertImportedPageToEditorElements,
    createPdfImportPageSettings,
    fitTextElementsToAssignedFonts,
    offsetImportedElements,
    rewriteImportedImageSources,
    scaleImportedElements,
    splitElementsIntoBandRegions,
} from '../src/app/[lang]/editor/pdf_import_converter'
import { createDefaultElement, normalizeTemplate } from '../src/app/[lang]/editor/reducer'
import {
    createDefaultRegionState,
    moveRegionBoundary,
    toggleRegion,
} from '../src/app/[lang]/editor/pdf_import_preview'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'
import { createDefaultTemplate } from '../src/app/[lang]/editor/reducer'

function findGroupWithOpacity(nodes: Array<{ type: string, opacity?: number, children?: unknown[] }>, opacity: number): { type: string, opacity?: number } | undefined {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!
        if (node.type === 'group' && node.opacity === opacity) return node
        if (node.children !== undefined) {
            const found = findGroupWithOpacity(node.children as Array<{ type: string, opacity?: number, children?: unknown[] }>, opacity)
            if (found !== undefined) return found
        }
    }
    return undefined
}

describe('pdf import converter', () => {
    it('retains shared PDF vectors without materializing editor anchors', () => {
        const source = {
            definitions: [{ commands: [0, 1, 1, 3], coords: [0, 0, 10, 0, 10, 10] }],
            instances: [
                { definitionIndex: 0, matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] },
                { definitionIndex: 0, matrix: [1, 0, 0, 1, 20, 0] as [number, number, number, number, number, number] },
            ],
        }
        const page: ImportedPage = {
            width: 100,
            height: 50,
            fonts: [],
            styles: [],
            images: {},
            elements: [{
                type: 'path', x: 10, y: 10, width: 30, height: 10,
                d: 'M0 0 L10 0 L10 10 Z M20 0 L30 0 L30 10 Z',
                pdfSourceVector: source,
                fill: '#000000',
            }],
        }
        const converted = convertImportedPageToEditorElements(page, 1, {})
        const element = converted.elements[0]!
        expect(element.pdfSourceLocked).toBe(true)
        expect(element.pathSubpaths).toEqual([])
        expect(element.importedPdfRenderState?.path?.pdfSourceVector).toEqual(source)

        const template = createDefaultTemplate()
        template.bands.find(function (band) { return band.type === 'detail' })!.elements = [element]
        const exported = convertEditorTemplateToCore(template).bands.details![0]!.elements![0]!
        expect(exported).toMatchObject({ type: 'path', d: '', pdfSourceVector: source })
    })

    it('migrates legacy outlineText per element without changing sibling defaults', () => {
        const template = createDefaultTemplate()
        const detail = template.bands.find(function (band) { return band.type === 'detail' })!
        const legacyOutline = createDefaultElement('el_1', 'staticText', 10, 10, 50, 14)
        const legacyEmbedded = createDefaultElement('el_2', 'staticText', 10, 30, 50, 14)
        delete (legacyOutline as unknown as Record<string, unknown>).pdfTextMode
        delete (legacyEmbedded as unknown as Record<string, unknown>).pdfTextMode
        legacyOutline.outlineText = true
        detail.elements = [legacyOutline, legacyEmbedded]

        const normalized = normalizeTemplate(template)
        const normalizedDetail = normalized.bands.find(function (band) { return band.type === 'detail' })!
        expect(normalizedDetail.elements.map(function (element) { return element.pdfTextMode })).toEqual(['outline', 'embedded'])
    })

    it('keeps imported text editable and maps each element PDF output mode independently', () => {
        const page: ImportedPage = {
            width: 200,
            height: 100,
            fonts: [],
            styles: [{ name: 'pdf_text', fontFamily: 'PdfFont', fontSize: 12 }],
            images: {},
            elements: [
                { type: 'staticText', x: 10, y: 10, width: 50, height: 14, text: 'Embedded', style: 'pdf_text' },
                { type: 'staticText', x: 10, y: 30, width: 50, height: 14, text: 'Outline', style: 'pdf_text' },
                { type: 'staticText', x: 10, y: 50, width: 50, height: 14, text: 'System', style: 'pdf_text' },
            ],
        }
        const converted = convertImportedPageToEditorElements(page, 1, { PdfFont: 'NotoSansJP' })
        expect(converted.elements.map(function (element) { return element.pdfTextMode })).toEqual(['embedded', 'embedded', 'embedded'])
        converted.elements[1]!.pdfTextMode = 'outline'
        converted.elements[2]!.pdfTextMode = 'system'
        const template = createDefaultTemplate()
        template.bands.find(function (band) { return band.type === 'detail' })!.elements = converted.elements
        const elements = convertEditorTemplateToCore(template).bands.details![0]!.elements!
        expect(elements[0]).toMatchObject({ type: 'staticText', text: 'Embedded' })
        expect(elements[0]!.outlineText).toBeUndefined()
        expect(elements[0]!.pdfFontMode).toBeUndefined()
        expect(elements[1]).toMatchObject({ type: 'staticText', outlineText: true })
        expect(elements[1]!.pdfFontMode).toBeUndefined()
        expect(elements[2]).toMatchObject({ type: 'staticText', pdfFontMode: 'reference' })
        expect(elements[2]!.outlineText).toBeUndefined()
    })

    it('preserves native PDF gradient functions through Editor export', () => {
        const pdfShading = {
            domain: [0, 1] as [number, number],
            extend: [true, true] as [boolean, boolean],
            functions: [{
                functionType: 2 as const,
                domain: [0, 1] as [number, number],
                c0: [0, 0.592157, 0.427451],
                c1: [0, 0.462745, 0.32549],
                exponent: 3.82753,
            }],
            colorSpace: { kind: 'rgb' as const },
            native: {
                shadingType: 2 as const,
                coords: [0, 0, 1, 0] as [number, number, number, number],
                patternMatrix: [0, -28.1767483, 28.1767483, 0, 84.998751, 28.1767969] as [number, number, number, number, number, number],
                paintOperator: 'sh' as const,
            },
        }
        const page: ImportedPage = {
            width: 200,
            height: 200,
            fonts: [],
            styles: [],
            images: {},
            elements: [{
                type: 'path', x: 10, y: 20, width: 100, height: 40,
                d: 'M0 0 L100 0 L100 40 L0 40 Z',
                fill: {
                    type: 'linearGradient', x1: 0, y1: 0, x2: 1, y2: 0,
                    stops: [{ offset: 0, color: '#00976d' }, { offset: 1, color: '#007653' }],
                    pdfShading,
                },
            }],
        }

        const converted = convertImportedPageToEditorElements(page, 1, {})
        expect(converted.elements[0]!.pathGradient.pdfShading).toEqual(pdfShading)
        const template = createDefaultTemplate()
        template.bands.find(function (band) { return band.type === 'detail' })!.elements = converted.elements
        const fill = convertEditorTemplateToCore(template).bands.details![0]!.elements![0]!
        expect(fill.type === 'path' ? fill.fill : undefined).toMatchObject({
            type: 'linearGradient',
            pdfShading: { functions: [{ functionType: 2, exponent: 3.82753 }], native: { shadingType: 2 } },
        })
    })

    it('rewrites uploaded images throughout nested soft-mask graphics', () => {
        const page: ImportedPage = {
            width: 200,
            height: 200,
            fonts: [],
            styles: [],
            images: {},
            elements: [{
                type: 'frame', x: 10, y: 20, width: 100, height: 80,
                isolated: true,
                softMask: {
                    type: 'luminosity',
                    elements: [{
                        type: 'frame', x: 0, y: 0, width: 100, height: 80,
                        elements: [{
                            type: 'image', x: 0, y: 0, width: 100, height: 80,
                            source: 'mask.png',
                            alternates: [{ source: 'mask-print.png', defaultForPrinting: true }],
                        }],
                    }],
                },
                elements: [{
                    type: 'image', x: 0, y: 0, width: 100, height: 80,
                    source: 'art.png',
                    alternates: [{ source: 'art-print.png' }],
                }],
            }],
        }
        const converted = convertImportedPageToEditorElements(page, 1, {})
        const rewritten = rewriteImportedImageSources(converted.elements, new Map([
            ['art.png', 'report_assets/img_0.png'],
            ['art-print.png', 'report_assets/img_1.png'],
            ['mask.png', 'report_assets/img_2.png'],
            ['mask-print.png', 'report_assets/img_3.png'],
        ]))

        expect(rewritten[0]!.children[0]).toMatchObject({
            source: 'report_assets/img_0.png',
            importedPdfRenderState: { image: { alternates: [{ source: 'report_assets/img_1.png' }] } },
        })
        expect(rewritten[0]!.importedPdfRenderState?.frame?.softMask?.elements[0]).toMatchObject({
            type: 'frame',
            elements: [{
                type: 'image',
                source: 'report_assets/img_2.png',
                alternates: [{ source: 'report_assets/img_3.png', defaultForPrinting: true }],
            }],
        })
    })

    it('rewrites uploaded images inside nested tiling-pattern graphics', () => {
        const page: ImportedPage = {
            width: 100,
            height: 100,
            fonts: [],
            styles: [],
            images: {},
            elements: [{
                type: 'frame', x: 0, y: 0, width: 100, height: 100,
                softMask: {
                    type: 'alpha',
                    elements: [{
                        type: 'path', x: 0, y: 0, width: 100, height: 100, d: 'M0 0 L100 0 L100 100 Z',
                        fill: {
                            type: 'tilingPattern', bbox: [0, 0, 10, 10], xStep: 10, yStep: 10,
                            graphics: [{
                                kind: 'group', x: 0, y: 0, width: 10, height: 10, graphics: [],
                                softMask: {
                                    type: 'alpha',
                                    graphics: [{ kind: 'image', x: 0, y: 0, width: 10, height: 10, source: 'tile.png' }],
                                },
                            }],
                        },
                    }],
                },
                elements: [],
            }],
        }
        const converted = convertImportedPageToEditorElements(page, 1, {})
        const rewritten = rewriteImportedImageSources(converted.elements, new Map([
            ['tile.png', 'report_assets/tile.png'],
        ]))
        const path = rewritten[0]!.importedPdfRenderState?.frame?.softMask?.elements[0]
        if (path?.type !== 'path' || typeof path.fill !== 'object' || path.fill.type !== 'tilingPattern') {
            throw new Error('Expected imported tiling pattern')
        }
        const group = path.fill.graphics[0]
        if (group?.kind !== 'group') throw new Error('Expected imported tile group')
        expect(group.softMask?.graphics[0]).toMatchObject({ kind: 'image', source: 'report_assets/tile.png' })
    })

    it('fits substituted fonts to PDF run advances without moving adjacent runs', () => {
        const synthetic = createDefaultElement('synthetic', 'staticText', 875.7004236, 100, 33.070818, 12)
        synthetic.text = '100% Synthetic '
        synthetic.style.fontFamily = 'Substitute'
        synthetic.style.fontSize = 10
        const oil = createDefaultElement('oil', 'staticText', 908.768364, 100, 5.56336, 12)
        oil.text = 'Oil'
        oil.style.fontFamily = 'Substitute'
        oil.style.fontSize = 10

        const originalSyntheticWidth = synthetic.width
        const originalOilX = oil.x
        fitTextElementsToAssignedFonts([synthetic, oil], function (_font, text) {
            return text === '100% Synthetic ' ? 45 : 7
        })

        expect(synthetic.width).toBe(originalSyntheticWidth)
        expect(oil.x).toBe(originalOilX)
        expect(synthetic.x + synthetic.width).toBeCloseTo(oil.x, 2)
        expect(45 * synthetic.horizontalScale).toBeCloseTo(synthetic.width, 10)
        expect(7 * oil.horizontalScale).toBeCloseTo(oil.width, 10)
    })

    it('preserves a trailing PDF space at a text-run boundary', () => {
        const non = createDefaultElement('non', 'staticText', 881.7289956, 100, 9.654348, 12)
        non.text = 'Non '
        non.style.fontFamily = 'Substitute'
        non.style.fontSize = 10
        const polymer = createDefaultElement('polymer', 'staticText', 891.3809456, 100, 18, 12)
        polymer.text = 'Polymer'
        polymer.style.fontFamily = 'Substitute'
        polymer.style.fontSize = 10

        fitTextElementsToAssignedFonts([non, polymer], function (_font, text) {
            // The substitute font's trailing space is included in its natural
            // advance; fitting the whole run keeps the next run at the PDF x.
            return text === 'Non ' ? 14 : 22
        })

        expect(14 * non.horizontalScale).toBeCloseTo(non.width, 10)
        expect(non.x + non.width).toBeCloseTo(polymer.x, 2)
        expect(polymer.x).toBe(891.3809456)
    })

    it('fits rotated substituted text along its PDF reading direction', () => {
        const rotated = createDefaultElement('rotated', 'staticText', 20, 30, 12, 40)
        rotated.text = 'Vertical'
        rotated.style.fontFamily = 'Substitute'
        rotated.style.fontSize = 10
        rotated.style.rotation = 90

        fitTextElementsToAssignedFonts([rotated], function () { return 50 })

        expect(rotated.height).toBe(40)
        expect(rotated.y).toBe(30)
        expect(rotated.horizontalScale).toBeCloseTo(0.8, 10)
    })

    it('converts imported path, text, image, and page settings', () => {
        const page: ImportedPage = {
            width: 595,
            height: 842,
            fonts: [],
            styles: [{ name: 'pdf_text_0', fontFamily: 'SubsetFont', fontSize: 10.5, bold: true }],
            images: { 'pdfimg0.png': new Uint8Array([1, 2, 3]) },
            elements: [
                {
                    type: 'staticText',
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 12,
                    text: 'Hello',
                    style: 'pdf_text_0',
                    forecolor: '#112233',
                    horizontalScale: 0.8,
                    baselineOffset: 10.5,
                },
                {
                    type: 'path',
                    x: 30,
                    y: 40,
                    width: 60,
                    height: 30,
                    d: 'M0 0 C20 0 40 30 60 30 Z',
                    fill: {
                        type: 'linearGradient',
                        x1: 0,
                        y1: 0,
                        x2: 1,
                        y2: 1,
                        stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }],
                    },
                    stroke: '#445566',
                    strokeWidth: 2,
                    fillOpacity: 0.35,
                    strokeOpacity: 0.6,
                    strokeDasharray: [3, 1],
                    strokeLinecap: 'round',
                    strokeLinejoin: 'bevel',
                },
                {
                    type: 'image',
                    x: 100,
                    y: 120,
                    width: 80,
                    height: 40,
                    source: 'pdfimg0.png',
                    scaleMode: 'fillFrame',
                    opacity: 0.5,
                    renderingIntent: 'Saturation',
                    interpolate: false,
                },
                {
                    type: 'frame',
                    x: 12,
                    y: 18,
                    width: 30,
                    height: 10,
                    clip: false,
                    opacity: 0.25,
                    affineTransform: [1, 0, 0, 1, 3, 4],
                    renderingIntent: 'Perceptual',
                    optionalContent: { name: 'Imported layer', visible: true, print: true },
                    hyperlink: { type: 'reference', target: '"https://example.test/form"' },
                    elements: [],
                },
            ],
        }

        const result = convertImportedPageToEditorElements(page, 7, { SubsetFont: 'NotoSansJP' })
        expect(result.nextElementIdCounter).toBe(11)
        expect(result.elements[0]).toMatchObject({
            id: 'el_7',
            kind: 'staticText',
            text: 'Hello',
            horizontalScale: 0.8,
            importedPdfRenderState: { text: { baselineOffset: 10.5 } },
            style: { fontFamily: 'NotoSansJP', fontSize: 10.5, bold: true, forecolor: '#112233', padding: { top: 0, bottom: 0, left: 0, right: 0 } },
        })
        expect(result.elements[1]).toMatchObject({
            id: 'el_8',
            kind: 'path',
            pathFillType: 'linear',
            stroke: '#445566',
            strokeWidth: 2,
            pathFillOpacity: 0.35,
            pathStrokeOpacity: 0.6,
            pathStrokeDash: [3, 1],
            pathStrokeCap: 'round',
            pathStrokeJoin: 'bevel',
        })
        expect(result.elements[1]!.pathSubpaths[0]!.closed).toBe(true)
        expect(result.elements[1]!.pathSubpaths[0]!.anchors.length).toBe(2)
        expect(result.elements[2]).toMatchObject({
            id: 'el_9',
            kind: 'image',
            source: 'pdfimg0.png',
            scaleMode: 'fillFrame',
            style: { opacity: 0.5 },
            importedPdfRenderState: {
                common: { renderingIntent: 'Saturation' },
                image: { interpolate: false },
            },
        })
        expect(result.elements[3]).toMatchObject({
            id: 'el_10',
            kind: 'frame',
            style: { opacity: 0.25 },
            hyperlinkType: 'reference',
            hyperlinkTarget: 'https://example.test/form',
            importedPdfRenderState: {
                common: {
                    renderingIntent: 'Perceptual',
                    optionalContent: { name: 'Imported layer', visible: true, print: true },
                },
                frame: { affineTransform: [1, 0, 0, 1, 3, 4] },
            },
        })

        const transparencyGroup = {
            colorSpace: { kind: 'rgb' as const },
            isolated: false,
            knockout: false,
        }
        const template = createDefaultTemplate()
        template.pageSettings = createPdfImportPageSettings(page.width, page.height, transparencyGroup)
        template.bands = [{ id: 'band_detail', type: 'detail', height: page.height, startNewPage: false, splitType: 'Stretch', elements: result.elements, printWhenExpression: '', enabled: true }]
        const core = convertEditorTemplateToCore(template)
        expect(core.page.transparencyGroup).toEqual(transparencyGroup)
        const path = core.bands.details![0]!.elements![1]!
        expect(core.bands.details![0]!.elements![0]).toMatchObject({ type: 'staticText', baselineOffset: 10.5 })
        expect(path).toMatchObject({ type: 'path', fillOpacity: 0.35, strokeOpacity: 0.6 })
        expect(core.bands.details![0]!.elements![2]).toMatchObject({
            type: 'image', renderingIntent: 'Saturation', interpolate: false,
        })
        expect(core.bands.details![0]!.elements![3]).toMatchObject({
            type: 'frame',
            clip: false,
            affineTransform: [1, 0, 0, 1, 3, 4],
            renderingIntent: 'Perceptual',
            optionalContent: { name: 'Imported layer', visible: true, print: true },
        })
        const doc = createReport(core, { rows: [{}] })
        expect(findGroupWithOpacity(doc.pages[0]!.children, 0.25)).toBeDefined()
        expect(doc.pages[0]!.transparencyGroup).toEqual(transparencyGroup)

        const settings = createPdfImportPageSettings(page.width, page.height)
        expect(settings).toMatchObject({
            size: 'A4',
            orientation: 'portrait',
            marginTop: 0,
            marginLeft: 0,
            columnWidth: 595,
        })
    })

    it('detects landscape page size by swapped dimensions', () => {
        const settings = createPdfImportPageSettings(842, 595)
        expect(settings.size).toBe('A4')
        expect(settings.orientation).toBe('landscape')
    })

    it('packs retained native mesh patches for the locked editor state', () => {
        const points: number[] = []
        for (let row = 0; row < 4; row++) {
            for (let column = 0; column < 4; column++) points.push(column * 10, row * 10)
        }
        const page: ImportedPage = { width: 30, height: 30, images: {}, fonts: [], styles: [], elements: [{
            type: 'path', x: 0, y: 0, width: 30, height: 30, d: 'M0 0L30 0L30 30L0 30Z',
            fill: {
                type: 'meshGradient',
                patches: [{ points, colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }],
                pdfShading: {
                    native: {
                        shadingType: 7, bitsPerCoordinate: 8, bitsPerComponent: 8, bitsPerFlag: 2,
                        decode: [0, 30, 0, 30, 0, 1, 0, 1, 0, 1], colorSpace: { kind: 'rgb' },
                        data: new Uint8Array([1, 2, 3]), matrix: [1, 0, 0, 1, 0, 0],
                    },
                },
            },
        }] }

        const result = convertImportedPageToEditorElements(page, 1, {})
        const fill = result.elements[0]!.pathComplexFill

        expect(fill?.type).toBe('meshGradient')
        if (fill?.type !== 'meshGradient') throw new Error('mesh fill expected')
        expect(fill.patches).toBeUndefined()
        expect(fill.packedPatches?.points).toEqual(new Float32Array(points))
        expect(fill.packedPatches?.colors).toEqual(new Uint32Array([0xff0000, 0x00ff00, 0x0000ff, 0xffffff]))
        const template = createDefaultTemplate()
        template.bands = [{ id: 'detail', type: 'detail', height: 30, startNewPage: false, splitType: 'Stretch', elements: result.elements, printWhenExpression: '', enabled: true }]
        const core = convertEditorTemplateToCore(template)
        const coreFill = (core.bands.details![0]!.elements![0] as { fill?: { packedPatches?: unknown } }).fill
        expect(coreFill?.packedPatches).toBeDefined()
    })

    it('packs preview meshes recursively without losing existing compact geometry', () => {
        const points: number[] = []
        for (let row = 0; row < 4; row++) {
            for (let column = 0; column < 4; column++) points.push(column * 10, row * 10)
        }
        const existingPoints = new Float32Array(points.map(function (value) { return value + 40 }))
        const page: ImportedPage = {
            width: 80,
            height: 40,
            images: {},
            fonts: [],
            styles: [],
            elements: [{
                type: 'frame', x: 0, y: 0, width: 80, height: 40,
                softMask: {
                    type: 'luminosity',
                    elements: [{
                        type: 'path', x: 0, y: 0, width: 80, height: 40, d: 'M0 0L80 0L80 40L0 40Z',
                        fill: {
                            type: 'meshGradient',
                            patches: [{ points, colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }],
                            packedPatches: {
                                points: existingPoints,
                                colors: new Uint32Array([0x010203, 0x040506, 0x070809, 0x0a0b0c]),
                            },
                        },
                    }],
                },
                elements: [],
            }],
        }

        const compacted = compactImportedPageMeshes(page)
        const frame = compacted.elements[0]
        if (frame?.type !== 'frame') throw new Error('frame expected')
        const path = frame.softMask?.elements[0]
        if (path?.type !== 'path' || typeof path.fill !== 'object' || path.fill.type !== 'meshGradient') {
            throw new Error('soft-mask mesh path expected')
        }
        expect(path.fill.patches).toBeUndefined()
        expect(path.fill.packedPatches?.points).toHaveLength(64)
        expect(path.fill.packedPatches?.points.subarray(0, 32)).toEqual(existingPoints)
        expect(path.fill.packedPatches?.points.subarray(32)).toEqual(new Float32Array(points))
        expect((page.elements[0] as { softMask?: { elements: Array<{ fill?: { patches?: unknown[] } }> } }).softMask?.elements[0]!.fill?.patches).toHaveLength(1)
    })

    it('imports a producer-rounded page as custom with its exact dimensions', () => {
        // 595.92 x 842.88 is "A4 with producer rounding". Labeling it A4 would
        // make the core engine lay out on a 595 x 842 page while the bands were
        // built from the real 842.88pt coordinates — a guaranteed page break.
        const settings = createPdfImportPageSettings(595.91998, 842.88)
        expect(settings.size).toBe('custom')
        expect(settings.orientation).toBe('portrait')
        expect(settings.width).toBe(595.91998)
        expect(settings.height).toBe(842.88)
    })

    it('rebases affine path matrices when path coordinates are normalized for editing', () => {
        const page: ImportedPage = {
            width: 2000,
            height: 11000,
            fonts: [], styles: [], images: {},
            elements: [{
                type: 'path', x: 0, y: 0, width: 1200, height: 10452,
                d: 'M323 98 L1523 98 L1523 10550 L323 10550 Z',
                fill: '#000000',
                affineTransform: [1, 0, 0, -1, -323, 10551],
            }],
        }
        const imported = convertImportedPageToEditorElements(page, 1, {})
        expect(imported.elements[0]).toMatchObject({
            x: 323,
            y: 98,
            importedPdfRenderState: {
                path: { affineTransform: [1, 0, 0, -1, -323, 10355] },
            },
        })
        const template = createDefaultTemplate()
        template.bands = [{
            id: 'band_detail', type: 'detail', height: page.height, startNewPage: false,
            splitType: 'Stretch', elements: imported.elements, printWhenExpression: '', enabled: true,
        }]
        const path = convertEditorTemplateToCore(template).bands.details![0]!.elements![0]!
        expect(path).toMatchObject({
            type: 'path', x: 323, y: 98,
            affineTransform: [1, 0, 0, -1, -323, 10355],
        })
    })
})

describe('pdf import band assignment', () => {
    function regions() {
        return [
            { type: 'pageHeader', top: 0, height: 60 },
            { type: 'detail', top: 60, height: 700 },
            { type: 'pageFooter', top: 760, height: 82 },
        ] as const
    }

    it('splits elements into band regions and rebases y', () => {
        const header = createDefaultElement('el_1', 'staticText', 10, 10, 50, 12)
        const body = createDefaultElement('el_2', 'staticText', 10, 100, 50, 12)
        const footer = createDefaultElement('el_3', 'staticText', 10, 790, 50, 12)
        const result = splitElementsIntoBandRegions([header, body, footer], [...regions()])
        expect(result[0]).toMatchObject({ type: 'pageHeader', height: 60 })
        expect(result[0]!.elements[0]).toMatchObject({ id: 'el_1', y: 10 })
        expect(result[1]!.elements[0]).toMatchObject({ id: 'el_2', y: 40 })
        expect(result[2]!.elements[0]).toMatchObject({ id: 'el_3', y: 30 })
    })

    it('assigns a boundary-crossing element to the band with the largest overlap', () => {
        // 0..100 overlaps the header by 60 and the detail by 40 → header,
        // even though it reaches past the boundary
        const acrossHeader = createDefaultElement('el_1', 'image', 0, 0, 200, 100)
        // 30..842 overlaps the detail by far the most → detail although it
        // touches the header and covers the footer entirely
        const acrossAll = createDefaultElement('el_2', 'image', 0, 30, 200, 812)
        const result = splitElementsIntoBandRegions([acrossHeader, acrossAll], [...regions()])
        expect(result[0]!.elements.map(function (e) { return e.id })).toEqual(['el_1'])
        expect(result[1]!.elements.map(function (e) { return e.id })).toEqual(['el_2'])
        // Boundaries grow to the content bottoms so no band stretches at
        // layout time: header 0..100, detail 100..842, footer empty
        expect(result[0]!.height).toBe(100)
        expect(result[1]!.height).toBe(742)
        expect(result[2]!.height).toBe(0)
        expect(result[1]!.elements[0]!.y).toBe(-70)
        expect(result[0]!.height + result[1]!.height + result[2]!.height).toBe(842)
    })

    it('keeps the configured boundaries when no content crosses them', () => {
        const header = createDefaultElement('el_1', 'image', 0, 10, 100, 40)
        const body = createDefaultElement('el_2', 'image', 0, 70, 100, 600)
        const result = splitElementsIntoBandRegions([header, body], [...regions()])
        expect(result[0]!.height).toBe(60)
        expect(result[1]!.height).toBe(700)
        expect(result[2]!.height).toBe(82)
    })

    it('assigns a zero-height element by its center position', () => {
        const rule = createDefaultElement('el_1', 'line', 0, 760, 500, 0)
        const result = splitElementsIntoBandRegions([rule], [...regions()])
        expect(result[2]!.elements.map(function (e) { return e.id })).toEqual(['el_1'])
    })

    it('dissolves a page-wide frame whose children span multiple bands', () => {
        // The PDF importer wraps clipped content in frames; a page-wide clip
        // frame must not drag every child into a single band
        const frame = createDefaultElement('el_1', 'frame', 5, 0, 585, 842)
        const headerPiece = createDefaultElement('el_2', 'image', 10, 5, 100, 50)
        const detailPiece = createDefaultElement('el_3', 'image', 10, 65, 100, 600)
        const footerPiece = createDefaultElement('el_4', 'image', 10, 770, 100, 60)
        frame.children = [headerPiece, detailPiece, footerPiece]
        const result = splitElementsIntoBandRegions([frame], [...regions()])
        // The frame wrapper is dropped; children hoist to page coordinates
        expect(result[0]!.elements).toEqual([{ ...headerPiece, x: 15, y: 5 }])
        expect(result[1]!.elements).toEqual([{ ...detailPiece, x: 15, y: 5 }])
        expect(result[2]!.elements).toEqual([{ ...footerPiece, x: 15, y: 10 }])
    })

    it('keeps an imported PDF frame intact across band regions', () => {
        const frame = createDefaultElement('el_1', 'frame', 5, 0, 585, 842)
        frame.importedPdfRenderState = { common: {}, frame: { affineTransform: [1, 0, 0, 1, 8, 9] } }
        frame.children = [
            createDefaultElement('el_2', 'image', 10, 5, 100, 50),
            createDefaultElement('el_3', 'image', 10, 770, 100, 60),
        ]

        const result = splitElementsIntoBandRegions([frame], [...regions()])

        expect(result[1]!.elements).toHaveLength(1)
        expect(result[1]!.elements[0]).toMatchObject({
            id: 'el_1',
            importedPdfRenderState: { frame: { affineTransform: [1, 0, 0, 1, 8, 9] } },
        })
        expect(result[0]!.elements).toHaveLength(0)
        expect(result[2]!.elements).toHaveLength(0)
    })

    it('keeps a frame whole when all children score into one band', () => {
        const frame = createDefaultElement('el_1', 'frame', 5, 750, 200, 92)
        const piece = createDefaultElement('el_2', 'image', 0, 20, 100, 60)
        frame.children = [piece]
        const result = splitElementsIntoBandRegions([frame], [...regions()])
        expect(result[2]!.elements).toHaveLength(1)
        expect(result[2]!.elements[0]).toMatchObject({ id: 'el_1', y: -10 })
        expect(result[2]!.elements[0]!.children[0]).toBe(piece)
    })

    it('scaleImportedElements applies a uniform similarity transform', () => {
        const frame = createDefaultElement('el_1', 'frame', 10, 20, 200, 100)
        frame.frameClipPathD = 'M0 0L200 0L200 100L0 100Z'
        const text = createDefaultElement('el_2', 'staticText', 4, 6, 50, 12)
        text.style = { ...text.style, fontSize: 10 }
        text.letterSpacing = 1
        text.wordSpacing = 2
        text.importedPdfRenderState = { common: {}, text: { baselineOffset: 10 } }
        const path = createDefaultElement('el_3', 'path', 0, 0, 10, 10)
        path.pathSubpaths = [{ closed: true, anchors: [{ x: 0, y: 0, inX: 0, inY: 0, outX: 5, outY: 0, handleMode: 'independent' }] }]
        path.pathStrokeDash = [4, 2]
        path.strokeWidth = 2
        frame.children = [text]
        const scaled = scaleImportedElements([frame, path], 0.5)
        expect(scaled[0]).toMatchObject({ x: 5, y: 10, width: 100, height: 50, frameClipPathD: 'M0 0L100 0L100 50L0 50Z' })
        expect(scaled[0]!.children[0]).toMatchObject({
            x: 2, y: 3, width: 25, height: 6, letterSpacing: 0.5, wordSpacing: 1,
            importedPdfRenderState: { text: { baselineOffset: 5 } },
        })
        expect(scaled[0]!.children[0]!.style.fontSize).toBe(5)
        expect(scaled[1]).toMatchObject({ strokeWidth: 1, pathStrokeDash: [2, 1] })
        expect(scaled[1]!.pathSubpaths[0]!.anchors[0]).toMatchObject({ outX: 2.5 })
        // Identity keeps the input untouched
        expect(scaleImportedElements([frame], 1)).toEqual([frame])
    })

    it('offsetImportedElements shifts top-level elements and their subtrees as one', () => {
        const frame = createDefaultElement('el_1', 'frame', 10, 20, 100, 50)
        const child = createDefaultElement('el_2', 'image', 5, 5, 10, 10)
        frame.children = [child]
        const shifted = offsetImportedElements([frame], 7, 3)
        expect(shifted[0]).toMatchObject({ x: 17, y: 23 })
        // Children are relative to the parent and stay untouched
        expect(shifted[0]!.children[0]).toBe(child)
        // Zero offset keeps the input untouched
        const identity = [frame]
        expect(offsetImportedElements(identity, 0, 0)).toBe(identity)
    })

    it('fits a producer-rounded page into the current A4 template on a single page', () => {
        // The fit-to-current-page mode: the page settings stay untouched and
        // the content is uniformly scaled into the printable area
        const pdfWidth = 595.91998
        const pdfHeight = 842.88
        const template = createDefaultTemplate()
        const settings = template.pageSettings
        const printableWidth = settings.width - settings.marginLeft - settings.marginRight
        const printableHeight = settings.height - settings.marginTop - settings.marginBottom
        const scale = Math.min(printableWidth / pdfWidth, printableHeight / pdfHeight)
        let regionState = createDefaultRegionState(pdfHeight)
        regionState = toggleRegion(regionState, 'pageHeader', pdfHeight)
        regionState = toggleRegion(regionState, 'pageFooter', pdfHeight)
        const enabled = regionState.filter(function (r) { return r.enabled })
        const bandRegions = []
        let top = 0
        for (const region of enabled) {
            const height = region.height * scale
            bandRegions.push({ type: region.type, top, height })
            top += height
        }
        const elements = scaleImportedElements([
            createDefaultElement('el_1', 'rectangle', 0, 0, pdfWidth, 200),
            createDefaultElement('el_2', 'rectangle', 0, 200, pdfWidth, pdfHeight - 200),
        ], scale)
        const contents = splitElementsIntoBandRegions(elements, bandRegions)
        template.bands = template.bands.map(function (band) {
            const content = contents.find(function (c) { return c.type === band.type })
            if (content !== undefined) return { ...band, height: content.height, enabled: true, elements: content.elements }
            return { ...band, enabled: false }
        })
        const doc = createReport(convertEditorTemplateToCore(template), { rows: [{}] })
        expect(doc.pages.length).toBe(1)
        // The page settings stay A4
        expect(template.pageSettings.size).toBe('A4')
        expect(template.pageSettings.height).toBe(842)
    })

    it('renders a producer-rounded page import on a single page end to end', () => {
        // Reproduces the reported break: a 595.92 x 842.88 PDF imported into
        // pageHeader / detail / pageFooter without any manual edits must not
        // paginate. The band heights carry float dust from the proportional
        // toggles and one piece crosses a band boundary.
        const pageWidth = 595.91998
        const pageHeight = 842.88
        let regionState = createDefaultRegionState(pageHeight)
        regionState = toggleRegion(regionState, 'pageHeader', pageHeight)
        regionState = toggleRegion(regionState, 'pageFooter', pageHeight)
        const enabled = regionState.filter(function (r) { return r.enabled })
        const bandRegions = []
        let top = 0
        for (const region of enabled) {
            bandRegions.push({ type: region.type, top, height: region.height })
            top += region.height
        }
        const headerBoundary = bandRegions[1]!.top
        const elements = [
            createDefaultElement('el_1', 'rectangle', 0, 0, pageWidth, headerBoundary - 5),
            // Crosses the header/detail boundary by a few points
            createDefaultElement('el_2', 'rectangle', 0, headerBoundary - 20, 200, 40),
            createDefaultElement('el_3', 'rectangle', 0, bandRegions[2]!.top + 1, pageWidth, pageHeight - bandRegions[2]!.top - 1),
        ]
        const contents = splitElementsIntoBandRegions(elements, bandRegions)

        const template = createDefaultTemplate()
        template.pageSettings = createPdfImportPageSettings(pageWidth, pageHeight)
        template.bands = template.bands.map(function (band) {
            const content = contents.find(function (c) { return c.type === band.type })
            if (content !== undefined) return { ...band, height: content.height, enabled: true, elements: content.elements }
            return { ...band, enabled: false }
        })
        const doc = createReport(convertEditorTemplateToCore(template), { rows: [{}] })
        expect(doc.pages.length).toBe(1)
    })

    it('toggles regions while keeping the total height equal to the page height', () => {
        const initial = createDefaultRegionState(800)
        expect(initial.find(r => r.type === 'detail')).toMatchObject({ enabled: true, height: 800 })

        const withHeader = toggleRegion(initial, 'pageHeader', 800)
        const enabled = withHeader.filter(r => r.enabled)
        expect(enabled.length).toBe(2)
        expect(enabled.reduce((sum, r) => sum + r.height, 0)).toBeCloseTo(800, 6)

        // Disabling the last remaining band is rejected
        const detailOnly = toggleRegion(toggleRegion(withHeader, 'pageHeader', 800), 'detail', 800)
        expect(detailOnly.filter(r => r.enabled).length).toBe(1)
    })

    it('moves a region boundary with a minimum band height clamp', () => {
        const regions = toggleRegion(createDefaultRegionState(800), 'pageHeader', 800)
        const moved = moveRegionBoundary(regions, 0, 100)
        const header = moved.find(r => r.type === 'pageHeader')!
        const detail = moved.find(r => r.type === 'detail')!
        expect(header.height + detail.height).toBeCloseTo(800, 6)
        expect(header.height).toBeGreaterThan(regions.find(r => r.type === 'pageHeader')!.height)

        // Clamped: cannot shrink the lower band below the minimum height
        const extreme = moveRegionBoundary(regions, 0, 100000)
        expect(extreme.find(r => r.type === 'detail')!.height).toBeGreaterThanOrEqual(8)
    })
})

describe('draft band conversion', () => {
    it('excludes draft bands from the core template output', () => {
        const template = createDefaultTemplate()
        template.bands = [
            {
                id: 'band_draft',
                type: 'draft',
                height: 800,
                startNewPage: false,
                splitType: 'Stretch',
                elements: [createDefaultElement('el_1', 'staticText', 0, 0, 50, 12)],
                printWhenExpression: '',
                enabled: true,
            },
            ...template.bands,
        ]
        const core = convertEditorTemplateToCore(template)
        const bandKeys = Object.keys(core.bands)
        expect(bandKeys.includes('draft' as never)).toBe(false)
        const json = JSON.stringify(core.bands)
        expect(json.includes('el_1')).toBe(false)
    })
})
