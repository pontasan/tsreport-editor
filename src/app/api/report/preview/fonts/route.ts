// Preview resource API: font catalog.
// Lists the editor-bundled fonts plus the server font directory using the same
// index rules as the print batch.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { ReportPreviewLogic, type PreviewFontEntry } from '@/lib/server/logic/report_preview_logic'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest
): Promise<NextResponse<{ fonts: PreviewFontEntry[] } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const token = await ReportApiLogic.checkBearerToken(client, req.headers.get('authorization') ?? '', 'report:preview')
        const fontDir = await ReportApiLogic.resolveClientFontDir(client, token.fkOAuthClient)
        return NextResponse.json({ fonts: ReportPreviewLogic.listFonts(fontDir) })
    })
}
