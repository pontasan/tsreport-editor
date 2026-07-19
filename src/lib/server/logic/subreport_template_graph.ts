import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolveStaticStringExpression } from '@/lib/common/report/subreport_reference'
import { dirnamePosix, normalizeWorkspacePath, resolveWorkspacePath } from '@/lib/common/utils/workspace_path'
import { parseTemplateJson } from '@/lib/common/utils/template_json'
import { workspacesDir } from '@/lib/server/logic/workspace_paths'

type ReportTemplateLike = Record<string, unknown>

type OpenReportTemplateInput = {
    path: string
    template: ReportTemplateLike
}

export type ResolveSubreportTemplateGraphInput = {
    workspace: string
    rootPath: string
    rootTemplate: ReportTemplateLike
    templateExpression: string
    openReportTemplates: OpenReportTemplateInput[]
    // Returns true when the caller is allowed to read the given workspace-
    // relative template path. Child templates loaded from disk are gated by
    // this so a folder-scoped user cannot read templates outside their grant
    // by pointing a subreport reference at another folder. Omitted = allow all
    // (the editor canvas path, which already holds the open template).
    authorizePath?: (path: string) => boolean
}

export type ResolveSubreportTemplateGraphResult = {
    valid: boolean
    message?: string
    templates: Array<{ path: string, template: ReportTemplateLike }>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getTemplateName(template: ReportTemplateLike): string {
    const name = template.name
    return typeof name === 'string' ? name : ''
}

function getTemplateBands(template: ReportTemplateLike): Record<string, unknown>[] {
    const bands = template.bands
    return Array.isArray(bands) ? bands.filter(isObjectRecord) : []
}

function getBandElements(band: Record<string, unknown>): Record<string, unknown>[] {
    const elements = band.elements
    return Array.isArray(elements) ? elements.filter(isObjectRecord) : []
}

function collectSubreportExpressionsFromElements(
    elements: Record<string, unknown>[],
    result: string[],
): void {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]
        if (element.kind === 'subreport' && typeof element.templateExpression === 'string' && element.templateExpression.trim() !== '') {
            result.push(element.templateExpression)
        }
        const children = element.children
        if (Array.isArray(children)) {
            collectSubreportExpressionsFromElements(children.filter(isObjectRecord), result)
        }
    }
}

function collectTemplateSubreportExpressions(template: ReportTemplateLike): string[] {
    const result: string[] = []
    const bands = getTemplateBands(template)
    for (let i = 0; i < bands.length; i++) {
        collectSubreportExpressionsFromElements(getBandElements(bands[i]), result)
    }
    return result
}

function workspaceRoot(workspace: string): string {
    return join(workspacesDir(), workspace)
}

function toWorkspaceAbsolutePath(workspace: string, normalizedPath: string): string | null {
    const wsRoot = workspaceRoot(workspace)
    const targetPath = resolve(join(wsRoot, normalizedPath))
    if (!targetPath.startsWith(wsRoot + '/')) return null
    return targetPath
}

async function readWorkspaceTemplate(workspace: string, path: string): Promise<ReportTemplateLike | null> {
    const absolutePath = toWorkspaceAbsolutePath(workspace, path)
    if (absolutePath === null) return null
    const content = await readFile(absolutePath, 'utf-8')
    const parsed = parseTemplateJson(content)
    return isObjectRecord(parsed) ? parsed : null
}

function buildCycleMessage(paths: string[]): string {
    return 'サブレポートのテンプレート参照が循環しています: ' + paths.join(' -> ')
}

export async function resolveSubreportTemplateGraph(
    input: ResolveSubreportTemplateGraphInput,
): Promise<ResolveSubreportTemplateGraphResult> {
    if (input.workspace.includes('..') || input.workspace.includes('/')) {
        return { valid: false, message: '無効なワークスペースです。', templates: [] }
    }

    const normalizedRootPath = normalizeWorkspacePath(input.rootPath)
    if (normalizedRootPath === null || normalizedRootPath === '') {
        return { valid: false, message: '無効な基準テンプレートパスです。', templates: [] }
    }

    const candidateResolution = resolveStaticStringExpression(input.templateExpression)
    if (!candidateResolution.ok) {
        return { valid: false, message: candidateResolution.message, templates: [] }
    }

    const templatesByPath = new Map<string, ReportTemplateLike>()
    const templatesByName = new Map<string, { path: string, template: ReportTemplateLike }>()

    templatesByPath.set(normalizedRootPath, input.rootTemplate)
    const rootTemplateName = getTemplateName(input.rootTemplate)
    if (rootTemplateName !== '') {
        templatesByName.set(rootTemplateName, { path: normalizedRootPath, template: input.rootTemplate })
    }

    for (let i = 0; i < input.openReportTemplates.length; i++) {
        const entry = input.openReportTemplates[i]
        const normalizedPath = normalizeWorkspacePath(entry.path)
        if (normalizedPath === null || normalizedPath === '') {
            return { valid: false, message: '開いているテンプレートのパスが不正です。', templates: [] }
        }
        templatesByPath.set(normalizedPath, entry.template)
        const templateName = getTemplateName(entry.template)
        if (templateName !== '') {
            templatesByName.set(templateName, { path: normalizedPath, template: entry.template })
        }
    }

    const loadedTemplates = new Map<string, ReportTemplateLike>()
    const visited = new Set<string>()

    function resolveTemplateReference(ref: string, currentPath: string): { ok: true, path: string } | { ok: false, message: string } {
        const byName = templatesByName.get(ref)
        if (byName !== undefined) {
            return { ok: true, path: byName.path }
        }

        const resolvedPath = resolveWorkspacePath(dirnamePosix(currentPath), ref)
        if (resolvedPath === null || resolvedPath === '') {
            return { ok: false, message: `サブレポートのテンプレート参照 "${ref}" を解決できません。` }
        }
        return { ok: true, path: resolvedPath }
    }

    async function getTemplate(path: string): Promise<ReportTemplateLike | null> {
        const overrideTemplate = templatesByPath.get(path)
        if (overrideTemplate !== undefined) return overrideTemplate
        const loaded = loadedTemplates.get(path)
        if (loaded !== undefined) return loaded

        // A template read from disk must be within the caller's access grants;
        // client-supplied override templates (rootTemplate / openReportTemplates)
        // are already in the caller's editor and bypass this check.
        if (input.authorizePath !== undefined && !input.authorizePath(path)) {
            return null
        }
        const template = await readWorkspaceTemplate(input.workspace, path)
        if (template === null) return null
        loadedTemplates.set(path, template)
        const templateName = getTemplateName(template)
        if (templateName !== '' && !templatesByName.has(templateName)) {
            templatesByName.set(templateName, { path, template })
        }
        return template
    }

    async function visitTemplate(path: string, template: ReportTemplateLike, stack: string[]): Promise<string | null> {
        if (path === normalizedRootPath || stack.indexOf(path) !== -1) {
            return buildCycleMessage(stack.concat(path))
        }
        if (visited.has(path)) return null

        const nextStack = stack.concat(path)
        const expressions = collectTemplateSubreportExpressions(template)
        for (let i = 0; i < expressions.length; i++) {
            const resolution = resolveStaticStringExpression(expressions[i])
            if (!resolution.ok) {
                return `サブレポート "${path}" 内のテンプレート式が無効です: ${resolution.message}`
            }
            const resolvedRef = resolveTemplateReference(resolution.value, path)
            if (!resolvedRef.ok) return resolvedRef.message
            const childTemplate = await getTemplate(resolvedRef.path)
            if (childTemplate === null) {
                return `サブレポートのテンプレート "${resolvedRef.path}" が見つかりません。`
            }
            const errorMessage = await visitTemplate(resolvedRef.path, childTemplate, nextStack)
            if (errorMessage !== null) return errorMessage
        }

        visited.add(path)
        return null
    }

    const resolvedCandidate = resolveTemplateReference(candidateResolution.value, normalizedRootPath)
    if (!resolvedCandidate.ok) {
        return { valid: false, message: resolvedCandidate.message, templates: [] }
    }

    const candidateTemplate = await getTemplate(resolvedCandidate.path)
    if (candidateTemplate === null) {
        return { valid: false, message: `サブレポートのテンプレート "${resolvedCandidate.path}" が見つかりません。`, templates: [] }
    }

    const errorMessage = await visitTemplate(resolvedCandidate.path, candidateTemplate, [normalizedRootPath])
    if (errorMessage !== null) {
        return { valid: false, message: errorMessage, templates: [] }
    }

    const templates: Array<{ path: string, template: ReportTemplateLike }> = []
    loadedTemplates.forEach(function (template, path) {
        templates.push({ path, template })
    })
    return { valid: true, templates }
}
