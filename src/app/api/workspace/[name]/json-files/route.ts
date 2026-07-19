// JSON file listing API. The [name] segment is the owning account's
// workspaceKey (own workspace, or a workspace shared with the caller). Only
// readable JSON files are returned; for a shared workspace that is limited to
// the shared subtree.

import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { WorkspaceAccess, WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

type JsonFileInfo = {
    path: string
    name: string
}

// Recursively collect readable JSON files. Descends only into directories that
// may contain readable content (own workspace: everything; shared workspace:
// the shared subtree and the ancestors leading to it).
async function scanJson(dir: string, prefix: string, access: WorkspaceAccess, workspaceKey: string, result: JsonFileInfo[]): Promise<void> {
    let items: string[]
    try {
        items = await readdir(dir)
    } catch {
        return
    }
    for (let i = 0; i < items.length; i++) {
        const name = items[i]
        const fullPath = join(dir, name)
        const s = await stat(fullPath).catch(() => null)
        if (s === null) continue
        const relativePath = prefix === '' ? name : prefix + '/' + name
        if (s.isDirectory()) {
            if (!WorkspaceAccessLogic.mayTraverse(access, workspaceKey, relativePath)) continue
            await scanJson(fullPath, relativePath, access, workspaceKey, result)
        } else if (name.endsWith('.json')) {
            if (!WorkspaceAccessLogic.isReadable(access, workspaceKey, relativePath)) continue
            result.push({ path: relativePath, name })
        }
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ name: string }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name } = await params

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)

        const wsRoot = WorkspacePaths.dirForWorkspaceKey(name)
        const jsonFiles: JsonFileInfo[] = []
        if (WorkspaceAccessLogic.mayTraverse(access, name, '')) {
            await scanJson(wsRoot, '', access, name, jsonFiles)
        }
        jsonFiles.sort(function (a, b) { return a.path.localeCompare(b.path) })
        return NextResponse.json({ jsonFiles })
    })
}
