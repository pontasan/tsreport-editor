// Workspace file-activity hot reload channel.
// Editor and MCP writes publish process-local events that are delivered to
// connected editors through the dedicated WebSocket listener.

import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { AuthenticationException } from '@/lib/common/exception/authentication_exception'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { WorkspaceAccessLogic, type WorkspaceAccess } from '@/lib/server/logic/workspace_access_logic'
import { DbUtils } from '@/lib/server/utils/db_utils'
import type { WorkspaceActivityEvent } from '@/lib/common/workspace_activity_event'
import type { ClientBase } from 'pg'

export const WORKSPACE_ACTIVITY_WS_PORT = 52007

const HEARTBEAT_MS = 25000
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const INTERNAL_PUBLISH_PATH = '/publish'

type Subscriber = (event: WorkspaceActivityEvent) => void

type WorkspaceSocketClient = {
    socket: Duplex
    token: string
    access: WorkspaceAccess
    heartbeat: ReturnType<typeof setInterval>
    refreshing: boolean
    closed: boolean
    incoming: Buffer
}

type WorkspaceActivityState = {
    server: Server | null
    serverReady: Promise<void> | null
    subscribers: Set<Subscriber>
    wsClients: Set<WorkspaceSocketClient>
}

const STATE_KEY = '__tsreportWorkspaceActivityState'
const state = workspaceActivityState()

export namespace WorkspaceActivityLogic {

    export async function startWebSocketServer(): Promise<void> {
        if (state.serverReady === null) {
            state.serverReady = startServer()
        }
        await state.serverReady
    }

    export async function publishFile(
        client: ClientBase,
        event: Pick<WorkspaceActivityEvent, 'workspace' | 'path' | 'isDirectory' | 'account' | 'via' | 'instance'>
            & { action: 'save' | 'delete' }
    ): Promise<void> {
        void client
        await publishEvent({
            ...event,
            previousPath: '',
            draftKind: '',
            content: '',
            at: new Date().toISOString()
        })
    }

    export async function publishRename(
        client: ClientBase,
        event: Pick<WorkspaceActivityEvent, 'workspace' | 'path' | 'previousPath' | 'isDirectory' | 'account' | 'via' | 'instance'>
    ): Promise<void> {
        void client
        await publishEvent({
            ...event,
            action: 'rename',
            draftKind: '',
            content: '',
            at: new Date().toISOString()
        })
    }

    export async function publishDraft(
        client: ClientBase,
        event: Pick<WorkspaceActivityEvent, 'workspace' | 'path' | 'draftKind' | 'content' | 'account'>
    ): Promise<void> {
        void client
        await publishEvent({
            ...event,
            previousPath: '',
            action: 'draft',
            isDirectory: false,
            via: 'mcp',
            instance: '',
            at: new Date().toISOString()
        })
    }

    // Subscribes to workspace file events inside this process.
    export async function subscribe(subscriber: Subscriber): Promise<() => void> {
        state.subscribers.add(subscriber)
        return function unsubscribe() {
            state.subscribers.delete(subscriber)
        }
    }

}

async function publishEvent(payload: WorkspaceActivityEvent): Promise<void> {
    state.subscribers.forEach(function (subscriber) { subscriber(payload) })
    await publishToWebSocketServer(payload)
}

async function startServer(): Promise<void> {
    if (state.server !== null) return
    const created = createServer(handleRequest)
    created.on('upgrade', function (req, socket, head) {
        handleUpgrade(req, socket, head)
    })
    state.server = created
    await new Promise<void>(function (resolve, reject) {
        created.once('error', reject)
        created.listen(WORKSPACE_ACTIVITY_WS_PORT, function () {
            created.removeListener('error', reject)
            resolve()
        })
    })
    created.on('error', function (e) { console.log(e) })
    console.log('Workspace activity WebSocket listener started on port ' + WORKSPACE_ACTIVITY_WS_PORT)
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST' || req.url !== INTERNAL_PUBLISH_PATH || !isLoopback(req.socket.remoteAddress)) {
        res.writeHead(404)
        res.end()
        return
    }
    const chunks: Buffer[] = []
    req.on('data', function (chunk: Buffer) {
        chunks.push(chunk)
    })
    req.on('end', function () {
        const event = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WorkspaceActivityEvent
        broadcastLocal(event)
        res.writeHead(204)
        res.end()
    })
}

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    void head
    completeUpgrade(req, socket).catch(function (e) {
        if (!(e instanceof AuthenticationException)) {
            console.log(e)
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
        } else {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        }
        socket.destroy()
    })
}

function workspaceActivityState(): WorkspaceActivityState {
    const globalRecord = globalThis as typeof globalThis & { __tsreportWorkspaceActivityState?: WorkspaceActivityState }
    if (globalRecord[STATE_KEY] === undefined) {
        globalRecord[STATE_KEY] = {
            server: null,
            serverReady: null,
            subscribers: new Set<Subscriber>(),
            wsClients: new Set<WorkspaceSocketClient>()
        }
    }
    return globalRecord[STATE_KEY]
}

async function completeUpgrade(req: IncomingMessage, socket: Duplex): Promise<void> {
    const key = singleHeader(req.headers['sec-websocket-key'])
    if (key === '') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
    }
    const token = getCookie(singleHeader(req.headers.cookie), 'token')
    const access = await loadFreshAccess(token)
    const accept = createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64')
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n' +
        '\r\n'
    )
    const wsClient: WorkspaceSocketClient = {
        socket,
        token,
        access,
        heartbeat: setInterval(function () { heartbeat(wsClient) }, HEARTBEAT_MS),
        refreshing: false,
        closed: false,
        incoming: Buffer.alloc(0)
    }
    state.wsClients.add(wsClient)
    socket.on('data', function (chunk: Buffer) { handleSocketData(wsClient, chunk) })
    socket.on('close', function () { closeClient(wsClient) })
    socket.on('error', function () { closeClient(wsClient) })
}

async function loadFreshAccess(token: string): Promise<WorkspaceAccess> {
    return await DbUtils.transaction(async function (client) {
        const user = await AuthLogic.checkToken(client, token)
        return await WorkspaceAccessLogic.loadAccess(client, user)
    })
}

async function publishToWebSocketServer(event: WorkspaceActivityEvent): Promise<void> {
    const res = await fetch('http://127.0.0.1:' + WORKSPACE_ACTIVITY_WS_PORT + INTERNAL_PUBLISH_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
    })
    if (res.status !== 204) {
        throw new Error('Workspace activity publish failed: ' + res.status)
    }
}

function broadcastLocal(event: WorkspaceActivityEvent): void {
    state.wsClients.forEach(function (wsClient) { sendWorkspaceEvent(wsClient, event) })
}

function heartbeat(wsClient: WorkspaceSocketClient): void {
    if (wsClient.closed) return
    sendFrame(wsClient.socket, 0x9, Buffer.alloc(0))
    if (wsClient.refreshing) return
    wsClient.refreshing = true
    loadFreshAccess(wsClient.token).then(function (fresh) {
        wsClient.refreshing = false
        if (wsClient.closed) return
        wsClient.access = fresh
    }, function (e) {
        wsClient.refreshing = false
        if (!(e instanceof AuthenticationException)) {
            console.log(e)
        }
        closeClient(wsClient)
    })
}

function sendWorkspaceEvent(wsClient: WorkspaceSocketClient, event: WorkspaceActivityEvent): void {
    if (!WorkspaceAccessLogic.isReadable(wsClient.access, event.workspace, event.path)) return
    sendFrame(wsClient.socket, 0x1, Buffer.from(JSON.stringify(event), 'utf8'))
}

function handleSocketData(wsClient: WorkspaceSocketClient, chunk: Buffer): void {
    wsClient.incoming = Buffer.concat([wsClient.incoming, chunk])
    while (wsClient.incoming.length >= 2) {
        const first = wsClient.incoming[0]
        const second = wsClient.incoming[1]
        const opcode = first & 0x0f
        const masked = (second & 0x80) !== 0
        let length = second & 0x7f
        let offset = 2
        if (length === 126) {
            if (wsClient.incoming.length < 4) return
            length = wsClient.incoming.readUInt16BE(2)
            offset = 4
        } else if (length === 127) {
            if (wsClient.incoming.length < 10) return
            length = Number(wsClient.incoming.readBigUInt64BE(2))
            offset = 10
        }
        const maskOffset = offset
        if (masked) offset += 4
        if (wsClient.incoming.length < offset + length) return
        const payload = Buffer.from(wsClient.incoming.subarray(offset, offset + length))
        if (masked) {
            const mask = wsClient.incoming.subarray(maskOffset, maskOffset + 4)
            for (let i = 0; i < payload.length; i++) {
                payload[i] = payload[i] ^ mask[i % 4]
            }
        }
        wsClient.incoming = wsClient.incoming.subarray(offset + length)
        if (opcode === 0x8) {
            closeClient(wsClient)
            return
        }
        if (opcode === 0x9) {
            sendFrame(wsClient.socket, 0xA, payload)
        }
    }
}

function closeClient(wsClient: WorkspaceSocketClient): void {
    if (wsClient.closed) return
    wsClient.closed = true
    clearInterval(wsClient.heartbeat)
    state.wsClients.delete(wsClient)
    if (!wsClient.socket.destroyed) {
        sendFrame(wsClient.socket, 0x8, Buffer.alloc(0))
        wsClient.socket.end()
    }
}

function sendFrame(socket: Duplex, opcode: number, payload: Buffer): void {
    if (socket.destroyed) return
    const first = Buffer.from([0x80 | opcode])
    let header: Buffer
    if (payload.length < 126) {
        header = Buffer.from([payload.length])
    } else if (payload.length <= 0xffff) {
        header = Buffer.alloc(3)
        header[0] = 126
        header.writeUInt16BE(payload.length, 1)
    } else {
        header = Buffer.alloc(9)
        header[0] = 127
        header.writeBigUInt64BE(BigInt(payload.length), 1)
    }
    socket.write(Buffer.concat([first, header, payload]))
}

function singleHeader(value: string | string[] | undefined): string {
    if (value === undefined) return ''
    if (Array.isArray(value)) return value[0]
    return value
}

function isLoopback(address: string | undefined): boolean {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function getCookie(header: string, name: string): string {
    const pairs = header.split(';')
    for (let i = 0; i < pairs.length; i++) {
        const part = pairs[i].trim()
        const index = part.indexOf('=')
        if (index < 0) continue
        if (part.slice(0, index) === name) {
            return decodeURIComponent(part.slice(index + 1))
        }
    }
    return ''
}
