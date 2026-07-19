'use client'

import { useEffect, useState } from 'react'
import { Font } from 'tsreport-core'
import type { DataSource, RenderDocument, ReportTemplate } from 'tsreport-core'
import type { PreviewConnector, PreviewTemplatePayload } from 'tsreport-react'
import type { ReportLayoutWorkerRequest, ReportLayoutWorkerResponse } from './report_layout_worker_messages'

export type EditorReportDocumentResult = {
    document: RenderDocument | null
    fonts: Record<string, Font> | null
    error: Error | null
}

export function useEditorReportDocument(
    template: ReportTemplate,
    dataSource: DataSource,
    baseFonts: Record<string, Font>,
    resolveFontBytes: (fontId: string) => Promise<Uint8Array | null>,
    connector: PreviewConnector,
    workingDirectory?: string,
): EditorReportDocumentResult {
    const [state, setState] = useState<EditorReportDocumentResult>({ document: null, fonts: null, error: null })

    useEffect(function () {
        let cancelled = false
        const worker = new Worker(new URL('./report_layout_worker.ts', import.meta.url), { type: 'module' })
        const effectiveFonts: Record<string, Font> = { ...baseFonts }
        const sentFontIds = new Set<string>()
        setState({ document: null, fonts: null, error: null })

        worker.onmessage = function (event: MessageEvent<ReportLayoutWorkerResponse>) {
            if (cancelled) return
            const response = event.data
            if (response.type === 'error') {
                setState({ document: null, fonts: null, error: new Error(response.message) })
                worker.terminate()
                return
            }
            if (response.type === 'done') {
                setState({ document: response.document, fonts: effectiveFonts, error: null })
                worker.terminate()
                return
            }
            void resolveResources(response.images, response.subreports).catch(function (error: unknown) {
                if (!cancelled) setState({ document: null, fonts: null, error: error instanceof Error ? error : new Error(String(error)) })
                worker.terminate()
            })
        }
        worker.onerror = function (event) {
            if (!cancelled) setState({ document: null, fonts: null, error: new Error(event.message || 'Report layout worker failed') })
            worker.terminate()
        }

        async function collectFonts(ids: string[]): Promise<Record<string, ArrayBuffer>> {
            const result: Record<string, ArrayBuffer> = {}
            for (let i = 0; i < ids.length; i++) {
                const id = ids[i]!
                if (sentFontIds.has(id)) continue
                sentFontIds.add(id)
                const bytes = await resolveFontBytes(id)
                if (bytes === null) continue
                const copy = new Uint8Array(bytes.byteLength)
                copy.set(bytes)
                result[id] = copy.buffer
                if (effectiveFonts[id] === undefined) effectiveFonts[id] = Font.load(copy.buffer.slice(0))
            }
            return result
        }

        async function resolveResources(
            imageRefs: string[],
            subreportRequests: Array<{ key: string, ref: string, workingDirectory: string }>,
        ): Promise<void> {
            const resolvedImages = await Promise.all(imageRefs.map(async function (ref) {
                return { ref, value: await connector.resolveImage(ref) }
            }))
            const resolvedSubreports = await Promise.all(subreportRequests.map(async function (request) {
                const payload = await connector.fetchSubreportTemplate(request.ref, { workingDirectory: request.workingDirectory })
                return { key: request.key, payload }
            }))
            const fontIds: string[] = []
            for (let i = 0; i < resolvedSubreports.length; i++) {
                const payload: PreviewTemplatePayload | null = resolvedSubreports[i]!.payload
                if (payload === null) continue
                for (let j = 0; j < payload.fontIds.length; j++) {
                    const id = payload.fontIds[j]!
                    if (!fontIds.includes(id)) fontIds.push(id)
                }
            }
            const fontSources = await collectFonts(fontIds)
            if (cancelled) return
            const request: ReportLayoutWorkerRequest = {
                type: 'resolved', images: resolvedImages, subreports: resolvedSubreports, fonts: fontSources,
            }
            worker.postMessage(request, Object.values(fontSources))
        }

        void collectFonts(Object.keys(baseFonts)).then(function (fontSources) {
            if (cancelled) return
            const request: ReportLayoutWorkerRequest = {
                type: 'start', template, dataSource, fonts: fontSources, workingDirectory,
            }
            worker.postMessage(request, Object.values(fontSources))
        }).catch(function (error: unknown) {
            if (!cancelled) setState({ document: null, fonts: null, error: error instanceof Error ? error : new Error(String(error)) })
            worker.terminate()
        })

        return function () {
            cancelled = true
            worker.terminate()
        }
    }, [template, dataSource, baseFonts, resolveFontBytes, connector, workingDirectory])

    return state
}
