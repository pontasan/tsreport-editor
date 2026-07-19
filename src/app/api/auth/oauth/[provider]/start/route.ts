// Begins external sign-in: redirects the browser to the provider's consent
// screen. A random state (CSRF for the OAuth flow) and nonce are stashed in
// short-lived httpOnly cookies and verified on the callback.

import { DEFAULT_LANGUAGE_CODE, resolveSupportedLanguage } from '@/lib/common/i18n/languages'
import { OAuthLoginLogic } from '@/lib/server/logic/oauth_login_logic'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
    const { provider } = await params
    if (!OAuthLoginLogic.isProvider(provider)) {
        return new NextResponse('Not Found', { status: 404 })
    }

    const config = await DbUtils.transaction(async function (client) {
        return await OAuthLoginLogic.loadConfig(client, provider)
    })
    if (!OAuthLoginLogic.isUsable(config)) {
        return new NextResponse('External sign-in is not enabled', { status: 404 })
    }

    const origin = req.nextUrl.origin
    const state = randomUUID()
    const nonce = randomUUID()
    // PKCE: keep the verifier server-side (cookie) and send only its challenge.
    // RFC 7636 verifier: 43 base64url chars carrying 256 bits of entropy.
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = OAuthLoginLogic.pkceChallenge(codeVerifier)
    // Only accept a supported language code for the post-login redirect path.
    const lang = resolveSupportedLanguage(req.nextUrl.searchParams.get('lang') ?? DEFAULT_LANGUAGE_CODE)
    const authorizeUrl = OAuthLoginLogic.buildAuthorizeUrl(config, provider, origin, state, nonce, codeChallenge)

    const res = NextResponse.redirect(authorizeUrl)
    const cookie = 'Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=600'
    res.headers.append('Set-Cookie', `oauth_state=${state}; ${cookie}`)
    res.headers.append('Set-Cookie', `oauth_nonce=${nonce}; ${cookie}`)
    res.headers.append('Set-Cookie', `oauth_verifier=${codeVerifier}; ${cookie}`)
    res.headers.append('Set-Cookie', `oauth_lang=${lang}; ${cookie}`)
    return res
}
