// Per-account font catalog and upload.
// GET lists the session account's selectable fonts (internal drawing fonts are
// excluded — they are not selectable). POST uploads a font file into the
// account's font directory.

import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FontAdminLogic, type AccountFontInfo } from '@/lib/server/logic/font_admin_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// The editor canvas loads a font by GET /api/fonts/{path}; the list returns
// { name, path } so the existing loader keeps working, plus size for the UI.
type FontListEntry = { name: string, path: string, extension: string, size: number, version: string, familyName?: string, postScriptName?: string, fullName?: string }

export async function GET(req: NextRequest): Promise<NextResponse<{ fonts: FontListEntry[] } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const fonts = await FontAdminLogic.listFonts(user.id!)
        return NextResponse.json({ fonts: fonts.map(toListEntry) })
    })
}

export async function POST(req: NextRequest): Promise<NextResponse<{ font: AccountFontInfo } | ErrorInfo>> {
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        const formData = await req.formData()
        const file = formData.get('file')
        if (!(file instanceof File)) {
            throw new BusinessException('フォントファイルが指定されていません。')
        }
        const buffer = await file.arrayBuffer()
        const font = await FontAdminLogic.uploadFont(user.id!, file.name, buffer)
        return NextResponse.json({ font })
    })
}

function toListEntry(font: AccountFontInfo): FontListEntry {
    return { name: font.fontId, path: font.fileName, extension: font.extension, size: font.size, version: font.version, familyName: font.familyName, postScriptName: font.postScriptName, fullName: font.fullName }
}
