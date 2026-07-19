import { NextRequest, NextResponse } from 'next/server'
import { ServerExceptionHandler } from '@/lib/server/exception/server_exception_handler'
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic'
import { resolveSubreportTemplateGraph } from '@/lib/server/logic/subreport_template_graph'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { NextUtils } from '@/lib/server/utils/next_utils'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ name: string }> }
) {
    return ServerExceptionHandler.handleWithTx(async function (client) {
        const { name } = await params
        const body = await request.json()
        // Resolving the subreport graph is part of opening the root template:
        // require access to that template (referenced subreports follow it).
        const user = await AuthLogic.checkToken(client, NextUtils.getCookie(request.cookies, 'token'))
        const rootPath = typeof body.rootPath === 'string' ? body.rootPath : ''
        const access = await WorkspaceAccessLogic.loadAccess(client, user)
        WorkspaceAccessLogic.checkRead(access, name, rootPath)
        const result = await resolveSubreportTemplateGraph({
            workspace: name,
            rootPath,
            rootTemplate: body.rootTemplate ?? {},
            templateExpression: typeof body.templateExpression === 'string' ? body.templateExpression : '',
            openReportTemplates: Array.isArray(body.openReportTemplates) ? body.openReportTemplates : [],
            // Child templates loaded from disk must be readable by the caller
            // (a subreport ref cannot reach a folder outside the caller's access).
            authorizePath: function (path: string): boolean {
                return WorkspaceAccessLogic.isReadable(access, name, path)
            },
        })
        return NextResponse.json(result)
    })
}
