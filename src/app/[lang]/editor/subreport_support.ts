import type { CreateReportOptions, ReportTemplate as CoreReportTemplate } from 'tsreport-core'
import type { ReportTemplate } from './reducer'
import { resolveEditorWorkspacePath, type EditorCurrentFile } from './resource_resolver'
import { convertEditorTemplateToCore } from './template_converter'
import { dirnamePosix } from '@/lib/common/utils/workspace_path'

export type OpenReportTemplate = { path: string, template: ReportTemplate }

export function createEditorSubreportResolver(
    file: EditorCurrentFile | null,
    rootTemplate: ReportTemplate,
    availableTemplates: OpenReportTemplate[],
): CreateReportOptions['resolveSubreportTemplate'] | undefined {
    const templatesByPath = new Map<string, ReportTemplate>()
    const templatesByName = new Map<string, { path: string, template: ReportTemplate }>()

    if (file !== null) {
        templatesByPath.set(file.path, rootTemplate)
        if (rootTemplate.name !== '') {
            templatesByName.set(rootTemplate.name, { path: file.path, template: rootTemplate })
        }
    }

    for (let i = 0; i < availableTemplates.length; i++) {
        const entry = availableTemplates[i]
        templatesByPath.set(entry.path, entry.template)
        if (entry.template.name !== '') {
            templatesByName.set(entry.template.name, entry)
        }
    }

    if (templatesByPath.size === 0 && templatesByName.size === 0) return undefined

    return function resolveSubreportTemplate(ref: string): { template: CoreReportTemplate, workingDirectory?: string } | null {
        const byName = templatesByName.get(ref)
        if (byName !== undefined) {
            return {
                template: convertEditorTemplateToCore(byName.template),
                workingDirectory: dirnamePosix(byName.path),
            }
        }

        const resolvedPath = resolveEditorWorkspacePath(ref, file)
        if (resolvedPath === null) return null

        const byPath = templatesByPath.get(resolvedPath)
        if (byPath === undefined) return null
        return {
            template: convertEditorTemplateToCore(byPath),
            workingDirectory: dirnamePosix(resolvedPath),
        }
    }
}
