// External sign-in (OpenID Connect) for Google and Microsoft.
//
// Authorization Code flow with a confidential client and PKCE: the code is
// exchanged for tokens server-to-server over TLS with our client secret. The
// id_token's RS256 signature is verified against the provider's published JWKS,
// and its aud / iss / exp / nonce claims are validated. First-time sign-in
// creates the account (self-signup); a returning identity logs in; a
// re-signed-in deleted account is reactivated.

import { BusinessException } from '@/lib/common/exception/business_exception'
import { AuthenticationException } from '@/lib/common/exception/authentication_exception'
import { SystemPropertyDao } from '@/lib/server/dao/SystemProperty'
import { SystemProperty } from '@/lib/server/entity/SystemProperty'
import { UserAccountDao } from '@/lib/server/dao/user_account'
import { UserAccount } from '@/lib/server/entity/user_account'
import { UserAdminLogic } from '@/lib/server/logic/user_admin_logic'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { createHash, createPublicKey, createVerify, randomUUID, type JsonWebKey as CryptoJsonWebKey, type KeyObject } from 'node:crypto'
import { ClientBase } from 'pg'

export type OAuthProvider = 'google' | 'microsoft'

type ProviderEndpoints = {
    authorizeUrl: string
    tokenUrl: string
    // JWKS endpoint publishing the provider's id_token signing keys.
    jwksUri: string
    scope: string
    // Acceptable id_token issuers (Microsoft's issuer is tenant-specific).
    isValidIssuer: (iss: string) => boolean
    // Whether the id_token asserts that its email is verified / owned by the
    // subject. Providers signal this differently: Google emits the standard
    // `email_verified` claim, while Microsoft never emits it and instead marks
    // email-domain-owner verification with `xms_edov` (its nOAuth remedy). An
    // email is only adopted when this returns true.
    //
    // Operational note (Microsoft): `xms_edov` is an OPTIONAL claim that Entra
    // only emits when the app registration explicitly requests it (Token
    // configuration → optional claims → xms_edov, with acceptMappedClaims where
    // applicable), and it is not available for personal Microsoft accounts on
    // the /common endpoint. Without that configuration a Microsoft sign-in
    // yields no verified email, so the account is created/kept with an empty
    // email (identity binding uses the immutable `sub`, never the email). To
    // capture Microsoft emails, configure the xms_edov optional claim.
    isEmailVerified: (payload: Record<string, unknown>) => boolean
}

const PROVIDERS: Record<OAuthProvider, ProviderEndpoints> = {
    google: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
        scope: 'openid email profile',
        isValidIssuer: function (iss) { return iss === 'https://accounts.google.com' || iss === 'accounts.google.com' },
        isEmailVerified: function (payload) { return payload.email_verified === true || payload.email_verified === 'true' },
    },
    microsoft: {
        authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
        scope: 'openid email profile',
        isValidIssuer: function (iss) { return iss.startsWith('https://login.microsoftonline.com/') },
        isEmailVerified: function (payload) { return payload.xms_edov === true || payload.xms_edov === 'true' },
    },
}

// A signing key (JWK) published by a provider's JWKS endpoint.
type Jwk = { kid?: string, kty?: string, alg?: string, use?: string, n?: string, e?: string }
type JwksCacheEntry = { keys: Jwk[], fetchedAt: number }
// Cache each provider's JWKS; providers rotate keys slowly, so a modest TTL
// avoids fetching the key set on every sign-in.
const JWKS_TTL_MS = 60 * 60 * 1000
const jwksCache: Partial<Record<OAuthProvider, JwksCacheEntry>> = {}

export type ProviderConfig = {
    enabled: boolean
    clientId: string
    clientSecret: string
}

export type IdTokenClaims = {
    sub: string
    email: string
    name: string
}

export namespace OAuthLoginLogic {

    export function isProvider(value: string): value is OAuthProvider {
        return value === 'google' || value === 'microsoft'
    }

    export async function loadConfig(client: ClientBase, provider: OAuthProvider): Promise<ProviderConfig> {
        const enabled = await SystemPropertyDao.findByKey(client, `oauth.${provider}.enabled`)
        const clientId = await SystemPropertyDao.findByKey(client, `oauth.${provider}.clientId`)
        const clientSecret = await SystemPropertyDao.findByKey(client, `oauth.${provider}.clientSecret`)
        return {
            enabled: enabled !== undefined && enabled.value === 'true',
            clientId: clientId !== undefined ? clientId.value : '',
            clientSecret: clientSecret !== undefined ? clientSecret.value : '',
        }
    }

    // A provider usable for sign-in: explicitly enabled and fully configured.
    export function isUsable(config: ProviderConfig): boolean {
        return config.enabled && config.clientId !== '' && config.clientSecret !== ''
    }

    export async function usableProviders(client: ClientBase): Promise<{ google: boolean, microsoft: boolean }> {
        return {
            google: isUsable(await loadConfig(client, 'google')),
            microsoft: isUsable(await loadConfig(client, 'microsoft')),
        }
    }

    // Administrator update of a provider's configuration (SystemProperty).
    export async function updateConfig(
        client: ClientBase,
        provider: OAuthProvider,
        enabled: boolean,
        clientId: string,
        clientSecret: string,
        operatorId: number | undefined,
    ): Promise<void> {
        await upsertProperty(client, `oauth.${provider}.enabled`, enabled ? 'true' : 'false', operatorId)
        await upsertProperty(client, `oauth.${provider}.clientId`, clientId, operatorId)
        await upsertProperty(client, `oauth.${provider}.clientSecret`, clientSecret, operatorId)
    }

    // Callback URL the provider redirects back to (must be registered with the
    // provider). Derived from the request origin so no base URL is stored.
    export function callbackUrl(origin: string, provider: OAuthProvider): string {
        return `${origin}/api/auth/oauth/${provider}/callback`
    }

    // PKCE code challenge (S256) for a verifier. The verifier is kept in a
    // short-lived cookie and replayed on the token exchange.
    export function pkceChallenge(verifier: string): string {
        return createHash('sha256').update(verifier).digest('base64url')
    }

    export function buildAuthorizeUrl(
        config: ProviderConfig,
        provider: OAuthProvider,
        origin: string,
        state: string,
        nonce: string,
        codeChallenge: string,
    ): string {
        const endpoints = PROVIDERS[provider]
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: callbackUrl(origin, provider),
            response_type: 'code',
            scope: endpoints.scope,
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            prompt: 'select_account',
        })
        return endpoints.authorizeUrl + '?' + params.toString()
    }

    // Exchanges the authorization code for the id_token and returns its claims.
    export async function exchangeCode(
        config: ProviderConfig,
        provider: OAuthProvider,
        origin: string,
        code: string,
        expectedNonce: string,
        codeVerifier: string,
    ): Promise<IdTokenClaims> {
        const endpoints = PROVIDERS[provider]
        const res = await fetch(endpoints.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: callbackUrl(origin, provider),
                client_id: config.clientId,
                client_secret: config.clientSecret,
                code_verifier: codeVerifier,
            }).toString(),
        })
        if (!res.ok) {
            throw new AuthenticationException()
        }
        const body = await res.json() as { id_token?: string }
        if (typeof body.id_token !== 'string') {
            throw new AuthenticationException()
        }
        return await verifyIdToken(body.id_token, provider, config.clientId, expectedNonce)
    }

    // Fetches (and caches) a provider's JWKS signing keys.
    async function fetchJwks(provider: OAuthProvider, forceRefresh: boolean): Promise<Jwk[]> {
        const cached = jwksCache[provider]
        if (!forceRefresh && cached !== undefined && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
            return cached.keys
        }
        const res = await fetch(PROVIDERS[provider].jwksUri, { headers: { Accept: 'application/json' } })
        if (!res.ok) {
            throw new AuthenticationException()
        }
        const body = await res.json() as { keys?: Jwk[] }
        if (!Array.isArray(body.keys)) {
            throw new AuthenticationException()
        }
        jwksCache[provider] = { keys: body.keys, fetchedAt: Date.now() }
        return body.keys
    }

    // Resolves the RSA public key for a given key id, refetching once on a miss
    // to tolerate provider key rotation.
    async function resolveSigningKey(provider: OAuthProvider, kid: string): Promise<KeyObject> {
        let keys = await fetchJwks(provider, false)
        let jwk = keys.find(function (k) { return k.kid === kid })
        if (jwk === undefined) {
            keys = await fetchJwks(provider, true)
            jwk = keys.find(function (k) { return k.kid === kid })
        }
        if (jwk === undefined || jwk.kty !== 'RSA') {
            throw new AuthenticationException()
        }
        return createPublicKey({ key: jwk as CryptoJsonWebKey, format: 'jwk' })
    }

    // Verifies the id_token's RS256 signature against the provider's JWKS and
    // returns the decoded payload.
    async function verifySignature(provider: OAuthProvider, parts: string[]): Promise<Record<string, unknown>> {
        let header: Record<string, unknown>
        try {
            header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf-8'))
        } catch {
            throw new AuthenticationException()
        }
        if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
            throw new AuthenticationException()
        }
        const key = await resolveSigningKey(provider, header.kid)
        const verifier = createVerify('RSA-SHA256')
        verifier.update(parts[0]! + '.' + parts[1]!)
        verifier.end()
        const signature = Buffer.from(parts[2]!, 'base64url')
        if (!verifier.verify(key, signature)) {
            throw new AuthenticationException()
        }
        try {
            return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'))
        } catch {
            throw new AuthenticationException()
        }
    }

    // Verifies the id_token's signature (JWKS/RS256) and its audience, issuer,
    // expiry and nonce, then extracts the identity claims. The email is only
    // adopted when the provider marks it verified.
    export async function verifyIdToken(idToken: string, provider: OAuthProvider, clientId: string, expectedNonce: string): Promise<IdTokenClaims> {
        const parts = idToken.split('.')
        if (parts.length !== 3) {
            throw new AuthenticationException()
        }
        const payload = await verifySignature(provider, parts)
        const aud = payload.aud
        const audOk = aud === clientId || (Array.isArray(aud) && aud.indexOf(clientId) !== -1)
        if (!audOk) {
            throw new AuthenticationException()
        }
        if (typeof payload.iss !== 'string' || !PROVIDERS[provider].isValidIssuer(payload.iss)) {
            throw new AuthenticationException()
        }
        // Expiry is mandatory: a token without a valid exp is rejected.
        if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
            throw new AuthenticationException()
        }
        // Nonce binding is mandatory: it must be present and match the value from
        // the sign-in request, preventing id_token replay/injection.
        if (expectedNonce === '' || payload.nonce !== expectedNonce) {
            throw new AuthenticationException()
        }
        const sub = payload.sub
        if (typeof sub !== 'string' || sub === '') {
            throw new AuthenticationException()
        }
        // Only trust the email if the provider verified it (Google: email_verified,
        // Microsoft: xms_edov). An unverified email is dropped to '' so it can never
        // be adopted or overwrite a previously verified address.
        const email = (PROVIDERS[provider].isEmailVerified(payload) && typeof payload.email === 'string') ? payload.email : ''
        const name = typeof payload.name === 'string' && payload.name !== '' ? payload.name : (email !== '' ? email : sub)
        return { sub, email, name }
    }

    async function upsertProperty(client: ClientBase, key: string, value: string, operatorId: number | undefined): Promise<void> {
        const existing = await SystemPropertyDao.findByKey(client, key)
        if (existing !== undefined) {
            existing.value = value
            existing.updateUser = operatorId
            await SystemPropertyDao.update(client, existing)
            return
        }
        const entity = SystemProperty.create()
        entity.id = await SystemPropertyDao.getSequenceId(client)
        entity.key = key
        entity.value = value
        entity.createUser = operatorId
        entity.updateUser = operatorId
        await SystemPropertyDao.insert(client, entity)
    }

    // Finds or creates the account for an external identity and returns it.
    export async function findOrCreateExternalAccount(
        client: ClientBase,
        provider: OAuthProvider,
        claims: IdTokenClaims,
    ): Promise<UserAccount.Type> {
        const existing = await UserAccountDao.getByExternalId(client, provider, claims.sub)
        if (existing !== undefined) {
            // Returning identity: refresh the profile. A deleted account no longer
            // exists (accounts are physically removed on withdrawal/deletion), so
            // a re-signup falls through to fresh account creation below.
            existing.displayName = claims.name
            // Only overwrite the stored email when the provider supplied a verified
            // one this sign-in. A provider that omits the verification signal (e.g.
            // Microsoft without xms_edov) yields an empty claims.email, which must
            // not wipe an address captured on an earlier verified sign-in.
            if (claims.email !== '') {
                existing.email = claims.email
            }
            existing.updateUser = existing.id
            const count = await UserAccountDao.update(client, existing)
            if (count !== 1) {
                throw new BusinessException('アカウントを更新できませんでした。')
            }
            existing.version = existing.version + 1
            return existing
        }

        const entity = UserAccount.create()
        entity.id = await UserAccountDao.getSequenceId(client)
        // A stable, unique, non-guessable login id for the external account.
        entity.userId = `${provider}:${claims.sub}`
        entity.displayName = claims.name
        entity.pw = ''
        entity.provider = provider
        entity.externalId = claims.sub
        entity.email = claims.email
        entity.workspaceKey = randomUUID()
        entity.adminFlag = false
        entity.mcpKey = UserAdminLogic.generateMcpKey()
        await UserAccountDao.insert(client, entity)
        await WorkspacePaths.ensureWorkspaceDir(entity.workspaceKey)
        return entity
    }

}
