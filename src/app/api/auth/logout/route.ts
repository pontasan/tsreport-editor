import { LogoutIF } from "@/lib/common/vo/api/auth/logout/types";
import { ErrorInfo } from "@/lib/common/exception/error_info";
import { SessionDao } from "@/lib/server/dao/session";
import { ServerExceptionHandler } from "@/lib/server/exception/server_exception_handler";
import { NextUtils } from "@/lib/server/utils/next_utils";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse<LogoutIF.POST.Response | ErrorInfo>> {
    // Invalidate the server-side session so the token cannot be replayed after
    // logout, then clear the cookie. Deleting a missing/expired token is a no-op.
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const token = NextUtils.getCookie(req.cookies, 'token')
        if (token !== '') {
            await SessionDao.deleteSessionByToken(client, token)
        }
        return NextResponse.json({}, {
            status: 200,
            headers: {
                'Set-Cookie': 'token=; Path=/; SameSite=Lax; HttpOnly; Secure;'
            }
        })
    })
}
