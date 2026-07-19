import { afterEach, describe, expect, it, vi } from 'vitest'
import { SystemPropertyDao } from '../src/lib/server/dao/SystemProperty'
import { UserAccountDao } from '../src/lib/server/dao/user_account'
import { UserAccount } from '../src/lib/server/entity/user_account'
import { PasswordHash } from '../src/lib/server/logic/password_hash'
import { SystemInitLogic } from '../src/lib/server/logic/system_init_logic'
import { DbUtils } from '../src/lib/server/utils/db_utils'
import type { Client, ClientBase } from 'pg'

function account(storedPassword: string): UserAccount.Type {
    return {
        id: 7,
        displayName: 'User',
        userId: 'user',
        pw: storedPassword,
        provider: 'local',
        externalId: '',
        email: '',
        workspaceKey: '00000000-0000-0000-0000-000000000007',
        adminFlag: false,
        mcpEnabled: true,
        mcpKey: '',
        defaultColorMode: 'rgb',
        version: 3,
    }
}

function prepareInitializedSystem(rows: UserAccount.Type[]): void {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) } as unknown as ClientBase
    vi.spyOn(DbUtils, 'createDbClient').mockResolvedValue({ end: vi.fn() } as unknown as Client)
    vi.spyOn(DbUtils, 'transaction').mockImplementation(async function (callback) {
        return await callback(client)
    })
    vi.spyOn(SystemPropertyDao, 'findByKey').mockResolvedValue({} as never)
    vi.spyOn(UserAccountDao, 'listLocalPasswordAccountsForUpdate').mockResolvedValue(rows)
}

afterEach(function () {
    vi.restoreAllMocks()
})

describe('SystemInitLogic password migration', function () {
    it('converts existing local plaintext passwords at application startup', async function () {
        const row = account('legacy-password')
        prepareInitializedSystem([row])
        const update = vi.spyOn(UserAccountDao, 'update').mockResolvedValue(1)

        await SystemInitLogic.ensureInitialized({ workspacesRoot: '/workspaces', outputRoot: '/output', seedRoot: '/seed' })

        expect(update).toHaveBeenCalledOnce()
        expect(PasswordHash.isArgon2id(row.pw)).toBe(true)
        expect((await PasswordHash.check(row.pw, 'legacy-password')).valid).toBe(true)
    })

    it('leaves an existing Argon2id password unchanged', async function () {
        const stored = await PasswordHash.create('stored-password')
        const row = account(stored)
        prepareInitializedSystem([row])
        const update = vi.spyOn(UserAccountDao, 'update').mockResolvedValue(1)

        await SystemInitLogic.ensureInitialized({ workspacesRoot: '/workspaces', outputRoot: '/output', seedRoot: '/seed' })

        expect(update).not.toHaveBeenCalled()
        expect(row.pw).toBe(stored)
    })
})
