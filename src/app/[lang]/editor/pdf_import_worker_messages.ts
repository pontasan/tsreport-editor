import type { ImportedPage, PdfImportProgress as CorePdfImportProgress } from 'tsreport-core'

export type PdfImportWorkerRequest =
    | { id: number, type: 'open', bytes: ArrayBuffer }
    | { id: number, type: 'importPage', pageIndex: number, outlineText: boolean }

export type PdfImportWorkerResponse =
    | { id: number, type: 'progress', progress: CorePdfImportProgress }
    | { id: number, type: 'opened', pageCount: number }
    | { id: number, type: 'page', pageIndex: number, page: ImportedPage }
