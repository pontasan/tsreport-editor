import type { DataSource, RenderDocument, ReportTemplate } from 'tsreport-core'
import type { PreviewTemplatePayload } from 'tsreport-react'

export type ReportLayoutWorkerStart = {
    type: 'start'
    template: ReportTemplate
    dataSource: DataSource
    fonts: Record<string, ArrayBuffer>
    workingDirectory?: string
}

export type ReportLayoutWorkerResolved = {
    type: 'resolved'
    images: Array<{ ref: string, value: Uint8Array | string | null }>
    subreports: Array<{ key: string, payload: PreviewTemplatePayload | null }>
    fonts: Record<string, ArrayBuffer>
}

export type ReportLayoutWorkerRequest = ReportLayoutWorkerStart | ReportLayoutWorkerResolved

export type ReportLayoutWorkerResponse =
    | { type: 'resources', images: string[], subreports: Array<{ key: string, ref: string, workingDirectory: string }> }
    | { type: 'done', document: RenderDocument }
    | { type: 'error', message: string }
