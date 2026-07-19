// File delivery, delete, and rename API. The [name] segment is the owning
// account's workspaceKey.

import { readFile, rename, rm, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FolderShareLogic } from '@/lib/server/logic/folder_share_logic'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { WorkspaceActivityLogic } from '@/lib/server/logic/workspace_activity_logic'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { detectFileType } from '@/lib/server/utils/file_type_detector'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ name: string; path: string[] }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name, path } = await params
        const relativePath = path.join('/')
        const targetPath = WorkspacePaths.resolveInside(name, relativePath)

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkRead(access, name, relativePath)

        const s = await stat(targetPath).catch(() => null)
        if (s === null || !s.isFile()) {
            throw new BusinessException('対象が見つかりません')
        }

        const data = await readFile(targetPath)
        const result = detectFileType(data)

        if (request.nextUrl.searchParams.has('info')) {
            return NextResponse.json({ category: result.category, mimeType: result.mimeType })
        }

        return new NextResponse(data, {
            headers: { 'Content-Type': result.mimeType }
        })
    })
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ name: string; path: string[] }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name, path } = await params
        const relativePath = path.join('/')
        // Delete must target a concrete entry, never the workspace root.
        const targetPath = WorkspacePaths.resolveEntryInside(name, relativePath)

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkWrite(access, name, relativePath)

        const s = await stat(targetPath).catch(() => null)
        if (s === null) {
            throw new BusinessException('対象が見つかりません')
        }

        if (s.isDirectory()) {
            // Drop any shares the workspace owner granted on this folder subtree
            // BEFORE removing it, so a failure leaves nothing deleted rather than a
            // gone folder whose shares linger and re-attach to a later same-named
            // folder. Runs in this transaction; the rm is the last, committing step.
            await FolderShareLogic.onOwnerFolderDeleted(client, name, relativePath)
        }
        await WorkspaceActivityLogic.publishFile(client, {
            workspace: name,
            path: relativePath,
            action: 'delete',
            isDirectory: s.isDirectory(),
            account: user.userId,
            via: 'editor',
            instance: request.headers.get('x-editor-instance') ?? ''
        })
        await rm(targetPath, { recursive: s.isDirectory() })
        return NextResponse.json({ deleted: relativePath })
    })
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ name: string; path: string[] }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name, path } = await params
        const relativePath = path.join('/')
        // Rename must target a concrete entry, never the workspace root.
        const targetPath = WorkspacePaths.resolveEntryInside(name, relativePath)

        const body = await request.json()
        const newName: string = body.newName
        if (typeof newName !== 'string' || newName.length === 0 || newName.includes('..') || newName.includes('/')) {
            throw new BusinessException('無効な名前です')
        }

        // Both the source and the renamed path must be writable.
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkWrite(access, name, relativePath)
        const newRelativePath = path.slice(0, path.length - 1).concat([newName]).join('/')
        WorkspaceAccessLogic.checkWrite(access, name, newRelativePath)

        const s = await stat(targetPath).catch(() => null)
        if (s === null) {
            throw new BusinessException('対象が見つかりません')
        }

        const parentDir = dirname(targetPath)
        const newPath = join(parentDir, newName)

        // Verify that the rename target does not already exist.
        const destStat = await stat(newPath).catch(() => null)
        if (destStat !== null) {
            throw new BusinessException('同名のファイルまたはディレクトリが既に存在します')
        }

        await rename(targetPath, newPath)
        if (s.isDirectory()) {
            // Repoint the workspace owner's shares from the old folder subtree to
            // the new one so grantees keep access to the moved folder.
            await FolderShareLogic.onOwnerFolderRenamed(client, name, relativePath, newRelativePath)
        }
        await WorkspaceActivityLogic.publishRename(client, {
            workspace: name,
            previousPath: relativePath,
            path: newRelativePath,
            isDirectory: s.isDirectory(),
            account: user.userId,
            via: 'editor',
            instance: request.headers.get('x-editor-instance') ?? ''
        })
        return NextResponse.json({ renamed: newName })
    })
}
