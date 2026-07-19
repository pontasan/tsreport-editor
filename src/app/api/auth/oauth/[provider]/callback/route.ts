// External sign-in callback: verifies the state, exchanges the code for the
// id_token, finds-or-creates the account, opens a session, and redirects to the
// editor. Errors bounce back to the login page with an error flag.

import { DEFAULT_LANGUAGE_CODE, resolveSupportedLanguage } from '@/lib/common/i18n/languages'
import { CommonDao } from '@/lib/server/dao/common'
import { SessionDao } from '@/lib/server/dao/session'
import { Session } from '@/lib/server/entity/session'
import { OAuthLoginLogic } from '@/lib/server/logic/oauth_login_logic'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { v4 as uuidv4 } from 'uuid'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
    const { provider } = await params
    const origin = req.nextUrl.origin
    // The language for the redirect path must be a supported code (it originates
    // from an attacker-influenceable query on /start), never injected verbatim.
    // The value is a bare code (the /start route stores it unencoded).
    const lang = resolveSupportedLanguage(NextUtils.getCookie(req.cookies, 'oauth_lang') || DEFAULT_LANGUAGE_CODE)

    if (!OAuthLoginLogic.isProvider(provider)) {
        return new NextResponse('Not Found', { status: 404 })
    }

    const code = req.nextUrl.searchParams.get('code') ?? ''
    const state = req.nextUrl.searchParams.get('state') ?? ''
    const expectedState = NextUtils.getCookie(req.cookies, 'oauth_state')
    const expectedNonce = NextUtils.getCookie(req.cookies, 'oauth_nonce')
    const codeVerifier = NextUtils.getCookie(req.cookies, 'oauth_verifier')

    // Verified state (OAuth-flow CSRF) and the PKCE verifier must be present, and
    // the state must match.
    if (code === '' || state === '' || expectedState === '' || state !== expectedState || codeVerifier === '') {
        return redirectToLogin(origin, lang, 'oauth')
    }

    let token = ''
    try {
        const config = await DbUtils.transaction(async function (client) {
            return await OAuthLoginLogic.loadConfig(client, provider)
        })
        if (!OAuthLoginLogic.isUsable(config)) {
            throw new Error('provider not enabled')
        }
        // The code exchange and JWKS signature verification are external HTTP
        // round-trips; run them before opening the account transaction so no
        // pooled DB connection is pinned across the network calls.
        const claims = await OAuthLoginLogic.exchangeCode(config, provider, origin, code, expectedNonce, codeVerifier)

        token = await DbUtils.transaction(async function (client) {
            const user = await OAuthLoginLogic.findOrCreateExternalAccount(client, provider, claims)

            const currentTime = await CommonDao.now(client)
            const newToken = uuidv4() + currentTime.getTime()
            const session: Session.Type = {
                ...Session.create(),
                fkUserAccount: user.id,
                token: newToken,
                createUser: user.id,
                updateUser: user.id,
            }
            await SessionDao.insert(client, session)
            await SessionDao.deleteExpiredSession(client)
            return newToken
        })
    } catch {
        return redirectToLogin(origin, lang, 'oauth')
    }

    // Success: set the session cookie, clear the transient oauth cookies, land in the editor.
    const res = NextResponse.redirect(`${origin}/${lang}/editor`)
    res.headers.append('Set-Cookie', `token=${token}; Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=28800;`)
    for (const name of ['oauth_state', 'oauth_nonce', 'oauth_verifier', 'oauth_lang']) {
        res.headers.append('Set-Cookie', `${name}=; Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=0;`)
    }
    return res
}

function redirectToLogin(origin: string, lang: string, error: string): NextResponse {
    // The login form renders at the language root (/{lang}), not /{lang}/login.
    return NextResponse.redirect(`${origin}/${lang}?error=${encodeURIComponent(error)}`)
}
