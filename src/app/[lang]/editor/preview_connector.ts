// Editor-internal preview connector.
// Implements the tsreport-react PreviewConnector contract on top of the
// editor's workspace API and cookie session. The editor passes the open
// template to useReportDocument directly and injects the already-loaded font
// registry through the low-level fonts option (which takes precedence over
// the connector), so this connector only supplies the materials the registry
// cannot: workspace images, subreport templates resolved from the open tabs,
// and font binaries for ids the registry has not loaded (fonts introduced by
// subreport templates).

import type { SubreportTemplateResolver, ReportTemplate as CoreReportTemplate } from 'tsreport-core'
import type { PreviewConnector, PreviewTemplatePayload, PreviewTemplateSource } from 'tsreport-react'
import { fetchProxy } from '@/lib/client/utils/fetch_proxy'
import { DEFAULT_FONT_ID, MATH_FONT_ID } from '@/lib/common/font_ids'
import type { FontEntry } from './font_loader'
import type { ReportTemplate } from './reducer'
import { loadEditorImageData, type EditorCurrentFile } from './resource_resolver'
import { createEditorSubreportResolver, type OpenReportTemplate } from './subreport_support'

// ─── Font id collection ───

// Collects font ids referenced anywhere in a template tree. Same key rule as
// the server-side batch collection: fontFamily (styles / elements),
// mathFontFamily (math elements) and fontName (markup styled-text attribute
// mirrored into element defs).
function collectFontIdsWalk(value: unknown, result: Set<string>): void {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            collectFontIdsWalk(value[i], result)
        }
        return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const child = record[key]
        if ((key === 'fontFamily' || key === 'mathFontFamily' || key === 'fontName') && typeof child === 'string' && child !== '') {
            result.add(child)
        } else {
            collectFontIdsWalk(child, result)
        }
    }
}

// The font id set printing loads for a template: the bundled default and math
// fonts plus every referenced font id. Ids without a server font file resolve
// to null in fetchFont, which is the same set the print batch skips.
function computeTemplateFontIds(template: CoreReportTemplate): string[] {
    const collected = new Set<string>()
    collectFontIdsWalk(template, collected)
    const result = [DEFAULT_FONT_ID, MATH_FONT_ID]
    collected.forEach(function (fontId) {
        if (fontId !== DEFAULT_FONT_ID && fontId !== MATH_FONT_ID) {
            result.push(fontId)
        }
    })
    return result
}

// ─── Server font fetching ───

// Font catalog (font id -> relative path under the server font directory).
// Fetched once per session, like the form's font list.
let fontCatalogPromise: Promise<Map<string, string>> | null = null

async function fetchFontCatalog(): Promise<Map<string, string>> {
    const response = await fetchProxy('/api/fonts')
    const data = await response.json() as { fonts: FontEntry[] }
    const catalog = new Map<string, string>()
    for (let i = 0; i < data.fonts.length; i++) {
        const entry = data.fonts[i]
        catalog.set(entry.name, entry.path)
    }
    return catalog
}

function loadFontCatalog(): Promise<Map<string, string>> {
    if (fontCatalogPromise === null) {
        fontCatalogPromise = fetchFontCatalog()
    }
    return fontCatalogPromise
}

// Font bytes cached per id for the session, like the form's font resource
// cache, so reopening the preview does not refetch subreport fonts.
const fontBytesCache = new Map<string, Promise<Uint8Array | null>>()

async function fetchServerFontBytes(fontId: string): Promise<Uint8Array | null> {
    const catalog = await loadFontCatalog()
    const path = catalog.get(fontId)
    if (path === undefined) return null
    const response = await fetchProxy('/api/fonts/' + path)
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
}

function loadServerFontBytes(fontId: string): Promise<Uint8Array | null> {
    let promise = fontBytesCache.get(fontId)
    if (promise === undefined) {
        promise = fetchServerFontBytes(fontId)
        fontBytesCache.set(fontId, promise)
    }
    return promise
}

/** Supplies fonts introduced by subreports to the background PDF worker. */
export function loadEditorPreviewFontBytes(fontId: string): Promise<Uint8Array | null> {
    return loadServerFontBytes(fontId)
}

// ─── Connector ───

class EditorPreviewConnector implements PreviewConnector {
    private readonly currentFile: EditorCurrentFile | null
    private readonly resolveSubreport: SubreportTemplateResolver | undefined

    constructor(currentFile: EditorCurrentFile | null, rootTemplate: ReportTemplate, openReportTemplates: OpenReportTemplate[]) {
        this.currentFile = currentFile
        this.resolveSubreport = createEditorSubreportResolver(currentFile, rootTemplate, openReportTemplates)
    }

    fetchTemplate(source: PreviewTemplateSource): Promise<PreviewTemplatePayload> {
        // The editor previews the open template by passing it to
        // useReportDocument directly, so this is never called. Published tag
        // snapshots are only reachable through the OAuth preview API, which
        // the cookie-session editor client cannot call; a call here is a
        // wiring bug and must surface as an error.
        throw new Error('Editor preview connector cannot fetch published templates (requested: '
            + source.workspace + '/' + source.path + '@' + source.tag + ')')
    }

    // Complementary font fetch: ids present in the preview's fonts option
    // (the editor font registry) are never requested, so this only serves
    // font ids that subreport templates introduce. Unknown ids resolve to
    // null so layout falls back per core rules.
    fetchFont(fontId: string): Promise<Uint8Array | null> {
        return loadServerFontBytes(fontId)
    }

    resolveImage(ref: string): Promise<Uint8Array | string | null> {
        return loadEditorImageData(ref, this.currentFile)
    }

    // The resolved working directory is intentionally not part of the
    // payload: the editor resolves images and subreport references against
    // the open file itself, so the core-side working directory of a
    // subreport never participates in resolution here.
    async fetchSubreportTemplate(ref: string, context: { workingDirectory: string }): Promise<PreviewTemplatePayload | null> {
        if (this.resolveSubreport === undefined) return null
        const resolved = this.resolveSubreport(ref, context)
        if (resolved === null) return null
        return { template: resolved.template, fontIds: computeTemplateFontIds(resolved.template) }
    }
}

export function createEditorPreviewConnector(
    currentFile: EditorCurrentFile | null,
    rootTemplate: ReportTemplate,
    openReportTemplates: OpenReportTemplate[],
): PreviewConnector {
    return new EditorPreviewConnector(currentFile, rootTemplate, openReportTemplates)
}
