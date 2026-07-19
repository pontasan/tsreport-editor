import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE_EDITOR_BASE as BASE } from './live_environment'

// Live regression tests against a RUNNING tsreport-editor server.
//
// Covers the administrator account concept: seeded admin/pass account,
// admin-only user management APIs (create/update/delete), the
// "at least one administrator" invariant, own password change, and the
// factory reset authorization guard (the reset itself is NOT executed here
// because it wipes the whole environment; it is exercised manually / by
// dedicated verification scripts). Account deletion is physical: the row and
// all of its data are removed, and there is no restore.
//
// Prerequisites (seeded on first boot by SystemInitLogic):
// - Editor server on http://localhost:52005 (Docker, server/compose.yaml)
// - Administrator account admin/pass, regression account test/pass

// Stable login id reused across runs. Deletion physically removes the account,
// so a later run simply recreates it fresh.
const LIVE_USER_ID = 'live-user-mgmt'
// Double-submit CSRF token: the server only checks that the csrf_token cookie
// equals the X-TemplateV3-Csrf-Token header, both of which a same-origin client
// controls. A browser gets this from CsrfGuard; tests supply a fixed value.
const CSRF = 'live-csrf-token'

type LoginResult = { ok: boolean, cookie: string, user: UserRow }
type UserRow = {
    id: number
    displayName: string
    userId: string
    pw: string
    adminFlag: boolean
    version: number
}

async function login(userId: string, pass: string): Promise<LoginResult> {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `csrf_token=${CSRF}`, 'X-TemplateV3-Csrf-Token': CSRF },
        body: JSON.stringify({ userId, pass }),
    })
    if (!res.ok) {
        return { ok: false, cookie: '', user: undefined as unknown as UserRow }
    }
    const setCookie = res.headers.get('set-cookie') as string
    const cookie = `token=${(/token=([^;]+)/.exec(setCookie) as RegExpExecArray)[1]}; csrf_token=${CSRF}`
    const body = await res.json()
    return { ok: true, cookie, user: body.loginUser }
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

async function listUsers(cookie: string): Promise<UserRow[]> {
    const res = await api(cookie, 'GET', '/api/users')
    expect(res.status).toBe(200)
    return res.body.users
}

// Brings the fixed live-test user to a known state: an existing row (possibly
// renamed by an aborted earlier run) is reset, otherwise created.
async function provisionLiveUser(adminCookie: string, pw: string): Promise<UserRow> {
    const users = await listUsers(adminCookie)
    const existing = users.find(function (row) { return row.userId === LIVE_USER_ID || row.userId === LIVE_USER_ID + '-renamed' })
    if (existing === undefined) {
        const created = await api(adminCookie, 'POST', '/api/users', {
            displayName: 'Live Regression User', userId: LIVE_USER_ID, pw, adminFlag: false,
        })
        expect(created.status).toBe(200)
        return created.body.user
    }
    const updated = await api(adminCookie, 'PATCH', `/api/users/${existing.id}`, {
        displayName: 'Live Regression User', userId: LIVE_USER_ID, adminFlag: false, mcpEnabled: true, pw, version: existing.version,
    })
    expect(updated.status).toBe(200)
    return updated.body.user
}

let serverUp = false

beforeAll(async function () {
    // Fail explicitly (not silently skip) when the prerequisites are absent.
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'admin', pass: 'pass' }),
    }).catch(function () { return null })
    if (res === null) {
        throw new Error('tsreport-editor server is not running on ' + BASE + ' (start the Docker dev environment first)')
    }
    serverUp = true
})

describe('administrator accounts (live)', function () {
    it('seeded admin/pass logs in with adminFlag, test/pass without', async function () {
        expect(serverUp).toBe(true)
        const admin = await login('admin', 'pass')
        expect(admin.ok).toBe(true)
        expect(admin.user.displayName).toBe('Administrator')
        expect(admin.user.adminFlag).toBe(true)
        expect(admin.user.pw).toBe('')

        const regular = await login('test', 'pass')
        expect(regular.ok).toBe(true)
        expect(regular.user.displayName).toBe('Test User')
        expect(regular.user.adminFlag).toBe(false)
    })

    it('verify_session carries the admin flag', async function () {
        const admin = await login('admin', 'pass')
        const res = await api(admin.cookie, 'POST', '/api/auth/verify_session', {})
        expect(res.status).toBe(200)
        expect(res.body.loginUser.adminFlag).toBe(true)
    })

    it('non-admin is rejected from user management and factory reset', async function () {
        const regular = await login('test', 'pass')
        expect((await api(regular.cookie, 'GET', '/api/users')).status).toBe(403)
        expect((await api(regular.cookie, 'POST', '/api/users', { displayName: 'x', userId: 'x', pw: 'x', adminFlag: false })).status).toBe(403)
        expect((await api(regular.cookie, 'POST', '/api/system/factory-reset', {})).status).toBe(403)
    })
})

describe('user management (live)', function () {
    it('creates, updates and permanently deletes a user', async function () {
        const admin = await login('admin', 'pass')
        const user = await provisionLiveUser(admin.cookie, 'live-pass-1')

        // The created/reset account can log in.
        expect((await login(LIVE_USER_ID, 'live-pass-1')).ok).toBe(true)

        // Duplicate login id is rejected.
        const dup = await api(admin.cookie, 'POST', '/api/users', {
            displayName: 'x', userId: LIVE_USER_ID, pw: 'x', adminFlag: false,
        })
        expect(dup.status).toBe(400)

        // Admin renames the user and resets its password.
        const current = (await listUsers(admin.cookie)).find(function (row) { return row.id === user.id }) as UserRow
        const renamed = await api(admin.cookie, 'PATCH', `/api/users/${user.id}`, {
            displayName: 'Live Regression User Updated', userId: LIVE_USER_ID + '-renamed', adminFlag: false, mcpEnabled: true, pw: 'live-pass-2', version: current.version,
        })
        expect(renamed.status).toBe(200)
        expect((await login(LIVE_USER_ID, 'live-pass-1')).ok).toBe(false)
        expect((await login(LIVE_USER_ID + '-renamed', 'live-pass-2')).ok).toBe(true)

        // Stale optimistic-lock version is rejected.
        const stale = await api(admin.cookie, 'PATCH', `/api/users/${user.id}`, {
            displayName: 'x', userId: LIVE_USER_ID + '-renamed', adminFlag: false, mcpEnabled: true, pw: '', version: current.version,
        })
        expect(stale.status).toBe(400)

        // Physical delete: login stops working and the row is gone entirely.
        const del = await api(admin.cookie, 'DELETE', `/api/users/${user.id}`)
        expect(del.status).toBe(200)
        expect((await login(LIVE_USER_ID + '-renamed', 'live-pass-2')).ok).toBe(false)
        const stillThere = (await listUsers(admin.cookie)).find(function (row) { return row.id === user.id })
        expect(stillThere).toBeUndefined()

        // The login id is freed: it can be created again from scratch.
        const recreated = await api(admin.cookie, 'POST', '/api/users', {
            displayName: 'Live Regression User', userId: LIVE_USER_ID, pw: 'live-pass-1', adminFlag: false,
        })
        expect(recreated.status).toBe(200)
        expect((await login(LIVE_USER_ID, 'live-pass-1')).ok).toBe(true)
    })

    it('enforces the "at least one administrator" invariant', async function () {
        const admin = await login('admin', 'pass')
        const user = await provisionLiveUser(admin.cookie, 'live-pass-1')

        // Promote the live user: two admins exist, demoting it back is allowed.
        let row = (await listUsers(admin.cookie)).find(function (r) { return r.id === user.id }) as UserRow
        const promote = await api(admin.cookie, 'PATCH', `/api/users/${user.id}`, {
            displayName: row.displayName, userId: row.userId, adminFlag: true, mcpEnabled: true, pw: '', version: row.version,
        })
        expect(promote.status).toBe(200)
        row = (await listUsers(admin.cookie)).find(function (r) { return r.id === user.id }) as UserRow
        const demote = await api(admin.cookie, 'PATCH', `/api/users/${user.id}`, {
            displayName: row.displayName, userId: row.userId, adminFlag: false, mcpEnabled: true, pw: '', version: row.version,
        })
        expect(demote.status).toBe(200)

        // The seeded admin is now the sole admin: demoting or deleting it fails.
        const adminRow = (await listUsers(admin.cookie)).find(function (r) { return r.userId === 'admin' }) as UserRow
        const selfDemote = await api(admin.cookie, 'PATCH', `/api/users/${adminRow.id}`, {
            displayName: adminRow.displayName, userId: adminRow.userId, adminFlag: false, mcpEnabled: true, pw: '', version: adminRow.version,
        })
        expect(selfDemote.status).toBe(400)
        const selfDelete = await api(admin.cookie, 'DELETE', `/api/users/${adminRow.id}`)
        expect(selfDelete.status).toBe(400)
    })

    it('every account can change its own password (wrong current password rejected)', async function () {
        const admin = await login('admin', 'pass')
        await provisionLiveUser(admin.cookie, 'live-pass-1')

        const user = await login(LIVE_USER_ID, 'live-pass-1')
        expect(user.ok).toBe(true)

        const wrong = await api(user.cookie, 'PUT', '/api/users/password', { currentPw: 'wrong', newPw: 'live-pass-3' })
        expect(wrong.status).toBe(400)

        // Password policy (Microsoft personal account rules): reject a password
        // shorter than 8 characters, and one that uses only a single character
        // category (here lowercase only). Neither changes state (validation fails
        // before the update), so this stays idempotent across runs.
        const tooShort = await api(user.cookie, 'PUT', '/api/users/password', { currentPw: 'live-pass-1', newPw: 'Aa1!' })
        expect(tooShort.status).toBe(400)
        const singleCategory = await api(user.cookie, 'PUT', '/api/users/password', { currentPw: 'live-pass-1', newPw: 'aaaaaaaa' })
        expect(singleCategory.status).toBe(400)

        const changed = await api(user.cookie, 'PUT', '/api/users/password', { currentPw: 'live-pass-1', newPw: 'live-pass-3' })
        expect(changed.status).toBe(200)
        expect((await login(LIVE_USER_ID, 'live-pass-1')).ok).toBe(false)
        expect((await login(LIVE_USER_ID, 'live-pass-3')).ok).toBe(true)

        // Leave the account in the canonical state for the next run.
        const back = await api(user.cookie, 'PUT', '/api/users/password', { currentPw: 'live-pass-3', newPw: 'live-pass-1' })
        expect(back.status).toBe(200)
    })
})
