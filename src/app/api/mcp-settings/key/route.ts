// Regenerates the caller's MCP authentication key.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { UserAdminLogic } from '@/lib/server/logic/user_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse<{ mcpKey: string } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const updated = await UserAdminLogic.regenerateOwnMcpKey(client, user)
        return NextResponse.json({ mcpKey: updated.mcpKey })
    })
}
