import { ErrorInfo } from '@/lib/common/exception/error_info'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { ReportApiLogic, TemplateTagInfo } from '@/lib/server/logic/report_api_logic'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<{ tags: TemplateTagInfo[] } | ErrorInfo>> {
    const { name } = await params
    const templatePath = req.nextUrl.searchParams.get('path') ?? ''

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        WorkspaceAccessLogic.checkRead(await WorkspaceAccessLogic.loadAccess(client, user), name, templatePath)
        const tags = await ReportApiLogic.listTemplateTags(client, name, templatePath)
        return NextResponse.json({ tags })
    })
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse<{ tag: TemplateTagInfo } | ErrorInfo>> {
    const { name } = await params

    return await ServerExceptionHandler.handleWithTx(async function (client) {
        const body: CreateTemplateTagRequest = await req.json()
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(req.cookies, 'token'))
        validateTemplatePath(body.templatePath)
        WorkspaceAccessLogic.checkWrite(await WorkspaceAccessLogic.loadAccess(client, user), name, body.templatePath)
        if (typeof body.templateJson !== 'string' || body.templateJson === '') {
            throw new BusinessException('テンプレートJSONが指定されていません。')
        }
        const tag = await ReportApiLogic.createTemplateTag(
            client,
            name,
            body.templatePath,
            body.tag,
            body.description,
            body.templateJson,
            user.id
        )
        return NextResponse.json({
            tag: {
                tag: tag.tag,
                description: tag.description,
                endpoint: tag.endpoint,
                creation: tag.creation
            }
        })
    })
}

type CreateTemplateTagRequest = {
    templatePath: string
    tag: string
    description: string
    templateJson: string
}

function validateTemplatePath(templatePath: string): void {
    if (templatePath === '' || templatePath.indexOf('..') !== -1 || !templatePath.endsWith('.report')) {
        throw new BusinessException('テンプレートパスが不正です。')
    }
}
