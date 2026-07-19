import { timingSafeEqual } from 'node:crypto'

// Constant-time comparison of two secret strings (tokens, keys, client
// secrets). Returns false on any length mismatch without leaking the position
// of the first differing byte, so response timing does not reveal the secret.
export function secretEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')
    if (bufA.length !== bufB.length) {
        return false
    }
    return timingSafeEqual(bufA, bufB)
}
