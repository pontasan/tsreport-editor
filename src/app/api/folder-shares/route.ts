// Folder sharing API (owner side). The caller shares folders inside its own
// workspace with other accounts, addressed by the grantee's workspaceKey.
//
// GET  ?path=<folder>  — list the shares the caller has granted on that folder.
// POST { path, granteeWorkspaceKey, canRead, canWrite } — grant (or update) a
//      share. Unknown grantee / self-share resolve to { ok: false } so account
//      existence never leaks.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FolderShareDao } from '@/lib/server/dao/FolderShare'
import { FolderShareLogic } from '@/lib/server/logic/folder_share_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse<{ shares: FolderShareDao.OutgoingRow[] } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const path = req.nextUrl.searchParams.get('path') ?? ''
        const shares = await FolderShareLogic.listOutgoingShares(client, user, path)
        return NextResponse.json({ shares })
    })
}

type CreateShareRequest = {
    path: string
    granteeWorkspaceKey: string
    canRead: boolean
    canWrite: boolean
}

export async function POST(req: NextRequest): Promise<NextResponse<{ ok: boolean } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: CreateShareRequest = await req.json()
        const result = await FolderShareLogic.createShareByKey(
            client,
            user,
            body.path,
            body.granteeWorkspaceKey,
            body.canRead === true,
            body.canWrite === true
        )
        return NextResponse.json(result)
    })
}
