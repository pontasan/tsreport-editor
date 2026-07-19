import { describe, expect, it, vi } from 'vitest'
import { waitForPdfImportProgressPaint } from '../src/app/[lang]/editor/pdf_import_progress'

describe('PDF import progress paint wait', () => {
    it('does not resume heavy import work inside the animation-frame callback', async () => {
        const timeouts: Array<() => void> = []
        vi.stubGlobal('requestAnimationFrame', function (callback: FrameRequestCallback): number {
            callback(0)
            return 1
        })
        vi.stubGlobal('setTimeout', function (callback: () => void): number {
            timeouts.push(callback)
            return timeouts.length
        })

        let resolved = false
        const wait = waitForPdfImportProgressPaint().then(function () {
            resolved = true
        })

        await Promise.resolve()
        expect(resolved).toBe(false)

        timeouts[0]!()
        await wait
        expect(resolved).toBe(true)

        vi.unstubAllGlobals()
    })
})
