import { describe, expect, it } from 'vitest'
import {
    collectPendingSliceSources, dataUriToBytes, pngBytesToDataUri, registerPendingSliceSource, rewriteTemplateImageSources,
} from '../src/app/[lang]/editor/pending_slice_images'
import { createDefaultElement, createDefaultTemplate } from '../src/app/[lang]/editor/reducer'

describe('pending slice images', () => {
    it('round-trips bytes through the data URI form', () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 7])
        const uri = pngBytesToDataUri(bytes)
        expect(uri.startsWith('data:image/png;base64,')).toBe(true)
        expect(dataUriToBytes(uri)).toEqual(bytes)
    })

    it('collects only registered provisional sources referenced by the template', () => {
        const pending = pngBytesToDataUri(new Uint8Array([1, 2, 3]))
        registerPendingSliceSource(pending)
        const template = createDefaultTemplate()
        const piece = createDefaultElement('el_1', 'image', 0, 0, 10, 10)
        piece.source = pending
        const other = createDefaultElement('el_2', 'image', 20, 0, 10, 10)
        other.source = 'logo.png'
        const frame = createDefaultElement('el_3', 'frame', 0, 20, 100, 50)
        const nested = createDefaultElement('el_4', 'image', 0, 0, 10, 10)
        nested.source = pending
        frame.children = [nested]
        template.bands = template.bands.map(function (band) {
            if (band.type !== 'detail') return band
            return { ...band, elements: [piece, other, frame] }
        })
        // The same pending source used twice is collected once; a plain data
        // URI that was never registered is not treated as provisional
        const unregistered = createDefaultElement('el_5', 'image', 40, 0, 10, 10)
        unregistered.source = 'data:image/png;base64,AAAA'
        template.bands = template.bands.map(function (band) {
            if (band.type !== 'pageHeader') return band
            return { ...band, elements: [unregistered] }
        })
        expect(collectPendingSliceSources(template)).toEqual([pending])
    })

    it('rewrites image sources across bands and nested frames', () => {
        const pending = pngBytesToDataUri(new Uint8Array([9, 9]))
        const template = createDefaultTemplate()
        const piece = createDefaultElement('el_1', 'image', 0, 0, 10, 10)
        piece.source = pending
        const frame = createDefaultElement('el_2', 'frame', 0, 20, 100, 50)
        const nested = createDefaultElement('el_3', 'image', 0, 0, 10, 10)
        nested.source = pending
        frame.children = [nested]
        template.bands = template.bands.map(function (band) {
            if (band.type !== 'detail') return band
            return { ...band, elements: [piece, frame] }
        })
        const rewritten = rewriteTemplateImageSources(template, new Map([[pending, './r_assets/slice_x/img_0.png']]))
        const detail = rewritten.bands.find(function (band) { return band.type === 'detail' })!
        expect(detail.elements[0]!.source).toBe('./r_assets/slice_x/img_0.png')
        expect(detail.elements[1]!.children[0]!.source).toBe('./r_assets/slice_x/img_0.png')
        // Untouched bands keep their identity
        const untouched = rewriteTemplateImageSources(template, new Map([['none', 'x']]))
        expect(untouched).toBe(template)
    })
})
