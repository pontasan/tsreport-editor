import { describe, expect, test } from 'vitest'
import { ClientBase } from 'pg'
import { PrintHistoryLogic } from '../src/lib/server/logic/print_history_logic'

// Stub client: the LEFT JOIN listing query returns `rows`; the COUNT query
// returns `total`.
function stubClient(rows: Record<string, unknown>[], total: number): ClientBase {
    const stub = {
        query: async function (config: unknown): Promise<{ rowCount: number, rows: Record<string, unknown>[] }> {
            const text = (config as { text: string }).text
            if (text.includes('COUNT(*)')) {
                return { rowCount: 1, rows: [{ count: total }] }
            }
            return { rowCount: rows.length, rows }
        },
    }
    return stub as unknown as ClientBase
}

function row(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        id: 1, key: 'k1', via: 'api', workspace: 'ws', templatePath: 'a.report', format: 'pdf',
        status: 'completed', errorReason: null, pdfPath: '/var/nfs/report-pdf/k1.pdf',
        creation: new Date('2026-07-05T00:00:00Z'), clientId: 'client-1',
        ...overrides,
    }
}

describe('PrintHistoryLogic.listHistory', function () {
    test('maps a completed row as downloadable with its client id', async function () {
        const client = stubClient([row({})], 42)
        const page = await PrintHistoryLogic.listHistory(client, 5, 0, 20)
        expect(page.total).toBe(42)
        expect(page.items).toHaveLength(1)
        const item = page.items[0]
        expect(item.key).toBe('k1')
        expect(item.via).toBe('api')
        expect(item.clientId).toBe('client-1')
        expect(item.downloadable).toBe(true)
        expect(typeof item.creation).toBe('string')
    })

    test('a queued row (no pdf) is not downloadable', async function () {
        const client = stubClient([row({ status: 'queued', pdfPath: null })], 1)
        const page = await PrintHistoryLogic.listHistory(client, 5, 0, 20)
        expect(page.items[0].downloadable).toBe(false)
    })

    test('a completed row with no stored file is not downloadable', async function () {
        const client = stubClient([row({ pdfPath: null })], 1)
        const page = await PrintHistoryLogic.listHistory(client, 5, 0, 20)
        expect(page.items[0].downloadable).toBe(false)
    })

    test('null client id and error reason collapse to empty strings', async function () {
        const client = stubClient([row({ via: 'editor', clientId: null, errorReason: null })], 1)
        const page = await PrintHistoryLogic.listHistory(client, 5, 0, 20)
        expect(page.items[0].clientId).toBe('')
        expect(page.items[0].errorReason).toBe('')
    })

    test('an error row keeps its reason and is not downloadable', async function () {
        const client = stubClient([row({ status: 'error', pdfPath: null, errorReason: 'boom' })], 1)
        const page = await PrintHistoryLogic.listHistory(client, 5, 0, 20)
        expect(page.items[0].status).toBe('error')
        expect(page.items[0].errorReason).toBe('boom')
        expect(page.items[0].downloadable).toBe(false)
    })
})
