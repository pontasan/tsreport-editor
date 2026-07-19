import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RenderDocument } from 'tsreport-core'
import { renderPdfInWorker } from '../src/app/[lang]/editor/pdf_export_worker_client'

class WorkerMock {
    static instance: WorkerMock | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminated = false
    posted: unknown = null
    transfer: Transferable[] = []

    constructor(_url: URL, _options: WorkerOptions) {
        WorkerMock.instance = this
    }

    postMessage(message: unknown, transfer: Transferable[]): void {
        this.posted = message
        this.transfer = transfer
    }

    terminate(): void {
        this.terminated = true
    }
}

describe('renderPdfInWorker', function () {
    const OriginalWorker = globalThis.Worker

    afterEach(function () {
        globalThis.Worker = OriginalWorker
        WorkerMock.instance = null
    })

    it('transfers private font copies and resolves worker PDF bytes', async function () {
        globalThis.Worker = WorkerMock as unknown as typeof Worker
        const document: RenderDocument = { pages: [{ width: 10, height: 20, children: [] }] }
        const source = new Uint8Array([1, 2, 3])
        const promise = renderPdfInWorker(document, { font: source })
        const worker = WorkerMock.instance!
        const posted = worker.posted as { document: RenderDocument, fonts: Record<string, ArrayBuffer> }
        expect(posted.document).toBe(document)
        expect(new Uint8Array(posted.fonts.font!)).toEqual(source)
        expect(posted.fonts.font).not.toBe(source.buffer)
        expect(worker.transfer).toContain(posted.fonts.font)
        expect(source).toEqual(new Uint8Array([1, 2, 3]))

        worker.onmessage!({ data: { type: 'done', bytes: new Uint8Array([37, 80, 68, 70]).buffer } } as MessageEvent)
        await expect(promise).resolves.toEqual(new Uint8Array([37, 80, 68, 70]))
        expect(worker.terminated).toBe(true)
    })

    it('rejects and terminates on a worker rendering error', async function () {
        globalThis.Worker = WorkerMock as unknown as typeof Worker
        const promise = renderPdfInWorker({ pages: [] }, {})
        const worker = WorkerMock.instance!
        worker.onmessage!({ data: { type: 'error', message: 'render failed' } } as MessageEvent)
        await expect(promise).rejects.toThrow('render failed')
        expect(worker.terminated).toBe(true)
    })
})
