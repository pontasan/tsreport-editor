import { createReport, Font, TextMeasurer } from 'tsreport-core'
import type { DataSource, FontMap, ReportTemplate } from 'tsreport-core'
import type { PreviewTemplatePayload } from 'tsreport-react'
import type { ReportLayoutWorkerRequest, ReportLayoutWorkerResponse } from './report_layout_worker_messages'

let template: ReportTemplate | null = null
let dataSource: DataSource | null = null
let workingDirectory: string | undefined
const fonts = new Map<string, Font>()
const images = new Map<string, Uint8Array | string | null>()
const subreports = new Map<string, PreviewTemplatePayload | null>()

self.onmessage = function (event: MessageEvent<ReportLayoutWorkerRequest>): void {
    try {
        const request = event.data
        if (request.type === 'start') {
            template = request.template
            dataSource = request.dataSource
            workingDirectory = request.workingDirectory
            loadFonts(request.fonts)
        } else {
            for (let i = 0; i < request.images.length; i++) {
                const image = request.images[i]!
                images.set(image.ref, image.value)
            }
            for (let i = 0; i < request.subreports.length; i++) {
                const subreport = request.subreports[i]!
                subreports.set(subreport.key, subreport.payload)
            }
            loadFonts(request.fonts)
        }
        runLayout()
    } catch (error) {
        postWorkerMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
}

function loadFonts(sources: Record<string, ArrayBuffer>): void {
    const ids = Object.keys(sources)
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!
        fonts.set(id, Font.load(sources[id]!))
    }
}

function runLayout(): void {
    if (template === null || dataSource === null) throw new Error('Report layout worker is not initialized')
    const missingImages = new Set<string>()
    const missingSubreports = new Map<string, { key: string, ref: string, workingDirectory: string }>()
    const fontMap: FontMap = new Map()
    fonts.forEach(function (font, id) { fontMap.set(id, new TextMeasurer(font)) })
    let document
    let failure: unknown
    try {
        document = createReport(template, dataSource as DataSource & Record<string, unknown>, {
            fontMap,
            workingDirectory,
            resources: {
                resolveImage(ref: string) {
                    if (images.has(ref)) return images.get(ref) ?? null
                    missingImages.add(ref)
                    return null
                },
            },
            resolveSubreportTemplate(ref: string, context: { workingDirectory: string }) {
                const key = subreportKey(ref, context.workingDirectory)
                if (subreports.has(key)) {
                    const payload = subreports.get(key)
                    return payload === null || payload === undefined ? null : { template: payload.template }
                }
                missingSubreports.set(key, { key, ref, workingDirectory: context.workingDirectory })
                return null
            },
        })
    } catch (error) {
        failure = error
    }
    if (missingImages.size > 0 || missingSubreports.size > 0) {
        postWorkerMessage({ type: 'resources', images: [...missingImages], subreports: [...missingSubreports.values()] })
        return
    }
    if (failure !== undefined) throw failure
    postWorkerMessage({ type: 'done', document: document! })
}

function subreportKey(ref: string, directory: string): string {
    return directory + '\u0000' + ref
}

function postWorkerMessage(message: ReportLayoutWorkerResponse): void {
    self.postMessage(message)
}
