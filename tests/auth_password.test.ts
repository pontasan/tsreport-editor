import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthenticationException } from '../src/lib/common/exception/authentication_exception'
import { UserAccountDao } from '../src/lib/server/dao/user_account'
import { UserAccount } from '../src/lib/server/entity/user_account'
import { AuthLogic } from '../src/lib/server/logic/auth/auth_logic'
import { PasswordHash } from '../src/lib/server/logic/password_hash'
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

describe('AuthLogic password verification', function () {
    it('authenticates an Argon2id password without rewriting it', async function () {
        const stored = await PasswordHash.create('test-password')
        const row = account(stored)
        vi.spyOn(UserAccountDao, 'getLocalByUserIdForUpdate').mockResolvedValue(row)
        const update = vi.spyOn(UserAccountDao, 'update').mockResolvedValue(1)

        expect(await AuthLogic.checkAuth({} as ClientBase, 'user', 'test-password')).toBe(row)
        expect(update).not.toHaveBeenCalled()
    })

    it('rejects an incorrect password without updating the account', async function () {
        const row = account(await PasswordHash.create('test-password'))
        vi.spyOn(UserAccountDao, 'getLocalByUserIdForUpdate').mockResolvedValue(row)
        const update = vi.spyOn(UserAccountDao, 'update').mockResolvedValue(1)

        await expect(AuthLogic.checkAuth({} as ClientBase, 'user', 'wrong-password')).rejects.toThrow(AuthenticationException)
        expect(update).not.toHaveBeenCalled()
    })

    it('upgrades a matching legacy plaintext password during login', async function () {
        const row = account('legacy-password')
        vi.spyOn(UserAccountDao, 'getLocalByUserIdForUpdate').mockResolvedValue(row)
        const update = vi.spyOn(UserAccountDao, 'update').mockResolvedValue(1)

        const authenticated = await AuthLogic.checkAuth({} as ClientBase, 'user', 'legacy-password')
        expect(update).toHaveBeenCalledOnce()
        expect(authenticated.version).toBe(4)
        expect(PasswordHash.isArgon2id(authenticated.pw)).toBe(true)
        expect((await PasswordHash.check(authenticated.pw, 'legacy-password')).valid).toBe(true)
    })

    it('rejects an unknown or external account before password verification', async function () {
        vi.spyOn(UserAccountDao, 'getLocalByUserIdForUpdate').mockResolvedValue(undefined)
        await expect(AuthLogic.checkAuth({} as ClientBase, 'external', '')).rejects.toThrow(AuthenticationException)
    })
})
