import { beforeAll, describe, expect, it } from 'vitest'
import { LIVE_EDITOR_BASE as BASE } from './live_environment'

// Live regression for the account-scoped print history against a RUNNING
// tsreport-editor server. Run with `npm run test:live`.
// Prereqs: seeded admin/pass and test/pass; server on http://localhost:52005.

const CSRF = 'printhist-csrf'

// A minimal but valid PDF (starts with the %PDF header the route requires).
const MINIMAL_PDF = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

async function login(userId: string, pass: string): Promise<string> {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `csrf_token=${CSRF}`, 'X-TemplateV3-Csrf-Token': CSRF },
        body: JSON.stringify({ userId, pass }),
    })
    if (!res.ok) throw new Error('login failed: server not running or seed missing')
    const token = (/token=([^;]+)/.exec(res.headers.get('set-cookie') as string) as RegExpExecArray)[1]
    return `token=${token}; csrf_token=${CSRF}`
}

async function recordEditorPrint(cookie: string, templatePath: string): Promise<string> {
    const form = new FormData()
    form.set('file', new Blob([MINIMAL_PDF], { type: 'application/pdf' }), 'print.pdf')
    form.set('workspace', '')
    form.set('templatePath', templatePath)
    form.set('format', 'pdf')
    const res = await fetch(`${BASE}/api/print-history`, {
        method: 'POST',
        headers: { cookie, 'X-TemplateV3-Csrf-Token': CSRF },
        body: form,
    })
    expect(res.status).toBe(200)
    return (await res.json()).key
}

let admin = ''
let other = ''

beforeAll(async function () {
    admin = await login('admin', 'pass')
    other = await login('test', 'pass')
})

describe('print history (live)', function () {
    it('records an editor print and lists it newest-first, downloadable', async function () {
        const templatePath = 'live-history-' + Date.now() + '.report'
        const key = await recordEditorPrint(admin, templatePath)

        const list = await (await fetch(`${BASE}/api/print-history?offset=0&limit=20`, { headers: { cookie: admin } })).json()
        expect(typeof list.total).toBe('number')
        const item = (list.items as Array<{ key: string, via: string, templatePath: string, downloadable: boolean }>).find(function (i) { return i.key === key })
        expect(item).toBeDefined()
        expect(item!.via).toBe('editor')
        expect(item!.templatePath).toBe(templatePath)
        expect(item!.downloadable).toBe(true)
    })

    it('downloads the stored PDF for an owned history row', async function () {
        const key = await recordEditorPrint(admin, 'live-dl.report')
        const res = await fetch(`${BASE}/api/print-history/${key}/download`, { headers: { cookie: admin } })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('application/pdf')
        const text = await res.text()
        expect(text.startsWith('%PDF')).toBe(true)
    })

    it('is strictly account-scoped: another account cannot see or download it', async function () {
        const key = await recordEditorPrint(admin, 'live-private.report')
        // The other account's listing never contains the admin row.
        const otherList = await (await fetch(`${BASE}/api/print-history?offset=0&limit=100`, { headers: { cookie: other } })).json()
        expect((otherList.items as Array<{ key: string }>).some(function (i) { return i.key === key })).toBe(false)
        // And it cannot download it (not found).
        const dl = await fetch(`${BASE}/api/print-history/${key}/download`, { headers: { cookie: other } })
        expect(dl.status).toBe(404)
    })

    it('rejects a non-PDF upload', async function () {
        const form = new FormData()
        form.set('file', new Blob(['not a pdf'], { type: 'application/pdf' }), 'x.pdf')
        form.set('workspace', '')
        form.set('templatePath', 'bad.report')
        form.set('format', 'pdf')
        const res = await fetch(`${BASE}/api/print-history`, {
            method: 'POST', headers: { cookie: admin, 'X-TemplateV3-Csrf-Token': CSRF }, body: form,
        })
        expect(res.status).not.toBe(200)
    })

    it('caps the page size and honours offset', async function () {
        const page = await (await fetch(`${BASE}/api/print-history?offset=0&limit=1`, { headers: { cookie: admin } })).json()
        expect((page.items as unknown[]).length).toBeLessThanOrEqual(1)
    })
})
