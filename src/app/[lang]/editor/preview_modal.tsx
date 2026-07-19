'use client'

// Print preview modal. Document layout and page painting are delegated to the
// preview components; this modal owns only
// the editor-specific concerns: the modal UI, PDF download, printing, and the
// editor-internal preview connector that supplies images, subreport templates
// and complementary fonts.

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import type { DataSource, Font, RenderDocument } from 'tsreport-core'
import { ReportPage } from 'tsreport-react'
import { FontResource } from './font_loader'
import { createEditorPreviewConnector, loadEditorPreviewFontBytes } from './preview_connector'
import { renderPdfInWorker } from './pdf_export_worker_client'
import { Action } from './action'
import styles from './preview_modal.module.css'
import { ReportTemplate } from './reducer'
import type { EditorCurrentFile } from './resource_resolver'
import type { OpenReportTemplate } from './subreport_support'
import { convertEditorTemplateToCore } from './template_converter'
import { dirnamePosix } from '@/lib/common/utils/workspace_path'
import { useEditorReportDocument } from './use_editor_report_document'
import {
    fitScalePercent, maximumPreviewScale, PREVIEW_ZOOM_LEVELS, previewAvailableWidth, resolvePreviewScale, stepPreviewZoom,
    type PreviewZoomPercent,
} from './preview_zoom'

type Props = {
    template: ReportTemplate,
    openReportTemplates: OpenReportTemplate[],
    fontRegistry: Map<string, FontResource>,
    defaultFontId: string,
    mathFontResource: FontResource | null,
    currentFile: EditorCurrentFile | null,
    dataSource: DataSource | null,
    onClose: () => void
}

// Build a Font map from fontRegistry.
function buildFontsMap(fontRegistry: Map<string, FontResource>, mathFontResource: FontResource | null): Record<string, Font> {
    const fonts: Record<string, Font> = {}
    fontRegistry.forEach(function (res, id) { fonts[id] = res.font })
    if (mathFontResource !== null) {
        fonts[mathFontResource.fontId] = mathFontResource.font
    }
    return fonts
}

function toBlobArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

// Data source used while no preview data is selected: a single empty row.
const EMPTY_DATA_SOURCE: DataSource = { rows: [{}] }

export default function PreviewModal(props: Props) {
    // Layout needs loaded fonts. Until the registry is populated, present the
    // modal shell without a document — the same state as while layout runs.
    if (props.fontRegistry.size === 0) {
        return (
            <PreviewModalView
                doc={null}
                fonts={buildFontsMap(props.fontRegistry, props.mathFontResource)}
                templateName={props.template.name}
                workspace={props.currentFile !== null ? props.currentFile.workspace : ''}
                templatePath={props.currentFile !== null ? props.currentFile.path : ''}
                onClose={props.onClose}
            />
        )
    }
    return <PreviewModalContent {...props} />
}

function PreviewModalContent(props: Props) {
    const { template, openReportTemplates, fontRegistry, mathFontResource, currentFile, dataSource, onClose } = props

    // Keep worker inputs referentially stable so unrelated modal state does
    // not restart a large layout job.
    const coreTemplate = useMemo(function () {
        return convertEditorTemplateToCore(template)
    }, [template])

    const effectiveDataSource = dataSource !== null ? dataSource : EMPTY_DATA_SOURCE

    const fonts = useMemo(function () {
        return buildFontsMap(fontRegistry, mathFontResource)
    }, [fontRegistry, mathFontResource])

    // The connector supplies images, subreport templates and complementary
    // fonts; the registry fonts go through the fonts option, which takes
    // precedence over the connector, so registry fonts are never refetched.
    const connector = useMemo(function () {
        return createEditorPreviewConnector(currentFile, template, openReportTemplates)
    }, [currentFile, template, openReportTemplates])

    const resolveFontBytes = useCallback(async function (fontId: string): Promise<Uint8Array | null> {
        const local = fontRegistry.get(fontId)
        if (local?.sourceBytes !== undefined) return local.sourceBytes
        if (mathFontResource?.fontId === fontId && mathFontResource.sourceBytes !== undefined) {
            return mathFontResource.sourceBytes
        }
        return loadEditorPreviewFontBytes(fontId)
    }, [fontRegistry, mathFontResource])

    const workingDirectory = currentFile !== null ? dirnamePosix(currentFile.path) : undefined

    const { document: doc, fonts: effectiveFonts, error } = useEditorReportDocument(
        coreTemplate, effectiveDataSource, fonts, resolveFontBytes, connector, workingDirectory,
    )

    // Re-raise layout and image loading failures through the promise channel
    // so they reach the client exception handler (unhandledrejection) and
    // present through the shared error dialog, the same path as fetchProxy.
    useEffect(function () {
        if (error !== null) {
            void Promise.reject(error)
        }
    }, [error])

    // Page painting and PDF output use the effective font record layout
    // measured with (registry fonts plus connector-loaded subreport fonts) so
    // glyph drawing matches measurement. While no document exists the pages
    // are not painted, so the registry record is presented as-is.
    return <PreviewModalView doc={doc} fonts={effectiveFonts !== null ? effectiveFonts : fonts} resolveFontBytes={resolveFontBytes} templateName={template.name} workspace={currentFile !== null ? currentFile.workspace : ''} templatePath={currentFile !== null ? currentFile.path : ''} onClose={onClose} />
}

function PreviewModalView(props: {
    doc: RenderDocument | null,
    fonts: Record<string, Font>,
    resolveFontBytes?: (fontId: string) => Promise<Uint8Array | null>,
    templateName: string,
    workspace: string,
    templatePath: string,
    onClose: () => void,
}) {
    const ui = useUiMessages()
    const { doc, fonts, resolveFontBytes, templateName, workspace, templatePath, onClose } = props
    const totalPages = doc !== null ? doc.pages.length : 0
    const [isPdfCreating, setIsPdfCreating] = useState(false)
    const [zoomPercent, setZoomPercent] = useState<PreviewZoomPercent>(null)

    // PDF output. Failures reject the handler promise and reach the client
    // exception handler, which presents them through the shared error dialog.
    const handlePdf = useCallback(async () => {
        if (doc === null || resolveFontBytes === undefined || isPdfCreating) return
        setIsPdfCreating(true)
        try {
            const sources: Record<string, Uint8Array> = {}
            const fontIds = Object.keys(fonts)
            for (let i = 0; i < fontIds.length; i++) {
                const fontId = fontIds[i]!
                const source = await resolveFontBytes(fontId)
                if (source === null) throw new Error('PDF export font is unavailable: ' + fontId)
                sources[fontId] = source
            }
            const bytes = await renderPdfInWorker(doc, sources)
            const blob = new Blob([toBlobArrayBuffer(bytes)], { type: 'application/pdf' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${templateName || 'report'}.pdf`
            a.click()
            URL.revokeObjectURL(url)
            // Record the editor print in the account's history (the exact PDF
            // produced by the background worker).
            await Action.recordEditorPrint(blob, workspace, templatePath, 'pdf')
        } finally {
            setIsPdfCreating(false)
        }
    }, [doc, fonts, resolveFontBytes, isPdfCreating, templateName, workspace, templatePath])

    // Print.
    const handlePrint = useCallback(() => {
        window.print()
    }, [])

    // Fit-to-window scale so landscape pages are not clipped or scrolled sideways.
    const [fitScale, setFitScale] = useState(1)
    useLayoutEffect(function () {
        function updateScale(): void {
            if (doc === null || doc.pages.length === 0) return
            let maxPageWidth = 0
            for (let i = 0; i < doc.pages.length; i++) {
                if (doc.pages[i]!.width > maxPageWidth) maxPageWidth = doc.pages[i]!.width
            }
            if (maxPageWidth <= 0) return
            // The modal keeps a 1rem viewport margin and the body keeps 1rem
            // horizontal padding on both sides.
            const available = previewAvailableWidth(window.innerWidth)
            setFitScale(maximumPreviewScale(maxPageWidth, available))
        }
        updateScale()
        window.addEventListener('resize', updateScale)
        return function () { window.removeEventListener('resize', updateScale) }
    }, [doc])

    const previewScale = resolvePreviewScale(zoomPercent, fitScale)
    const lowerZoom = stepPreviewZoom(zoomPercent, fitScale, -1)
    const upperZoom = stepPreviewZoom(zoomPercent, fitScale, 1)
    const fitPercent = fitScalePercent(fitScale)

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {}
                <div className={styles.header}>
                    <span className={styles.title}>{ui.preview}</span>
                    <div className={styles.headerActions}>
                        {isPdfCreating && <span className={styles.exportStatus}>{ui.pdfCreating}</span>}
                        <div className={styles.zoomControls}>
                            <button
                                type="button"
                                className={styles.zoomButton}
                                onClick={() => setZoomPercent(lowerZoom)}
                                title={ui.zoomOut}
                                aria-label={ui.previewZoomOut}
                                disabled={doc === null || lowerZoom === zoomPercent}
                            >−</button>
                            <select
                                className={styles.zoomSelect}
                                value={zoomPercent === null ? 'fit' : String(zoomPercent)}
                                onChange={(event) => setZoomPercent(event.target.value === 'fit' ? null : Number(event.target.value) as PreviewZoomPercent)}
                                aria-label={ui.previewZoom}
                                disabled={doc === null}
                            >
                                <option value="fit">{ui.fitToWindow} ({fitPercent}%)</option>
                                {PREVIEW_ZOOM_LEVELS.map(function (level) {
                                    return <option key={level} value={level}>{level}%</option>
                                })}
                            </select>
                            <button
                                type="button"
                                className={styles.zoomButton}
                                onClick={() => setZoomPercent(upperZoom)}
                                title={ui.zoomIn}
                                aria-label={ui.previewZoomIn}
                                disabled={doc === null || upperZoom === zoomPercent}
                            >＋</button>
                        </div>
                        <button className={styles.headerButton} onClick={handlePdf} title={ui.pdfOutput} disabled={isPdfCreating || doc === null}>
                            <i className="pi pi-file-pdf" />
                        </button>
                        <button className={styles.headerButton} onClick={handlePrint} title={ui.print}>
                            <i className="pi pi-print" />
                        </button>
                        <button className={styles.headerButton} onClick={onClose} title={ui.close}>
                            <i className="pi pi-times" />
                        </button>
                    </div>
                </div>

                {}
                <div className={styles.body}>
                    {doc !== null && doc.pages.map(function (page, index) {
                        return (
                            <div key={index} className={styles.pageBlock}>
                                <div className={styles.pageLabel}>Page {index + 1}</div>
                                <ReportPage
                                    page={page}
                                    fonts={fonts}
                                    images={doc.images}
                                    scale={previewScale}
                                    tileSize={512}
                                    className={styles.canvas}
                                />
                            </div>
                        )
                    })}
                </div>

                <div className={styles.footer}>
                    <span className={styles.pageInfo}>
                        {totalPages > 0 ? `${totalPages} ${ui.pageUnit}` : '---'}
                    </span>
                </div>
            </div>
        </div>
    )
}
