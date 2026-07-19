// Self-service account settings: edit own display name, or delete own account
// (退会). Available to every authenticated account; not admin-gated.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { UserAccountVO } from '@/lib/common/vo/entity/user_account'
import { UserAccountConverter } from '@/lib/server/converter/user_account'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { UserAdminLogic } from '@/lib/server/logic/user_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Returns the caller's own account, including its workspaceKey (the share key
// the user hands to others to receive folder access).
export async function GET(req: NextRequest): Promise<NextResponse<{ user: UserAccountVO.Type } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        return NextResponse.json({ user: UserAccountConverter.toVO(user) })
    })
}

export async function PATCH(req: NextRequest): Promise<NextResponse<{ user: UserAccountVO.Type } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: { displayName?: string, defaultColorMode?: string } = await req.json()
        let updated = user
        if (body.displayName !== undefined) {
            updated = await UserAdminLogic.updateOwnDisplayName(client, updated, body.displayName)
        }
        if (body.defaultColorMode !== undefined) {
            updated = await UserAdminLogic.updateOwnDefaultColorMode(client, updated, body.defaultColorMode)
        }
        return NextResponse.json({ user: UserAccountConverter.toVO(updated) })
    })
}

export async function DELETE(req: NextRequest): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    let files: UserAdminLogic.PurgedAccountFiles | null = null
    const res = await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        files = await UserAdminLogic.deleteOwnAccount(client, user)
        // The session is revoked server-side; also clear the cookie.
        return NextResponse.json({}, {
            headers: { 'Set-Cookie': 'token=; Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=0;' }
        })
    })
    // Remove the on-disk artifacts only after the purge transaction committed.
    if (files !== null && res.status >= 200 && res.status < 300) {
        await UserAdminLogic.removeAccountFiles(files)
    }
    return res
}
