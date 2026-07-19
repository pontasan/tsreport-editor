// Preview resource API: subreport template.
// Resolves the current workspace file (same semantics as the print batch subreport
// resolver), converts it to core format and returns it with its font id set.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { ReportPreviewLogic, type PreviewTemplatePayload } from '@/lib/server/logic/report_preview_logic'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ workspace: string, path: string[] }> }
): Promise<NextResponse<PreviewTemplatePayload | ErrorInfo>> {
    const { workspace, path } = await params

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const token = await ReportApiLogic.checkBearerToken(client, req.headers.get('authorization') ?? '', 'report:preview')
        const fontDir = await ReportApiLogic.resolveClientFontDir(client, token.fkOAuthClient)
        const payload = await ReportPreviewLogic.getSubreportTemplate(
            client,
            token.fkOAuthClient,
            workspace,
            path,
            fontDir
        )
        return NextResponse.json(payload)
    })
}
