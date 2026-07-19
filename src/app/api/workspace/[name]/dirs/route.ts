// Directory creation API. The [name] segment is the owning account's
// workspaceKey.

import { mkdir, stat } from 'fs/promises'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { WorkspaceActivityLogic } from '@/lib/server/logic/workspace_activity_logic'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ name: string }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name } = await params

        const body = await request.json()
        const subPath: string = body.path
        if (typeof subPath !== 'string' || subPath.length === 0) {
            throw new BusinessException('無効なパスです')
        }

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkWrite(access, name, subPath)

        const targetPath = WorkspacePaths.resolveInside(name, subPath)

        const s = await stat(targetPath).catch(() => null)
        if (s !== null && !s.isDirectory()) {
            throw new BusinessException('同名のファイルが既に存在します')
        }
        await mkdir(targetPath, { recursive: true })
        await WorkspaceActivityLogic.publishFile(client, {
            workspace: name,
            path: subPath,
            action: 'save',
            isDirectory: true,
            account: user.userId,
            via: 'editor',
            instance: request.headers.get('x-editor-instance') ?? ''
        })
        return NextResponse.json({ path: subPath })
    })
}
