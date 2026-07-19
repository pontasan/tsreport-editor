import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { SystemInitLogic } from '@/lib/server/logic/system_init_logic'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Administrator-only factory reset. Authentication runs in a short-lived
// connection scope first: the reset's TRUNCATE takes ACCESS EXCLUSIVE locks and
// would deadlock against a route-wide DB scope's auth SELECTs.
export async function POST(req: NextRequest): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    return await ServerExceptionHandler.handle(async function () {
        await DbUtils.transaction(async function (client) {
            const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
            AuthLogic.checkAdmin(user)
        })

        await SystemInitLogic.factoryReset(SystemInitLogic.defaultContext())
        return NextResponse.json({})
    })
}
