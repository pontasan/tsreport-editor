import { PdfImporter } from 'tsreport-core'
import type { PdfImportWorkerRequest, PdfImportWorkerResponse } from './pdf_import_worker_messages'

let importer: PdfImporter | null = null

self.onmessage = function (event: MessageEvent<PdfImportWorkerRequest>): void {
    const request = event.data
    if (request.type === 'open') {
        importer = PdfImporter.open(new Uint8Array(request.bytes), {
            onProgress(progress) {
                postWorkerMessage({ id: request.id, type: 'progress', progress })
            },
        })
        postWorkerMessage({ id: request.id, type: 'opened', pageCount: importer.pageCount })
        return
    }
    if (request.type === 'importPage') {
        if (importer === null) throw new Error('PDF import worker error: importer is not open')
        const page = importer.importPage(request.pageIndex, {
            outlineText: request.outlineText,
            onProgress(progress) {
                postWorkerMessage({ id: request.id, type: 'progress', progress })
            },
        })
        postWorkerMessage({ id: request.id, type: 'page', pageIndex: request.pageIndex, page })
    }
}

function postWorkerMessage(message: PdfImportWorkerResponse): void {
    self.postMessage(message)
}
