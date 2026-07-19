import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ key: string }> }
): Promise<NextResponse<PrintStatusResponse | ErrorInfo>> {
    const { key } = await params
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const token = await ReportApiLogic.checkBearerToken(client, req.headers.get('authorization') ?? '', 'report:status')
        const request = await ReportApiLogic.getPrintRequestByKey(client, key, token.fkOAuthClient)
        return NextResponse.json({
            key: request.key,
            status: request.status,
            errorReason: request.errorReason
        })
    })
}

type PrintStatusResponse = {
    key: string
    status: string
    errorReason?: string
}
