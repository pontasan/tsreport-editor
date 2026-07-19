// Provisional slice-piece images. The canvas image slice tool writes its
// piece PNGs as data: URI sources into the template only — nothing reaches
// the workspace until the template is saved. Saving uploads exactly the
// provisional sources still referenced by the template into a fresh
// timestamped + randomized assets directory and rewrites them to
// workspace-relative paths. An undone or discarded slice therefore never
// leaves a file behind, and concurrent editors can never collide on
// provisional files.

import { dirnamePosix } from '@/lib/common/utils/workspace_path'
import { Action } from './action'
import type { ReportTemplate, TemplateElement } from './reducer'

/** Data URI sources produced by the slice tool in this session */
const pendingSliceSources = new Set<string>()

export function registerPendingSliceSource(source: string): void {
    pendingSliceSources.add(source)
}

export function pngBytesToDataUri(bytes: Uint8Array): string {
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, bytes.length)
        for (let j = i; j < end; j++) binary += String.fromCharCode(bytes[j]!)
    }
    return 'data:image/png;base64,' + btoa(binary)
}

export function dataUriToBytes(source: string): Uint8Array {
    const base64 = source.substring(source.indexOf(',') + 1)
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

/** Provisional slice sources currently referenced by the template, in element order. */
export function collectPendingSliceSources(template: ReportTemplate): string[] {
    const found: string[] = []
    for (let i = 0; i < template.bands.length; i++) {
        collectFromElements(template.bands[i]!.elements, found)
    }
    return found
}

function collectFromElements(elements: TemplateElement[], out: string[]): void {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        if (element.kind === 'image' && pendingSliceSources.has(element.source) && out.indexOf(element.source) === -1) {
            out.push(element.source)
        }
        if (element.children.length > 0) collectFromElements(element.children, out)
    }
}

/** Rewrites image sources across the whole template (no-op sharing preserved). */
export function rewriteTemplateImageSources(template: ReportTemplate, replacements: Map<string, string>): ReportTemplate {
    let changed = false
    const bands = template.bands.map(function (band) {
        const elements = rewriteElements(band.elements, replacements)
        if (elements === band.elements) return band
        changed = true
        return { ...band, elements }
    })
    return changed ? { ...template, bands } : template
}

function rewriteElements(elements: TemplateElement[], replacements: Map<string, string>): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = []
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        let next = element
        if (element.kind === 'image') {
            const to = replacements.get(element.source)
            if (to !== undefined) next = { ...next, source: to }
        }
        if (element.children.length > 0) {
            const children = rewriteElements(element.children, replacements)
            if (children !== element.children) next = next === element ? { ...element, children } : { ...next, children }
        }
        if (next !== element) changed = true
        result.push(next)
    }
    return changed ? result : elements
}

/**
 * Uploads the provisional slice images referenced by the template into a
 * unique assets directory of the report and returns the template with the
 * data URI sources rewritten to workspace-relative paths. Returns the input
 * unchanged when the template holds no provisional sources.
 */
export async function uploadPendingSliceImages(workspace: string, reportPath: string, template: ReportTemplate): Promise<ReportTemplate> {
    const sources = collectPendingSliceSources(template)
    if (sources.length === 0) return template
    const reportDir = dirnamePosix(reportPath)
    const reportName = reportPath.substring(reportPath.lastIndexOf('/') + 1).replace(/\.report$/, '')
    const stamp = timestampForPath(new Date()) + '_' + Math.random().toString(36).substring(2, 6)
    const relativeDir = reportName + '_assets/slice_' + stamp
    const assetDir = (reportDir !== '' ? reportDir + '/' : '') + relativeDir
    await Action.createDirectory(workspace, assetDir)
    const replacements = new Map<string, string>()
    for (let i = 0; i < sources.length; i++) {
        const bytes = dataUriToBytes(sources[i]!)
        const fileName = 'img_' + i + '.png'
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const file = new File([arrayBuffer], fileName, { type: 'image/png' })
        await Action.uploadFile(workspace, assetDir, file)
        replacements.set(sources[i]!, (reportDir !== '' ? './' : '') + relativeDir + '/' + fileName)
    }
    return rewriteTemplateImageSources(template, replacements)
}

function timestampForPath(date: Date): string {
    const y = date.getFullYear()
    const m = pad2(date.getMonth() + 1)
    const d = pad2(date.getDate())
    const h = pad2(date.getHours())
    const min = pad2(date.getMinutes())
    const s = pad2(date.getSeconds())
    return '' + y + m + d + h + min + s
}

function pad2(value: number): string {
    return value < 10 ? '0' + value : String(value)
}
