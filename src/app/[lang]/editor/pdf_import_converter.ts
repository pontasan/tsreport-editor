import { parseSvgPath, type ElementDef, type FillDef, type FrameDef, type GradientDef, type HyperlinkDef, type ImportedPage, type MeshGradientDef, type PageTransparencyGroupDef, type PathDef, type StyleDef, type TileGraphicDef } from 'tsreport-core'
import { DEFAULT_FONT_ID } from '@/lib/common/font_ids'
import { createDefaultElement, PAGE_SIZES, type BandType, type ImportedPdfRenderState, type PageSettings, type PdfImportBandContent, type TemplateElement } from './reducer'
import { normalizePathBounds, pathArraysToSubpaths, type PathSubpath } from './path_model'

export type PdfFontAssignments = Record<string, string>

export type PdfImportConversionResult = {
    elements: TemplateElement[],
    nextElementIdCounter: number
}

/** Compacts display-only mesh data before it enters React preview state. */
export function compactImportedPageMeshes(page: ImportedPage): ImportedPage {
    return { ...page, elements: page.elements.map(compactCoreElementMeshes) }
}

/** Vertical page region assigned to a band in the import preview */
export type PdfImportBandRegion = {
    type: BandType,
    top: number,
    height: number
}

type ConversionContext = {
    nextId: () => string,
    fontAssignments: PdfFontAssignments,
    styleMap: Map<string, StyleDef>
}

export function pdfFontKey(baseFont: string, familyName: string): string {
    return baseFont + '\n' + familyName
}

export function createPdfImportPageSettings(
    width: number,
    height: number,
    transparencyGroup?: PageTransparencyGroupDef,
): PageSettings {
    const matched = matchPageSize(width, height)
    return {
        size: matched.size,
        width,
        height,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        orientation: matched.orientation,
        columnCount: 1,
        columnWidth: width,
        columnSpacing: 0,
        columnPrintOrder: 'vertical',
        transparencyGroup,
    }
}

export function convertImportedPageToEditorElements(
    page: ImportedPage,
    firstElementId: number,
    fontAssignments: PdfFontAssignments,
): PdfImportConversionResult {
    let counter = firstElementId
    const context: ConversionContext = {
        nextId: function nextId(): string {
            const id = 'el_' + counter
            counter++
            return id
        },
        fontAssignments,
        styleMap: new Map(page.styles.map(function (style) { return [style.name, style] })),
    }
    const elements = page.elements.map(function (element) {
        return convertCoreElement(element, context)
    })
    return { elements, nextElementIdCounter: counter }
}

/**
 * Fits each assigned (substituted) font to the original PDF text-run advance.
 *
 * PDF producers commonly split one visual line into adjacent text runs. Their
 * x positions are authoritative: growing a run to the substitute font's
 * natural width makes it overlap the next run and destroys spaces that end a
 * run.  Preserve the imported box and fit the substitute glyph advances with
 * horizontalScale instead. Rotated 90/270-degree text advances along height.
 */
export function fitTextElementsToAssignedFonts(
    elements: TemplateElement[],
    measureWidth: (fontFamily: string, text: string, fontSize: number) => number,
): void {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        if (element.children.length > 0) fitTextElementsToAssignedFonts(element.children, measureWidth)
        if (element.kind !== 'staticText' || element.text === '') continue
        const fontSize = element.style.fontSize
        // Mirror the core layout measurement (text-layout.ts measureText).
        // Imported Tc/Tw values are stored in unscaled text space; layout
        // applies horizontalScale once to the complete advance.
        const chars = [...element.text]
        let extra = Math.max(0, chars.length - 1) * element.letterSpacing
        for (let c = 0; c < chars.length; c++) {
            if (chars[c] === ' ') extra += element.wordSpacing
        }
        const naturalAdvance = measureWidth(element.style.fontFamily, element.text, fontSize) + extra
        if (!Number.isFinite(naturalAdvance) || naturalAdvance <= 0) {
            throw new Error('PDF import error: assigned font produced an invalid text advance')
        }
        const rotation = element.style.rotation
        const targetAdvance = rotation === 90 || rotation === 270 ? element.height : element.width
        if (!Number.isFinite(targetAdvance) || targetAdvance < 0) {
            throw new Error('PDF import error: imported text has an invalid advance')
        }
        element.horizontalScale = targetAdvance / naturalAdvance
    }
}

/**
 * Rewrites imported raster references after the files have been uploaded.
 * Soft-mask graphics remain core elements because they are not editable
 * artwork, so they must be traversed separately from the editor child tree.
 */
export function rewriteImportedImageSources(
    elements: TemplateElement[],
    sourceMap: Map<string, string>,
): TemplateElement[] {
    return elements.map(function (element) {
        const source = element.kind === 'image' ? sourceMap.get(element.source) ?? element.source : element.source
        const children = element.children.length > 0
            ? rewriteImportedImageSources(element.children, sourceMap)
            : element.children
        const importedPdfRenderState = rewriteImportedStateImageSources(element.importedPdfRenderState, sourceMap)
        if (
            source === element.source
            && children === element.children
            && importedPdfRenderState === element.importedPdfRenderState
        ) return element
        return { ...element, source, children, importedPdfRenderState }
    })
}

function rewriteImportedStateImageSources(
    state: ImportedPdfRenderState | null,
    sourceMap: Map<string, string>,
): ImportedPdfRenderState | null {
    if (state === null) return null
    let image = state.image
    if (image?.alternates !== undefined) {
        image = {
            ...image,
            alternates: image.alternates.map(function (alternate) {
                return { ...alternate, source: sourceMap.get(alternate.source) ?? alternate.source }
            }),
        }
    }
    let frame = state.frame
    if (frame?.softMask !== undefined) {
        frame = {
            ...frame,
            softMask: {
                ...frame.softMask,
                elements: rewriteCoreImageSources(frame.softMask.elements, sourceMap),
            },
        }
    }
    if (image === state.image && frame === state.frame) return state
    return { ...state, image, frame }
}

function rewriteCoreImageSources(elements: ElementDef[], sourceMap: Map<string, string>): ElementDef[] {
    return elements.map(function (element) {
        switch (element.type) {
            case 'image': {
                const source = element.source === undefined ? undefined : sourceMap.get(element.source) ?? element.source
                const alternates = element.alternates?.map(function (alternate) {
                    return { ...alternate, source: sourceMap.get(alternate.source) ?? alternate.source }
                })
                return { ...element, source, alternates }
            }
            case 'rectangle':
            case 'ellipse':
                return { ...element, fill: rewriteFillImageSources(element.fill, sourceMap) }
            case 'path':
                return {
                    ...element,
                    fill: rewriteFillImageSources(element.fill, sourceMap),
                    stroke: rewriteFillImageSources(element.stroke, sourceMap),
                }
            case 'frame': {
                const children = element.elements === undefined
                    ? undefined
                    : rewriteCoreImageSources(element.elements, sourceMap)
                const softMask = element.softMask === undefined
                    ? undefined
                    : { ...element.softMask, elements: rewriteCoreImageSources(element.softMask.elements, sourceMap) }
                return { ...element, elements: children, softMask }
            }
            default:
                return element
        }
    })
}

function rewriteFillImageSources(fill: FillDef | undefined, sourceMap: Map<string, string>): FillDef | undefined {
    if (typeof fill !== 'object') return fill
    switch (fill.type) {
        case 'tilingPattern':
            return { ...fill, graphics: fill.graphics.map(function (graphic) { return rewriteTileGraphicImageSources(graphic, sourceMap) }) }
        case 'pdfSpecialColor':
        case 'linearGradient':
        case 'radialGradient':
        case 'meshGradient':
        case 'functionShading':
            return fill
        default:
            fill satisfies never
            return fill
    }
}

function rewriteTileGraphicImageSources(graphic: TileGraphicDef, sourceMap: Map<string, string>): TileGraphicDef {
    switch (graphic.kind) {
        case 'image':
            return { ...graphic, source: sourceMap.get(graphic.source) ?? graphic.source }
        case 'path':
            return {
                ...graphic,
                fill: rewriteFillImageSources(graphic.fill, sourceMap),
                stroke: rewriteFillImageSources(graphic.stroke, sourceMap),
            }
        case 'group':
            return {
                ...graphic,
                graphics: graphic.graphics.map(function (child) { return rewriteTileGraphicImageSources(child, sourceMap) }),
                softMask: graphic.softMask === undefined ? undefined : {
                    ...graphic.softMask,
                    graphics: graphic.softMask.graphics.map(function (child) { return rewriteTileGraphicImageSources(child, sourceMap) }),
                },
            }
        case 'text':
            return graphic
    }
}

/**
 * Splits converted elements into the band regions chosen in the import
 * preview. Every element is assigned to the region with the largest
 * overlapping area — regions are full-width horizontal strips, so the
 * vertical overlap length decides — and repositioned relative to the band
 * top. Boundary-crossing elements (e.g. slice pieces) therefore follow
 * their dominant band instead of a fragile edge test; an element without
 * vertical overlap falls back to the region containing its center. A frame
 * whose children score into different regions (typically a page-wide clip
 * wrapper from the PDF importer) cannot follow a single band: it is
 * dissolved and its children are hoisted to page coordinates and assigned
 * individually. A frame whose children all score into one region moves
 * there as a whole.
 */
export function splitElementsIntoBandRegions(
    elements: TemplateElement[],
    regions: PdfImportBandRegion[],
): PdfImportBandContent[] {
    if (regions.length === 0) throw new Error('PDF import error: at least one band region is required')
    const buckets: TemplateElement[][] = regions.map(function () { return [] })
    assignElementsToRegions(elements, 0, 0, regions, buckets)
    // Fit the band boundaries to the assigned content: the layout engine
    // stretches a band whose content reaches below its declared height, which
    // would push the following bands and break the single-page reproduction
    // of the imported page. Growing a boundary to the content bottom keeps
    // every band at least as tall as its content while the total stays equal
    // to the page height (the last band absorbs the difference).
    const total = regions[regions.length - 1]!.top + regions[regions.length - 1]!.height
    const tops: number[] = [regions[0]!.top]
    for (let i = 1; i < regions.length; i++) {
        let top = Math.max(regions[i]!.top, tops[i - 1]!)
        const bucket = buckets[i - 1]!
        for (let j = 0; j < bucket.length; j++) {
            const bottom = bucket[j]!.y + bucket[j]!.height
            if (bottom > top) top = bottom
        }
        tops.push(Math.min(top, total))
    }
    return regions.map(function (region, index) {
        const top = tops[index]!
        const height = (index + 1 < regions.length ? tops[index + 1]! : total) - top
        const rebased = buckets[index]!.map(function (element) { return { ...element, y: element.y - top } })
        return { type: region.type, height, elements: rebased }
    })
}

function assignElementsToRegions(
    elements: TemplateElement[],
    offsetX: number,
    offsetY: number,
    regions: PdfImportBandRegion[],
    buckets: TemplateElement[][],
): void {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        const absX = offsetX + element.x
        const absTop = offsetY + element.y
        if (element.kind === 'frame' && element.children.length > 0) {
            // A PDF frame owns affine, clipping, transparency, and form state.
            // Hoisting its children would change their coordinate system and
            // painting order, so imported frames always move as one unit.
            if (element.importedPdfRenderState !== null) {
                const frameRegion = regionIndexByScore(absTop, element.height, regions)
                buckets[frameRegion]!.push({ ...element, x: absX, y: absTop })
                continue
            }
            const first = regionIndexByScore(absTop + element.children[0]!.y, element.children[0]!.height, regions)
            let spansMultiple = false
            for (let j = 1; j < element.children.length; j++) {
                const child = element.children[j]!
                if (regionIndexByScore(absTop + child.y, child.height, regions) !== first) {
                    spansMultiple = true
                    break
                }
            }
            if (spansMultiple) {
                assignElementsToRegions(element.children, absX, absTop, regions, buckets)
                continue
            }
            buckets[first]!.push({ ...element, x: absX, y: absTop })
            continue
        }
        const index = regionIndexByScore(absTop, element.height, regions)
        buckets[index]!.push({ ...element, x: absX, y: absTop })
    }
}

/** Index of the region with the largest vertical overlap with [top, top+height]. */
function regionIndexByScore(top: number, height: number, regions: PdfImportBandRegion[]): number {
    let best = -1
    let bestOverlap = 0
    for (let r = 0; r < regions.length; r++) {
        const region = regions[r]!
        const overlap = Math.min(top + height, region.top + region.height) - Math.max(top, region.top)
        if (overlap > bestOverlap) {
            bestOverlap = overlap
            best = r
        }
    }
    if (best >= 0) return best
    // No vertical extent overlaps any region (zero-height rules or
    // out-of-page positions): use the region containing the center
    const center = top + height / 2
    for (let r = 0; r < regions.length; r++) {
        const region = regions[r]!
        if (center < region.top + region.height) return r
    }
    return regions.length - 1
}

// A page is labeled with a named size only when the dimensions match it
// exactly. The core engine resolves a named size to its canonical dimensions
// before the explicit width/height, so labeling a producer-rounded page
// (e.g. 595.92 x 842.88 "A4") would shrink the layout page below the band
// total built from the real PDF coordinates and force a page break. Inexact
// pages import as 'custom' with their exact dimensions; the fit-to-page
// import option covers the "this is meant to be A4" case instead.
function matchPageSize(width: number, height: number): { size: string, orientation: 'portrait' | 'landscape' } {
    const names = Object.keys(PAGE_SIZES)
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!
        const size = PAGE_SIZES[name]!
        if (width === size.width && height === size.height) return { size: name, orientation: 'portrait' }
        if (width === size.height && height === size.width) return { size: name, orientation: 'landscape' }
    }
    return { size: 'custom', orientation: width >= height ? 'landscape' : 'portrait' }
}

/**
 * Uniformly scales imported elements by the given factor: geometry, text
 * metrics, outline geometry and stroke widths, recursively. Used by the
 * fit-to-current-page import mode; a uniform factor keeps the result an
 * exact similarity transform of the PDF page.
 */
export function scaleImportedElements(elements: TemplateElement[], factor: number): TemplateElement[] {
    if (factor === 1) return elements
    const result: TemplateElement[] = []
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        result.push({
            ...element,
            x: element.x * factor,
            y: element.y * factor,
            width: element.width * factor,
            height: element.height * factor,
            style: { ...element.style, fontSize: element.style.fontSize * factor },
            letterSpacing: element.letterSpacing * factor,
            wordSpacing: element.wordSpacing * factor,
            strokeWidth: element.strokeWidth * factor,
            radius: element.radius * factor,
            topLeftRadius: element.topLeftRadius * factor,
            topRightRadius: element.topRightRadius * factor,
            bottomRightRadius: element.bottomRightRadius * factor,
            bottomLeftRadius: element.bottomLeftRadius * factor,
            pathSubpaths: scaleSubpaths(element.pathSubpaths, factor),
            pathStrokeDash: scaleNumbers(element.pathStrokeDash, factor),
            shapeGradient: scaleImportedGradientMetadata(element.shapeGradient, factor),
            pathGradient: scaleImportedGradientMetadata(element.pathGradient, factor),
            pathComplexFill: scaleComplexFill(element.pathComplexFill, factor),
            frameClipPathD: scalePathD(element.frameClipPathD, factor),
            importedPdfRenderState: scaleImportedPdfRenderState(element.importedPdfRenderState, factor),
            children: scaleImportedElements(element.children, factor),
        })
    }
    return result
}

function scaleComplexFill(fill: TemplateElement['pathComplexFill'], factor: number): TemplateElement['pathComplexFill'] {
    if (fill === null || factor === 1 || fill.type !== 'meshGradient') return fill
    const scalePoints = function (points: number[]): number[] {
        return points.map(function (value) { return value * factor })
    }
    const scalePacked = function (packed: { points: Float32Array, colors: Uint32Array } | undefined) {
        if (packed === undefined) return undefined
        const points = new Float32Array(packed.points.length)
        for (let i = 0; i < points.length; i++) points[i] = packed.points[i]! * factor
        return { points, colors: packed.colors }
    }
    const native = fill.pdfShading?.native
    return {
        ...fill,
        patches: fill.patches?.map(function (patch) { return { ...patch, points: scalePoints(patch.points) } }),
        triangles: fill.triangles?.map(function (triangle) { return { ...triangle, points: scalePoints(triangle.points) } }),
        packedPatches: scalePacked(fill.packedPatches),
        packedTriangles: scalePacked(fill.packedTriangles),
        lattice: fill.lattice === undefined ? undefined : { ...fill.lattice, points: scalePoints(fill.lattice.points) },
        pdfShading: fill.pdfShading === undefined ? undefined : {
            ...fill.pdfShading,
            bbox: fill.pdfShading.bbox?.map(function (value) { return value * factor }) as [number, number, number, number] | undefined,
            native: native === undefined ? undefined : {
                ...native,
                matrix: native.matrix.map(function (value) { return value * factor }) as [number, number, number, number, number, number],
            },
        },
    }
}

function scaleImportedGradientMetadata<T extends TemplateElement['pathGradient']>(gradient: T, factor: number): T {
    const shading = gradient.pdfShading
    if (shading === undefined) return gradient
    const native = shading.native
    return {
        ...gradient,
        pdfShading: {
            ...shading,
            bbox: shading.bbox?.map(function (value) { return value * factor }) as [number, number, number, number] | undefined,
            native: native === undefined ? undefined : {
                ...native,
                patternMatrix: native.patternMatrix.map(function (value) { return value * factor }) as [number, number, number, number, number, number],
            },
        },
    }
}

/**
 * Shifts top-level imported elements (children follow their parents). Used
 * by the fit-to-current-page mode to center the scaled content inside the
 * printable area.
 */
export function offsetImportedElements(elements: TemplateElement[], offsetX: number, offsetY: number): TemplateElement[] {
    if (offsetX === 0 && offsetY === 0) return elements
    return elements.map(function (element) {
        return { ...element, x: element.x + offsetX, y: element.y + offsetY }
    })
}

function scaleSubpaths(subpaths: PathSubpath[], factor: number): PathSubpath[] {
    if (subpaths.length === 0) return subpaths
    return subpaths.map(function (subpath) {
        return {
            closed: subpath.closed,
            anchors: subpath.anchors.map(function (anchor) {
                return {
                    ...anchor,
                    x: anchor.x * factor,
                    y: anchor.y * factor,
                    inX: anchor.inX * factor,
                    inY: anchor.inY * factor,
                    outX: anchor.outX * factor,
                    outY: anchor.outY * factor,
                }
            }),
        }
    })
}

function scaleNumbers(values: number[], factor: number): number[] {
    if (values.length === 0) return values
    return values.map(function (value) { return value * factor })
}

function scaleImportedPdfRenderState(state: ImportedPdfRenderState | null, factor: number): ImportedPdfRenderState | null {
    if (state === null) return state
    const source = state.path?.pdfSourceVector
    return {
        ...state,
        text: state.text?.baselineOffset === undefined
            ? state.text
            : { ...state.text, baselineOffset: state.text.baselineOffset * factor },
        path: source === undefined ? state.path : {
            ...state.path,
            pdfSourceVector: {
                definitions: source.definitions,
                instances: source.instances.map(function (instance) {
                    return {
                        definitionIndex: instance.definitionIndex,
                        matrix: instance.matrix.map(function (value) { return value * factor }) as [number, number, number, number, number, number],
                    }
                }),
            },
        },
    }
}

/** Imported clip paths contain only absolute M/L/C/Z commands. */
function scalePathD(d: string, factor: number): string {
    if (d === '') return d
    return d.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi, function (token) {
        return String(Number(token) * factor)
    })
}

function convertCoreElement(element: ElementDef, context: ConversionContext): TemplateElement {
    const converted = convertCoreElementBody(element, context)
    converted.pdfSourceLocked = element.type === 'path'
        || element.type === 'line'
        || element.type === 'rectangle'
        || element.type === 'ellipse'
    const state = createImportedPdfRenderState(element)
    if (element.type === 'path' && element.affineTransform !== undefined && state.path !== undefined) {
        const dx = converted.x - element.x
        const dy = converted.y - element.y
        const matrix = element.affineTransform
        state.path.affineTransform = [
            matrix[0], matrix[1], matrix[2], matrix[3],
            matrix[4] + matrix[0] * dx + matrix[2] * dy - dx,
            matrix[5] + matrix[1] * dx + matrix[3] * dy - dy,
        ]
    }
    converted.importedPdfRenderState = state
    return converted
}

function convertCoreElementBody(element: ElementDef, context: ConversionContext): TemplateElement {
    const id = context.nextId()
    switch (element.type) {
        case 'staticText': {
            const converted = createDefaultElement(id, 'staticText', element.x, element.y, element.width, element.height)
            converted.text = element.text
            // PDF coordinates are exact glyph origins; the editor default
            // 2pt horizontal padding would shift and clip the imported text
            converted.style.padding = { top: 0, bottom: 0, left: 0, right: 0 }
            converted.style.forecolor = element.forecolor ?? '#000000'
            applyImportedTextStyle(converted, element.style, context)
            converted.style.rotation = element.rotation ?? 0
            converted.style.hAlign = element.hAlign === 'justify' ? 'justified' : element.hAlign ?? 'left'
            converted.style.vAlign = element.vAlign ?? 'top'
            converted.markup = element.markup ?? 'none'
            converted.letterSpacing = element.letterSpacing ?? 0
            converted.wordSpacing = element.wordSpacing ?? 0
            converted.horizontalScale = element.horizontalScale ?? 1
            converted.firstLineIndent = element.firstLineIndent ?? 0
            converted.leftIndent = element.leftIndent ?? 0
            converted.rightIndent = element.rightIndent ?? 0
            converted.direction = element.direction ?? 'ltr'
            converted.wrap = element.wrap ?? true
            converted.shrinkToFit = element.shrinkToFit ?? false
            converted.minFontSize = element.minFontSize ?? 4
            converted.fitWidth = element.fitWidth ?? false
            converted.outlineText = element.outlineText ?? false
            converted.pdfTextMode = 'embedded'
            applyImportedHyperlink(converted, element.hyperlink)
            return converted
        }
        case 'image': {
            const converted = createDefaultElement(id, 'image', element.x, element.y, element.width, element.height)
            converted.source = element.source ?? ''
            converted.sourceExpression = typeof element.sourceExpression === 'string' ? element.sourceExpression : ''
            converted.scaleMode = element.scaleMode ?? 'retainShape'
            converted.imageHAlign = element.hAlign ?? 'center'
            converted.imageVAlign = element.vAlign ?? 'middle'
            converted.onError = element.onError ?? 'error'
            converted.lazy = element.lazy ?? false
            converted.style.rotation = element.rotation ?? 0
            converted.style.opacity = element.opacity ?? 1
            // PDF placement is authoritative; the source bitmap may be
            // intentionally stretched, so never snap back to its natural ratio
            converted.lockAspectRatio = false
            applyImportedHyperlink(converted, element.hyperlink)
            return converted
        }
        case 'path': return convertPathElement(element, id)
        case 'rectangle': {
            const converted = createDefaultElement(id, 'rectangle', element.x, element.y, element.width, element.height)
            converted.radius = element.radius ?? 0
            converted.topLeftRadius = element.cornerRadii?.topLeft ?? converted.radius
            converted.topRightRadius = element.cornerRadii?.topRight ?? converted.radius
            converted.bottomRightRadius = element.cornerRadii?.bottomRight ?? converted.radius
            converted.bottomLeftRadius = element.cornerRadii?.bottomLeft ?? converted.radius
            applyShapeFill(converted, element.fill)
            applyImportedStroke(converted, element.stroke, element.strokeWidth)
            return converted
        }
        case 'ellipse': {
            const converted = createDefaultElement(id, 'ellipse', element.x, element.y, element.width, element.height)
            applyShapeFill(converted, element.fill)
            applyImportedStroke(converted, element.stroke, element.strokeWidth)
            return converted
        }
        case 'frame': {
            const converted = createDefaultElement(id, 'frame', element.x, element.y, element.width, element.height)
            converted.children = convertFrameChildren(element, context)
            applyImportedElementOpacity(converted, element.opacity)
            if (element.clipPath !== undefined) {
                converted.frameClipPathD = element.clipPath.d
                converted.frameClipPathRule = element.clipPath.fillRule ?? 'nonzero'
            }
            applyImportedHyperlink(converted, element.hyperlink)
            return converted
        }
        default:
            return createDefaultElement(id, 'frame', element.x, element.y, element.width, element.height)
    }
}

function createImportedPdfRenderState(element: ElementDef): ImportedPdfRenderState {
    const state: ImportedPdfRenderState = {
        common: {
            blendMode: element.blendMode,
            overprintFill: element.overprintFill,
            overprintStroke: element.overprintStroke,
            overprintMode: element.overprintMode,
            renderingIntent: element.renderingIntent,
            alphaIsShape: element.alphaIsShape,
            textKnockout: element.textKnockout,
            optionalContent: element.optionalContent,
        },
    }
    if (element.type === 'path') {
        state.path = {
            affineTransform: element.affineTransform,
            pdfSourceVector: element.pdfSourceVector,
            fillRule: element.fillRule,
            strokeMiterLimit: element.strokeMiterLimit,
            strokeDashoffset: element.strokeDashoffset,
        }
    } else if (element.type === 'staticText' && element.baselineOffset !== undefined) {
        state.text = { baselineOffset: element.baselineOffset }
    } else if (element.type === 'image') {
        state.image = {
            affineTransform: element.affineTransform,
            interpolate: element.interpolate,
            alternates: element.alternates,
            opi: element.opi,
            measure: element.measure,
            pointData: element.pointData,
        }
    } else if (element.type === 'frame') {
        state.frame = {
            clip: element.clip,
            rotation: element.rotation,
            rotationOriginX: element.rotationOriginX,
            rotationOriginY: element.rotationOriginY,
            affineTransform: element.affineTransform,
            pdfForm: element.pdfForm,
            transparencyGroup: element.transparencyGroup,
            isolated: element.isolated,
            knockout: element.knockout,
            softMask: compactFrameSoftMask(element.softMask),
            deviceParams: element.deviceParams,
        }
    }
    return state
}

function compactFrameSoftMask(mask: FrameDef['softMask']): FrameDef['softMask'] {
    if (mask === undefined) return undefined
    return { ...mask, elements: mask.elements.map(compactCoreElementMeshes) }
}

function compactCoreElementMeshes(element: ElementDef): ElementDef {
    if (element.type === 'path') {
        const fill = element.fill
        const stroke = element.stroke
        return {
            ...element,
            fill: typeof fill === 'object' && fill.type === 'meshGradient' ? compactMeshFill(fill) : fill,
            stroke: typeof stroke === 'object' && stroke.type === 'meshGradient' ? compactMeshFill(stroke) : stroke,
        }
    }
    if (element.type === 'frame') {
        return {
            ...element,
            elements: element.elements?.map(compactCoreElementMeshes),
            softMask: compactFrameSoftMask(element.softMask),
        }
    }
    return element
}

function applyImportedHyperlink(element: TemplateElement, hyperlink: HyperlinkDef | undefined): void {
    if (hyperlink === undefined) return
    element.hyperlinkType = hyperlink.type
    element.hyperlinkTarget = expressionToEditorText(hyperlink.target)
    element.hyperlinkRemoteDocument = hyperlink.remoteDocument !== undefined ? expressionToEditorText(hyperlink.remoteDocument) : ''
}

function expressionToEditorText(value: unknown): string {
    if (typeof value !== 'string') return String(value)
    if (value.startsWith('"')) return JSON.parse(value)
    return value
}

function convertFrameChildren(element: FrameDef, context: ConversionContext): TemplateElement[] {
    if (element.elements === undefined) return []
    return element.elements.map(function (child) {
        return convertCoreElement(child, context)
    })
}

function convertPathElement(element: PathDef, id: string): TemplateElement {
    const converted = createDefaultElement(id, 'path', element.x, element.y, element.width, element.height)
    if (element.pdfSourceVector === undefined) {
        let subpaths = pathDefToSubpaths(element)
        if (element.viewBox !== undefined) {
            subpaths = scaleViewBoxSubpaths(subpaths, element.viewBox, element.width, element.height)
        }
        const normalized = normalizePathBounds(subpaths)
        converted.pathSubpaths = normalized.subpaths
        converted.x += normalized.bounds.x
        converted.y += normalized.bounds.y
        converted.width = normalized.bounds.width
        converted.height = normalized.bounds.height
    } else {
        converted.pathSubpaths = []
    }
    applyPathFill(converted, element.fill)
    applyImportedStroke(converted, typeof element.stroke === 'string' || element.stroke === undefined ? element.stroke : firstGradientColor(element.stroke), element.strokeWidth)
    converted.pathStrokeDash = element.strokeDasharray ?? []
    converted.pathStrokeCap = element.strokeLinecap ?? 'butt'
    converted.pathStrokeJoin = element.strokeLinejoin ?? 'miter'
    converted.pathFillOpacity = element.fillOpacity ?? 1
    converted.pathStrokeOpacity = element.strokeOpacity ?? 1
    applyImportedElementOpacity(converted, element.opacity)
    return converted
}

function applyImportedElementOpacity(element: TemplateElement, opacity: number | undefined): void {
    if (opacity !== undefined) element.style.opacity = opacity
}

function pathDefToSubpaths(element: PathDef): PathSubpath[] {
    const parsed = parseSvgPath(element.d)
    return pathArraysToSubpaths(parsed.commands, parsed.coords)
}

function scaleViewBoxSubpaths(subpaths: PathSubpath[], viewBox: [number, number, number, number], width: number, height: number): PathSubpath[] {
    const sx = viewBox[2] === 0 ? 1 : width / viewBox[2]
    const sy = viewBox[3] === 0 ? 1 : height / viewBox[3]
    return subpaths.map(function (subpath) {
        return {
            closed: subpath.closed,
            anchors: subpath.anchors.map(function (a) {
                return {
                    x: (a.x - viewBox[0]) * sx,
                    y: (a.y - viewBox[1]) * sy,
                    inX: (a.inX - viewBox[0]) * sx,
                    inY: (a.inY - viewBox[1]) * sy,
                    outX: (a.outX - viewBox[0]) * sx,
                    outY: (a.outY - viewBox[1]) * sy,
                    handleMode: a.handleMode,
                }
            }),
        }
    })
}

function applyShapeFill(element: TemplateElement, fill: FillDef | undefined): void {
    if (fill === undefined) {
        element.fill = ''
        element.shapeFillType = 'none'
        return
    }
    if (typeof fill === 'string') {
        element.fill = fill
        element.shapeFillType = 'solid'
        element.shapeFillColor = fill
        return
    }
    if (fill.type === 'meshGradient' || fill.type === 'tilingPattern' || fill.type === 'functionShading') {
        // The importer emits complex fills on path elements only
        throw new Error('PDF import error: mesh/tiling fills are only supported on path elements')
    }
    if (fill.type === 'pdfSpecialColor') {
        element.shapeFillType = 'special'
        element.shapeComplexFill = fill
        return
    }
    applyGradientFill(element, fill, 'shape')
}

function applyPathFill(element: TemplateElement, fill: FillDef | undefined): void {
    if (fill === undefined) {
        element.pathFillType = 'none'
        return
    }
    if (typeof fill === 'string') {
        element.pathFillType = 'solid'
        element.pathFillColor = fill
        return
    }
    if (fill.type === 'meshGradient') {
        element.pathFillType = 'mesh'
        element.pathComplexFill = compactMeshFill(fill)
        return
    }
    if (fill.type === 'tilingPattern' || fill.type === 'functionShading') {
        element.pathFillType = 'pattern'
        element.pathComplexFill = fill
        return
    }
    if (fill.type === 'pdfSpecialColor') {
        element.pathFillType = 'special'
        element.pathComplexFill = fill
        return
    }
    applyGradientFill(element, fill, 'path')
}

function compactMeshFill(fill: MeshGradientDef): MeshGradientDef {
    const convertedPatches = packMeshItems(fill.patches, 32, 4)
    const convertedTriangles = packMeshItems(fill.triangles, 6, 3)
    if (convertedPatches === null || convertedTriangles === null) return fill
    const packedPatches = mergePackedMeshItems(fill.packedPatches, convertedPatches)
    const packedTriangles = mergePackedMeshItems(fill.packedTriangles, convertedTriangles)
    return {
        ...fill,
        patches: undefined,
        triangles: undefined,
        packedPatches: packedPatches ?? undefined,
        packedTriangles: packedTriangles ?? undefined,
    }
}

function mergePackedMeshItems(
    existing: { points: Float32Array, colors: Uint32Array } | undefined,
    converted: { points: Float32Array, colors: Uint32Array } | undefined,
): { points: Float32Array, colors: Uint32Array } | undefined {
    if (existing === undefined) return converted
    if (converted === undefined) return existing
    const points = new Float32Array(existing.points.length + converted.points.length)
    points.set(existing.points)
    points.set(converted.points, existing.points.length)
    const colors = new Uint32Array(existing.colors.length + converted.colors.length)
    colors.set(existing.colors)
    colors.set(converted.colors, existing.colors.length)
    return { points, colors }
}

function packMeshItems(
    items: Array<{ points: number[], colors: string[] }> | undefined,
    pointCount: number,
    colorCount: number,
): { points: Float32Array, colors: Uint32Array } | undefined | null {
    if (items === undefined || items.length === 0) return undefined
    const points = new Float32Array(items.length * pointCount)
    const colors = new Uint32Array(items.length * colorCount)
    for (let i = 0; i < items.length; i++) {
        const item = items[i]!
        if (item.points.length !== pointCount || item.colors.length !== colorCount) return null
        points.set(item.points, i * pointCount)
        for (let c = 0; c < colorCount; c++) {
            const packed = packHexColor(item.colors[c]!)
            if (packed === null) return null
            colors[i * colorCount + c] = packed
        }
    }
    return { points, colors }
}

function packHexColor(color: string): number | null {
    if (/^#[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color.slice(1), 16)
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return Number.parseInt(color[1]! + color[1]! + color[2]! + color[2]! + color[3]! + color[3]!, 16)
    }
    return null
}

function applyGradientFill(element: TemplateElement, fill: GradientDef, target: 'shape' | 'path'): void {
    const type = fill.type === 'linearGradient' ? 'linear' : 'radial'
    const gradient = {
        x1: fill.type === 'linearGradient' ? fill.x1 ?? 0 : 0,
        y1: fill.type === 'linearGradient' ? fill.y1 ?? 0 : 0,
        x2: fill.type === 'linearGradient' ? fill.x2 ?? 1 : 1,
        y2: fill.type === 'linearGradient' ? fill.y2 ?? 0 : 0,
        cx: fill.type === 'radialGradient' ? fill.cx ?? 0.5 : 0.5,
        cy: fill.type === 'radialGradient' ? fill.cy ?? 0.5 : 0.5,
        r: fill.type === 'radialGradient' ? fill.r ?? 0.5 : 0.5,
        stops: fill.stops,
        pdfShading: fill.pdfShading,
    }
    if (target === 'shape') {
        element.shapeFillType = type
        element.shapeGradient = gradient
    } else {
        element.pathFillType = type
        element.pathGradient = gradient
    }
}

/**
 * A PDF element without a stroke has no border at all; the editor convention
 * for "no stroke" is an empty color. Filling in a default black stroke would
 * outline every imported glyph path and fatten the artwork.
 */
function applyImportedStroke(converted: TemplateElement, stroke: string | undefined, strokeWidth: number | undefined): void {
    if (stroke === undefined || stroke === '') {
        converted.stroke = ''
        converted.strokeWidth = 0
        return
    }
    converted.stroke = stroke
    converted.strokeWidth = strokeWidth ?? 1
}

function firstGradientColor(fill: FillDef | undefined): string | undefined {
    if (fill === undefined || typeof fill === 'string') return fill
    if (fill.type === 'meshGradient') return fill.patches?.[0]?.colors[0] ?? fill.triangles?.[0]?.colors[0] ?? fill.lattice?.colors[0]
    if (fill.type === 'functionShading') return undefined
    if (fill.type === 'tilingPattern') return undefined
    if (fill.type === 'pdfSpecialColor') return fill.displayColor
    return fill.stops[0]?.color
}

/**
 * Resolves the named style emitted by the core importer into concrete font
 * family / size / weight values, applying the user's font assignments.
 */
function applyImportedTextStyle(converted: TemplateElement, styleName: string | undefined, context: ConversionContext): void {
    const style = styleName !== undefined ? context.styleMap.get(styleName) : undefined
    if (style === undefined) {
        converted.style.fontFamily = context.fontAssignments[styleName ?? ''] ?? DEFAULT_FONT_ID
        return
    }
    const family = style.fontFamily ?? ''
    converted.style.fontFamily = context.fontAssignments[family] ?? family
    if (style.fontSize !== undefined) converted.style.fontSize = style.fontSize
    if (style.bold === true) converted.style.bold = true
    if (style.italic === true) converted.style.italic = true
    if (style.writingMode !== undefined) converted.writingMode = style.writingMode
}
