// Administrator: view and update the external sign-in (Google/Microsoft)
// provider configuration. The client secret is returned so the admin can see
// what is stored (consistent with the plaintext-secret scheme).

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { OAuthLoginLogic, type OAuthProvider } from '@/lib/server/logic/oauth_login_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type ProviderView = { enabled: boolean, clientId: string, clientSecret: string, callbackUrl: string }
type SettingsView = { google: ProviderView, microsoft: ProviderView }

export async function GET(req: NextRequest): Promise<NextResponse<SettingsView | ErrorInfo>> {
    const origin = req.nextUrl.origin
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        const google = await OAuthLoginLogic.loadConfig(client, 'google')
        const microsoft = await OAuthLoginLogic.loadConfig(client, 'microsoft')
        return NextResponse.json({
            google: { ...google, callbackUrl: OAuthLoginLogic.callbackUrl(origin, 'google') },
            microsoft: { ...microsoft, callbackUrl: OAuthLoginLogic.callbackUrl(origin, 'microsoft') },
        })
    })
}

export async function PATCH(req: NextRequest): Promise<NextResponse<{ ok: true } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        AuthLogic.checkAdmin(user)
        const body: { provider: string, enabled: boolean, clientId: string, clientSecret: string } = await req.json()
        if (!OAuthLoginLogic.isProvider(body.provider)) {
            throw new BusinessException('プロバイダが不正です。')
        }
        await OAuthLoginLogic.updateConfig(
            client,
            body.provider as OAuthProvider,
            body.enabled === true,
            body.clientId ?? '',
            body.clientSecret ?? '',
            user.id
        )
        return NextResponse.json({ ok: true })
    })
}
