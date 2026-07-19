// Folder sharing API (owner side, per-share). Update the read/write flags of a
// share, or revoke it. Both operations verify the caller owns the share; a
// non-owner gets NotFound so a share's existence is never revealed.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FolderShareLogic } from '@/lib/server/logic/folder_share_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type UpdateShareRequest = {
    canRead: boolean
    canWrite: boolean
    version: number
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const { id } = await params
        const shareId = Number(id)
        if (!Number.isInteger(shareId)) {
            throw new BusinessException('共有IDが不正です。')
        }
        const body: UpdateShareRequest = await req.json()
        await FolderShareLogic.updatePermissions(client, user, shareId, body.canRead === true, body.canWrite === true, body.version)
        return NextResponse.json({})
    })
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const { id } = await params
        const shareId = Number(id)
        if (!Number.isInteger(shareId)) {
            throw new BusinessException('共有IDが不正です。')
        }
        await FolderShareLogic.deleteShare(client, user, shareId)
        return NextResponse.json({})
    })
}
