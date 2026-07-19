import { describe, expect, it } from 'vitest'
import { PasswordHash } from '../src/lib/server/logic/password_hash'

describe('PasswordHash', function () {
    it('creates an Argon2id PHC string with the approved parameters', async function () {
        const encoded = await PasswordHash.create('Correct Horse Battery Staple')
        expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
        expect(await PasswordHash.check(encoded, 'Correct Horse Battery Staple')).toEqual({
            valid: true,
            needsUpgrade: false,
        })
    })

    it('uses a unique random salt for every stored password', async function () {
        const first = await PasswordHash.create('same-password')
        const second = await PasswordHash.create('same-password')
        expect(first).not.toBe(second)
        expect((await PasswordHash.check(first, 'same-password')).valid).toBe(true)
        expect((await PasswordHash.check(second, 'same-password')).valid).toBe(true)
    })

    it('rejects an incorrect password and a modified digest', async function () {
        const encoded = await PasswordHash.create('right-password')
        expect((await PasswordHash.check(encoded, 'wrong-password')).valid).toBe(false)
        const parts = encoded.split('$')
        const digest = parts[5]
        parts[5] = (digest.startsWith('A') ? 'B' : 'A') + digest.slice(1)
        const modified = parts.join('$')
        expect((await PasswordHash.check(modified, 'right-password')).valid).toBe(false)
    })

    it('accepts a matching legacy plaintext value only for immediate upgrade', async function () {
        expect(await PasswordHash.check('legacy-password', 'legacy-password')).toEqual({
            valid: true,
            needsUpgrade: true,
        })
        expect(await PasswordHash.check('legacy-password', 'wrong-password')).toEqual({
            valid: false,
            needsUpgrade: false,
        })
    })

    it('performs an Argon2id check and rejects a missing account', async function () {
        expect(await PasswordHash.check(undefined, 'supplied-password')).toEqual({
            valid: false,
            needsUpgrade: false,
        })
    })
})
