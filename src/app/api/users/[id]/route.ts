import { BusinessException } from '@/lib/common/exception/business_exception'
import { ErrorInfo } from '@/lib/common/exception/error_info'
import { UserAccountVO } from '@/lib/common/vo/entity/user_account'
import { UserAccountConverter } from '@/lib/server/converter/user_account'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { UserAdminLogic } from '@/lib/server/logic/user_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ user: UserAccountVO.Type } | ErrorInfo>> {
    const { id } = await params
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        const body: UpdateUserRequest = await req.json()
        // Accounts are deleted only through the DELETE endpoint (physical delete).
        // Reject the removed deleteFlag field so a stale caller that expects the
        // old soft-delete/restore semantics fails loudly instead of silently
        // leaving the account active.
        if ('deleteFlag' in body) {
            throw new BusinessException('deleteFlag は指定できません。削除は DELETE を使用してください。')
        }
        const updated = await UserAdminLogic.updateUser(
            client, parseInt(id, 10), body.displayName, body.userId, body.adminFlag, body.mcpEnabled, body.pw, body.version, user.id
        )
        return NextResponse.json({ user: UserAccountConverter.toVO(updated) })
    })
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    const { id } = await params
    let files: UserAdminLogic.PurgedAccountFiles | null = null
    const res = await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        files = await UserAdminLogic.deleteUser(client, parseInt(id, 10))
        return NextResponse.json({})
    })
    // Remove the on-disk artifacts only after the purge transaction committed
    // (2xx). A rollback (error response) must leave the files untouched.
    if (files !== null && res.status >= 200 && res.status < 300) {
        await UserAdminLogic.removeAccountFiles(files)
    }
    return res
}

type UpdateUserRequest = {
    displayName: string
    userId: string
    adminFlag: boolean
    mcpEnabled: boolean
    // Empty string keeps the current password.
    pw: string
    version: number
}
