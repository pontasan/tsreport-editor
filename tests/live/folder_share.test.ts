import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE_EDITOR_BASE as BASE } from './live_environment'

// Live regression tests for cross-account folder sharing against a RUNNING
// tsreport-editor server. Run with `npm run test:live`.
//
// Prerequisites (seeded on first boot by SystemInitLogic):
// - Editor server on http://localhost:52005 (Docker, server/compose.yaml)
// - Administrator account admin/pass (owner side of the share here)
//
// Flow: admin (owner) shares a folder in its own workspace with a dedicated
// grantee account, then read/write access, revocation and non-disclosure of
// account existence are verified through the public workspace API.

const GRANTEE_USER_ID = 'live-share-grantee'
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

async function api(cookie: string, method: string, path: string, body?: object | FormData): Promise<{ status: number, body: any }> {
    const headers: Record<string, string> = { cookie, 'X-TemplateV3-Csrf-Token': CSRF }
    let payload: string | FormData | undefined
    if (body instanceof FormData) {
        payload = body
    } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify(body)
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
    const text = await res.text()
    return { status: res.status, body: text.length > 0 ? JSON.parse(text) : {} }
}

function uploadForm(subPath: string, name: string, content: string): FormData {
    const form = new FormData()
    form.set('file', new Blob([content]), name)
    form.set('path', subPath)
    return form
}

let admin = ''
let ownerKey = ''
let granteeCookie = ''
let granteeKey = ''

beforeAll(async function () {
    const cookie = await login('admin', 'pass')
    if (cookie === null) {
        throw new Error('tsreport-editor server is not running on ' + BASE + ' (start the Docker dev environment first)')
    }
    admin = cookie
    ownerKey = (await api(admin, 'GET', '/api/users/me')).body.user.workspaceKey

    // Fresh fixture folders in the owner's own workspace: share/ and private/.
    await api(admin, 'DELETE', `/api/workspace/${ownerKey}/files/share`)
    await api(admin, 'DELETE', `/api/workspace/${ownerKey}/files/private`)
    expect((await api(admin, 'POST', `/api/workspace/${ownerKey}/dirs`, { path: 'share' })).status).toBe(200)
    expect((await api(admin, 'POST', `/api/workspace/${ownerKey}/dirs`, { path: 'private' })).status).toBe(200)
    expect((await api(admin, 'POST', `/api/workspace/${ownerKey}/files`, uploadForm('share', 's.json', '{}'))).status).toBe(200)
    expect((await api(admin, 'POST', `/api/workspace/${ownerKey}/files`, uploadForm('private', 'p.json', '{}'))).status).toBe(200)

    // A dedicated grantee account.
    const users = await api(admin, 'GET', '/api/users')
    let row = users.body.users.find(function (u: { userId: string }) { return u.userId === GRANTEE_USER_ID })
    if (row === undefined) {
        row = (await api(admin, 'POST', '/api/users', {
            displayName: 'Share Recipient', userId: GRANTEE_USER_ID, pw: 'live-share-pass', adminFlag: false,
        })).body.user
    } else {
        row = (await api(admin, 'PATCH', `/api/users/${row.id}`, {
            displayName: 'Share Recipient', userId: GRANTEE_USER_ID, pw: 'live-share-pass',
            adminFlag: false, mcpEnabled: true, version: row.version,
        })).body.user
    }
    granteeCookie = await login(GRANTEE_USER_ID, 'live-share-pass') as string
    expect(granteeCookie).not.toBeNull()
    granteeKey = (await api(granteeCookie, 'GET', '/api/users/me')).body.user.workspaceKey
    expect(typeof granteeKey).toBe('string')
    expect(granteeKey).not.toBe(ownerKey)
}, 30000)

// Removes any existing share on 'share' so each run starts clean.
async function resetShare(): Promise<void> {
    const shares = (await api(admin, 'GET', '/api/folder-shares?path=share')).body.shares
    for (const s of shares) {
        await api(admin, 'DELETE', `/api/folder-shares/${s.id}`)
    }
}

describe('folder sharing (live)', function () {
    it('grants read-only access to the shared folder and nothing else', async function () {
        await resetShare()
        expect((await api(admin, 'POST', '/api/folder-shares', {
            path: 'share', granteeWorkspaceKey: granteeKey, canRead: true, canWrite: false,
        })).body).toEqual({ ok: true })

        // The grantee sees the shared folder in its overview.
        const tree = await api(granteeCookie, 'GET', '/api/workspace')
        const shared = tree.body.sharedIn.find(function (n: { ownerWorkspaceKey: string, path: string }) {
            return n.ownerWorkspaceKey === ownerKey && n.path === 'share'
        })
        expect(shared).toBeDefined()
        expect(shared.canRead).toBe(true)
        expect(shared.canWrite).toBe(false)

        // Read inside the shared folder; denied elsewhere in the owner's workspace.
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files?path=share`)).status).toBe(200)
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files/share/s.json`)).status).toBe(200)
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files/private/p.json`)).status).toBe(403)
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files?path=private`)).status).toBe(403)
        // The owner's workspace root is not listable by the grantee.
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files`)).status).toBe(403)

        // A read-only share cannot write.
        expect((await api(granteeCookie, 'POST', `/api/workspace/${ownerKey}/files`, uploadForm('share', 'w.json', '{}'))).status).toBe(403)
        expect((await api(granteeCookie, 'POST', `/api/workspace/${ownerKey}/dirs`, { path: 'share/sub' })).status).toBe(403)
    })

    it('grants write access when the share is upgraded, and revokes on deletion', async function () {
        await resetShare()
        expect((await api(admin, 'POST', '/api/folder-shares', {
            path: 'share', granteeWorkspaceKey: granteeKey, canRead: true, canWrite: false,
        })).body).toEqual({ ok: true })

        const share = (await api(admin, 'GET', '/api/folder-shares?path=share')).body.shares[0]
        expect((await api(admin, 'PATCH', `/api/folder-shares/${share.id}`, { canRead: true, canWrite: true, version: share.version })).status).toBe(200)

        // Now writable.
        expect((await api(granteeCookie, 'POST', `/api/workspace/${ownerKey}/files`, uploadForm('share', 'w.json', '{}'))).status).toBe(200)

        // Revoke: the shared folder disappears and access is denied again.
        expect((await api(admin, 'DELETE', `/api/folder-shares/${share.id}`)).status).toBe(200)
        const tree = await api(granteeCookie, 'GET', '/api/workspace')
        expect(tree.body.sharedIn.find(function (n: { ownerWorkspaceKey: string }) { return n.ownerWorkspaceKey === ownerKey })).toBeUndefined()
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files/share/s.json`)).status).toBe(403)
    })

    it('cross-tenant access to a non-shared workspace is denied', async function () {
        await resetShare()
        // The grantee cannot reach the owner's workspace with no share in place.
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files?path=share`)).status).toBe(403)
        expect((await api(granteeCookie, 'GET', `/api/workspace/${ownerKey}/files/share/s.json`)).status).toBe(403)
    })

    it('sharing to an unknown key returns { ok:false } without disclosing existence', async function () {
        const bogus = '99999999-9999-9999-9999-999999999999'
        const res = await api(admin, 'POST', '/api/folder-shares', {
            path: 'share', granteeWorkspaceKey: bogus, canRead: true, canWrite: false,
        })
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ ok: false })
    })

    it('exposes the account workspaceKey as a UUID via /api/users/me', async function () {
        const me = await api(admin, 'GET', '/api/users/me')
        expect(me.status).toBe(200)
        expect(me.body.user.workspaceKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })
})
