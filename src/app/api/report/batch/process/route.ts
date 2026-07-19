import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { ReportBatchLogic } from '@/lib/server/logic/report_batch_logic'
import { secretEquals } from '@/lib/server/utils/secret_compare'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse<{ processed: number } | ErrorInfo>> {
    return await ServerExceptionHandler.handle(async function () {
        const expected = process.env.REPORT_BATCH_TOKEN
        if (expected === undefined || !secretEquals(req.headers.get('x-report-batch-token') ?? '', expected)) {
            throw new ForbiddenException()
        }
        const processed = await ReportBatchLogic.processQueuedRequests()
        if (processed === 0) {
            return new NextResponse(null, { status: 200 })
        }
        return NextResponse.json({ processed })
    })
}
