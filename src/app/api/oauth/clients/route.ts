import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { OAuthClientInfo, ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse<{ clients: OAuthClientInfo[] } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const clients = await ReportApiLogic.listOAuthClients(client, user.id!)
        return NextResponse.json({ clients })
    })
}

export async function POST(req: NextRequest): Promise<NextResponse<{ client: OAuthClientInfo } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: CreateOAuthClientRequest = await req.json()
        const created = await ReportApiLogic.createOAuthClient(client, body.clientId, body.scopes, user.id!)
        return NextResponse.json({ client: created })
    })
}

type CreateOAuthClientRequest = {
    clientId: string
    scopes: string
}
