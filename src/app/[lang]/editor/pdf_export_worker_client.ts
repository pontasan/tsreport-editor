import type { RenderDocument } from 'tsreport-core'
import type { PdfExportWorkerRequest, PdfExportWorkerResponse } from './pdf_export_worker_messages'

export function renderPdfInWorker(
    document: RenderDocument,
    fonts: Record<string, Uint8Array>,
): Promise<Uint8Array> {
    return new Promise(function (resolve, reject) {
        const worker = new Worker(new URL('./pdf_export_worker.ts', import.meta.url), { type: 'module' })
        let settled = false
        function finish(): void {
            if (!settled) {
                settled = true
                worker.terminate()
            }
        }
        worker.onmessage = function (event: MessageEvent<PdfExportWorkerResponse>) {
            const response = event.data
            finish()
            if (response.type === 'error') {
                reject(new Error(response.message))
                return
            }
            resolve(new Uint8Array(response.bytes))
        }
        worker.onerror = function (event) {
            finish()
            reject(new Error(event.message || 'PDF export worker failed'))
        }

        // Transfer private copies so the editor's cached font buffers remain
        // attached for later previews and exports.
        const workerFonts: Record<string, ArrayBuffer> = {}
        const transfer: Transferable[] = []
        const ids = Object.keys(fonts)
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i]!
            const source = fonts[id]!
            const copy = new Uint8Array(source.byteLength)
            copy.set(source)
            workerFonts[id] = copy.buffer
            transfer.push(copy.buffer)
        }
        const request: PdfExportWorkerRequest = { type: 'render', document, fonts: workerFonts }
        worker.postMessage(request, transfer)
    })
}
