// Workspace overview API. Returns the caller's own workspace, the folders other
// accounts have shared with it, and which of its own folders it has shared out.
// There is no workspace creation: each account owns exactly one workspace,
// provisioned when the account is created.

import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FolderShareDao } from '@/lib/server/dao/FolderShare'
import { FolderShareLogic } from '@/lib/server/logic/folder_share_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))

        const incoming = await FolderShareLogic.listIncomingShares(client, user)
        const sharedIn = []
        for (let i = 0; i < incoming.length; i++) {
            sharedIn.push({
                id: incoming[i].id,
                ownerWorkspaceKey: incoming[i].ownerWorkspaceKey,
                ownerLabel: incoming[i].ownerDisplayName,
                path: incoming[i].path,
                canRead: incoming[i].canRead,
                canWrite: incoming[i].canWrite
            })
        }

        const outgoing = await FolderShareDao.listByOwner(client, user.id!)
        const sharedOutPaths: string[] = []
        for (let i = 0; i < outgoing.length; i++) {
            if (sharedOutPaths.indexOf(outgoing[i].path) === -1) {
                sharedOutPaths.push(outgoing[i].path)
            }
        }

        return NextResponse.json({
            own: { workspaceKey: user.workspaceKey, label: user.displayName },
            sharedIn,
            sharedOutPaths
        })
    })
}
