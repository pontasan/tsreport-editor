// Dedicated MCP HTTP listener.
// Serves the same JSON-RPC handling as /api/mcp on the administrator-configured
// port (SystemProperty mcp.port, default 52006) while mcp.enabled is true.
// Started from instrumentation.ts; administrator setting changes call
// syncListener() after the properties are updated.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AuthenticationException } from '@/lib/common/exception/authentication_exception'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { SystemPropertyDao } from '@/lib/server/dao/SystemProperty'
import { SystemProperty } from '@/lib/server/entity/SystemProperty'
import { McpLogic, type McpAccess } from './mcp_logic'
import { buildMcpDbHooks } from './mcp_db_hooks'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { ClientBase } from 'pg'

export const DEFAULT_MCP_PORT = 52006
const MAX_BODY_BYTES = 16 * 1024 * 1024

export type McpGlobalSettings = {
    enabled: boolean
    port: number
}

let server: Server | null = null
let listeningPort = 0

export namespace McpServerLogic {

    export async function loadGlobalSettings(client: ClientBase): Promise<McpGlobalSettings> {
        const enabled = await McpLogic.isMcpGloballyEnabled(client)
        const portProperty = await SystemPropertyDao.findByKey(client, 'mcp.port')
        const port = portProperty !== undefined ? parseInt(portProperty.value, 10) : DEFAULT_MCP_PORT
        return { enabled, port }
    }

    // Administrator update of the global MCP settings.
    export async function updateGlobalSettings(
        client: ClientBase,
        enabled: boolean,
        port: number,
        operatorId: number | undefined
    ): Promise<void> {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new BusinessException('ポート番号が不正です。')
        }
        await upsertProperty(client, 'mcp.enabled', enabled ? 'true' : 'false', operatorId)
        await upsertProperty(client, 'mcp.port', String(port), operatorId)
    }

    // Applies the current global settings to this process's dedicated listener.
    export async function syncListener(): Promise<void> {
        const settings = await DbUtils.transaction(async function (client) {
            return await loadGlobalSettings(client)
        })
        await applySettings(settings)
    }

}

async function upsertProperty(client: ClientBase, key: string, value: string, operatorId: number | undefined): Promise<void> {
    const existing = await SystemPropertyDao.findByKey(client, key)
    if (existing !== undefined) {
        existing.value = value
        existing.updateUser = operatorId
        await SystemPropertyDao.update(client, existing)
        return
    }
    const entity = SystemProperty.create()
    entity.id = await SystemPropertyDao.getSequenceId(client)
    entity.key = key
    entity.value = value
    entity.createUser = operatorId
    entity.updateUser = operatorId
    await SystemPropertyDao.insert(client, entity)
}

async function applySettings(settings: McpGlobalSettings): Promise<void> {
    const shouldListen = settings.enabled && Number.isInteger(settings.port) && settings.port > 0 && settings.port < 65536
    if (server !== null && (!shouldListen || listeningPort !== settings.port)) {
        const closing = server
        server = null
        await new Promise<void>(function (resolve) { closing.close(function () { resolve() }) })
    }
    if (!shouldListen || server !== null) {
        return
    }
    const created = createServer(handleRequest)
    server = created
    listeningPort = settings.port
    await new Promise<void>(function (resolve, reject) {
        created.once('error', reject)
        created.listen(settings.port, function () {
            created.removeListener('error', reject)
            resolve()
        })
    })
    console.log('MCP listener started on port ' + settings.port)
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
        res.end(McpLogic.gettingStartedText())
        return
    }
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Allow': 'GET, POST' })
        res.end()
        return
    }
    const chunks: Buffer[] = []
    let received = 0
    let aborted = false
    req.on('data', function (chunk: Buffer) {
        if (aborted) return
        received += chunk.length
        // Cap the request body so an unauthenticated caller cannot exhaust
        // memory on this dedicated listener (it is not behind Next.js's body
        // size limit). 16 MB comfortably covers base64 asset uploads.
        if (received > MAX_BODY_BYTES) {
            aborted = true
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(McpLogic.buildErrorResponse(null, McpLogic.INVALID_REQUEST, 'Payload too large')))
            req.destroy()
            return
        }
        chunks.push(chunk)
    })
    req.on('end', function () {
        if (aborted) return
        handlePost(req, Buffer.concat(chunks), res).catch(function (e) {
            console.log(e)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(McpLogic.buildErrorResponse(null, McpLogic.INTERNAL_ERROR, 'Internal error')))
        })
    })
}

async function handlePost(req: IncomingMessage, body: Buffer, res: ServerResponse): Promise<void> {
    let access: McpAccess
    try {
        access = await DbUtils.transaction(async function (client) {
            return await McpLogic.checkMcpAccess(client, {
                authorization: headerValue(req, 'authorization'),
                account: headerValue(req, 'x-mcp-account'),
                key: headerValue(req, 'x-mcp-key')
            })
        })
    } catch (e) {
        if (e instanceof AuthenticationException) {
            res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="tsreport"' })
            res.end()
            return
        }
        if (e instanceof ForbiddenException) {
            res.writeHead(403)
            res.end()
            return
        }
        throw e
    }

    let message: unknown
    try {
        message = JSON.parse(body.toString('utf-8'))
    } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(McpLogic.buildErrorResponse(null, McpLogic.PARSE_ERROR, 'Parse error')))
        return
    }

    const response = await McpLogic.handleMessage(message, { access, ...buildMcpDbHooks(access) })
    if (response === null) {
        res.writeHead(202)
        res.end()
        return
    }
    const status = response.error !== undefined && response.error.code === McpLogic.INVALID_REQUEST ? 400 : 200
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
}

function headerValue(req: IncomingMessage, name: string): string {
    const value = req.headers[name]
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value[0] ?? ''
    return ''
}
