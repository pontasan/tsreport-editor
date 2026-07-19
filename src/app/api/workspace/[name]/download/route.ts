import { lstat, readFile } from 'fs/promises'
import { basename } from 'path'
import { Readable } from 'stream'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { detectFileType } from '@/lib/server/utils/file_type_detector'
import { createZipArchive, downloadContentDisposition } from '@/lib/server/utils/zip_archive'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ name: string }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name } = await params
        const relativePath = request.nextUrl.searchParams.get('path') ?? ''
        const targetPath = WorkspacePaths.resolveInside(name, relativePath)

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkRead(access, name, relativePath)

        const targetStat = await lstat(targetPath).catch(function () { return null })
        if (targetStat === null || targetStat.isSymbolicLink()) {
            throw new BusinessException('対象が見つかりません')
        }

        if (targetStat.isFile()) {
            const data = await readFile(targetPath)
            const fileType = detectFileType(data)
            return new NextResponse(data, {
                headers: {
                    'Content-Type': fileType.mimeType,
                    'Content-Length': String(data.length),
                    'Content-Disposition': downloadContentDisposition(basename(relativePath)),
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                },
            })
        }

        if (!targetStat.isDirectory()) {
            throw new BusinessException('対象が見つかりません')
        }

        const folderName = relativePath === '' ? 'workspace' : basename(relativePath)
        const archive = Readable.from(createZipArchive(targetPath, folderName))
        const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': downloadContentDisposition(folderName + '.zip'),
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        })
    })
}
