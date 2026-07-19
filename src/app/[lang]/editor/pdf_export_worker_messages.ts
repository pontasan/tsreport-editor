import type { RenderDocument } from 'tsreport-core'

export type PdfExportWorkerRequest = {
    type: 'render'
    document: RenderDocument
    fonts: Record<string, ArrayBuffer>
}

export type PdfExportWorkerResponse =
    | { type: 'done', bytes: ArrayBuffer }
    | { type: 'error', message: string }
