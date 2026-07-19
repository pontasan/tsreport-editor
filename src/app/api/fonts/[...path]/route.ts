// Per-account font binary delivery and deletion.
// GET serves a font file from the session account's directory (used by the
// editor canvas). DELETE removes it. Path is confined to the account dir.

import { readFile, stat } from 'fs/promises'
import { extname, join, resolve } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { FontAdminLogic } from '@/lib/server/logic/font_admin_logic'
import { fontDirForAccount } from '@/lib/server/logic/font_resolver'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { AuthenticationException } from '@/lib/common/exception/authentication_exception'

const CONTENT_TYPES: Record<string, string> = {
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttc': 'font/collection',
    '.otc': 'font/collection',
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    let accountId: number
    try {
        accountId = await DbUtils.transaction(async function (client) {
            const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
            return user.id!
        })
    } catch (e) {
        if (e instanceof AuthenticationException) return new NextResponse('Unauthorized', { status: 401 })
        throw e
    }

    const { path } = await params
    for (let i = 0; i < path.length; i++) {
        if (path[i] === '..' || path[i] === '.') {
            return new NextResponse('Forbidden', { status: 403 })
        }
    }
    const fontDir = fontDirForAccount(accountId)
    const filePath = resolve(join(fontDir, ...path))
    if (!filePath.startsWith(fontDir + '/')) {
        return new NextResponse('Forbidden', { status: 403 })
    }
    const s = await stat(filePath).catch(() => null)
    if (s === null || !s.isFile()) {
        return new NextResponse('Not Found', { status: 404 })
    }
    const buffer = await readFile(filePath)
    const ext = extname(filePath).toLowerCase()
    return new NextResponse(buffer, {
        headers: {
            'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
            'Cache-Control': 'private, max-age=86400',
        },
    })
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse<{ deleted: string } | ErrorInfo>> {
    const { path } = await params
    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        // Only a bare file name inside the account dir may be deleted.
        await FontAdminLogic.deleteFont(user.id!, path.join('/'))
        return NextResponse.json({ deleted: path.join('/') })
    })
}
