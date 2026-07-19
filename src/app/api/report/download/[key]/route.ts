import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { readFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ key: string }> }
): Promise<NextResponse<Uint8Array | ErrorInfo>> {
    const { key } = await params
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const token = await ReportApiLogic.checkBearerToken(client, req.headers.get('authorization') ?? '', 'report:download')
        const request = await ReportApiLogic.getPrintRequestByKey(client, key, token.fkOAuthClient)
        if (request.status !== 'completed' || request.pdfPath === undefined) {
            throw new BusinessException('PDFはまだダウンロードできません。')
        }
        const pdf = await readFile(request.pdfPath)
        return new NextResponse(pdf, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="' + request.key + '.pdf"'
            }
        })
    })
}
