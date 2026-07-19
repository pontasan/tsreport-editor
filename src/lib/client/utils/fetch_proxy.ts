import { AuthenticationException } from '@/lib/common/exception/authentication_exception'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ConsistencyException } from '@/lib/common/exception/consistency_exception'
import { ErrorInfo } from '@/lib/common/exception/error_info'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { GatewayTimeoutException } from '@/lib/common/exception/gateway_timeout_exception'
import { NetworkDisconnectionException } from '@/lib/common/exception/network_disconnection_exception'
import { SystemException } from '@/lib/common/exception/system_exception'
import { StringUtils } from '@/lib/common/utils/string_utils'

/**
  * Fetchwrapper.
  * Exception convert.
 */

// Identifies this browser tab across API calls. Workspace file-activity events
// carry the originating instance so the saving browser can ignore its own
// events (a self-triggered hot reload would wipe the undo history).
export const EDITOR_INSTANCE_ID = typeof window !== 'undefined' ? crypto.randomUUID() : ''

export async function fetchProxy(
    input: RequestInfo | URL,
    init?: RequestInit): Promise<Response> {

    if (typeof window === 'undefined') {
        throw new Error('fetchProxyはClient専用です。')
    }

    init = {
        ...init,
        headers: {
            ...(init !== undefined ? init.headers : undefined),
            'x-editor-instance': EDITOR_INSTANCE_ID
        }
    }

    // Attach the double-submit CSRF token to every state-changing method.
    // The token is a stable per-session value rendered into #___csrf___ by
    // CsrfGuard; the server (proxy.ts) checks it against the csrf_token cookie.
    const method = init && init.method ? init.method.toUpperCase() : 'GET'
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        const csrfTokenDom = document.querySelector('#___csrf___') as HTMLInputElement | undefined
        if (csrfTokenDom) {
            const csrfToken = StringUtils.nvl(csrfTokenDom.getAttribute('data-token'))
            init = {
                ...init,
                headers: {
                    ...init.headers,
                    'X-TemplateV3-Csrf-Token': csrfToken
                }
            }
        }
    }

    let result: Response | undefined = undefined
    try {
        result = await fetch(input, init)
    } catch (e) {
        if (e instanceof TypeError) {
            // With TypeError.
            // With, with.


            throw new NetworkDisconnectionException()
        }
        throw e
    }

    if (result.status === 200) {
        return result
    }

    if (result.status === 400) {
        // Bad Request
        const errorInfo: ErrorInfo = await result.json()
        throw new BusinessException(errorInfo.message)
    } else if (result.status === 401) {
        // Unauthorized
        throw new AuthenticationException()
    } else if (result.status === 403) {
        // Forbidden
        throw new ForbiddenException()
    } else if (result.status === 409) {
        // Conflict
        throw new ConsistencyException()
    } else if (result.status === 504) {
        // Gateway Timeout
        throw new GatewayTimeoutException()
    }

    // Other non-200 responses are treated as system errors.
    throw new SystemException()
}
