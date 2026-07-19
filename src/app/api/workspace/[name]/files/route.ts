// File listing and upload API. The [name] segment is the owning account's
// workspaceKey (own workspace, or a workspace shared with the caller).

import { readdir, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { WorkspaceActivityLogic } from '@/lib/server/logic/workspace_activity_logic'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

// Cap a single workspace upload so an authenticated tenant cannot exhaust
// server memory or the shared workspace volume with one oversized request.
// Matches the account font upload limit (large CJK fonts are ~5-16MB).
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

type FileEntry = {
    name: string
    isDirectory: boolean
    size: number
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ name: string }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name } = await params
        const subPath = request.nextUrl.searchParams.get('path') ?? ''

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkRead(access, name, subPath)

        const targetDir = WorkspacePaths.resolveInside(name, subPath)

        let items
        try {
            items = await readdir(targetDir)
        } catch {
            return NextResponse.json({ entries: [] })
        }

        const entries: FileEntry[] = []
        for (let i = 0; i < items.length; i++) {
            const fullPath = join(targetDir, items[i])
            const s = await stat(fullPath).catch(() => null)
            if (s === null) continue
            entries.push({
                name: items[i],
                isDirectory: s.isDirectory(),
                size: s.isFile() ? s.size : 0,
            })
        }
        entries.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
            return a.name.localeCompare(b.name)
        })
        return NextResponse.json({ entries })
    })
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ name: string }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name } = await params

        const formData = await request.formData()
        const file = formData.get('file') as File | null
        const subPath = (formData.get('path') as string) ?? ''

        if (file === null) {
            throw new BusinessException('ファイルが指定されていません')
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            throw new BusinessException('ファイルサイズが大きすぎます')
        }

        // The multipart filename is fully attacker-controlled: reduce it to a
        // bare name so it can neither traverse ("../") nor carry directory
        // separators. The destination directory comes solely from the
        // validated subPath.
        const baseName = basename(file.name.replace(/\\/g, '/'))
        if (baseName === '' || baseName === '.' || baseName === '..') {
            throw new BusinessException('ファイル名が不正です')
        }

        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        const relativeFilePath = subPath === '' ? baseName : subPath + '/' + baseName
        WorkspaceAccessLogic.checkWrite(access, name, relativeFilePath)

        const filePath = WorkspacePaths.resolveInside(name, relativeFilePath)

        const buffer = Buffer.from(await file.arrayBuffer())
        await writeFile(filePath, buffer)
        // Broadcast to other open editors (the saving browser filters out its
        // own events by the instance id it sent).
        await WorkspaceActivityLogic.publishFile(client, {
            workspace: name,
            path: relativeFilePath,
            action: 'save',
            isDirectory: false,
            account: user.userId,
            via: 'editor',
            instance: request.headers.get('x-editor-instance') ?? ''
        })
        return NextResponse.json({ name: file.name })
    })
}
