import { create as createErrorInfo } from "@/lib/common/exception/error_info";
import { SUPPORTED_LANGUAGE_CODES, DEFAULT_LANGUAGE_CODE } from "@/lib/common/i18n/languages";
import Negotiator from "negotiator";
import { NextRequest, NextResponse } from "next/server";
import { StringUtils } from "./lib/common/utils/string_utils";

const ENABLE_CSRF = true // Enable CSRF protection for cookie-authenticated state-changing APIs
// State-changing HTTP methods that must carry a valid CSRF token.
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
// Paths exempt from CSRF: they authenticate with a Bearer/account token or a
// batch secret (not the session cookie), so they are not cookie-CSRF targets.
// Prefixes end with "/" to avoid matching unrelated siblings (e.g. the MCP
// endpoint "/api/mcp" must not exempt the cookie-authed "/api/mcp-settings").
// NOTE: "/api/oauth/" as a whole is NOT exempt — only the token endpoint uses
// client-credentials. The client/grant management routes under /api/oauth/
// (clients, clients/[id], .../secret, .../access-grants, access-grants/[id])
// are session-cookie authenticated and MUST keep CSRF protection.
// Logout is NOT exempt: it is a cookie-authenticated state change (it deletes
// the server-side session) and goes through fetchProxy, which carries the token.
const CSRF_EXEMPT_PREFIXES = ['/api/report/']
const CSRF_EXEMPT_EXACT = new Set(['/api/mcp', '/api/oauth/token'])
const SUPPORT_LANGUAGES = SUPPORTED_LANGUAGE_CODES // Supported language settings (see @/lib/common/i18n/languages)
const DEFAULT_SUPPORT_LOCALE = DEFAULT_LANGUAGE_CODE // Default language when unsupported or unknown

export async function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname
    const isAPI = pathname.startsWith('/api/') // Treated as an API request.
    const isResource = pathname.lastIndexOf('.') >= 0 // Treated as having an extension if a dot is present.

    // TODO: for the Node.js runtime
    // if (!isResource) {
    //     // If the path has no extension and was excluded from the resource check,
    //     // check whether the file exists under public.
    //     const baseDir = process.cwd()
    //     if (await FileUtils.exists(baseDir + `/public${pathname}`)) {
    //         isResource = true
    //     }
    // }

    if (isAPI) {
        // For APIs, handle CSRF processing etc.
        return handleAPI(request)
    }

    if (isResource) {
        // Skip the middleware for resources with an extension, such as images.
        return wrapNextResponse(NextResponse.next())
    }

    // Internationalization support starts here, implemented based on the following URL.
    // https://nextjs.org/docs/app/guides/internationalization

    // Skip the middleware if the path already contains a language identifier.
    for (const otherLang of SUPPORT_LANGUAGES) {
        if (pathname === `/${otherLang}` || pathname.startsWith(`/${otherLang}/`)) {
            return wrapNextResponse(NextResponse.next())
        }
    }

    // The path does not contain a language identifier, so derive
    // the appropriate language from the request headers and redirect to the localized page.
    const lang = getLanguage(request)
    request.nextUrl.pathname = `/${lang}${pathname}`
    return wrapNextResponse(NextResponse.redirect(request.nextUrl))
}

function getLanguage(request: NextRequest): string {
    const negotiator = createNegotiator(request)
    const languages = negotiator.languages()

    let lang: string | undefined = undefined
    if (languages) {
        // Exact match first (case-insensitive), e.g. "zh-CN" -> "zh-CN".
        for (const reqLang of languages) {
            if (!reqLang) {
                continue
            }
            const normalizedLang = reqLang.toLowerCase().trim()
            for (const supportLang of SUPPORT_LANGUAGES) {
                if (normalizedLang === supportLang.toLowerCase()) {
                    lang = supportLang
                    break
                }
            }
            if (lang) {
                break
            }
        }
        // Fall back to the base language, e.g. "de-DE" -> "de", "zh" -> "zh-CN".
        if (!lang) {
            for (const reqLang of languages) {
                if (!reqLang) {
                    continue
                }
                const base = reqLang.toLowerCase().trim().split('-')[0]
                for (const supportLang of SUPPORT_LANGUAGES) {
                    if (supportLang.toLowerCase().split('-')[0] === base) {
                        lang = supportLang
                        break
                    }
                }
                if (lang) {
                    break
                }
            }
        }
    }

    if (!lang) {
        lang = DEFAULT_SUPPORT_LOCALE
    }

    return lang
}

function createNegotiator(request: NextRequest): Negotiator {
    const headers: Record<string, string> = {}

    for (const key of request.headers.keys()) {
        const value = request.headers.get(key)
        if (!value) {
            continue
        }

        headers[key] = value
    }

    return new Negotiator({ headers })
}

function handleAPI(request: NextRequest) {
    if (!ENABLE_CSRF) {
        return wrapNextResponse(NextResponse.next())
    }

    // Double-submit-cookie CSRF check for every cookie-authenticated
    // state-changing method. The csrf_token cookie (httpOnly, established by
    // the getCSRFToken server action) must match the X-TemplateV3-Csrf-Token
    // header that the client mirrors from the rendered token. Exempt paths use
    // token/secret auth instead of the session cookie.
    const pathname = request.nextUrl.pathname
    const isExempt = CSRF_EXEMPT_EXACT.has(pathname)
        || CSRF_EXEMPT_PREFIXES.some(function (prefix) { return pathname.startsWith(prefix) })
    if (CSRF_PROTECTED_METHODS.has(request.method) && !isExempt) {
        const cookieToken = request.cookies.has('csrf_token') ? StringUtils.nvl(request.cookies.get('csrf_token')!.value) : ''
        const headerToken = StringUtils.nvl(request.headers.get('X-TemplateV3-Csrf-Token'))
        if (cookieToken === '' || cookieToken !== headerToken) {
            // 403: Forbidden
            return wrapNextResponse(NextResponse.json({
                ...createErrorInfo(),
                statusCode: 403
            }, { status: 403 }))
        }
    }

    return wrapNextResponse(NextResponse.next())
}

function wrapNextResponse<T>(response: NextResponse<T>): NextResponse<T> {
    // TODO: post-processing such as adding response headers
    // response.headers.set('Content-Security-Policy', `img-src 'self';`)
    return response
}

export const config = {
    // runtime: 'nodejs',
    matcher: [
        // Skip all internal paths (_next)
        '/((?!_next).*)'
    ]
}
