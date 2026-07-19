// Font loader.
// Fetch font data, convert it to an ArrayBuffer, load it as Font, then obtain
// the TextMeasurer shared with the preview components so the design canvas
// and the preview layout use the same shaping caches.

import { Font } from 'tsreport-core'
import type { TextMeasurer } from 'tsreport-core'
import { getTextMeasurer } from 'tsreport-react'

export type FontResource = {
    font: Font
    measurer: TextMeasurer
    fontId: string
    /** Original font container bytes, retained for background PDF workers. */
    sourceBytes?: Uint8Array
}

export type FontEntry = {
    name: string
    path: string
    extension: string
    version: string
    /** name-table metadata for similarity matching (from the server font list) */
    familyName?: string
    postScriptName?: string
    fullName?: string
}

const cache = new Map<string, FontResource>()

export async function loadFont(url: string, fontId: string): Promise<FontResource> {
    const existing = cache.get(fontId)
    if (existing !== undefined) return existing

    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    const sourceBytes = new Uint8Array(buffer)
    const font = Font.load(buffer)
    const measurer = getTextMeasurer(font)
    const resource: FontResource = { font, measurer, fontId, sourceBytes }
    cache.set(fontId, resource)
    return resource
}

export function evictFont(fontId: string): void {
    cache.delete(fontId)
}
