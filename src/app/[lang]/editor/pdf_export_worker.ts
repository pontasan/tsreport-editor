import { Font, PdfBackend, render } from 'tsreport-core'
import { prepareBrowserPdfImageResources } from 'tsreport-core/browser'
import type { PdfExportWorkerRequest, PdfExportWorkerResponse } from './pdf_export_worker_messages'

self.onmessage = async function (event: MessageEvent<PdfExportWorkerRequest>): Promise<void> {
    try {
        const request = event.data
        const fonts: Record<string, Font> = {}
        const fontIds = Object.keys(request.fonts)
        for (let i = 0; i < fontIds.length; i++) {
            const fontId = fontIds[i]!
            fonts[fontId] = Font.load(request.fonts[fontId]!)
        }
        const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(request.document)
        const document = request.document.images === undefined ? request.document : { ...request.document, images }
        const backend = new PdfBackend({ fonts, images, rasterImageDecoder })
        render(document, backend)
        const bytes = backend.toUint8Array()
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        const transferable = copy.buffer
        postWorkerMessage({ type: 'done', bytes: transferable }, [transferable])
    } catch (error) {
        postWorkerMessage({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
        })
    }
}

function postWorkerMessage(message: PdfExportWorkerResponse, transfer: Transferable[] = []): void {
    self.postMessage(message, { transfer })
}
