import { createHash, timingSafeEqual } from 'node:crypto'
import { argon2id, hash, needsRehash, verify } from 'argon2'

const MEMORY_COST_KIB = 19 * 1024
const TIME_COST = 2
const PARALLELISM = 1
const HASH_LENGTH = 32
const ARGON2ID_PREFIX = '$argon2id$'
const MISSING_ACCOUNT_HASH = '$argon2id$v=19$m=19456,t=2,p=1$sNDmOK+NW5MtER6QVQ7ZSw$YWsPxUDdGzLpB9n3rTzP3ihMabeSd2+X6cvwLs4KvDg'

const HASH_OPTIONS = {
    type: argon2id,
    memoryCost: MEMORY_COST_KIB,
    timeCost: TIME_COST,
    parallelism: PARALLELISM,
    hashLength: HASH_LENGTH,
} as const

export type PasswordVerification = {
    valid: boolean
    needsUpgrade: boolean
}

export namespace PasswordHash {

    export async function create(password: string): Promise<string> {
        return await hash(password, HASH_OPTIONS)
    }

    export async function check(storedValue: string | undefined, password: string): Promise<PasswordVerification> {
        if (storedValue === undefined) {
            await verify(MISSING_ACCOUNT_HASH, password)
            return { valid: false, needsUpgrade: false }
        }
        if (!isArgon2id(storedValue)) {
            const valid = compareLegacyPlainText(storedValue, password)
            return { valid, needsUpgrade: valid }
        }
        const valid = await verify(storedValue, password)
        return {
            valid,
            needsUpgrade: valid && needsRehash(storedValue, HASH_OPTIONS),
        }
    }

    export function isArgon2id(storedValue: string): boolean {
        return storedValue.startsWith(ARGON2ID_PREFIX)
    }

}

// Legacy values are compared through equal-length digests so the temporary
// migration path does not reintroduce a length-dependent string comparison.
function compareLegacyPlainText(storedValue: string, password: string): boolean {
    const storedDigest = createHash('sha256').update(storedValue, 'utf8').digest()
    const suppliedDigest = createHash('sha256').update(password, 'utf8').digest()
    return timingSafeEqual(storedDigest, suppliedDigest)
}
