// Public: which external sign-in providers are usable (for the login page).

import { OAuthLoginLogic } from '@/lib/server/logic/oauth_login_logic'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        return NextResponse.json(await OAuthLoginLogic.usableProviders(client))
    })
}
