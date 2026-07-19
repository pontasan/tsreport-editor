// Print history download (account-scoped, cookie-authenticated). Returns the
// stored PDF for a history row the caller owns.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { NotFoundException } from '@/lib/common/exception/not_found_exception'
import { PrintRequestDao } from '@/lib/server/dao/PrintRequest'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { readFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ key: string }> }
): Promise<NextResponse<Uint8Array | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const { key } = await params

        const request = await PrintRequestDao.getByKeyAndAccount(client, key, user.id!)
        if (request === undefined) {
            throw new NotFoundException()
        }
        if (request.status !== 'completed' || request.pdfPath === undefined || request.pdfPath === null) {
            throw new BusinessException('この印刷にはダウンロードできるファイルがありません。')
        }

        const data = await readFile(request.pdfPath)
        return new NextResponse(data, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${key}.pdf"`
            }
        })
    })
}
