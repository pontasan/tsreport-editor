// Print history API (account-scoped, cookie-authenticated).
//
// GET  ?offset=&limit=  — a newest-first page of the caller's print history.
// POST (multipart)      — record an editor print: the browser uploads the PDF it
//                         generated plus its metadata, and the server stores the
//                         file and inserts a completed history row (via='editor').

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { PrintHistoryLogic, type PrintHistoryPage } from '@/lib/server/logic/print_history_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
// Cap a single stored print so an authenticated tenant cannot exhaust the PDF
// volume with one oversized upload. Generous for multi-page reports with images.
const MAX_PDF_BYTES = 64 * 1024 * 1024

export async function GET(req: NextRequest): Promise<NextResponse<PrintHistoryPage | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))

        const offsetParam = Number(req.nextUrl.searchParams.get('offset') ?? '0')
        const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? String(DEFAULT_LIMIT))
        const offset = Number.isInteger(offsetParam) && offsetParam >= 0 ? offsetParam : 0
        const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT

        const page = await PrintHistoryLogic.listHistory(client, user.id!, offset, limit)
        return NextResponse.json(page)
    })
}

export async function POST(req: NextRequest): Promise<NextResponse<{ key: string } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))

        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const workspace = (formData.get('workspace') as string) ?? ''
        const templatePath = (formData.get('templatePath') as string) ?? ''
        const format = (formData.get('format') as string) || 'pdf'

        if (file === null) {
            throw new BusinessException('PDFが指定されていません。')
        }
        if (file.size > MAX_PDF_BYTES) {
            throw new BusinessException('PDFサイズが大きすぎます。')
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        // The upload is the exact PDF the browser printed; require a PDF header.
        if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
            throw new BusinessException('PDFデータが不正です。')
        }

        const key = await PrintHistoryLogic.recordCompleted(client, user.id!, 'editor', workspace, templatePath, format, '/api/print-history', bytes)
        return NextResponse.json({ key })
    })
}
