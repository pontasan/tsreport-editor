import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { OAuthLoginLogic } from '../src/lib/server/logic/oauth_login_logic'
import { AuthenticationException } from '../src/lib/common/exception/authentication_exception'

// A throwaway RSA key pair signs the test id_tokens; its public JWK is served
// through a stubbed global fetch as the providers' JWKS, so verifyIdToken
// exercises the real RS256 signature check end-to-end.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const JWK = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'test-key', alg: 'RS256', use: 'sig' }

function signIdToken(claims: Record<string, unknown>, headerOverrides: Record<string, unknown> = {}): string {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key', ...headerOverrides }
    const h = Buffer.from(JSON.stringify(header)).toString('base64url')
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const signer = createSign('RSA-SHA256')
    signer.update(`${h}.${p}`)
    signer.end()
    const sig = signer.sign(privateKey).toString('base64url')
    return `${h}.${p}.${sig}`
}

beforeAll(function () {
    vi.stubGlobal('fetch', vi.fn(async function () {
        return { ok: true, json: async function () { return { keys: [JWK] } } }
    }))
})

afterAll(function () {
    vi.unstubAllGlobals()
})

const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const FUTURE = Math.floor(Date.now() / 1000) + 3600

describe('OAuthLoginLogic.verifyIdToken', function () {
    test('extracts identity from a valid Google id_token', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 'g-sub-1', email: 'a@example.com', email_verified: true, name: 'Alice', nonce: 'n1' })
        const claims = await OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n1')
        expect(claims.sub).toBe('g-sub-1')
        expect(claims.email).toBe('a@example.com')
        expect(claims.name).toBe('Alice')
    })

    test('accepts an aud array containing the client id', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: ['other', CLIENT_ID], exp: FUTURE, sub: 's', nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n')).sub).toBe('s')
    })

    test('rejects a wrong audience', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: 'someone-else', exp: FUTURE, sub: 's', nonce: 'n' })
        await expect(OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n')).rejects.toThrow(AuthenticationException)
    })

    test('rejects a wrong issuer', async function () {
        const token = signIdToken({ iss: 'https://evil.example', aud: CLIENT_ID, exp: FUTURE, sub: 's', nonce: 'n' })
        await expect(OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n')).rejects.toThrow(AuthenticationException)
    })

    test('rejects an expired token', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) - 10, sub: 's', nonce: 'n' })
        await expect(OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n')).rejects.toThrow(AuthenticationException)
    })

    test('rejects a token with no expiry', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 's', nonce: 'n' })
        await expect(OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n')).rejects.toThrow(AuthenticationException)
    })

    test('rejects a nonce mismatch', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 's', nonce: 'other' })
        await expect(OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'expected')).rejects.toThrow(AuthenticationException)
    })

    test('rejects when no nonce is expected (empty expectedNonce)', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 's', nonce: 'n' })
        await expect(OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, '')).rejects.toThrow(AuthenticationException)
    })

    test('rejects a tampered signature', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 's', nonce: 'n' })
        const tampered = token.replace(/\.[^.]+$/, '.deadbeef')
        await expect(OAuthLoginLogic.verifyIdToken(tampered, 'google', CLIENT_ID, 'n')).rejects.toThrow(AuthenticationException)
    })

    test('rejects a non-RS256 algorithm', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 's', nonce: 'n' }, { alg: 'HS256' })
        await expect(OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n')).rejects.toThrow(AuthenticationException)
    })

    test('ignores an unverified email', async function () {
        const token = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 's', email: 'a@example.com', email_verified: false, name: 'Alice', nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(token, 'google', CLIENT_ID, 'n')).email).toBe('')
    })

    test('accepts a Microsoft tenant issuer', async function () {
        const token = signIdToken({ iss: 'https://login.microsoftonline.com/tenant-id/v2.0', aud: CLIENT_ID, exp: FUTURE, sub: 'm-sub', name: 'Bob', nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(token, 'microsoft', CLIENT_ID, 'n')).name).toBe('Bob')
    })

    test('adopts a Microsoft email only when xms_edov marks it verified', async function () {
        // Microsoft never emits email_verified; it signals email-domain-owner
        // verification with xms_edov, so that is the claim the check must read.
        const verified = signIdToken({ iss: 'https://login.microsoftonline.com/tenant-id/v2.0', aud: CLIENT_ID, exp: FUTURE, sub: 'm-sub', email: 'bob@contoso.com', xms_edov: true, name: 'Bob', nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(verified, 'microsoft', CLIENT_ID, 'n')).email).toBe('bob@contoso.com')
        // Without xms_edov the email is present but untrusted, so it is dropped.
        const unverified = signIdToken({ iss: 'https://login.microsoftonline.com/tenant-id/v2.0', aud: CLIENT_ID, exp: FUTURE, sub: 'm-sub', email: 'bob@contoso.com', name: 'Bob', nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(unverified, 'microsoft', CLIENT_ID, 'n')).email).toBe('')
    })

    test('a Google email_verified claim is not honored for Microsoft', async function () {
        // Cross-provider guard: the Google-style email_verified must not unlock a
        // Microsoft email, since Microsoft does not issue that claim.
        const token = signIdToken({ iss: 'https://login.microsoftonline.com/tenant-id/v2.0', aud: CLIENT_ID, exp: FUTURE, sub: 'm-sub', email: 'bob@contoso.com', email_verified: true, name: 'Bob', nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(token, 'microsoft', CLIENT_ID, 'n')).email).toBe('')
    })

    test('falls back to email then sub when name is absent', async function () {
        const withEmail = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 's', email: 'e@x.com', email_verified: true, nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(withEmail, 'google', CLIENT_ID, 'n')).name).toBe('e@x.com')
        const bare = signIdToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: FUTURE, sub: 'only-sub', nonce: 'n' })
        expect((await OAuthLoginLogic.verifyIdToken(bare, 'google', CLIENT_ID, 'n')).name).toBe('only-sub')
    })
})

describe('OAuthLoginLogic provider helpers', function () {
    test('isProvider only accepts google/microsoft', function () {
        expect(OAuthLoginLogic.isProvider('google')).toBe(true)
        expect(OAuthLoginLogic.isProvider('microsoft')).toBe(true)
        expect(OAuthLoginLogic.isProvider('facebook')).toBe(false)
    })

    test('isUsable requires enabled + both credentials', function () {
        expect(OAuthLoginLogic.isUsable({ enabled: true, clientId: 'a', clientSecret: 'b' })).toBe(true)
        expect(OAuthLoginLogic.isUsable({ enabled: false, clientId: 'a', clientSecret: 'b' })).toBe(false)
        expect(OAuthLoginLogic.isUsable({ enabled: true, clientId: '', clientSecret: 'b' })).toBe(false)
        expect(OAuthLoginLogic.isUsable({ enabled: true, clientId: 'a', clientSecret: '' })).toBe(false)
    })

    test('pkceChallenge is the S256 (base64url) hash of the verifier', function () {
        // RFC 7636 test vector.
        expect(OAuthLoginLogic.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
            .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    })

    test('callbackUrl and authorize URL are built from the origin, with PKCE', function () {
        expect(OAuthLoginLogic.callbackUrl('https://app.example.com', 'google')).toBe('https://app.example.com/api/auth/oauth/google/callback')
        const url = OAuthLoginLogic.buildAuthorizeUrl({ enabled: true, clientId: 'cid', clientSecret: 's' }, 'google', 'https://app.example.com', 'state1', 'nonce1', 'chal1')
        expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?')
        expect(url).toContain('client_id=cid')
        expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fauth%2Foauth%2Fgoogle%2Fcallback')
        expect(url).toContain('state=state1')
        expect(url).toContain('nonce=nonce1')
        expect(url).toContain('code_challenge=chal1')
        expect(url).toContain('code_challenge_method=S256')
    })
})
