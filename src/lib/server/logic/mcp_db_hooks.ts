import { DbUtils } from '@/lib/server/utils/db_utils'
import { FolderShareLogic } from './folder_share_logic'
import { WorkspaceActivityLogic } from './workspace_activity_logic'
import { PrintHistoryLogic } from './print_history_logic'
import type { McpAccess } from './mcp_logic'

// The database-backed side effects an MCP transport hands to
// McpLogic.handleMessage. McpLogic's tools are deliberately database-free (so
// they stay unit-testable); the DB work lives here and is shared by both MCP
// transports (the Next route and the dedicated listener) so the two can never
// diverge on the security-relevant share follow or the print history record.
export type McpDbHooks = {
    onFileEvent: (workspace: string, path: string, action: 'save' | 'delete', isDirectory: boolean) => Promise<void>,
    onFileMove: (workspace: string, previousPath: string, path: string, isDirectory: boolean) => Promise<void>,
    onDraftEvent: (workspace: string, path: string, draftKind: 'report' | 'json', content: string) => Promise<void>,
    recordPrint: (workspace: string, templatePath: string, format: string, pdfBytes: Uint8Array) => Promise<void>,
}

export function buildMcpDbHooks(access: McpAccess): McpDbHooks {
    const account = access.user !== null ? access.user.userId : ''
    return {
        onFileEvent: async function (workspace, path, action, isDirectory) {
            await DbUtils.transaction(async function (client) {
                if (action === 'delete' && isDirectory) {
                    // Follow the owner's folder shares so a deleted folder cannot
                    // leave shares that re-attach to a later same-named folder.
                    await FolderShareLogic.onOwnerFolderDeleted(client, workspace, path)
                }
                await WorkspaceActivityLogic.publishFile(client, {
                    workspace, path, action, isDirectory, account, via: 'mcp', instance: ''
                })
            })
        },
        onFileMove: async function (workspace, previousPath, path, isDirectory) {
            await DbUtils.transaction(async function (client) {
                if (isDirectory) {
                    await FolderShareLogic.onOwnerFolderRenamed(client, workspace, previousPath, path)
                }
                await WorkspaceActivityLogic.publishRename(client, {
                    workspace, previousPath, path, isDirectory, account, via: 'mcp', instance: ''
                })
            })
        },
        onDraftEvent: async function (workspace, path, draftKind, content) {
            await DbUtils.transaction(async function (client) {
                await WorkspaceActivityLogic.publishDraft(client, { workspace, path, draftKind, content, account })
            })
        },
        recordPrint: async function (workspace, templatePath, format, pdfBytes) {
            if (access.user === null) return
            const userId = access.user.id!
            await DbUtils.transaction(async function (client) {
                await PrintHistoryLogic.recordCompleted(client, userId, 'mcp', workspace, templatePath, format, 'mcp:render_report', pdfBytes)
            })
        },
    }
}
