import { OAuthTokenException } from '@/lib/common/exception/oauth_token_exception'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// OAuth 2.0 token endpoint (RFC 6749 Section 3.2 / OAuth 2.1) for the client
// credentials grant. Client authentication supports HTTP Basic (mandatory per
// RFC 6749 2.3.1) and credentials in the request body (client_secret_post).
// Errors use the RFC 6749 5.2 JSON format instead of the app's ErrorInfo.
export async function POST(req: NextRequest): Promise<NextResponse<OAuthTokenResponse | OAuthTokenErrorResponse>> {
    let usedBasicAuth = false
    try {
        const form = await req.formData()
        const grantType = stringValue(form.get('grant_type'))
        const scope = stringValue(form.get('scope'))

        let clientId: string
        let clientSecret: string
        const authorization = req.headers.get('authorization')
        if (authorization !== null && authorization.startsWith('Basic ')) {
            usedBasicAuth = true
            const basic = parseBasicCredentials(authorization.substring(6))
            clientId = basic.clientId
            clientSecret = basic.clientSecret
            if (form.get('client_id') !== null && stringValue(form.get('client_id')) !== clientId) {
                throw new OAuthTokenException('invalid_request', 'client_idがBasic認証と一致しません。')
            }
        } else {
            clientId = stringValue(form.get('client_id'))
            clientSecret = stringValue(form.get('client_secret'))
        }
        if (clientId === '') {
            throw new OAuthTokenException('invalid_client', 'クライアント認証情報が指定されていません。')
        }

        if (grantType === '') {
            throw new OAuthTokenException('invalid_request', 'grant_typeを指定してください。')
        }
        if (grantType !== 'client_credentials') {
            throw new OAuthTokenException('unsupported_grant_type', 'grant_typeにはclient_credentialsを指定してください。')
        }

        const token = await DbUtils.transaction(async function (client) {
            return await ReportApiLogic.createAccessToken(client, clientId, clientSecret, scope)
        })
        return NextResponse.json({
            access_token: token.accessToken,
            token_type: 'Bearer' as const,
            expires_in: token.expiresIn,
            scope: token.scope
        }, {
            headers: {
                'Cache-Control': 'no-store',
                'Pragma': 'no-cache'
            }
        })
    } catch (e) {
        if (e instanceof OAuthTokenException) {
            return buildErrorResponse(e, usedBasicAuth)
        }
        console.log(e)
        return NextResponse.json(
            { error: 'invalid_request', error_description: 'サーバーエラー' },
            { status: 500, headers: { 'Cache-Control': 'no-store' } }
        )
    }
}

type OAuthTokenResponse = {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    scope: string
}

type OAuthTokenErrorResponse = {
    error: string
    error_description?: string
}

function buildErrorResponse(e: OAuthTokenException, usedBasicAuth: boolean): NextResponse<OAuthTokenErrorResponse> {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
    let status = 400
    if (e.code === 'invalid_client') {
        // RFC 6749 5.2: invalid_client responds with 401; when the client attempted
        // Basic authentication, include a matching WWW-Authenticate header.
        status = 401
        if (usedBasicAuth) {
            headers['WWW-Authenticate'] = 'Basic realm="tsreport", charset="UTF-8"'
        }
    }
    return NextResponse.json({ error: e.code, error_description: e.description }, { status, headers })
}

function parseBasicCredentials(encoded: string): { clientId: string, clientSecret: string } {
    const decoded = Buffer.from(encoded.trim(), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator === -1) {
        throw new OAuthTokenException('invalid_request', 'Authorizationヘッダの形式が不正です。')
    }
    // RFC 6749 2.3.1: client_id / client_secret are form-urlencoded before Basic encoding
    try {
        return {
            clientId: decodeURIComponent(decoded.substring(0, separator)),
            clientSecret: decodeURIComponent(decoded.substring(separator + 1))
        }
    } catch {
        throw new OAuthTokenException('invalid_request', 'Authorizationヘッダの形式が不正です。')
    }
}

function stringValue(value: FormDataEntryValue | null): string {
    return typeof value === 'string' ? value : ''
}
