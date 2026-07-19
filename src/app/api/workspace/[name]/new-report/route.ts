// Creates a new report file with a server-assigned, collision-free name inside a
// workspace folder. Uniqueness is guaranteed on the server by exclusive
// (O_EXCL / flag 'wx') file creation, so two concurrent requests can never end
// up producing the same file. The [name] segment is the owning workspaceKey.

import { writeFile } from 'fs/promises'
import { join } from 'path'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { WorkspaceActivityLogic } from '@/lib/server/logic/workspace_activity_logic'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Bounds the name search so a pathological folder cannot spin forever.
const MAX_NAME_ATTEMPTS = 10000

function isFileExists(e: unknown): boolean {
    return e instanceof Error && (e as NodeJS.ErrnoException).code === 'EEXIST'
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ name: string }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name } = await params
        const body: { folder?: string, baseName?: string, content?: string } = await request.json()
        const folder = typeof body.folder === 'string' ? body.folder : ''
        const content = typeof body.content === 'string' ? body.content : ''
        if (content === '') {
            throw new BusinessException('レポート内容が指定されていません')
        }
        // The base name is server-controlled (fixed prefix); only the numeric
        // suffix varies, so the generated file name can never traverse.
        const baseName = 'subreport'

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkWrite(access, name, folder)

        const folderDir = WorkspacePaths.resolveInside(name, folder)

        // Try subreport_1.report, subreport_2.report, ... creating the first one
        // that does not yet exist. 'wx' fails with EEXIST if the file is already
        // there (including a race with a concurrent request), so we retry.
        for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
            const fileName = baseName + '_' + attempt + '.report'
            const targetPath = join(folderDir, fileName)
            try {
                await writeFile(targetPath, content, { flag: 'wx' })
            } catch (e) {
                if (isFileExists(e)) {
                    continue
                }
                throw e
            }
            const relativePath = folder === '' ? fileName : folder + '/' + fileName
            await WorkspaceActivityLogic.publishFile(client, {
                workspace: name,
                path: relativePath,
                action: 'save',
                isDirectory: false,
                account: user.userId,
                via: 'editor',
                instance: request.headers.get('x-editor-instance') ?? ''
            })
            return NextResponse.json({ fileName, path: relativePath })
        }
        throw new BusinessException('サブレポートのファイル名を採番できませんでした')
    })
}
