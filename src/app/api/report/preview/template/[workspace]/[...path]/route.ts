// Preview resource API: published template snapshot.
// Returns the tag snapshot converted to core format together with the font id set
// the print batch loads for it (preview/print parity).

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
        const resolved = ReportApiLogic.splitTemplatePathAndTag(path)
        const payload = await ReportPreviewLogic.getPublishedTemplate(
            client,
            token.fkOAuthClient,
            workspace,
            resolved.templatePath,
            resolved.tag,
            fontDir
        )
        return NextResponse.json(payload)
    })
}
