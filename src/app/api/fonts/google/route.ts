// Google Fonts download for the session account.
// GET proposes candidate downloadable fonts for a language. POST downloads the
// chosen fonts into the account's font directory (auto-added to font management).

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FontAdminLogic, type AccountFontInfo, type LanguageProposal } from '@/lib/server/logic/font_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse<LanguageProposal | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const language = req.nextUrl.searchParams.get('language') ?? ''
        const proposal = await FontAdminLogic.proposeFonts(user.id!, language)
        return NextResponse.json(proposal)
    })
}

export async function POST(req: NextRequest): Promise<NextResponse<{ fonts: AccountFontInfo[] } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const body: { fontIds: string[] } = await req.json()
        const fontIds = Array.isArray(body.fontIds) ? body.fontIds : []
        // The download fetches from Google Fonts; the DB connection is only held
        // for the auth SELECT and takes no locks, so the network wait is safe.
        const fonts = await FontAdminLogic.downloadFonts(user.id!, fontIds)
        return NextResponse.json({ fonts })
    })
}
