import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Upper bound on the print data payload so an authenticated client cannot
// exhaust memory with an unbounded JSON body. Structured report data rarely
// approaches this; kept in sync with the nginx /api/report/print/ limit.
const MAX_PRINT_BODY_BYTES = 16 * 1024 * 1024

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ workspace: string, path: string[] }> }
): Promise<NextResponse<{ key: string } | ErrorInfo>> {
    const { workspace, path } = await params

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        // Authenticate before touching the request body so unauthenticated calls never parse payloads.
        const token = await ReportApiLogic.checkBearerToken(client, req.headers.get('authorization') ?? '', 'report:print')
        const resolved = ReportApiLogic.splitTemplatePathAndTag(path)
        // Bounded read (throws if oversized) before parsing, so the size error is
        // distinct from a JSON-syntax error.
        const rawBody = await NextUtils.readBodyText(req, MAX_PRINT_BODY_BYTES)
        let body: unknown
        try {
            body = JSON.parse(rawBody)
        } catch {
            throw new BusinessException('リクエストボディが正しいJSONではありません。')
        }
        const key = await ReportApiLogic.enqueuePrintRequest(
            client,
            workspace,
            resolved.templatePath,
            resolved.tag,
            req.nextUrl.pathname,
            token.fkOAuthClient,
            body
        )
        return NextResponse.json({ key })
    })
}
