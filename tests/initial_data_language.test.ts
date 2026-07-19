import { describe, expect, it } from 'vitest'
import { INITIAL_ACCOUNT_DISPLAY_NAMES } from '../src/lib/server/logic/system_init_logic'

describe('initial account display names', function () {
    it('uses language-neutral seed display names', function () {
        expect(INITIAL_ACCOUNT_DISPLAY_NAMES).toEqual({ admin: 'Administrator', test: 'Test User' })
        expect(Object.values(INITIAL_ACCOUNT_DISPLAY_NAMES).join('')).not.toMatch(/[ぁ-んァ-ヶ一-龠々]/)
    })
})
