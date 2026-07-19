import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { UserAdminLogic } from '@/lib/server/logic/user_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Changes the password of the logged-in user (available to every account).
export async function PUT(req: NextRequest): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: ChangeOwnPasswordRequest = await req.json()
        await UserAdminLogic.changeOwnPassword(client, user, body.currentPw, body.newPw)
        return NextResponse.json({})
    })
}

type ChangeOwnPasswordRequest = {
    currentPw: string
    newPw: string
}
