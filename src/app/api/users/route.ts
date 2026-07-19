import { ErrorInfo } from '@/lib/common/exception/error_info'
import { UserAccountVO } from '@/lib/common/vo/entity/user_account'
import { UserAccountConverter } from '@/lib/server/converter/user_account'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { UserAdminLogic } from '@/lib/server/logic/user_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse<{ users: UserAccountVO.Type[] } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        const users = await UserAdminLogic.listUsers(client)
        return NextResponse.json({ users: users.map(UserAccountConverter.toVO) })
    })
}

export async function POST(req: NextRequest): Promise<NextResponse<{ user: UserAccountVO.Type } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        const body: CreateUserRequest = await req.json()
        const created = await UserAdminLogic.createUser(client, body.displayName, body.userId, body.pw, body.adminFlag, user.id)
        return NextResponse.json({ user: UserAccountConverter.toVO(created) })
    })
}

type CreateUserRequest = {
    displayName: string
    userId: string
    pw: string
    adminFlag: boolean
}
