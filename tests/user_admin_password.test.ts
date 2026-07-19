import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserAccountDao } from '../src/lib/server/dao/user_account'
import { UserAccount } from '../src/lib/server/entity/user_account'
import { PasswordHash } from '../src/lib/server/logic/password_hash'
import { UserAdminLogic } from '../src/lib/server/logic/user_admin_logic'
import { WorkspacePaths } from '../src/lib/server/logic/workspace_paths'
import type { ClientBase } from 'pg'

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

afterEach(function () {
    vi.restoreAllMocks()
})

describe('UserAdminLogic password storage', function () {
    it('hashes a password before creating a local account', async function () {
        vi.spyOn(UserAccountDao, 'getByUserId').mockResolvedValue(undefined)
        vi.spyOn(UserAccountDao, 'getSequenceId').mockResolvedValue(7)
        const insert = vi.spyOn(UserAccountDao, 'insert').mockResolvedValue()
        vi.spyOn(WorkspacePaths, 'ensureWorkspaceDir').mockResolvedValue()

        const created = await UserAdminLogic.createUser(
            {} as ClientBase,
            'User',
            'user',
            'create-pass-1',
            false,
            1
        )

        expect(insert).toHaveBeenCalledOnce()
        expect(PasswordHash.isArgon2id(created.pw)).toBe(true)
        expect((await PasswordHash.check(created.pw, 'create-pass-1')).valid).toBe(true)
    })

    it('hashes an administrator-supplied replacement password', async function () {
        const row = account(await PasswordHash.create('old-pass-1'))
        vi.spyOn(UserAccountDao, 'getById').mockResolvedValue(row)
        const update = vi.spyOn(UserAccountDao, 'update').mockResolvedValue(1)

        const updated = await UserAdminLogic.updateUser(
            {} as ClientBase,
            row.id!,
            row.displayName,
            row.userId,
            row.adminFlag,
            row.mcpEnabled,
            'replacement-pass-2',
            row.version,
            1
        )

        expect(update).toHaveBeenCalledOnce()
        expect(PasswordHash.isArgon2id(updated.pw)).toBe(true)
        expect((await PasswordHash.check(updated.pw, 'replacement-pass-2')).valid).toBe(true)
        expect((await PasswordHash.check(updated.pw, 'old-pass-1')).valid).toBe(false)
    })

    it('verifies the current password and hashes the new self-service password', async function () {
        const row = account(await PasswordHash.create('current-pass-1'))
        vi.spyOn(UserAccountDao, 'getLocalByUserIdForUpdate').mockResolvedValue(row)
        const update = vi.spyOn(UserAccountDao, 'update').mockResolvedValue(1)

        await UserAdminLogic.changeOwnPassword(
            {} as ClientBase,
            row,
            'current-pass-1',
            'new-pass-2'
        )

        expect(update).toHaveBeenCalledOnce()
        expect(PasswordHash.isArgon2id(row.pw)).toBe(true)
        expect((await PasswordHash.check(row.pw, 'new-pass-2')).valid).toBe(true)
        expect((await PasswordHash.check(row.pw, 'current-pass-1')).valid).toBe(false)
    })
})
