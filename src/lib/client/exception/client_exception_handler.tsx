"use client"

import { SystemAction } from '@/lib/client/components/system/action'
import { useSystem } from "@/lib/client/components/system/hooks"
import { AuthenticationException } from '@/lib/common/exception/authentication_exception'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { ClientTimeoutException } from '@/lib/common/exception/client_timeout_exception'
import { ConsistencyException } from '@/lib/common/exception/consistency_exception'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { GatewayTimeoutException } from '@/lib/common/exception/gateway_timeout_exception'
import { NetworkDisconnectionException } from '@/lib/common/exception/network_disconnection_exception'
import { ClientDictionaryType } from '@/lib/server/i18n/dictionaries/client/type'
import { useEffect } from "react"

type Props = {
    children: React.ReactNode,
    lang: string,
    dictionary: ClientDictionaryType
}

/**
  * Exception.
  * Exception, 「error」common display.
  * Promiseexception target.(errorerror with)
 */

export function ClientExceptionHandler(props: Props) {
    // For, useRouterfor.
    
    const [, sysDispatch] = useSystem()

    useEffect(() => {
        const handleRejection = (event: PromiseRejectionEvent) => {
            if (event.reason instanceof BusinessException) {
                SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, event.reason.message)
                return
            } else if (event.reason instanceof AuthenticationException) {
                SystemAction.logout(sysDispatch)
                return
            } else if (event.reason instanceof ConsistencyException) {
                SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, props.dictionary.system.consistencyExceptionMessage)
                return
            } else if (event.reason instanceof ForbiddenException) {
                SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, props.dictionary.system.forbiddenExceptionMessage)
                return
            } else if (event.reason instanceof GatewayTimeoutException) {
                SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, props.dictionary.system.gatewayTimeoutExceptionMessage)
                return
            } else if (event.reason instanceof ClientTimeoutException) {
                SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, props.dictionary.system.clientTimeoutExceptionMessage)
                return
            } else if (event.reason instanceof DOMException && (event.reason.name === 'AbortError' || event.reason.name === 'TimeoutError')) {
                // MEMO: This implementation treats TimeoutError as a fetch timeout.
                // AbortError occurs when AbortController aborts; AbortSignal.timeout produces TimeoutError.
                // The source of the abort cannot be distinguished, but this template only uses it for fetch processing.
                SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, props.dictionary.system.clientTimeoutExceptionMessage)
                return
            } else if (event.reason instanceof NetworkDisconnectionException) {
                // Fetch.
                
                SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, props.dictionary.system.networkDisconnectionExceptionMessage)
                return
            }

            SystemAction.showMessage(sysDispatch, props.dictionary.system.exceptionTitle, props.dictionary.system.systemExceptionMessage)
        }

        window.addEventListener('unhandledrejection', handleRejection, true)

        return () => {
            window.removeEventListener('unhandledrejection', handleRejection)
        }
        /* eslint-disable */
    }, [])
    /* eslint-enable */

    return <>
        {props.children}
    </>
}
