import { BusinessException } from '@/lib/common/exception/business_exception'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { OAuthClientDao } from '@/lib/server/dao/OAuthClient'
import { PrintRequestDao } from '@/lib/server/dao/PrintRequest'
import { TemplateTagDao } from '@/lib/server/dao/TemplateTag'
import { UserAccountDao } from '@/lib/server/dao/user_account'
import { PrintRequest } from '@/lib/server/entity/PrintRequest'
import { TemplateTag } from '@/lib/server/entity/TemplateTag'
import { UserAccount } from '@/lib/server/entity/user_account'
import { WorkspaceAccessLogic, type WorkspaceAccess } from '@/lib/server/logic/workspace_access_logic'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { mkdir, writeFile } from 'fs/promises'
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { ClientBase } from 'pg'
import SQL from 'sql-template-strings'
import { createNodeExternalRasterImageDecoder, createReport, Font, renderToPdf, type DataSource, type FontMap, type RenderDocument, type ReportTemplate as CoreTemplate, type SubreportTemplateResolver } from 'tsreport-core'
import { collectLoadedFonts, ensureFont, fontDirForAccount, listAccountFontIds } from './font_resolver'
import { parseTemplateJson } from '@/lib/common/utils/template_json'
import { convertEditorTemplateToCore } from '../../../app/[lang]/editor/template_converter'
import { normalizeTemplate, type ReportTemplate as EditorTemplate } from '../../../app/[lang]/editor/reducer'

// Re-exported for existing importers (preview logic, MCP).
export {
    DEFAULT_FONT_ID,
    LEGACY_DEFAULT_FONT_ID,
    LEGACY_MATH_FONT_ID,
    MATH_FONT_ID,
    INTERNAL_FONT_IDS,
    buildFontFileIndex,
    builtinFontFilePath,
    fontDirForAccount,
    listAccountFontIds,
    resolveFontFilePath,
    resolveFontFilePathFromIndex,
} from './font_resolver'

const BATCH_LOCK_KEY = 'report-print'
const DEFAULT_LIMIT = 100
const OUTPUT_DIR = '/var/nfs/report-pdf'
import { DEFAULT_FONT_ID, MATH_FONT_ID } from './font_resolver'
import { WorkspacePaths } from './workspace_paths'

type ApiDataSource = DataSource & Record<string, unknown>

export namespace ReportBatchLogic {

    export async function processQueuedRequests(): Promise<number> {
        return await DbUtils.transaction(async function (lockClient) {
            const locked = await tryAcquireBatchLock(lockClient)
            if (!locked) {
                return 0
            }
            try {
                // Fetch the queue in a separate connection scope while this session
                // holds the advisory lock.
                const queued = await DbUtils.transaction(async function (client) {
                    return await PrintRequestDao.listQueued(client, DEFAULT_LIMIT)
                })

                for (let i = 0; i < queued.length; i++) {
                    await processOne(queued[i]!)
                }
                return queued.length
            } finally {
                await releaseBatchLock(lockClient)
            }
        })
    }

    // Renders a template JSON with a request body JSON into a laid-out document.
    // Fonts resolve against the acting account's font directory (fontDir) plus the
    // internal drawing fonts; images and subreport templates resolve against the
    // workspace root. Shared by the print batch and the MCP layout/preview tools
    // so every consumer sees identical output.
    // authorizeAsset gates every workspace-relative asset the template pulls in
    // (images and referenced subreport templates) beyond the whole-workspace
    // confinement, to the acting account's effective read access. It is required
    // (build WorkspaceAccessLogic.assetAuthorizer from the account's access) so
    // no call site can accidentally render without tenant confinement: a crafted
    // "../" reference from a shared subtree cannot reach files outside the share.
    export function renderTemplateToDocument(
        workspaceRoot: string,
        templatePath: string,
        templateJson: string,
        requestBodyJson: string,
        fontDir: string,
        authorizeAsset: (relativePath: string) => boolean
    ): { doc: RenderDocument, fonts: Record<string, Font> } {
        const rawTemplate: unknown = parseTemplateJson(templateJson)
        const coreTemplate = toCoreTemplate(rawTemplate)
        const rawBody: unknown = JSON.parse(requestBodyJson)
        const dataSource = toDataSource(rawBody)

        // Reproduce the editor preview environment on the server:
        // - internal drawing fonts + the template's fonts (from the account dir)
        // - workingDirectory = the template's directory, so relative image refs
        //   resolve through the confined image resolver against the workspace files
        // - subreport templates resolved from the same workspace (fonts loaded on demand)
        const fontMap: FontMap = new Map()
        ensureFont(fontMap, DEFAULT_FONT_ID, fontDir)
        ensureFont(fontMap, MATH_FONT_ID, fontDir)
        collectFontIds(rawTemplate).forEach(function (fontId) { ensureFont(fontMap, fontId, fontDir) })

        const workingDirectory = resolve(join(workspaceRoot, dirnamePosix(templatePath)))

        const doc = createReport(coreTemplate, dataSource, {
            fontMap,
            workingDirectory,
            resources: { resolveImage: createServerImageResolver(workspaceRoot, workingDirectory, authorizeAsset) },
            resolveSubreportTemplate: createServerSubreportResolver(workspaceRoot, coreTemplate, fontMap, fontDir, authorizeAsset),
        })

        return { doc, fonts: collectLoadedFonts(fontMap, fontDir) }
    }

    export function renderTemplateToPdf(
        workspaceRoot: string,
        templatePath: string,
        templateJson: string,
        requestBodyJson: string,
        fontDir: string,
        authorizeAsset: (relativePath: string) => boolean
    ): Uint8Array {
        const { doc, fonts } = renderTemplateToDocument(workspaceRoot, templatePath, templateJson, requestBodyJson, fontDir, authorizeAsset)
        // WebP/AVIF pixel decoding is injected here (sharp-backed); PNG decodes in pure TypeScript inside core
        return renderToPdf(doc, { fonts, images: doc.images, rasterImageDecoder: createNodeExternalRasterImageDecoder() })
    }

    // User-selectable font ids for an account (its font directory only; the
    // internal drawing fonts are excluded because they are not selectable).
    export function listAvailableFontIds(fontDir: string): string[] {
        return listAccountFontIds(fontDir)
    }

}

async function processOne(request: PrintRequest.Type): Promise<void> {
    try {
        await DbUtils.transaction(async function (client) {
            const marked = await PrintRequestDao.markProcessing(client, request)
            if (marked !== 1) {
                // Already picked up by another run (should not happen under the batch lock) — skip, do not overwrite its state.
                return
            }

            // Queued requests are always API prints, so they carry the tag FK.
            if (request.fkTemplateTag === undefined) {
                throw new BusinessException('API公開タグが見つかりません。')
            }
            const templateTag = await TemplateTagDao.getById(client, request.fkTemplateTag)
            if (templateTag === undefined) {
                throw new BusinessException('API公開タグが見つかりません。')
            }

            // Resolve the account that owns the requesting OAuth client: its
            // fonts render the report and its effective access bounds every asset
            // the template pulls in.
            const owner = await resolvePrintRequestOwner(client, request)
            const access = await WorkspaceAccessLogic.loadAccess(client, owner)
            const fontDir = fontDirForAccount(owner.id!)
            // Re-verify the template is still readable at processing time: a share
            // granting access may have been revoked between enqueue and now.
            if (!WorkspaceAccessLogic.isReadable(access, templateTag.workspace, templateTag.templatePath)) {
                throw new ForbiddenException()
            }
            const pdfBytes = renderRequestToPdf(templateTag, request.requestBodyJson, fontDir, access)
            await mkdir(OUTPUT_DIR, { recursive: true })
            const pdfPath = join(OUTPUT_DIR, request.key + '.pdf')
            await writeFile(pdfPath, pdfBytes)
            await PrintRequestDao.markCompleted(client, request, pdfPath)
        })
    } catch (e) {
        // Requirement: record the failure reason and flip the status in a separate transaction.
        await DbUtils.transaction(async function (client) {
            await PrintRequestDao.markError(client, request.id!, errorMessage(e))
        })
    }
}

// The account that owns the print request's OAuth client.
async function resolvePrintRequestOwner(client: ClientBase, request: PrintRequest.Type): Promise<UserAccount.Type> {
    if (request.fkOAuthClient === undefined) {
        throw new BusinessException('印字リクエストの所有アカウントを解決できません。')
    }
    const oauthClient = await OAuthClientDao.getById(client, request.fkOAuthClient)
    if (oauthClient === undefined || oauthClient.fkUserAccount === undefined) {
        throw new BusinessException('印字リクエストの所有アカウントを解決できません。')
    }
    const owner = await UserAccountDao.getById(client, oauthClient.fkUserAccount)
    if (owner === undefined) {
        throw new BusinessException('印字リクエストの所有アカウントを解決できません。')
    }
    // Defense in depth against a disabled client landing between enqueue and now.
    // A deleted owner account is physically gone, so getById above already
    // rejected it; only the client's own disable flag remains to check here.
    if (oauthClient.deleteFlag) {
        throw new ForbiddenException()
    }
    return owner
}

function renderRequestToPdf(templateTag: TemplateTag.Type, requestBodyJson: string, fontDir: string, access: WorkspaceAccess): Uint8Array {
    const workspaceRoot = WorkspacePaths.dirForWorkspaceKey(templateTag.workspace)
    // Gate every workspace-relative asset the template references to what the
    // owning account can actually read, so a crafted "../" reference from a
    // shared subtree cannot escape into the sharer's private files.
    const authorizeAsset = WorkspaceAccessLogic.assetAuthorizer(access, templateTag.workspace)
    return ReportBatchLogic.renderTemplateToPdf(workspaceRoot, templateTag.templatePath, templateTag.templateJson, requestBodyJson, fontDir, authorizeAsset)
}

// Resolves subreport template references against the tag's workspace on the file system.
// Mirrors the editor's createEditorSubreportResolver: name lookup first, then a path
// relative to the referencing template's directory. Fonts used by loaded subreport
// templates are added to the shared fontMap before the engine lays them out.
function createServerSubreportResolver(
    workspaceRoot: string,
    rootTemplate: CoreTemplate,
    fontMap: FontMap,
    fontDir: string,
    authorizeAsset: (relativePath: string) => boolean
): SubreportTemplateResolver {
    const templatesByName = new Map<string, { template: CoreTemplate, workingDirectory: string }>()
    const templatesByPath = new Map<string, CoreTemplate>()
    if (typeof rootTemplate.name === 'string' && rootTemplate.name !== '') {
        templatesByName.set(rootTemplate.name, { template: rootTemplate, workingDirectory: workspaceRoot })
    }

    return function resolveSubreportTemplate(ref, context) {
        const byName = templatesByName.get(ref)
        if (byName !== undefined) {
            return { template: byName.template, workingDirectory: byName.workingDirectory }
        }

        const absolutePath = resolve(context.workingDirectory, ref)
        if (absolutePath !== workspaceRoot && !absolutePath.startsWith(workspaceRoot + '/')) {
            throw new BusinessException(`サブレポートのテンプレート参照 "${ref}" がワークスペース外を指しています。`)
        }
        if (!authorizeAsset(workspaceRelativePath(workspaceRoot, absolutePath))) {
            throw new BusinessException(`サブレポートのテンプレート参照 "${ref}" へのアクセス権がありません。`)
        }

        const cached = templatesByPath.get(absolutePath)
        if (cached !== undefined) {
            return { template: cached, workingDirectory: dirname(absolutePath) }
        }

        const rawTemplate: unknown = JSON.parse(readFileSync(absolutePath, 'utf-8'))
        const template = toCoreTemplate(rawTemplate)
        collectFontIds(rawTemplate).forEach(function (fontId) { ensureFont(fontMap, fontId, fontDir) })
        templatesByPath.set(absolutePath, template)
        if (typeof template.name === 'string' && template.name !== '') {
            templatesByName.set(template.name, { template, workingDirectory: dirname(absolutePath) })
        }
        return { template, workingDirectory: dirname(absolutePath) }
    }
}

// Confines server-side image resolution to the workspace. The core default
// resolver would otherwise read any file reachable from workingDirectory via
// "../" or an absolute/file:// path, so a template with a crafted image source
// could exfiltrate arbitrary server files into the rendered output. Data URIs
// and http(s) refs are handled by the core resolver before this is consulted;
// here only workspace-relative file references are honored.
function createServerImageResolver(workspaceRoot: string, workingDirectory: string, authorizeAsset: (relativePath: string) => boolean): (ref: string) => Uint8Array | null {
    return function resolveImage(ref: string): Uint8Array | null {
        if (ref === '') return null
        // Reject anything that is not a plain relative path (absolute paths,
        // file:// / data: / http(s):// schemes, Windows paths). A colon never
        // appears in a legitimate workspace-relative reference.
        if (ref.indexOf(':') !== -1 || ref.startsWith('/') || ref.startsWith('\\')) return null
        const absolutePath = resolve(workingDirectory, ref)
        if (absolutePath !== workspaceRoot && !absolutePath.startsWith(workspaceRoot + '/')) return null
        if (!authorizeAsset(workspaceRelativePath(workspaceRoot, absolutePath))) return null
        try {
            const data = readFileSync(absolutePath)
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        } catch {
            return null
        }
    }
}

// Exported so the preview resource API converts templates with the exact same rules as the batch.
export function toCoreTemplate(template: unknown): CoreTemplate {
    if (isEditorTemplate(template)) {
        // The editor always normalizes raw JSON when opening a file (form.tsx), so
        // tag snapshots and workspace .report files must pass through the same
        // normalization before conversion.
        return convertEditorTemplateToCore(normalizeTemplate(template))
    }
    if (isCoreTemplate(template)) {
        return template
    }
    throw new BusinessException('テンプレートJSONの形式が不正です。')
}

function isEditorTemplate(value: unknown): value is EditorTemplate {
    return isRecord(value) && Array.isArray(value.bands)
}

function isCoreTemplate(value: unknown): value is CoreTemplate {
    return isRecord(value) && isRecord(value.page) && isRecord(value.bands)
}

function toDataSource(value: unknown): ApiDataSource {
    if (Array.isArray(value)) {
        return { rows: recordsFromArray(value) }
    }
    if (!isRecord(value)) {
        throw new BusinessException('リクエストボディJSONはオブジェクトまたは配列である必要があります。')
    }
    if (Array.isArray(value.rows)) {
        const dataSource: ApiDataSource = { rows: recordsFromArray(value.rows) }
        if (isRecord(value.parameters)) dataSource.parameters = value.parameters
        if (isRecord(value.resources)) dataSource.resources = resourcesFromRecord(value.resources)
        return dataSource
    }
    return { rows: [value] }
}

function recordsFromArray(values: unknown[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = []
    for (let i = 0; i < values.length; i++) {
        const row = values[i]
        if (!isRecord(row)) {
            throw new BusinessException('rowsにはオブジェクト配列を指定してください。')
        }
        result.push(row)
    }
    return result
}

function resourcesFromRecord(value: Record<string, unknown>): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {}
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!
        const entry = value[key]
        if (!isRecord(entry)) {
            throw new BusinessException('resourcesには文字列マップを指定してください。')
        }
        const child: Record<string, string> = {}
        const childKeys = Object.keys(entry)
        for (let j = 0; j < childKeys.length; j++) {
            const childKey = childKeys[j]!
            const childValue = entry[childKey]
            if (typeof childValue !== 'string') {
                throw new BusinessException('resourcesには文字列マップを指定してください。')
            }
            child[childKey] = childValue
        }
        result[key] = child
    }
    return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Collects font identifiers referenced anywhere in a template JSON tree.
// fontFamily (styles/elements), mathFontFamily (math elements) and fontName
// (markup styled-text attribute mirrored into element defs) are the reference keys.
// Exported so the preview resource API computes the same font id set as the batch.
export function collectFontIds(template: unknown): Set<string> {
    const result = new Set<string>()
    collectFontIdsWalk(template, result)
    return result
}

function collectFontIdsWalk(value: unknown, result: Set<string>): void {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            collectFontIdsWalk(value[i], result)
        }
        return
    }
    if (!isRecord(value)) return
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!
        const child = value[key]
        if ((key === 'fontFamily' || key === 'mathFontFamily' || key === 'fontName') && typeof child === 'string' && child !== '') {
            result.add(child)
        } else {
            collectFontIdsWalk(child, result)
        }
    }
}

function dirnamePosix(path: string): string {
    const idx = path.lastIndexOf('/')
    return idx === -1 ? '' : path.substring(0, idx)
}

// Converts an absolute path known to be inside workspaceRoot back to the path
// relative to the workspace root ('' for the root itself), so it can be checked
// against the caller's share-scoped access.
function workspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
    if (absolutePath === workspaceRoot) {
        return ''
    }
    return absolutePath.substring(workspaceRoot.length + 1)
}

async function tryAcquireBatchLock(client: ClientBase): Promise<boolean> {
    const result = await client.query(SQL`SELECT pg_try_advisory_lock(hashtext(${BATCH_LOCK_KEY})) AS "locked"`)
    return result.rows[0].locked === true
}

async function releaseBatchLock(client: ClientBase): Promise<void> {
    await client.query(SQL`SELECT pg_advisory_unlock(hashtext(${BATCH_LOCK_KEY}))`)
}

function errorMessage(e: unknown): string {
    if (e instanceof Error) {
        return e.message
    }
    return String(e)
}
