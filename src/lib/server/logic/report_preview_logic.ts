// Preview resource API logic.
// Serves the materials an external app needs for client-side preview rendering:
// published template snapshots, current workspace subreport templates, workspace
// files (images etc.) and the server font catalog. Templates are converted to the
// core format on the server and returned together with the exact font id set the
// print batch would load for them, so preview and print stay byte-identical.

import { NotFoundException } from '@/lib/common/exception/not_found_exception'
import { TemplateTagDao } from '@/lib/server/dao/TemplateTag'
import { detectFileType } from '@/lib/server/utils/file_type_detector'
import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { ClientBase } from 'pg'
import type { ReportTemplate as CoreTemplate } from 'tsreport-core'
import { parseTemplateJson } from '@/lib/common/utils/template_json'
import { isBuiltinFontId } from '@/lib/common/font_ids'
import { ReportApiLogic } from './report_api_logic'
import { WorkspacePaths } from './workspace_paths'
import {
    buildFontFileIndex,
    builtinFontFilePath,
    collectFontIds,
    DEFAULT_FONT_ID,
    LEGACY_DEFAULT_FONT_ID,
    LEGACY_MATH_FONT_ID,
    MATH_FONT_ID,
    resolveFontFilePath,
    resolveFontFilePathFromIndex,
    toCoreTemplate,
} from './report_batch_logic'

export type PreviewTemplatePayload = {
    template: CoreTemplate
    fontIds: string[]
}

export type PreviewFontEntry = {
    id: string
    fileName: string
}

export type PreviewFileBinary = {
    data: Buffer<ArrayBuffer>
    contentType: string
}

export type PreviewFontBinary = {
    // null when the request's If-None-Match matched the current entity tag (304 answer).
    data: Buffer<ArrayBuffer> | null
    contentType: string
    etag: string
}

const FONT_CONTENT_TYPES: Record<string, string> = {
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttc': 'font/collection',
    '.otc': 'font/collection',
}

export namespace ReportPreviewLogic {

    // Published template snapshot (tag) converted to core format, guarded by the same
    // TemplateAccessGrant check the print API applies to the template path.
    export async function getPublishedTemplate(
        client: ClientBase,
        fkOAuthClient: number,
        workspace: string,
        templatePath: string,
        tag: string,
        fontDir: string
    ): Promise<PreviewTemplatePayload> {
        ReportApiLogic.validateTag(tag)
        await ReportApiLogic.checkClientTemplateAccess(client, fkOAuthClient, workspace, templatePath)
        const templateTag = await TemplateTagDao.getByPathAndTag(client, workspace, templatePath, tag)
        if (templateTag === undefined) {
            throw new NotFoundException('指定されたAPI公開タグが見つかりません。')
        }
        return buildTemplatePayload(templateTag.templateJson, fontDir)
    }

    // Subreport template resolved from the current workspace files (print parity: the
    // batch also reads subreports from the live workspace, not from tag snapshots).
    export async function getSubreportTemplate(
        client: ClientBase,
        fkOAuthClient: number,
        workspace: string,
        path: string[],
        fontDir: string
    ): Promise<PreviewTemplatePayload> {
        const relativePath = path.join('/')
        await ReportApiLogic.checkClientTemplateAccess(client, fkOAuthClient, workspace, relativePath)
        const targetPath = WorkspacePaths.resolveInside(workspace, relativePath)
        const templateJson = (await readExistingFile(targetPath)).toString('utf-8')
        return buildTemplatePayload(templateJson, fontDir)
    }

    // Raw workspace file bytes (images etc.) for preview-side resource resolution.
    export async function getWorkspaceFile(
        client: ClientBase,
        fkOAuthClient: number,
        workspace: string,
        path: string[]
    ): Promise<PreviewFileBinary> {
        const relativePath = path.join('/')
        await ReportApiLogic.checkClientTemplateAccess(client, fkOAuthClient, workspace, relativePath)
        const targetPath = WorkspacePaths.resolveInside(workspace, relativePath)
        const data = await readExistingFile(targetPath)
        return { data, contentType: detectFileType(data).mimeType }
    }

    // Font catalog: canonical bundled ids, account ids and legacy bundled aliases
    // that are not occupied by an account font.
    export function listFonts(fontDir: string): PreviewFontEntry[] {
        const result: PreviewFontEntry[] = [
            { id: DEFAULT_FONT_ID, fileName: basename(builtinFontFilePath(DEFAULT_FONT_ID)!) },
            { id: MATH_FONT_ID, fileName: basename(builtinFontFilePath(MATH_FONT_ID)!) },
        ]
        const index = buildFontFileIndex(fontDir)
        for (const [id, filePath] of index) {
            if (!isBuiltinFontId(id)) result.push({ id, fileName: basename(filePath) })
        }
        if (!index.has(LEGACY_DEFAULT_FONT_ID)) {
            result.push({ id: LEGACY_DEFAULT_FONT_ID, fileName: basename(builtinFontFilePath(DEFAULT_FONT_ID)!) })
        }
        if (!index.has(LEGACY_MATH_FONT_ID)) {
            result.push({ id: LEGACY_MATH_FONT_ID, fileName: basename(builtinFontFilePath(MATH_FONT_ID)!) })
        }
        result.sort(compareFontEntries)
        return result
    }

    // Font binary by font id. The entity tag includes filesystem identity so a
    // deleted and recreated font invalidates client caches.
    export async function getFontBinary(fontDir: string, fontId: string, ifNoneMatch: string | null): Promise<PreviewFontBinary> {
        const filePath = resolveFontFilePath(fontId, fontDir)
        if (filePath === null) {
            throw new NotFoundException('指定されたフォントが見つかりません。')
        }
        const s = await stat(filePath, { bigint: true })
        const etag = '"' + s.dev.toString(16) + '-' + s.ino.toString(16) + '-' + s.size.toString(16) + '-' + s.mtimeNs.toString(16) + '"'
        const contentType = FONT_CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
        if (ifNoneMatch !== null && ifNoneMatch === etag) {
            return { data: null, contentType, etag }
        }
        return { data: await readFile(filePath), contentType, etag }
    }

}

async function readExistingFile(targetPath: string): Promise<Buffer<ArrayBuffer>> {
    let s
    try {
        s = await stat(targetPath)
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new NotFoundException('対象が見つかりません')
        }
        throw e
    }
    if (!s.isFile()) {
        throw new NotFoundException('対象が見つかりません')
    }
    return await readFile(targetPath)
}

function buildTemplatePayload(templateJson: string, fontDir: string): PreviewTemplatePayload {
    const rawTemplate: unknown = parseTemplateJson(templateJson)
    const template = toCoreTemplate(rawTemplate)
    return { template, fontIds: computeFontIds(rawTemplate, fontDir) }
}

// The exact font id set the print batch loads for this template: the bundled default
// and math fonts plus every referenced font id that resolves to a font file.
function computeFontIds(rawTemplate: unknown, fontDir: string): string[] {
    const result = [DEFAULT_FONT_ID, MATH_FONT_ID]
    const included = new Set(result)
    const index = buildFontFileIndex(fontDir)
    for (const fontId of collectFontIds(rawTemplate)) {
        if (!included.has(fontId) && resolveFontFilePathFromIndex(fontId, index) !== null) {
            included.add(fontId)
            result.push(fontId)
        }
    }
    return result
}

function compareFontEntries(a: PreviewFontEntry, b: PreviewFontEntry): number {
    return a.id.localeCompare(b.id)
}
