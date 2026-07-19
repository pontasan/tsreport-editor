'use client'

// PDF import preview: renders the imported page through the core print
// pipeline and hosts the two interactive overlay modes of the import dialog:
// band region assignment (toggle bands, drag the boundaries) and the image
// slice tool (shared SliceOverlay component).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
    CanvasBackend, createReport, renderPage, SvgBackend,
    type Font, type ImportedPage, type RenderPage, type ReportTemplate as CoreTemplate, type TextMeasurer,
} from 'tsreport-core'
import type { FontResource } from './font_loader'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import type { SlicePoint, SliceTarget } from './pdf_import_slicer'
import SliceOverlay from './slice_overlay'
import { getBandColor, getBandLabel, type BandType } from './reducer'
import styles from './pdf_import_dialog.module.css'

/** Band types selectable as vertical regions in the import preview */
export const PDF_IMPORT_REGION_BAND_TYPES: BandType[] = [
    'title', 'pageHeader', 'columnHeader', 'detail', 'columnFooter', 'pageFooter', 'summary',
]

export type PdfImportPreviewMode = 'none' | 'bands' | 'slice'

/**
 * Where the imported page lands on the target paper: the paper dimensions,
 * the printable area inside the margins, the content offset on the paper
 * (margins + centering) and the content scale (fit-to-page factor; 1 for
 * exact-size import).
 */
export type PdfImportPreviewPlacement = {
    pageWidth: number,
    pageHeight: number,
    printableX: number,
    printableY: number,
    printableWidth: number,
    printableHeight: number,
    offsetX: number,
    offsetY: number,
    contentScale: number
}

export type PdfImportRegionState = {
    type: BandType,
    enabled: boolean,
    height: number
}

export function createDefaultRegionState(pageHeight: number): PdfImportRegionState[] {
    return PDF_IMPORT_REGION_BAND_TYPES.map(function (type) {
        return { type, enabled: type === 'detail', height: type === 'detail' ? pageHeight : 0 }
    })
}

/** Re-balances region heights after enabling or disabling a band. */
export function toggleRegion(regions: PdfImportRegionState[], type: BandType, pageHeight: number): PdfImportRegionState[] {
    const target = regions.find(function (r) { return r.type === type })
    if (target === undefined) return regions
    const enabledCount = regions.filter(function (r) { return r.enabled }).length
    if (target.enabled && enabledCount <= 1) return regions
    if (target.enabled) {
        // Distribute the removed band's height across the remaining bands
        const rest = pageHeight - target.height
        const factor = rest <= 0 ? 0 : pageHeight / rest
        return regions.map(function (r) {
            if (r.type === type) return { ...r, enabled: false, height: 0 }
            return r.enabled ? { ...r, height: r.height * factor } : r
        })
    }
    // Give the new band an even share taken proportionally from the others
    const share = pageHeight / (enabledCount + 1)
    const factor = (pageHeight - share) / pageHeight
    return regions.map(function (r) {
        if (r.type === type) return { ...r, enabled: true, height: share }
        return r.enabled ? { ...r, height: r.height * factor } : r
    })
}

/** Moves the boundary below the given enabled-region index by deltaPt. */
export function moveRegionBoundary(regions: PdfImportRegionState[], enabledIndex: number, deltaPt: number): PdfImportRegionState[] {
    const enabled = regions.filter(function (r) { return r.enabled })
    const above = enabled[enabledIndex]
    const below = enabled[enabledIndex + 1]
    if (above === undefined || below === undefined) return regions
    const minHeight = 8
    const clamped = Math.max(minHeight - above.height, Math.min(below.height - minHeight, deltaPt))
    return regions.map(function (r) {
        if (r.type === above.type) return { ...r, height: above.height + clamped }
        if (r.type === below.type) return { ...r, height: below.height - clamped }
        return r
    })
}

function createImportedPageRender(
    page: ImportedPage,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
): { page: RenderPage, fonts: Record<string, Font> } {
    const fallback = fontRegistry.get(defaultFontId)
    if (fallback === undefined) throw new Error('PDF import preview error: default font is not loaded')
    const fontMap = new Map<string, TextMeasurer>()
    const fonts: Record<string, Font> = {}
    fontRegistry.forEach(function (resource, fontId) {
        fontMap.set(fontId, resource.measurer)
        fonts[fontId] = resource.font
    })
    // Approximate PDF fonts that have no registered counterpart with the default font
    for (let i = 0; i < page.styles.length; i++) {
        const family = page.styles[i]!.fontFamily
        if (family !== undefined && family !== '' && !fontMap.has(family)) {
            fontMap.set(family, fallback.measurer)
            fonts[family] = fallback.font
        }
    }
    const template: CoreTemplate = {
        page: { width: page.width, height: page.height, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: page.styles,
        bands: { title: { height: page.height, elements: page.elements } },
    }
    const report = createReport(template, { rows: [{}] }, { fontMap })
    const renderPage = report.pages[0]
    if (renderPage === undefined) throw new Error('PDF import preview error: report page was not generated')
    return { page: renderPage, fonts }
}

/** Serializes the imported page through the core renderer as one SVG image. */
export function renderImportedPageToSvg(
    page: ImportedPage,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
): string {
    const rendered = createImportedPageRender(page, fontRegistry, defaultFontId)
    const backend = new SvgBackend({
        fonts: rendered.fonts,
        background: '#ffffff',
        images: page.images,
    })
    backend.beginDocument()
    renderPage(rendered.page, backend)
    backend.endDocument()
    const svg = backend.getPages()[0]
    if (svg === undefined) throw new Error('PDF import preview error: SVG page was not generated')
    return svg
}

/** Paints the imported page through the core Canvas backend. */
export function renderImportedPageToCanvas(
    canvas: HTMLCanvasElement,
    page: ImportedPage,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    scale: number,
    onImagesReady?: () => void,
): void {
    const rendered = createImportedPageRender(page, fontRegistry, defaultFontId)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('PDF import preview error: Canvas 2D context is unavailable')
    const backend = new CanvasBackend(context, {
        fonts: rendered.fonts,
        images: page.images,
        background: '#ffffff',
        scale,
        devicePixelRatio: globalThis.devicePixelRatio,
        onImagesReady,
    })
    backend.beginDocument()
    renderPage(rendered.page, backend)
    backend.endDocument()
}

type PreviewProps = {
    page: ImportedPage,
    /** Placement of the page content on the target paper (size mode result) */
    placement: PdfImportPreviewPlacement,
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    /** null hides the band overlay (draft / background destinations) */
    regions: PdfImportRegionState[] | null,
    onRegionsChange?: (regions: PdfImportRegionState[]) => void,
    /** Which overlay is interactive; defaults to 'bands' backward-compatible behavior via the dialog */
    mode?: PdfImportPreviewMode,
    sliceTargets?: SliceTarget[],
    slicePoints?: SlicePoint[],
    selectedPointId?: number | null,
    disabledPieces?: ReadonlySet<string>,
    onSlicePointsChange?: (points: SlicePoint[]) => void,
    onSelectPoint?: (pointId: number | null) => void,
    onTogglePiece?: (key: string) => void
}

export default function PdfImportPreview(props: PreviewProps) {
    const ui = useUiMessages()
    const { page, placement, fontRegistry, defaultFontId, regions, onRegionsChange, onSlicePointsChange, onSelectPoint, onTogglePiece } = props
    const mode = props.mode ?? 'none'
    const sliceTargets = props.sliceTargets ?? []
    const slicePoints = props.slicePoints ?? []
    const selectedPointId = props.selectedPointId ?? null
    const disabledPieces = props.disabledPieces ?? new Set<string>()
    const fitRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const dragRef = useRef<{ boundaryIndex: number, startY: number, startRegions: PdfImportRegionState[] } | null>(null)
    const regionsRef = useRef(regions)
    regionsRef.current = regions
    const [fitSize, setFitSize] = useState<{ width: number, height: number } | null>(null)
    const [previewPainted, setPreviewPainted] = useState(false)
    const [imageDecodeTick, setImageDecodeTick] = useState(0)

    // Track the available pane size so the page preview always fills the
    // maximized dialog; measured before paint to avoid a small-scale flash
    useLayoutEffect(function () {
        const element = fitRef.current
        if (element === null) return
        function measure(): void {
            const el = fitRef.current
            if (el === null) return
            const width = el.clientWidth
            const height = el.clientHeight
            setFitSize(function (current) {
                if (current !== null && current.width === width && current.height === height) return current
                return { width, height }
            })
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return function () { observer.disconnect() }
    }, [])

    // Fit the target paper into the measured pane, minus the pane chrome
    // (8px backdrop padding and 1px paper border per side); keep a fixed
    // budget until the first measurement lands. The content renders at the
    // pane scale combined with the fit-to-page factor.
    const PANE_CHROME_PX = 18
    const paneScale = fitSize === null || fitSize.width < 40 || fitSize.height < 40
        ? Math.min(380 / placement.pageWidth, 460 / placement.pageHeight)
        : Math.min((fitSize.width - PANE_CHROME_PX) / placement.pageWidth, (fitSize.height - PANE_CHROME_PX) / placement.pageHeight)
    const scale = paneScale * placement.contentScale

    useEffect(function () {
        setPreviewPainted(false)
        const timer = window.setTimeout(function () {
            const canvas = canvasRef.current
            if (canvas === null) return
            renderImportedPageToCanvas(canvas, page, fontRegistry, defaultFontId, scale, function () {
                setImageDecodeTick(function (tick) { return tick + 1 })
            })
            setPreviewPainted(true)
        }, 0)
        return function () {
            window.clearTimeout(timer)
        }
    }, [page, fontRegistry, defaultFontId, scale, imageDecodeTick])

    function handleBoundaryMouseDown(boundaryIndex: number, e: React.MouseEvent): void {
        if (regions === null || onRegionsChange === undefined) return
        e.preventDefault()
        dragRef.current = { boundaryIndex, startY: e.clientY, startRegions: regions }
        function handleMove(ev: MouseEvent): void {
            const drag = dragRef.current
            if (drag === null) return
            const deltaPt = (ev.clientY - drag.startY) / scale
            onRegionsChange!(moveRegionBoundary(drag.startRegions, drag.boundaryIndex, deltaPt))
        }
        function handleUp(): void {
            dragRef.current = null
            document.removeEventListener('mousemove', handleMove)
            document.removeEventListener('mouseup', handleUp)
        }
        document.addEventListener('mousemove', handleMove)
        document.addEventListener('mouseup', handleUp)
    }

    function renderOverlay() {
        if (regions === null) return null
        const interactive = mode === 'bands'
        const enabled = regions.filter(function (r) { return r.enabled })
        const rows: React.ReactNode[] = []
        let top = 0
        for (let i = 0; i < enabled.length; i++) {
            const region = enabled[i]!
            const heightPx = region.height * scale
            rows.push(
                <div
                    key={region.type}
                    className={styles.regionStrip}
                    style={{ top: top + 'px', height: heightPx + 'px', backgroundColor: getBandColor(region.type) }}
                >
                    <span className={styles.regionLabel} style={{ backgroundColor: getBandColor(region.type) }}>
                        {getBandLabel(region.type)} ({Math.round(region.height)}pt)
                    </span>
                </div>,
            )
            if (interactive && i < enabled.length - 1) {
                rows.push(
                    <div
                        key={region.type + '_boundary'}
                        className={styles.regionBoundary}
                        style={{ top: (top + heightPx) + 'px' }}
                        onMouseDown={function (e) { handleBoundaryMouseDown(i, e) }}
                    />,
                )
            }
            top += heightPx
        }
        return <div className={styles.regionOverlay}>{rows}</div>
    }

    const hasMargins = placement.printableX > 0 || placement.printableY > 0
        || placement.printableWidth < placement.pageWidth || placement.printableHeight < placement.pageHeight
    return (
        <div ref={fitRef} className={styles.previewFit}>
            <div
                className={styles.previewPane}
                style={{ width: Math.ceil(placement.pageWidth * paneScale) + 'px', height: Math.ceil(placement.pageHeight * paneScale) + 'px' }}
            >
                <div
                    className={styles.previewContent}
                    style={{
                        left: placement.offsetX * paneScale + 'px',
                        top: placement.offsetY * paneScale + 'px',
                        width: Math.ceil(page.width * scale) + 'px',
                        height: Math.ceil(page.height * scale) + 'px',
                    }}
                >
                    {!previewPainted && <div className={styles.previewLoading}>{ui.previewGenerating}</div>}
                    <canvas
                        ref={canvasRef}
                        className={styles.previewCanvas}
                        aria-label={ui.pdfImportPreview}
                        style={{ width: Math.ceil(page.width * scale), height: Math.ceil(page.height * scale) }}
                    />
                    {renderOverlay()}
                    {mode === 'slice' && onSlicePointsChange !== undefined && onSelectPoint !== undefined && onTogglePiece !== undefined && (
                        <SliceOverlay
                            width={page.width}
                            height={page.height}
                            scale={scale}
                            targets={sliceTargets}
                            tintTargets
                            points={slicePoints}
                            selectedPointId={selectedPointId}
                            disabledPieces={disabledPieces}
                            onPointsChange={onSlicePointsChange}
                            onSelectPoint={onSelectPoint}
                            onTogglePiece={onTogglePiece}
                        />
                    )}
                </div>
                {hasMargins && (
                    <div
                        className={styles.previewMarginGuide}
                        style={{
                            left: placement.printableX * paneScale + 'px',
                            top: placement.printableY * paneScale + 'px',
                            width: placement.printableWidth * paneScale + 'px',
                            height: placement.printableHeight * paneScale + 'px',
                        }}
                    />
                )}
            </div>
        </div>
    )
}
