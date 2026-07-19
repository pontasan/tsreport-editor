import { ErrorInfo } from '@/lib/common/exception/error_info';
import { VerifySessionIF } from '@/lib/common/vo/api/auth/verify_session/types';
import { UserAccountConverter } from '@/lib/server/converter/user_account';
import { SessionDao } from '@/lib/server/dao/session';
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler';
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'

export async function POST(
    req: NextRequest
): Promise<NextResponse<VerifySessionIF.POST.Response | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async (client) => {
        // While at it, clean up unneeded sessions at this point
        await SessionDao.deleteExpiredSession(client)

        const token = req.cookies.get('token')

        // Check that the account exists
        const loginUser = await AuthLogic.checkToken(client, token?.value as string)

        return NextResponse.json({
            isLoggedin: true,
            loginUser: UserAccountConverter.toVO(loginUser)
        })
    })
}