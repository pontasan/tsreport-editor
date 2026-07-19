import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { EditorDataArchiveLogic } from '@/lib/server/logic/editor_data_archive_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse<Uint8Array | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        const archive = await EditorDataArchiveLogic.exportData()
        return new NextResponse(new Uint8Array(archive.data), {
            headers: {
                'Content-Type': 'application/gzip',
                'Content-Disposition': 'attachment; filename="' + archive.fileName + '"'
            }
        })
    })
}
