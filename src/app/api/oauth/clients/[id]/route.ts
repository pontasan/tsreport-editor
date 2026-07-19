import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { OAuthClientInfo, ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ client: OAuthClientInfo } | ErrorInfo>> {
    const { id } = await params
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: UpdateOAuthClientRequest = await req.json()
        const updated = await ReportApiLogic.updateOAuthClient(client, parseInt(id, 10), body.scopes, body.deleteFlag, user.id!)
        return NextResponse.json({ client: updated })
    })
}

type UpdateOAuthClientRequest = {
    scopes: string
    deleteFlag: boolean
}
