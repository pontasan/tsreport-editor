import { beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { connect } from 'node:net'
import {
    LIVE_ACTIVITY_HOST,
    LIVE_ACTIVITY_PORT as ACTIVITY_WS_PORT,
    LIVE_EDITOR_BASE as BASE,
    LIVE_MCP_BASE as MCP_PORT_BASE,
} from './live_environment'

// Live regression tests for the account+key MCP authentication, the
// unauthenticated onboarding path, the dedicated listener, and the MCP
// activity WebSocket, against a RUNNING tsreport-editor server.
//
// Prerequisites (seeded on first boot by SystemInitLogic):
// - Editor server on http://localhost:52005 (Docker, server/compose.yaml,
//   dedicated MCP listener published on 52006, activity WebSocket on 52007)
// - Accounts admin/pass (key admin-mcp-key) and test/pass (key test-mcp-key,
//   '*' view grant)

let rpcId = 0

async function mcp(
    endpoint: string,
    method: string,
    params: object,
    headers: Record<string, string>
): Promise<{ status: number, body: any }> {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    })
    const text = await res.text()
    return { status: res.status, body: text.length > 0 ? JSON.parse(text) : {} }
}

function authHeaders(account: string, key: string): Record<string, string> {
    return { 'x-mcp-account': account, 'x-mcp-key': key }
}

const CSRF = 'live-csrf-token'

async function login(userId: string, pass: string): Promise<string | null> {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `csrf_token=${CSRF}`, 'X-TemplateV3-Csrf-Token': CSRF },
        body: JSON.stringify({ userId, pass }),
    })
    if (!res.ok) return null
    const setCookie = res.headers.get('set-cookie') as string
    return `token=${(/token=([^;]+)/.exec(setCookie) as RegExpExecArray)[1]}; csrf_token=${CSRF}`
}

async function meKey(cookie: string): Promise<string> {
    const res = await fetch(`${BASE}/api/users/me`, { headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF } })
    return (await res.json()).user.workspaceKey
}

type ActivityWatcher = {
    result: Promise<Record<string, unknown> | null>
    close: () => void
}

function openActivityWatcher(cookie: string, targetPath: string): Promise<ActivityWatcher> {
    return new Promise(function (resolve, reject) {
        const socket = connect(ACTIVITY_WS_PORT, LIVE_ACTIVITY_HOST)
        const key = randomBytes(16).toString('base64')
        let buffer = Buffer.alloc(0)
        let handshaken = false
        let finished = false
        let resolveResult: (event: Record<string, unknown> | null) => void
        const result = new Promise<Record<string, unknown> | null>(function (resolveEvent) {
            resolveResult = resolveEvent
        })
        const timer = setTimeout(function () {
            finish(null)
        }, 10000)

        function close(): void {
            clearTimeout(timer)
            socket.end()
            socket.destroy()
        }

        function finish(event: Record<string, unknown> | null): void {
            if (finished) return
            finished = true
            resolveResult(event)
        }

        socket.on('connect', function () {
            socket.write(
                'GET / HTTP/1.1\r\n' +
                'Host: ' + LIVE_ACTIVITY_HOST + ':' + ACTIVITY_WS_PORT + '\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                'Sec-WebSocket-Key: ' + key + '\r\n' +
                'Sec-WebSocket-Version: 13\r\n' +
                'Cookie: ' + cookie + '\r\n' +
                '\r\n'
            )
        })
        socket.on('data', function (chunk: Buffer) {
            buffer = Buffer.concat([buffer, chunk])
            if (!handshaken) {
                const headerEnd = buffer.indexOf('\r\n\r\n')
                if (headerEnd < 0) return
                const header = buffer.subarray(0, headerEnd).toString('utf8')
                if (!header.startsWith('HTTP/1.1 101')) {
                    reject(new Error('activity WebSocket handshake failed: ' + header.split('\r\n')[0]))
                    close()
                    return
                }
                handshaken = true
                buffer = buffer.subarray(headerEnd + 4)
                resolve({ result, close })
            }
            readFrames()
        })
        socket.on('error', reject)

        function readFrames(): void {
            while (buffer.length >= 2) {
                const opcode = buffer[0] & 0x0f
                let length = buffer[1] & 0x7f
                let offset = 2
                if (length === 126) {
                    if (buffer.length < 4) return
                    length = buffer.readUInt16BE(2)
                    offset = 4
                } else if (length === 127) {
                    if (buffer.length < 10) return
                    length = Number(buffer.readBigUInt64BE(2))
                    offset = 10
                }
                if (buffer.length < offset + length) return
                const payload = buffer.subarray(offset, offset + length)
                buffer = buffer.subarray(offset + length)
                if (opcode === 0x8) {
                    finish(null)
                    return
                }
                if (opcode !== 0x1) continue
                const event = JSON.parse(payload.toString('utf8')) as Record<string, unknown>
                if (event.path === targetPath) {
                    finish(event)
                    return
                }
            }
        }
    })
}

let adminKey = ''
let testKey = ''

beforeAll(async function () {
    const cookie = await login('admin', 'pass')
    if (cookie === null) {
        throw new Error('tsreport-editor server is not running on ' + BASE + ' (start the Docker dev environment first)')
    }
    adminKey = await meKey(cookie)
    testKey = await meKey(await login('test', 'pass') as string)
})

describe('MCP account+key authentication (live)', function () {

    it('GET /api/mcp returns the setup guide without authentication', async function () {
        const res = await fetch(`${BASE}/api/mcp`)
        expect(res.status).toBe(200)
        expect(await res.text()).toContain('x-mcp-account')
    })

    it('get_started works unauthenticated; other tools return setup guidance', async function () {
        const started = await mcp(`${BASE}/api/mcp`, 'tools/call', { name: 'get_started', arguments: {} }, {})
        expect(started.status).toBe(200)
        expect(started.body.result.isError).toBeUndefined()
        expect(started.body.result.content[0].text).toContain('x-mcp-key')

        const denied = await mcp(`${BASE}/api/mcp`, 'tools/call', { name: 'list_workspaces', arguments: {} }, {})
        expect(denied.status).toBe(200)
        expect(denied.body.result.isError).toBe(true)
        expect(denied.body.result.content[0].text).toContain('get_started')
    })

    it('wrong credentials are rejected with 401', async function () {
        const res = await mcp(`${BASE}/api/mcp`, 'tools/call', { name: 'list_workspaces', arguments: {} }, authHeaders('test', 'wrong-key'))
        expect(res.status).toBe(401)
    })

    it('account+key authenticates and list_workspaces returns the own workspace', async function () {
        const res = await mcp(`${BASE}/api/mcp`, 'tools/call', { name: 'list_workspaces', arguments: {} }, authHeaders('test', 'test-mcp-key'))
        expect(res.status).toBe(200)
        const workspaces = JSON.parse(res.body.result.content[0].text).workspaces as Array<{ workspace: string, kind: string }>
        expect(workspaces.some(function (w) { return w.workspace === testKey && w.kind === 'own' })).toBe(true)
    })

    it('Bearer account:key is accepted as an alternative', async function () {
        const res = await mcp(`${BASE}/api/mcp`, 'tools/call', { name: 'list_fonts', arguments: {} }, {
            Authorization: 'Bearer admin:admin-mcp-key',
        })
        expect(res.status).toBe(200)
        expect(res.body.result.isError).toBeUndefined()
    })

    it('the dedicated listener serves the same MCP endpoint on mcp.port', async function () {
        const guide = await fetch(`${MCP_PORT_BASE}/`)
        expect(guide.status).toBe(200)
        expect(await guide.text()).toContain('READ THIS FIRST')

        const res = await mcp(`${MCP_PORT_BASE}/`, 'tools/call', { name: 'list_workspaces', arguments: {} }, authHeaders('test', 'test-mcp-key'))
        expect(res.status).toBe(200)
        const workspaces = JSON.parse(res.body.result.content[0].text).workspaces as Array<{ workspace: string, kind: string }>
        expect(workspaces.some(function (w) { return w.workspace === testKey && w.kind === 'own' })).toBe(true)
    })

    async function watchActivity(cookie: string, targetPath: string, trigger: () => Promise<void>): Promise<Record<string, unknown> | null> {
        const watcher = await openActivityWatcher(cookie, targetPath)
        await trigger()
        const event = await watcher.result
        watcher.close()
        return event
    }

    it('MCP file writes are broadcast on the activity WebSocket (hot-reload feed)', async function () {
        // The test account both writes (MCP) and watches its own workspace.
        const cookie = await login('test', 'pass') as string
        const path = 'mcp-live-activity.txt'
        const event = await watchActivity(cookie, path, async function () {
            const save = await mcp(`${BASE}/api/mcp`, 'tools/call', {
                name: 'save_workspace_file',
                arguments: { workspace: testKey, path, content: 'activity probe' },
            }, authHeaders('test', 'test-mcp-key'))
            expect(save.body.result.isError).toBeUndefined()
        })
        expect(event).not.toBeNull()
        expect(event!.workspace).toBe(testKey)
        expect(event!.action).toBe('save')
        expect(event!.account).toBe('test')
        expect(event!.via).toBe('mcp')
        expect(event!.instance).toBe('')

        // Clean up the probe file through MCP.
        const del = await mcp(`${BASE}/api/mcp`, 'tools/call', {
            name: 'delete_workspace_file',
            arguments: { workspace: testKey, path },
        }, authHeaders('test', 'test-mcp-key'))
        expect(del.body.result.isError).toBeUndefined()
    })

    it('editor saves are broadcast with via=editor and the originating instance id', async function () {
        const cookie = await login('admin', 'pass') as string
        const path = 'editor-live-activity.txt'
        const event = await watchActivity(cookie, path, async function () {
            const form = new FormData()
            form.set('file', new Blob(['editor probe']), path)
            const res = await fetch(`${BASE}/api/workspace/${adminKey}/files`, {
                method: 'POST',
                headers: { cookie, 'x-editor-instance': 'browser-A', 'X-TemplateV3-Csrf-Token': CSRF },
                body: form,
            })
            expect(res.status).toBe(200)
        })
        expect(event).not.toBeNull()
        expect(event!.action).toBe('save')
        expect(event!.account).toBe('admin')
        expect(event!.via).toBe('editor')
        expect(event!.instance).toBe('browser-A')

        const del = await fetch(`${BASE}/api/workspace/${adminKey}/files/${encodeURIComponent(path)}`, {
            method: 'DELETE',
            headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        })
        expect(del.status).toBe(200)
    })

    it('MCP settings API serves the own key and admin global settings', async function () {
        const cookie = await login('admin', 'pass') as string
        const res = await fetch(`${BASE}/api/mcp-settings`, { headers: { cookie } })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('admin')
        expect(body.mcpKey).toBe('admin-mcp-key')
        expect(body.global.enabled).toBe(true)
        expect(body.global.port).toBe(52006)
    })
})
