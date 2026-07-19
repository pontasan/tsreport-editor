// MCP (Model Context Protocol) endpoint.
// Streamable HTTP transport carrying JSON-RPC 2.0 over HTTP POST. Every request
// is answered with a single application/json response (or 202 for notifications);
// server-initiated SSE streams are not provided. GET returns the setup guide.

import { AuthenticationException } from '@/lib/common/exception/authentication_exception'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { McpLogic, type McpAccess } from '@/lib/server/logic/mcp_logic'
import { buildMcpDbHooks } from '@/lib/server/logic/mcp_db_hooks'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Upper bound on the JSON-RPC payload so an authenticated client cannot exhaust
// memory with an unbounded body. Larger than the print-data cap because an MCP
// render call bundles an inline template plus its data source. Kept in sync with
// the nginx = /api/mcp limit.
const MAX_MCP_BODY_BYTES = 32 * 1024 * 1024

export async function POST(req: NextRequest): Promise<NextResponse> {
    // Authenticate before touching the request body so unauthenticated calls
    // never parse payloads. Requests without credentials are accepted with a
    // guide-only access so an AI client can call get_started and learn the
    // setup procedure; wrong credentials are rejected outright.
    let access: McpAccess
    try {
        access = await DbUtils.transaction(async function (client) {
            return await McpLogic.checkMcpAccess(client, {
                authorization: req.headers.get('authorization') ?? '',
                account: req.headers.get('x-mcp-account') ?? '',
                key: req.headers.get('x-mcp-key') ?? ''
            })
        })
    } catch (e) {
        if (e instanceof AuthenticationException) {
            return new NextResponse(null, {
                status: 401,
                headers: { 'WWW-Authenticate': 'Bearer realm="tsreport"' }
            })
        }
        if (e instanceof ForbiddenException) {
            return new NextResponse(null, { status: 403 })
        }
        console.log(e)
        return NextResponse.json(
            McpLogic.buildErrorResponse(null, McpLogic.INTERNAL_ERROR, 'Internal error'),
            { status: 500 }
        )
    }

    let message: unknown
    try {
        message = JSON.parse(await NextUtils.readBodyText(req, MAX_MCP_BODY_BYTES))
    } catch {
        return NextResponse.json(
            McpLogic.buildErrorResponse(null, McpLogic.PARSE_ERROR, 'Parse error'),
            { status: 400 }
        )
    }

    try {
        const response = await McpLogic.handleMessage(message, { access, ...buildMcpDbHooks(access) })
        if (response === null) {
            // Notification accepted: no response body per the Streamable HTTP transport.
            return new NextResponse(null, { status: 202 })
        }
        const status = response.error !== undefined && response.error.code === McpLogic.INVALID_REQUEST ? 400 : 200
        return NextResponse.json(response, { status })
    } catch (e) {
        console.log(e)
        return NextResponse.json(
            McpLogic.buildErrorResponse(McpLogic.extractRequestId(message), McpLogic.INTERNAL_ERROR, 'Internal error'),
            { status: 500 }
        )
    }
}

// The emphasized "read me first" entry point: no authentication required.
export async function GET(): Promise<NextResponse> {
    const enabled = await DbUtils.transaction(async function (client) {
        return await McpLogic.isMcpGloballyEnabled(client)
    })
    if (!enabled) {
        return new NextResponse(null, { status: 403 })
    }
    return new NextResponse(McpLogic.gettingStartedText(), {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
    })
}
