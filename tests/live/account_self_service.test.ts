import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE_EDITOR_BASE as BASE } from './live_environment'

// Live regression for self-service account settings and external sign-in
// discovery against a RUNNING tsreport-editor server.
// Prereqs: seeded admin/pass and test/pass; server on http://localhost:52005.

const CSRF = 'selfsvc-csrf'
const LIVE_USER_ID = 'live-selfsvc-user'

async function login(userId: string, pass: string): Promise<{ cookie: string, user: any }> {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `csrf_token=${CSRF}`, 'X-TemplateV3-Csrf-Token': CSRF },
        body: JSON.stringify({ userId, pass }),
    })
    if (!res.ok) throw new Error('login failed for ' + userId)
    const token = (/token=([^;]+)/.exec(res.headers.get('set-cookie') as string) as RegExpExecArray)[1]
    return { cookie: `token=${token}; csrf_token=${CSRF}`, user: (await res.json()).loginUser }
}

async function api(cookie: string, method: string, path: string, body?: object): Promise<{ status: number, body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text.length > 0 ? JSON.parse(text) : {} }
}

let admin = ''

beforeAll(async function () {
    admin = (await login('admin', 'pass')).cookie
})

describe('account self-service (live)', function () {

    it('exposes the enabled external providers publicly (none by default)', async function () {
        const res = await fetch(`${BASE}/api/auth/oauth/providers`)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(typeof body.google).toBe('boolean')
        expect(typeof body.microsoft).toBe('boolean')
    })

    it('a user can edit their own display name', async function () {
        // Provision a disposable local user via admin.
        const list = await api(admin, 'GET', '/api/users')
        const existing = (list.body.users as any[]).find(function (u) { return u.userId === LIVE_USER_ID })
        if (existing !== undefined) {
            await api(admin, 'PATCH', `/api/users/${existing.id}`, {
                displayName: 'Self-service User', userId: LIVE_USER_ID, adminFlag: false, mcpEnabled: true, pw: 'selfsvc-pass', version: existing.version,
            })
        } else {
            await api(admin, 'POST', '/api/users', { displayName: 'Self-service User', userId: LIVE_USER_ID, pw: 'selfsvc-pass', adminFlag: false })
        }

        const self = await login(LIVE_USER_ID, 'selfsvc-pass')
        const renamed = await api(self.cookie, 'PATCH', '/api/users/me', { displayName: 'Updated Display Name' })
        expect(renamed.status).toBe(200)
        expect(renamed.body.user.displayName).toBe('Updated Display Name')
        // verify_session reflects it.
        const vs = await api(self.cookie, 'POST', '/api/auth/verify_session')
        expect(vs.body.loginUser.displayName).toBe('Updated Display Name')
    })

    it('a user can delete their own account (退会) and the token is then rejected', async function () {
        const self = await login(LIVE_USER_ID, 'selfsvc-pass')
        const del = await api(self.cookie, 'DELETE', '/api/users/me')
        expect(del.status).toBe(200)
        // The session is revoked; the same cookie no longer authenticates.
        const after = await api(self.cookie, 'POST', '/api/auth/verify_session')
        expect(after.status).toBe(401)
        // Re-login fails (account is deleted).
        const relogin = await fetch(`${BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie: `csrf_token=${CSRF}`, 'X-TemplateV3-Csrf-Token': CSRF },
            body: JSON.stringify({ userId: LIVE_USER_ID, pass: 'selfsvc-pass' }),
        })
        expect(relogin.status).toBe(401)
    })

    it('the last active administrator cannot self-delete', async function () {
        // admin is the only seeded admin: 退会 must be blocked (400).
        const del = await api(admin, 'DELETE', '/api/users/me')
        expect(del.status).toBe(400)
        // admin still works.
        const vs = await api(admin, 'POST', '/api/auth/verify_session')
        expect(vs.status).toBe(200)
    })

    it('exposes the account workspaceKey (share id) via /api/users/me and verify_session', async function () {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        const me = await api(admin, 'GET', '/api/users/me')
        expect(me.status).toBe(200)
        expect(me.body.user.workspaceKey).toMatch(uuid)
        const vs = await api(admin, 'POST', '/api/auth/verify_session')
        expect(vs.body.loginUser.workspaceKey).toMatch(uuid)
    })
})
