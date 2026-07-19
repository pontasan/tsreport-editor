import { describe, expect, test } from 'vitest'
import { ClientBase } from 'pg'
import { BusinessException } from '../src/lib/common/exception/business_exception'
import { ConsistencyException } from '../src/lib/common/exception/consistency_exception'
import { NotFoundException } from '../src/lib/common/exception/not_found_exception'
import { FolderShareLogic } from '../src/lib/server/logic/folder_share_logic'
import type { UserAccount } from '../src/lib/server/entity/user_account'

const OWNER_KEY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const GRANTEE_KEY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function owner(): UserAccount.Type {
    return {
        id: 1, displayName: 'owner', userId: 'owner', pw: '', provider: 'local', externalId: '', email: '',
        workspaceKey: OWNER_KEY, adminFlag: false, mcpEnabled: true, mcpKey: 'k', version: 0,
    }
}

// A DB stub that answers the queries FolderShareLogic.createShareByKey issues.
// `grantee` is the row getByWorkspaceKey resolves to (undefined = not found).
function stubClient(grantee: Record<string, unknown> | undefined): { client: ClientBase, inserted: boolean } {
    const state = { inserted: false }
    const stub = {
        query: async function (config: unknown): Promise<{ rowCount: number, rows: Record<string, unknown>[] }> {
            const text = (config as { text: string }).text
            if (text.includes('workspaceKey = ')) {
                return { rowCount: grantee === undefined ? 0 : 1, rows: grantee === undefined ? [] : [grantee] }
            }
            if (text.includes("NEXTVAL('FolderShareSeq')")) {
                return { rowCount: 1, rows: [{ id: 99 }] }
            }
            if (text.includes('FolderShare.fkGranteeAccount =')) {
                // getByTriple: no existing share.
                return { rowCount: 0, rows: [] }
            }
            if (text.includes('INSERT INTO FolderShare')) {
                state.inserted = true
                return { rowCount: 1, rows: [] }
            }
            return { rowCount: 0, rows: [] }
        },
    }
    return { client: stub as unknown as ClientBase, inserted: state.inserted }
}

function granteeRow(id: number): Record<string, unknown> {
    return {
        id, displayName: 'g', userId: 'g', pw: '', provider: 'local', externalId: '', email: '',
        workspaceKey: GRANTEE_KEY, adminFlag: false, mcpEnabled: true, mcpKey: 'k', version: 0,
    }
}

describe('FolderShareLogic.createShareByKey', function () {
    test('rejects an empty folder path', async function () {
        const { client } = stubClient(granteeRow(2))
        await expect(FolderShareLogic.createShareByKey(client, owner(), '', GRANTEE_KEY, true, false)).rejects.toThrow(BusinessException)
    })

    test('rejects a traversal folder path', async function () {
        const { client } = stubClient(granteeRow(2))
        await expect(FolderShareLogic.createShareByKey(client, owner(), '../x', GRANTEE_KEY, true, false)).rejects.toThrow(BusinessException)
    })

    test('rejects a share with no read and no write permission', async function () {
        const { client } = stubClient(granteeRow(2))
        await expect(FolderShareLogic.createShareByKey(client, owner(), 'designs', GRANTEE_KEY, false, false)).rejects.toThrow(BusinessException)
    })

    test('returns { ok:false } for an unknown grantee key (existence not disclosed)', async function () {
        const { client } = stubClient(undefined)
        const result = await FolderShareLogic.createShareByKey(client, owner(), 'designs', GRANTEE_KEY, true, false)
        expect(result).toEqual({ ok: false })
    })

    test('returns { ok:false } when sharing with oneself (same neutral result)', async function () {
        // Grantee resolves to the owner's own account id.
        const { client } = stubClient(granteeRow(1))
        const result = await FolderShareLogic.createShareByKey(client, owner(), 'designs', GRANTEE_KEY, true, false)
        expect(result).toEqual({ ok: false })
    })

    test('returns { ok:true } for a valid new share', async function () {
        const { client } = stubClient(granteeRow(2))
        const result = await FolderShareLogic.createShareByKey(client, owner(), 'designs', GRANTEE_KEY, true, true)
        expect(result).toEqual({ ok: true })
    })
})

// A DB stub that records the SQL text of every query and answers each with a
// caller-supplied rowCount (keyed by the leading SQL verb).
function recordingClient(rowCounts: { select?: number, update?: number, delete?: number }, selectRows: Record<string, unknown>[] = []): { client: ClientBase, texts: string[] } {
    const texts: string[] = []
    const stub = {
        query: async function (config: unknown): Promise<{ rowCount: number, rows: Record<string, unknown>[] }> {
            const text = (config as { text: string }).text
            texts.push(text)
            const trimmed = text.trimStart()
            if (trimmed.startsWith('UPDATE')) {
                return { rowCount: rowCounts.update ?? 0, rows: [] }
            }
            if (trimmed.startsWith('DELETE')) {
                return { rowCount: rowCounts.delete ?? 0, rows: [] }
            }
            // SELECT (getById etc.)
            return { rowCount: rowCounts.select ?? selectRows.length, rows: selectRows }
        },
    }
    return { client: stub as unknown as ClientBase, texts }
}

const ownedShareRow = { id: 5, fkOwnerAccount: 1, fkGranteeAccount: 2, path: 'designs', canRead: true, canWrite: true, version: 0 }

describe('FolderShareLogic.updatePermissions', function () {
    test('throws ConsistencyException when the optimistic update matches no row', async function () {
        const { client } = recordingClient({ select: 1, update: 0 }, [ownedShareRow])
        await expect(FolderShareLogic.updatePermissions(client, owner(), 5, true, false, 0)).rejects.toThrow(ConsistencyException)
    })

    test('succeeds when the update matches exactly one row', async function () {
        const { client } = recordingClient({ select: 1, update: 1 }, [ownedShareRow])
        await expect(FolderShareLogic.updatePermissions(client, owner(), 5, true, false, 0)).resolves.toBeUndefined()
    })
})

describe('FolderShareLogic.rejectIncomingShare', function () {
    test('removes a share targeting the grantee', async function () {
        const { client, texts } = recordingClient({ delete: 1 })
        await FolderShareLogic.rejectIncomingShare(client, owner(), 7)
        expect(texts.some(function (t) { return t.includes('DELETE') && t.includes('fkGranteeAccount') })).toBe(true)
    })

    test('throws NotFound when no matching incoming share exists', async function () {
        const { client } = recordingClient({ delete: 0 })
        await expect(FolderShareLogic.rejectIncomingShare(client, owner(), 7)).rejects.toThrow(NotFoundException)
    })
})

const ownerRow = { id: 1, workspaceKey: OWNER_KEY }

describe('FolderShareLogic owner folder reorganization', function () {
    test('onOwnerFolderDeleted resolves the owner by workspaceKey then drops the subtree shares', async function () {
        const { client, texts } = recordingClient({ select: 1, delete: 2 }, [ownerRow])
        await FolderShareLogic.onOwnerFolderDeleted(client, OWNER_KEY, 'designs')
        expect(texts.some(function (t) { return t.includes('workspaceKey = ') })).toBe(true)
        expect(texts.some(function (t) { return t.includes('DELETE') && t.includes('starts_with(FolderShare.path') })).toBe(true)
    })

    test('onOwnerFolderRenamed repaths the subtree shares, dropping any stale destination shares first', async function () {
        const { client, texts } = recordingClient({ select: 1, update: 1, delete: 1 }, [ownerRow])
        await FolderShareLogic.onOwnerFolderRenamed(client, OWNER_KEY, 'designs', 'blueprints')
        expect(texts.some(function (t) { return t.includes('UPDATE') && t.includes('substr(FolderShare.path') })).toBe(true)
        // The destination-subtree DELETE runs before the repoint UPDATE so the
        // repoint can never collide with a stale same-path share.
        const deleteIdx = texts.findIndex(function (t) { return t.trimStart().startsWith('DELETE') })
        const updateIdx = texts.findIndex(function (t) { return t.trimStart().startsWith('UPDATE') })
        expect(deleteIdx).toBeGreaterThanOrEqual(0)
        expect(updateIdx).toBeGreaterThan(deleteIdx)
    })

    test('onOwnerFolderDeleted fails loudly when the workspace owner cannot be resolved', async function () {
        const { client } = recordingClient({ select: 0 }, [])
        await expect(FolderShareLogic.onOwnerFolderDeleted(client, OWNER_KEY, 'designs')).rejects.toThrow(BusinessException)
    })

    test('onOwnerFolderDeleted rejects an empty/root path', async function () {
        const { client } = recordingClient({ select: 1 }, [ownerRow])
        await expect(FolderShareLogic.onOwnerFolderDeleted(client, OWNER_KEY, '')).rejects.toThrow(BusinessException)
    })
})
