import { ErrorInfo } from '@/lib/common/exception/error_info';
import { LoginIF } from '@/lib/common/vo/api/auth/login/types';
import { UserAccountConverter } from '@/lib/server/converter/user_account';
import { CommonDao } from '@/lib/server/dao/common';
import { SessionDao } from '@/lib/server/dao/session';
import { Session } from '@/lib/server/entity/session';
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler';
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic'

export async function POST(
    req: NextRequest
): Promise<NextResponse<LoginIF.POST.Response | ErrorInfo>> {
    const {
        userId,
        pass
    }: LoginIF.POST.Request = await req.json()

    return await ServerExceptionHandler.handleWithTx(async (client) => {
        // Check that the account exists
        const loginUser = await AuthLogic.checkAuth(client, userId, pass)

        // Get the current time from the DB (note: precision is truncated to milliseconds once it reaches JavaScript!! the DB uses microseconds)
        const currentTime = await CommonDao.now(client)

        // Generate the token
        const token = uuidv4() + currentTime.getTime()

        const session: Session.Type = {
            ...Session.create(),
            fkUserAccount: loginUser.id,
            token: token,
            createUser: loginUser.id,
            updateUser: loginUser.id,
        }

        await SessionDao.insert(client, session)

        // While at it, also delete old tokens at this point
        await SessionDao.deleteExpiredSession(client)

        // Store the token in the client's cookie ()
        return NextResponse.json({
            loginUser: UserAccountConverter.toVO(loginUser)
        }, {
            status: 200,
            headers: {
                // Match the DB session lifetime (8h) so the cookie and the
                // server-side session expire together.
                'Set-Cookie': `token=${token}; Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=28800;`
            }
        })
    })
}