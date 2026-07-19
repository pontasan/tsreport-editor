// Administrator-only global MCP settings (enabled flag and dedicated port).

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { McpServerLogic } from '@/lib/server/logic/mcp_server_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest): Promise<NextResponse<{ enabled: boolean, port: number } | ErrorInfo>> {
    const result = await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        const body: { enabled: boolean, port: number } = await req.json()
        await McpServerLogic.updateGlobalSettings(client, body.enabled === true, body.port, user.id)
        return NextResponse.json({ enabled: body.enabled === true, port: body.port })
    })
    // Re-sync this process's listener after the settings update.
    await McpServerLogic.syncListener()
    return result
}
