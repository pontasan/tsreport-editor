// Preview resource API: workspace file delivery (images etc.).
// Returns the raw bytes of a current workspace file, resolving references with the
// same semantics as the print batch (workspace-root relative paths).

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { ReportPreviewLogic } from '@/lib/server/logic/report_preview_logic'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ workspace: string, path: string[] }> }
): Promise<NextResponse<Uint8Array | ErrorInfo>> {
    const { workspace, path } = await params

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const token = await ReportApiLogic.checkBearerToken(client, req.headers.get('authorization') ?? '', 'report:preview')
        const file = await ReportPreviewLogic.getWorkspaceFile(
            client,
            token.fkOAuthClient,
            workspace,
            path
        )
        return new NextResponse(file.data, {
            headers: { 'Content-Type': file.contentType }
        })
    })
}
