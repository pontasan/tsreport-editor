import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { ReportApiLogic, TemplateAccessGrantInfo } from '@/lib/server/logic/report_api_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ grants: TemplateAccessGrantInfo[] } | ErrorInfo>> {
    const { id } = await params
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const grants = await ReportApiLogic.listTemplateAccessGrants(client, parseInt(id, 10), user.id!)
        return NextResponse.json({ grants })
    })
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ grant: TemplateAccessGrantInfo } | ErrorInfo>> {
    const { id } = await params
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: CreateTemplateAccessGrantRequest = await req.json()
        const grant = await ReportApiLogic.createTemplateAccessGrant(
            client,
            parseInt(id, 10),
            body.workspace,
            body.path,
            user.id!
        )
        return NextResponse.json({ grant })
    })
}

type CreateTemplateAccessGrantRequest = {
    workspace: string
    path: string
}
