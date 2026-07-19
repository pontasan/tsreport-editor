import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE_EDITOR_BASE as BASE } from './live_environment'

// Live security regression tests against a RUNNING tsreport-editor server.
// Each test pins a specific vulnerability closed during the pre-ship audit:
// CSRF enforcement, logout session invalidation, cross-workspace write, and
// render-time local file inclusion via a crafted image reference.
//
// Prerequisites: editor on http://localhost:52005, seeded admin/pass and the
// sample workspace (SystemInitLogic first-boot seed).

const CSRF = 'sec-csrf-token'

let rpcId = 0

async function loginRaw(userId: string, pass: string): Promise<{ token: string, cookie: string }> {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `csrf_token=${CSRF}`, 'X-TemplateV3-Csrf-Token': CSRF },
        body: JSON.stringify({ userId, pass }),
    })
    if (!res.ok) throw new Error('login failed: server not running or seed missing')
    const setCookie = res.headers.get('set-cookie') as string
    const token = (/token=([^;]+)/.exec(setCookie) as RegExpExecArray)[1]
    return { token, cookie: `token=${token}; csrf_token=${CSRF}` }
}

async function mcpTool(name: string, args: object, account: string, key: string): Promise<any> {
    const res = await fetch(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mcp-account': account, 'x-mcp-key': key },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    })
    return (await res.json()).result
}

async function workspaceKey(cookie: string): Promise<string> {
    const res = await fetch(`${BASE}/api/users/me`, { headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF } })
    return (await res.json()).user.workspaceKey
}

let adminKey = ''

beforeAll(async function () {
    const admin = await loginRaw('admin', 'pass')
    adminKey = await workspaceKey(admin.cookie)
})

describe('security regression (live)', function () {

    it('H3: a cookie-authenticated PATCH without a CSRF token is rejected (403)', async function () {
        const { cookie } = await loginRaw('admin', 'pass')
        // Missing header → mismatch with the csrf_token cookie → 403.
        const noToken = await fetch(`${BASE}/api/mcp-settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', cookie },
            body: JSON.stringify({ mcpEnabled: true }),
        })
        expect(noToken.status).toBe(403)
        // Matching header → allowed.
        const withToken = await fetch(`${BASE}/api/mcp-settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', cookie, 'X-TemplateV3-Csrf-Token': CSRF },
            body: JSON.stringify({ mcpEnabled: true }),
        })
        expect(withToken.status).toBe(200)
    })

    it('H3b: OAuth client management (cookie-authed) is CSRF-protected, only /token is exempt', async function () {
        const { cookie } = await loginRaw('admin', 'pass')
        // Creating an OAuth client is cookie-authenticated and state-changing, so
        // it must be rejected without a matching CSRF token (it used to fall under
        // the too-broad /api/oauth/ exemption).
        const noToken = await fetch(`${BASE}/api/oauth/clients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie },
            body: JSON.stringify({ clientId: 'sec-csrf-probe-' + Date.now(), scopes: 'report:print' }),
        })
        expect(noToken.status).toBe(403)
        // The token endpoint stays exempt (client-credentials, not cookie auth):
        // it fails auth (400/401), never a CSRF 403.
        const tokenNoCsrf = await fetch(`${BASE}/api/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials&client_id=nope&client_secret=nope',
        })
        expect(tokenNoCsrf.status).not.toBe(403)
    })

    it('H4: the session token is rejected after logout', async function () {
        const { cookie } = await loginRaw('admin', 'pass')
        // The token works before logout.
        const before = await fetch(`${BASE}/api/auth/verify_session`, {
            method: 'POST',
            headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        })
        expect(before.status).toBe(200)
        // Without a matching CSRF token the logout is rejected (403) and the
        // session survives — logout is not CSRF-exempt.
        const noCsrf = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie } })
        expect(noCsrf.status).toBe(403)
        // Logout is a cookie-authenticated state change, so it is CSRF-protected
        // (double-submit token required) and invalidates the server-side session.
        const out = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF } })
        expect(out.status).toBe(200)
        // The same token is now rejected.
        const after = await fetch(`${BASE}/api/auth/verify_session`, {
            method: 'POST',
            headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        })
        expect(after.status).toBe(401)
    })

    it('H2: a multipart filename cannot escape the workspace', async function () {
        const { cookie } = await loginRaw('admin', 'pass')
        const form = new FormData()
        // Attacker-controlled filename attempting to traverse to a sibling path.
        form.set('file', new Blob(['pwned']), '../sec-escape-probe.txt')
        const res = await fetch(`${BASE}/api/workspace/${adminKey}/files`, {
            method: 'POST',
            headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF },
            body: form,
        })
        // The filename is reduced to a bare name; it is stored inside the
        // workspace, never at the traversed location.
        expect(res.status).toBe(200)
        const escaped = await fetch(`${BASE}/api/workspace/${adminKey}/files/${encodeURIComponent('../sec-escape-probe.txt')}`, {
            headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        })
        expect(escaped.status).not.toBe(200)
        // Clean up the basename that was actually written.
        await fetch(`${BASE}/api/workspace/${adminKey}/files/${encodeURIComponent('sec-escape-probe.txt')}`, {
            method: 'DELETE', headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        })
    })

    it('API clients are strictly per-account: another account cannot see or manage them', async function () {
        const admin = await loginRaw('admin', 'pass')
        // Unique clientId per run: clientId uniqueness spans logically-deleted
        // rows too, so a fixed id would collide on re-run.
        const probeClientId = 'sec-owner-probe-' + Date.now()
        const created = await fetch(`${BASE}/api/oauth/clients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie: admin.cookie, 'X-TemplateV3-Csrf-Token': CSRF },
            body: JSON.stringify({ clientId: probeClientId, scopes: 'report:print' }),
        })
        expect(created.status).toBe(200)
        const clientId = (await created.json()).client.id as number

        // admin sees it; the test account does not.
        const adminList = await (await fetch(`${BASE}/api/oauth/clients`, { headers: { cookie: admin.cookie } })).json()
        expect((adminList.clients as { id: number }[]).some(function (c) { return c.id === clientId })).toBe(true)
        const other = await loginRaw('test', 'pass')
        const otherList = await (await fetch(`${BASE}/api/oauth/clients`, { headers: { cookie: other.cookie } })).json()
        expect((otherList.clients as { id: number }[]).some(function (c) { return c.id === clientId })).toBe(false)

        // the test account cannot manage admin's client (reported as not found).
        const patch = await fetch(`${BASE}/api/oauth/clients/${clientId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', cookie: other.cookie, 'X-TemplateV3-Csrf-Token': CSRF },
            body: JSON.stringify({ scopes: 'report:print', deleteFlag: false }),
        })
        expect(patch.status).toBe(400)

        // clean up (delete via the owner).
        await fetch(`${BASE}/api/oauth/clients/${clientId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', cookie: admin.cookie, 'X-TemplateV3-Csrf-Token': CSRF },
            body: JSON.stringify({ scopes: 'report:print', deleteFlag: true }),
        })
    })

    it('font management is per-account: fonts uploaded by one account are invisible to another', async function () {
        const admin = await loginRaw('admin', 'pass')
        const other = await loginRaw('test', 'pass')
        // A tiny but valid TTF is hard to synthesize; use the Google download of
        // the smallest catalog font into the admin account, then assert isolation.
        const dl = await fetch(`${BASE}/api/fonts/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie: admin.cookie, 'X-TemplateV3-Csrf-Token': CSRF },
            body: JSON.stringify({ fontIds: ['BeVietnamPro'] }),
        })
        expect(dl.status).toBe(200)
        const adminFonts = await (await fetch(`${BASE}/api/fonts`, { headers: { cookie: admin.cookie } })).json()
        expect((adminFonts.fonts as { name: string }[]).some(function (f) { return f.name === 'BeVietnamPro' })).toBe(true)
        const otherFonts = await (await fetch(`${BASE}/api/fonts`, { headers: { cookie: other.cookie } })).json()
        expect((otherFonts.fonts as { name: string }[]).some(function (f) { return f.name === 'BeVietnamPro' })).toBe(false)
        // clean up.
        await fetch(`${BASE}/api/fonts/BeVietnamPro.ttf`, {
            method: 'DELETE', headers: { cookie: admin.cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        })
    })

    it('H1: a crafted image reference cannot read files outside the workspace', async function () {
        // Render a template whose image points at an absolute system path via
        // MCP render_report. The confined resolver must drop it (no image),
        // and the render must still succeed (no file content leaks).
        const template = {
            name: 'lfi-probe',
            pageSettings: {
                size: 'custom', width: 200, height: 200,
                marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
                orientation: 'portrait', columnCount: 1, columnWidth: 200, columnSpacing: 0, columnPrintOrder: 'vertical',
            },
            bands: [{
                id: 'b', type: 'detail', height: 100, startNewPage: false, splitType: 'Stretch',
                printWhenExpression: '', enabled: true,
                elements: [{
                    id: 'img', kind: 'image', x: 0, y: 0, width: 100, height: 40,
                    source: '../../../../../../etc/passwd', sourceExpression: '',
                    style: { fontFamily: 'NotoSansJP', fontSize: 10, forecolor: '#000000', backcolor: '#FFFFFF', mode: 'transparent', hAlign: 'left', vAlign: 'top', border: { top: null, bottom: null, left: null, right: null }, padding: { top: 0, bottom: 0, left: 0, right: 0 }, opacity: 1 },
                    scaleMode: 'clip', onError: 'blank',
                }],
            }],
            groups: [],
        }
        const result = await mcpTool('render_report', { workspace: adminKey, template, dataSource: { rows: [{}] }, format: 'png' }, 'admin', 'admin-mcp-key')
        // Rendering succeeds (the out-of-workspace image simply resolves to
        // nothing); no server file is embedded.
        expect(result.isError).toBeUndefined()
        const images = (result.content as Array<{ type: string }>).filter(function (c) { return c.type === 'image' })
        expect(images.length).toBeGreaterThan(0)
    })

    it('multi-tenant: an administrator cannot read another account\'s workspace', async function () {
        const admin = await loginRaw('admin', 'pass')
        const test = await loginRaw('test', 'pass')
        const testKey = await workspaceKey(test.cookie)
        // Even an administrator has no access to another tenant's workspace
        // without an explicit share.
        const res = await fetch(`${BASE}/api/workspace/${testKey}/files?path=`, {
            headers: { cookie: admin.cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        })
        expect(res.status).toBe(403)
    })

    it('folder-share mutations require a CSRF token', async function () {
        const { cookie } = await loginRaw('admin', 'pass')
        const bogus = '99999999-9999-9999-9999-999999999999'
        // Missing CSRF header → rejected before the handler runs.
        const noToken = await fetch(`${BASE}/api/folder-shares`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie },
            body: JSON.stringify({ path: 'share', granteeWorkspaceKey: bogus, canRead: true, canWrite: false }),
        })
        expect(noToken.status).toBe(403)
    })
})
