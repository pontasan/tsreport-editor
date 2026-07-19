// Preview resource API: font binary delivery.
// Fonts are large and immutable per file, so responses carry an entity tag derived
// from file size and mtime plus a Cache-Control header for client-side caching.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { ReportPreviewLogic } from '@/lib/server/logic/report_preview_logic'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CACHE_CONTROL = 'public, max-age=86400'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<Uint8Array | ErrorInfo>> {
    const { id } = await params

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const token = await ReportApiLogic.checkBearerToken(client, req.headers.get('authorization') ?? '', 'report:preview')
        const fontDir = await ReportApiLogic.resolveClientFontDir(client, token.fkOAuthClient)
        const font = await ReportPreviewLogic.getFontBinary(fontDir, id, req.headers.get('if-none-match'))
        if (font.data === null) {
            return new NextResponse(null, {
                status: 304,
                headers: {
                    'ETag': font.etag,
                    'Cache-Control': CACHE_CONTROL
                }
            })
        }
        return new NextResponse(font.data, {
            headers: {
                'Content-Type': font.contentType,
                'ETag': font.etag,
                'Cache-Control': CACHE_CONTROL
            }
        })
    })
}
