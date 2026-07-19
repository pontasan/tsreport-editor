// Folder sharing API (grantee side). Lets a grantee decline a share that was
// pushed onto their workspace view. Scoped to the caller as grantee: a share
// that does not target the caller yields NotFound so its existence is never
// revealed.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FolderShareLogic } from '@/lib/server/logic/folder_share_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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
        await FolderShareLogic.rejectIncomingShare(client, user, shareId)
        return NextResponse.json({})
    })
}
