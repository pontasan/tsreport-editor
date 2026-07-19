'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImportedPage, PdfImportProgress as CorePdfImportProgress } from 'tsreport-core'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import type { UiMessages } from '@/lib/common/i18n/ui_messages'
import { dirnamePosix } from '@/lib/common/utils/workspace_path'
import { Action } from './action'
import { loadFont, type FontEntry, type FontResource } from './font_loader'
import { assignPdfImportPreviewFonts, buildPdfImportFontRows, type PdfEmbeddedFontSource, type PdfImportFontRow } from './pdf_import_embedded_font'
import {
    compactImportedPageMeshes, convertImportedPageToEditorElements, createPdfImportPageSettings, fitTextElementsToAssignedFonts, offsetImportedElements,
    rewriteImportedImageSources, scaleImportedElements, splitElementsIntoBandRegions, type PdfFontAssignments, type PdfImportBandRegion,
} from './pdf_import_converter'
import PdfImportPreview, {
    createDefaultRegionState, toggleRegion, type PdfImportPreviewMode, type PdfImportPreviewPlacement, type PdfImportRegionState,
} from './pdf_import_preview'
import { applySlicesToImport, collectSliceTargets, remapDisabledPieces, type SlicePoint } from './pdf_import_slicer'
import { waitForPdfImportProgressPaint } from './pdf_import_progress'
import type { PdfImportWorkerRequest, PdfImportWorkerResponse } from './pdf_import_worker_messages'
import { getBandColor, getBandLabel, type ActionType, type BandType, type PdfImportBandContent, type State, type TemplateElement } from './reducer'
import SelectDropdown from './select_dropdown'
import styles from './pdf_import_dialog.module.css'

type Props = {
    visible: boolean,
    onHide: () => void,
    state: State,
    dispatch: (action: ActionType) => void,
    fontList: FontEntry[],
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    currentFile: { workspace: string, path: string } | null,
    onEmbeddedFontsImported: (sources: PdfEmbeddedFontSource[]) => void
}

type PdfImportDestination = 'draft' | 'background' | 'bands'

/** 'pdf' = the report page adopts the exact PDF page size; 'fit' = the current page stays and the content is scaled into its printable area */
type PdfImportSizeMode = 'pdf' | 'fit'

type PdfImportStep = 'select' | 'edit'

type PdfImportProgress = {
    label: string,
    percent: number
}

export default function PdfImportDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, state, dispatch, fontList, fontRegistry, defaultFontId, currentFile, onEmbeddedFontsImported } = props
    const [file, setFile] = useState<File | null>(null)
    const [pageCount, setPageCount] = useState(0)
    const [selectedPage, setSelectedPage] = useState(0)
    const [importedPage, setImportedPage] = useState<ImportedPage | null>(null)
    const [fontRows, setFontRows] = useState<PdfImportFontRow[]>([])
    const [step, setStep] = useState<PdfImportStep>('select')
    const [destination, setDestination] = useState<PdfImportDestination>('draft')
    const [sizeMode, setSizeMode] = useState<PdfImportSizeMode>('pdf')
    const [regions, setRegions] = useState<PdfImportRegionState[]>([])
    const [mode, setMode] = useState<PdfImportPreviewMode>('none')
    const [slicePoints, setSlicePoints] = useState<SlicePoint[]>([])
    const [selectedPointId, setSelectedPointId] = useState<number | null>(null)
    const [disabledPieces, setDisabledPieces] = useState<ReadonlySet<string>>(new Set())
    const [completed, setCompleted] = useState(false)
    const [importing, setImporting] = useState(false)
    const [progress, setProgress] = useState<PdfImportProgress | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const workerRef = useRef<Worker | null>(null)
    const workerRequestIdRef = useRef(0)
    const workerPendingRef = useRef<Map<number, {
        resolve: (response: PdfImportWorkerResponse) => void,
        reject: (error: Error) => void,
    }>>(new Map())

    useEffect(function () {
        if (!visible) {
            disposePdfWorker()
            return
        }
        setFile(null)
        disposePdfWorker()
        setPageCount(0)
        setSelectedPage(0)
        setImportedPage(null)
        setFontRows([])
        setStep('select')
        setDestination('draft')
        setSizeMode('pdf')
        setRegions([])
        setMode('none')
        setSlicePoints([])
        setSelectedPointId(null)
        setDisabledPieces(new Set())
        setCompleted(false)
        setImporting(false)
        setProgress(null)
        setDragOver(false)
    }, [visible])

    useEffect(function () {
        return function () { disposePdfWorker() }
    }, [])

    const pageNumbers = useMemo(function () {
        const result: number[] = []
        for (let i = 0; i < pageCount; i++) result.push(i)
        return result
    }, [pageCount])

    const sliceTargets = useMemo(function () {
        return importedPage === null ? [] : collectSliceTargets(importedPage.elements)
    }, [importedPage])

    const previewPage = useMemo(function () {
        return importedPage === null ? null : compactImportedPageMeshes(assignPdfImportPreviewFonts(importedPage, fontRows))
    }, [importedPage, fontRows])

    const previewFontRegistry = useMemo(function () {
        const resources = new Map(fontRegistry)
        for (let i = 0; i < fontRows.length; i++) {
            const row = fontRows[i]!
            if (row.embeddedSource !== null && row.fontName === row.embeddedSource.fontId) {
                resources.set(row.fontName, row.embeddedSource.resource)
            }
        }
        return resources
    }, [fontRegistry, fontRows])

    function handleFileChange(nextFile: File | null): void {
        setFile(nextFile)
        disposePdfWorker()
        setPageCount(0)
        setImportedPage(null)
        setFontRows([])
        if (nextFile === null) {
            setProgress(null)
            return
        }
        setProgress({ label: ui.pdfFileReading, percent: 0 })
        const reader = new FileReader()
        reader.onprogress = function (event) {
            if (!event.lengthComputable) return
            setProgress({ label: ui.pdfFileReading, percent: Math.min(15, event.loaded / event.total * 15) })
        }
        reader.onload = function () {
            const result = reader.result
            if (!(result instanceof ArrayBuffer)) throw new Error('PDF import error: file read did not return an ArrayBuffer')
            setProgress({ label: ui.pdfFileReading, percent: 15 })
            void openPdfInWorker(result)
        }
        reader.onerror = function () {
            throw reader.error ?? new Error('PDF import error: file read failed')
        }
        reader.readAsArrayBuffer(nextFile)
    }

    async function openPdfInWorker(buffer: ArrayBuffer): Promise<void> {
        const worker = createPdfWorker()
        workerRef.current = worker
        setProgress({ label: ui.pdfStructureAnalyzing, percent: 15 })
        await waitForPdfImportProgressPaint()
        const opened = await sendWorkerRequest(worker, { id: 0, type: 'open', bytes: buffer }, [buffer])
        if (opened.type !== 'opened') throw new Error('PDF import worker error: open response expected')
        setPageCount(opened.pageCount)
        setSelectedPage(0)
        const page = await importPageInWorker(0, 'initial')
        setImportedPage(page)
        setFontRows(await buildPdfImportFontRows(page.fonts, fontList))
        setRegions(createDefaultRegionState(page.height))
        setSlicePoints([])
        setSelectedPointId(null)
        setDisabledPieces(new Set())
        setProgress(null)
    }

    async function importPageInWorker(pageIndex: number, mode: 'initial' | 'page-change'): Promise<ImportedPage> {
        const worker = workerRef.current
        if (worker === null) throw new Error('PDF import worker error: worker is not initialized')
        setProgress({ label: ui.pageConverting + ' ' + (pageIndex + 1), percent: mode === 'initial' ? 40 : 10 })
        await waitForPdfImportProgressPaint()
        const response = await sendWorkerRequest(worker, { id: 0, type: 'importPage', pageIndex, outlineText: false })
        if (response.type !== 'page') throw new Error('PDF import worker error: page response expected')
        return response.page
    }

    function createPdfWorker(): Worker {
        const worker = new Worker(new URL('./pdf_import_worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = function (event: MessageEvent<PdfImportWorkerResponse>) {
            const response = event.data
            if (response.type === 'progress') {
                setProgress(progressFromCore(response.progress, ui))
                return
            }
            const pending = workerPendingRef.current.get(response.id)
            if (pending === undefined) return
            workerPendingRef.current.delete(response.id)
            pending.resolve(response)
        }
        worker.onerror = function (event) {
            rejectAllWorkerRequests(new Error(event.message))
        }
        return worker
    }

    function sendWorkerRequest(
        worker: Worker,
        request: PdfImportWorkerRequest,
        transfer?: Transferable[],
    ): Promise<PdfImportWorkerResponse> {
        const id = ++workerRequestIdRef.current
        const message: PdfImportWorkerRequest = { ...request, id }
        const promise = new Promise<PdfImportWorkerResponse>(function (resolve, reject) {
            workerPendingRef.current.set(id, { resolve, reject })
        })
        worker.postMessage(message, transfer ?? [])
        return promise
    }

    function rejectAllWorkerRequests(error: Error): void {
        for (const pending of workerPendingRef.current.values()) pending.reject(error)
        workerPendingRef.current.clear()
    }

    function disposePdfWorker(): void {
        const worker = workerRef.current
        if (worker !== null) {
            worker.terminate()
            workerRef.current = null
        }
        workerPendingRef.current.clear()
    }

    function selectPage(pageIndex: number): void {
        if (workerRef.current === null) return
        void selectPageAsync(pageIndex)
    }

    async function selectPageAsync(pageIndex: number): Promise<void> {
        setSelectedPage(pageIndex)
        setImportedPage(null)
        setProgress({ label: ui.pageConverting + ' ' + (pageIndex + 1), percent: 10 })
        await waitForPdfImportProgressPaint()
        const page = await importPageInWorker(pageIndex, 'page-change')
        setImportedPage(page)
        setFontRows(await buildPdfImportFontRows(page.fonts, fontList))
        setRegions(createDefaultRegionState(page.height))
        setSlicePoints([])
        setSelectedPointId(null)
        setDisabledPieces(new Set())
        setProgress(null)
    }

    function changeDestination(next: PdfImportDestination): void {
        setDestination(next)
        if (next === 'bands') {
            if (mode === 'none') setMode('bands')
        } else if (mode === 'bands') {
            setMode('none')
        }
    }

    function toggleMode(target: PdfImportPreviewMode): void {
        setMode(mode === target ? 'none' : target)
        setSelectedPointId(null)
    }

    function changeSlicePoints(next: SlicePoint[]): void {
        // Piece keys are grid indices; carry the disabled state over to the
        // new grid geometrically so it never jumps to a different region
        if (disabledPieces.size > 0) {
            setDisabledPieces(remapDisabledPieces(sliceTargets, slicePoints, next, disabledPieces))
        }
        setSlicePoints(next)
    }

    function togglePiece(key: string): void {
        setDisabledPieces(function (current) {
            const next = new Set(current)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    function updateFontAssignment(key: string, fontName: string): void {
        setFontRows(function (rows) {
            return rows.map(function (row) {
                if (row.key !== key) return row
                return { ...row, fontName, warning: false, score: 1 }
            })
        })
    }

    // Mirrors the size-mode math of executeImport so the preview shows the
    // imported page exactly where it will land on the target paper
    function previewPlacement(page: ImportedPage): PdfImportPreviewPlacement {
        if (sizeMode === 'fit') {
            const ps = state.template.pageSettings
            const printableWidth = ps.width - ps.marginLeft - ps.marginRight
            const printableHeight = ps.height - ps.marginTop - ps.marginBottom
            const contentScale = Math.min(printableWidth / page.width, printableHeight / page.height)
            return {
                pageWidth: ps.width,
                pageHeight: ps.height,
                printableX: ps.marginLeft,
                printableY: ps.marginTop,
                printableWidth,
                printableHeight,
                offsetX: ps.marginLeft + (printableWidth - page.width * contentScale) / 2,
                offsetY: ps.marginTop + (destination === 'bands' ? 0 : (printableHeight - page.height * contentScale) / 2),
                contentScale,
            }
        }
        return {
            pageWidth: page.width,
            pageHeight: page.height,
            printableX: 0,
            printableY: 0,
            printableWidth: page.width,
            printableHeight: page.height,
            offsetX: 0,
            offsetY: 0,
            contentScale: 1,
        }
    }

    function buildBandContents(elements: TemplateElement[], layerHeight: number, contentScale: number): PdfImportBandContent[] {
        if (destination === 'draft') return [{ type: 'draft', height: layerHeight, elements }]
        if (destination === 'background') return [{ type: 'background', height: layerHeight, elements }]
        // Region state lives in raw PDF page coordinates (the preview space);
        // the fit mode scales the regions together with the content
        const enabled = regions.filter(function (r) { return r.enabled })
        const bandRegions: PdfImportBandRegion[] = []
        let top = 0
        for (let i = 0; i < enabled.length; i++) {
            const height = enabled[i]!.height * contentScale
            bandRegions.push({ type: enabled[i]!.type, top, height })
            top += height
        }
        return splitElementsIntoBandRegions(elements, bandRegions)
    }

    async function loadAssignedFontResources(): Promise<Map<string, FontResource>> {
        const resources = new Map(fontRegistry)
        for (let i = 0; i < fontRows.length; i++) {
            const row = fontRows[i]!
            const name = row.fontName
            if (resources.has(name)) continue
            if (row.embeddedSource !== null && row.embeddedSource.fontId === name) {
                resources.set(name, row.embeddedSource.resource)
                continue
            }
            const entry = fontList.find(function (f) { return f.name === name })
            if (entry === undefined) continue
            resources.set(name, await loadFont('/api/fonts/' + entry.path, name))
        }
        return resources
    }

    async function executeImport(): Promise<void> {
        if (importedPage === null || currentFile === null || importing) return
        setImporting(true)
        try {
            setProgress({ label: ui.importElementsConverting, percent: 10 })
            await waitForPdfImportProgressPaint()
            const embeddedSources = selectedEmbeddedSources(fontRows)
            for (let i = 0; i < embeddedSources.length; i++) {
                const source = embeddedSources[i]!
                const exists = fontList.some(function (entry) { return entry.name === source.fontId })
                if (!exists) {
                    await Action.uploadAccountFont(new File([source.bytes.slice()], source.fileName, { type: source.extension === '.otf' ? 'font/otf' : 'font/ttf' }))
                }
            }
            if (embeddedSources.length > 0) onEmbeddedFontsImported(embeddedSources)
            const assignments: PdfFontAssignments = {}
            for (let i = 0; i < fontRows.length; i++) {
                assignments[fontRows[i]!.info.familyName] = fontRows[i]!.fontName
                assignments[fontRows[i]!.info.baseFont] = fontRows[i]!.fontName
            }
            const conversion = convertImportedPageToEditorElements(importedPage, state.elementIdCounter, assignments)
            // Preserve every PDF text run's original advance while fitting the
            // assigned font. The same resolved font drives embedded, outline,
            // and system-reference output so changing the per-element mode does
            // not change layout.
            setProgress({ label: ui.fontAssignmentPreparing, percent: 25 })
            const fontResources = await loadAssignedFontResources()
            const fallback = fontResources.get(defaultFontId)
            if (fallback === undefined) throw new Error('PDF import error: default font is not loaded')
            fitTextElementsToAssignedFonts(conversion.elements, function (fontFamily, text, fontSize) {
                const resource = fontResources.get(fontFamily) ?? fallback
                return resource.measurer.measure(text, fontSize).width
            })
            // Size mode: 'pdf' switches the report page to the exact PDF page
            // size; 'fit' keeps the current page and uniformly scales the
            // content into its printable area
            const pageSettings = sizeMode === 'fit'
                ? state.template.pageSettings
                : createPdfImportPageSettings(
                    importedPage.width,
                    importedPage.height,
                    importedPage.pageProperties.transparencyGroup,
                )
            const printableWidth = pageSettings.width - pageSettings.marginLeft - pageSettings.marginRight
            const printableHeight = pageSettings.height - pageSettings.marginTop - pageSettings.marginBottom
            const contentScale = sizeMode === 'fit'
                ? Math.min(printableWidth / importedPage.width, printableHeight / importedPage.height)
                : 1
            // Center the fitted content: the horizontal leftover splits evenly
            // in every destination; the vertical leftover centers only for the
            // draft / background layers — the band assignment keeps its top-down
            // structure (the page footer is bottom-fixed by the layout engine)
            const offsetX = (printableWidth - importedPage.width * contentScale) / 2
            const offsetY = destination === 'bands' ? 0 : (printableHeight - importedPage.height * contentScale) / 2
            // Execute the slice plan: cut lines split raster images pixel-exact
            // and vector shapes geometrically; disabled pieces are dropped
            setProgress({ label: ui.sliceSettingsApplying, percent: 45 })
            await waitForPdfImportProgressPaint()
            const sliced = await applySlicesToImport(
                conversion.elements, importedPage.images, sliceTargets, slicePoints, disabledPieces, conversion.nextElementIdCounter,
            )
            const positioned = offsetImportedElements(scaleImportedElements(sliced.elements, contentScale), offsetX, offsetY)
            const elements = await uploadImages(currentFile, sliced.images, positioned, function (done, total) {
                setProgress({ label: ui.imagesUploading + ' ' + done + '/' + total, percent: 60 + done / total * 25 })
            })
            // Band-assignment imports disable the bands the user left out so
            // the resulting template contains exactly the assigned bands
            setProgress({ label: ui.templateApplying, percent: 90 })
            const disabledBandTypes: BandType[] = destination === 'bands'
                ? regions.filter(function (r) { return !r.enabled }).map(function (r) { return r.type })
                : []
            dispatch({
                type: 'APPLY_PDF_IMPORT',
                payload: {
                    pageSettings,
                    bands: buildBandContents(elements, printableHeight, contentScale),
                    disabledBandTypes,
                    nextElementIdCounter: sliced.nextElementIdCounter,
                },
            })
            setCompleted(true)
        } finally {
            setImporting(false)
            setProgress(null)
        }
    }

    function handleDragOver(e: React.DragEvent): void {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dragOver) setDragOver(true)
    }

    function handleDrop(e: React.DragEvent): void {
        e.preventDefault()
        setDragOver(false)
        const files = e.dataTransfer.files
        if (files.length === 0) return
        const dropped = files[0]!
        // Mirror the file input's accept filter
        if (dropped.type !== 'application/pdf' && !dropped.name.toLowerCase().endsWith('.pdf')) return
        handleFileChange(dropped)
    }

    function renderFileStep() {
        return (
            <div
                className={styles.dropZone + (dragOver ? ' ' + styles.dropZoneActive : '')}
                onDragOver={handleDragOver}
                onDragLeave={function () { setDragOver(false) }}
                onDrop={handleDrop}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className={styles.hiddenFileInput}
                    onChange={function (e) {
                        const selected = e.target.files !== null && e.target.files.length > 0 ? e.target.files[0] : null
                        e.target.value = ''
                        handleFileChange(selected)
                    }}
                />
                <div className={styles.filePicker}>
                    <Button
                        type="button"
                        label={ui.selectPdfFile}
                        icon="pi pi-file-pdf"
                        size="small"
                        onClick={function () {
                            if (fileInputRef.current !== null) fileInputRef.current.click()
                        }}
                    />
                    <span className={styles.selectedFile}>{file === null ? ui.noPdfFileSelected : file.name}</span>
                </div>
                <p className={styles.dropZoneHint}>{ui.dropPdfHint}</p>
            </div>
        )
    }

    function renderPageStep() {
        if (pageCount <= 1) return null
        return (
            <div>
                <div className={styles.stepHeader}>{ui.pageSelection}</div>
                <div className={styles.pageGrid}>
                    {pageNumbers.map(function (pageIndex) {
                        return (
                            <button
                                key={pageIndex}
                                type="button"
                                className={styles.pageButton + (selectedPage === pageIndex ? ' ' + styles.pageButtonSelected : '')}
                                onClick={function () { selectPage(pageIndex) }}
                            >
                                {pageIndex + 1}
                            </button>
                        )
                    })}
                </div>
            </div>
        )
    }

    function renderDestinationStep() {
        if (importedPage === null) return null
        return (
            <div>
                <div className={styles.stepHeader}>{ui.importDestination}</div>
                <div className={styles.destinationOptions}>
                    <label className={styles.destinationOption}>
                        <input type="radio" name="pdfImportDestination" checked={destination === 'draft'} onChange={function () { changeDestination('draft') }} />
                        <span>{ui.importToDraft}</span>
                        <span className={styles.destinationNote}>{ui.importToDraftNote}</span>
                    </label>
                    <label className={styles.destinationOption}>
                        <input type="radio" name="pdfImportDestination" checked={destination === 'background'} onChange={function () { changeDestination('background') }} />
                        <span>{ui.importToBackground}</span>
                        <span className={styles.destinationNote}>{ui.importToBackgroundNote}</span>
                    </label>
                    <label className={styles.destinationOption}>
                        <input type="radio" name="pdfImportDestination" checked={destination === 'bands'} onChange={function () { changeDestination('bands') }} />
                        <span>{ui.importToBands}</span>
                        <span className={styles.destinationNote}>{ui.importToBandsNote}</span>
                    </label>
                </div>
                {destination === 'bands' && renderBandToggles()}
            </div>
        )
    }

    function renderSizeModeStep() {
        if (importedPage === null) return null
        const current = state.template.pageSettings
        return (
            <div>
                <div className={styles.stepHeader}>{ui.sizeAdjustment}</div>
                <div className={styles.destinationOptions}>
                    <label className={styles.destinationOption}>
                        <input type="radio" name="pdfImportSizeMode" checked={sizeMode === 'pdf'} onChange={function () { setSizeMode('pdf') }} />
                        <span>{ui.exactPdfSize}</span>
                        <span className={styles.destinationNote}>
                            {ui.exactPdfSizeNote} ({formatPt(importedPage.width)} × {formatPt(importedPage.height)} pt)
                        </span>
                    </label>
                    <label className={styles.destinationOption}>
                        <input type="radio" name="pdfImportSizeMode" checked={sizeMode === 'fit'} onChange={function () { setSizeMode('fit') }} />
                        <span>{ui.fitCurrentPaper}</span>
                        <span className={styles.destinationNote}>
                            {ui.fitCurrentPaperNote} ({formatPt(current.width)} × {formatPt(current.height)} pt)
                        </span>
                    </label>
                </div>
            </div>
        )
    }

    function renderBandToggles() {
        return (
            <div className={styles.bandToggles}>
                {regions.map(function (region) {
                    return (
                        <label key={region.type} className={styles.bandToggle}>
                            <input
                                type="checkbox"
                                checked={region.enabled}
                                onChange={function () {
                                    if (importedPage !== null) setRegions(toggleRegion(regions, region.type, importedPage.height))
                                }}
                            />
                            <span className={styles.bandChip} style={{ backgroundColor: getBandColor(region.type) }} />
                            <span>{getBandLabel(region.type)}</span>
                        </label>
                    )
                })}
            </div>
        )
    }

    function renderFontStep() {
        if (importedPage === null || fontRows.length === 0) return null
        return (
            <div>
                <div className={styles.stepHeader}>{ui.fontAssignment}</div>
                <table className={styles.fontTable}>
                    <thead>
                        <tr>
                            <th>{ui.pdfFont}</th>
                            <th>{ui.assignment}</th>
                            <th>{ui.decision}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fontRows.map(function (row) {
                            return (
                                <tr key={row.key}>
                                    <td>{row.info.familyName}</td>
                                    <td>
                                        <SelectDropdown
                                            className={styles.fontSelect}
                                            value={row.fontName}
                                            onChange={function (e) { updateFontAssignment(row.key, e.target.value) }}
                                        >
                                            {row.embeddedSource !== null && (
                                                <option value={row.embeddedSource.fontId}>{ui.embeddedPdfFont}: {row.info.familyName}</option>
                                            )}
                                            <option value={defaultFontId}>NotoSansJP (built-in)</option>
                                            {fontList.map(function (font) {
                                                return <option key={font.name} value={font.name}>{font.name}</option>
                                            })}
                                        </SelectDropdown>
                                    </td>
                                    <td className={row.warning ? styles.warning : ''}>{Math.round(row.score * 100)}%</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        )
    }

    function renderSummary() {
        if (importedPage === null) return null
        return (
            <p className={styles.summary}>
                {formatPt(importedPage.width)} pt x {formatPt(importedPage.height)} pt / {importedPage.elements.length} {ui.elementUnit}
            </p>
        )
    }

    function renderProgress() {
        if (progress === null) return null
        const percent = Math.max(0, Math.min(100, progress.percent))
        return (
            <div className={styles.importProgress} role="status" aria-live="polite" aria-busy="true">
                <div className={styles.progressHeader}>
                    <span>{progress.label}</span>
                    <span>{Math.round(percent)}%</span>
                </div>
                <div className={styles.progressTrack}>
                    <div className={styles.progressBar} style={{ width: Math.max(3, percent) + '%' }} />
                </div>
            </div>
        )
    }

    function renderEditPreviewColumn() {
        if (importedPage === null) return null
        return (
            <div className={styles.previewColumn}>
                <div className={styles.modeButtons}>
                    {destination === 'bands' && (
                        <Button
                            label={ui.bandEditing}
                            icon="pi pi-arrows-v"
                            size="small"
                            outlined={mode !== 'bands'}
                            onClick={function () { toggleMode('bands') }}
                        />
                    )}
                    <Button
                        label={ui.imageSlicing}
                        icon="pi pi-th-large"
                        size="small"
                        outlined={mode !== 'slice'}
                        onClick={function () { toggleMode('slice') }}
                    />
                </div>
                <PdfImportPreview
                    page={previewPage ?? importedPage}
                    placement={previewPlacement(importedPage)}
                    fontRegistry={previewFontRegistry}
                    defaultFontId={defaultFontId}
                    regions={destination === 'bands' ? regions : null}
                    onRegionsChange={setRegions}
                    mode={mode}
                    sliceTargets={sliceTargets}
                    slicePoints={slicePoints}
                    selectedPointId={selectedPointId}
                    disabledPieces={disabledPieces}
                    onSlicePointsChange={changeSlicePoints}
                    onSelectPoint={setSelectedPointId}
                    onTogglePiece={togglePiece}
                />
                {mode === 'slice' && (
                    <p className={styles.sliceHint}>
                        {ui.sliceInstructions}
                    </p>
                )}
            </div>
        )
    }

    function completionMessage(): string {
        if (destination === 'draft') return ui.importDoneDraft
        if (destination === 'background') return ui.importDoneBackground
        return ui.importDoneBands
    }

    function renderFooter() {
        if (step === 'select') {
            return (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <Button label={ui.cancel} severity="secondary" size="small" onClick={onHide} />
                    <Button label={ui.next} icon="pi pi-arrow-right" iconPos="right" size="small" disabled={importedPage === null || progress !== null} onClick={function () { setStep('edit') }} />
                </div>
            )
        }
        return (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <Button label={ui.cancel} severity="secondary" size="small" onClick={onHide} />
                <Button label={ui.back} icon="pi pi-arrow-left" severity="secondary" size="small" disabled={importing} onClick={function () { setStep('select') }} />
                <Button label={ui.continueImport} icon="pi pi-file-import" size="small" disabled={importedPage === null || currentFile === null || importing || progress !== null} onClick={executeImport} />
            </div>
        )
    }

    return (
        <>
            <Dialog
                header={step === 'select' ? ui.pdfImportPageTitle : ui.pdfImportSettingsTitle}
                visible={visible}
                onHide={onHide}
                maximized
                contentClassName={styles.dialogContent}
                footer={renderFooter()}
            >
                {renderProgress()}
                <div className={importedPage !== null ? styles.columns : styles.content}>
                    <div className={styles.content}>
                        {step === 'select' && renderFileStep()}
                        {step === 'select' && renderPageStep()}
                        {step === 'edit' && renderDestinationStep()}
                        {step === 'edit' && renderSizeModeStep()}
                        {step === 'edit' && renderFontStep()}
                        {renderSummary()}
                    </div>
                    {step === 'select' && importedPage !== null && (
                        <div className={styles.previewColumn}>
                            <PdfImportPreview
                                page={previewPage ?? importedPage}
                                placement={previewPlacement(importedPage)}
                                fontRegistry={previewFontRegistry}
                                defaultFontId={defaultFontId}
                                regions={null}
                            />
                        </div>
                    )}
                    {step === 'edit' && renderEditPreviewColumn()}
                </div>
            </Dialog>
            <Dialog
                header={ui.importCompleted}
                visible={completed}
                onHide={function () { setCompleted(false); onHide() }}
                style={{ width: '24rem' }}
                footer={<Button label="OK" size="small" onClick={function () { setCompleted(false); onHide() }} />}
            >
                <p style={{ margin: 0 }}>{completionMessage()}</p>
            </Dialog>
        </>
    )
}

function formatPt(value: number): number {
    return Math.round(value * 10) / 10
}

function selectedEmbeddedSources(rows: PdfImportFontRow[]): PdfEmbeddedFontSource[] {
    const result: PdfEmbeddedFontSource[] = []
    const ids = new Set<string>()
    for (let i = 0; i < rows.length; i++) {
        const source = rows[i]!.embeddedSource
        if (source === null || rows[i]!.fontName !== source.fontId || ids.has(source.fontId)) continue
        ids.add(source.fontId)
        result.push(source)
    }
    return result
}

function progressFromCore(progress: CorePdfImportProgress, ui: UiMessages): PdfImportProgress {
    const pageLabel = progress.pageIndex === undefined ? '' : ' ' + (progress.pageIndex + 1)
    if (progress.stage === 'open-parse') {
        return { label: ui.pdfStructureAnalyzing, percent: 15 + progressRatio(progress) * 20 }
    }
    if (progress.stage === 'open-pages') {
        return { label: ui.pageListAnalyzing, percent: 35 + progressRatio(progress) * 5 }
    }
    if (progress.stage === 'open-complete') {
        return { label: ui.pdfStructureAnalyzing, percent: 40 }
    }
    if (progress.stage === 'page-contents') {
        return { label: ui.pdfFileReading + pageLabel, percent: 40 + progressRatio(progress) * 5 }
    }
    if (progress.stage === 'page-interpret') {
        return { label: ui.pageConverting + pageLabel, percent: 45 + progressRatio(progress) * 40 }
    }
    if (progress.stage === 'page-annotations') {
        return { label: ui.annotationsConverting + pageLabel, percent: 85 + progressRatio(progress) * 10 }
    }
    return { label: ui.pageConverting + pageLabel, percent: 95 }
}

function progressRatio(progress: CorePdfImportProgress): number {
    if (progress.total <= 0) return 0
    return Math.max(0, Math.min(1, progress.done / progress.total))
}

async function uploadImages(
    currentFile: { workspace: string, path: string },
    images: Record<string, Uint8Array>,
    elements: TemplateElement[],
    onProgress?: (done: number, total: number) => void,
): Promise<TemplateElement[]> {
    const imageKeys = Object.keys(images)
    if (imageKeys.length === 0) return elements
    const reportDir = dirnamePosix(currentFile.path)
    const reportName = currentFile.path.substring(currentFile.path.lastIndexOf('/') + 1).replace(/\.report$/, '')
    const timestamp = timestampForPath(new Date())
    const assetDir = (reportDir !== '' ? reportDir + '/' : '') + reportName + '_assets/pdf_' + timestamp
    await Action.createDirectory(currentFile.workspace, assetDir)
    const sourceMap = new Map<string, string>()
    for (let i = 0; i < imageKeys.length; i++) {
        const key = imageKeys[i]!
        const bytes = images[key]!
        const extension = key.toLowerCase().endsWith('.jpg') || key.toLowerCase().endsWith('.jpeg') ? 'jpg' : 'png'
        const fileName = 'img_' + i + '.' + extension
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const file = new File([arrayBuffer], fileName, { type: extension === 'jpg' ? 'image/jpeg' : 'image/png' })
        await Action.uploadFile(currentFile.workspace, assetDir, file)
        if (onProgress !== undefined) onProgress(i + 1, imageKeys.length)
        sourceMap.set(key, (reportDir !== '' ? './' : '') + reportName + '_assets/pdf_' + timestamp + '/' + fileName)
    }
    return rewriteImportedImageSources(elements, sourceMap)
}

function timestampForPath(date: Date): string {
    const y = date.getFullYear()
    const m = pad2(date.getMonth() + 1)
    const d = pad2(date.getDate())
    const h = pad2(date.getHours())
    const min = pad2(date.getMinutes())
    const s = pad2(date.getSeconds())
    return '' + y + m + d + h + min + s
}

function pad2(value: number): string {
    return value < 10 ? '0' + value : String(value)
}
