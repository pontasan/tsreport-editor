import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { EditorDataArchiveLogic } from '@/lib/server/logic/editor_data_archive_logic'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    return await ServerExceptionHandler.handle(async function () {
        // Authenticate in a short-lived connection scope before the import runs.
        // Keeping a route-wide DB scope would hold ACCESS SHARE locks from the auth
        // SELECTs and deadlock against the import's TRUNCATE (ACCESS EXCLUSIVE).
        await DbUtils.transaction(async function (client) {
            const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
            AuthLogic.checkAdmin(user)
        })

        const formData = await req.formData()
        const file = formData.get('file') as File | null
        if (file === null) {
            throw new BusinessException('インポートファイルが指定されていません。')
        }
        await EditorDataArchiveLogic.importData(Buffer.from(await file.arrayBuffer()))
        return NextResponse.json({})
    })
}
