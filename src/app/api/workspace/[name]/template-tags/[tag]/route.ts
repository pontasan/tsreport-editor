import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { ReportApiLogic, TemplateTagDetailInfo } from '@/lib/server/logic/report_api_logic'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ name: string, tag: string }> }
): Promise<NextResponse<{ tag: TemplateTagDetailInfo } | ErrorInfo>> {
    const { name, tag } = await params
    const templatePath = req.nextUrl.searchParams.get('path') ?? ''

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        validateTemplatePath(templatePath)
        WorkspaceAccessLogic.checkRead(await WorkspaceAccessLogic.loadAccess(client, user), name, templatePath)
        const result = await ReportApiLogic.getTemplateTag(client, name, templatePath, tag)
        return NextResponse.json({ tag: result })
    })
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ name: string, tag: string }> }
): Promise<NextResponse<{ tag: TemplateTagDetailInfo } | ErrorInfo>> {
    const { name, tag } = await params

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const body: UpdateTemplateTagRequest = await req.json()
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        validateTemplatePath(body.templatePath)
        WorkspaceAccessLogic.checkWrite(await WorkspaceAccessLogic.loadAccess(client, user), name, body.templatePath)
        if (typeof body.templateJson !== 'string' || body.templateJson === '') {
            throw new BusinessException('テンプレートJSONが指定されていません。')
        }
        const result = await ReportApiLogic.updateTemplateTag(client, name, body.templatePath, tag, body.templateJson, user.id)
        return NextResponse.json({ tag: result })
    })
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ name: string, tag: string }> }
): Promise<NextResponse<Record<string, never> | ErrorInfo>> {
    const { name, tag } = await params
    const templatePath = req.nextUrl.searchParams.get('path') ?? ''

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        validateTemplatePath(templatePath)
        WorkspaceAccessLogic.checkWrite(await WorkspaceAccessLogic.loadAccess(client, user), name, templatePath)
        await ReportApiLogic.deleteTemplateTag(client, name, templatePath, tag)
        return NextResponse.json({})
    })
}

type UpdateTemplateTagRequest = {
    templatePath: string
    templateJson: string
}

function validateTemplatePath(templatePath: string): void {
    if (templatePath === '' || templatePath.indexOf('..') !== -1 || !templatePath.endsWith('.report')) {
        throw new BusinessException('テンプレートパスが不正です。')
    }
}
