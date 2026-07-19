// Own MCP settings (every account) and the global settings for administrators.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { McpServerLogic } from '@/lib/server/logic/mcp_server_logic'
import { UserAdminLogic } from '@/lib/server/logic/user_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export type McpSettingsResponse = {
    userId: string
    mcpEnabled: boolean
    mcpKey: string
    global?: { enabled: boolean, port: number }
}

export async function GET(req: NextRequest): Promise<NextResponse<McpSettingsResponse | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const response: McpSettingsResponse = {
            userId: user.userId,
            mcpEnabled: user.mcpEnabled,
            mcpKey: user.mcpKey
        }
        if (user.adminFlag) {
            response.global = await McpServerLogic.loadGlobalSettings(client)
        }
        return NextResponse.json(response)
    })
}

export async function PATCH(req: NextRequest): Promise<NextResponse<{ mcpEnabled: boolean } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: { mcpEnabled: boolean } = await req.json()
        const updated = await UserAdminLogic.updateOwnMcpEnabled(client, user, body.mcpEnabled === true)
        return NextResponse.json({ mcpEnabled: updated.mcpEnabled })
    })
}
