'use client'

import { AuthenticationException } from "@/lib/common/exception/authentication_exception"
import { BusinessException } from "@/lib/common/exception/business_exception"
import { ConsistencyException } from "@/lib/common/exception/consistency_exception"
import { ErrorInfo } from "@/lib/common/exception/error_info"
import { ForbiddenException } from "@/lib/common/exception/forbidden_exception"
import { GatewayTimeoutException } from "@/lib/common/exception/gateway_timeout_exception"
import { SystemException } from "@/lib/common/exception/system_exception"
import { ReactNode } from "react"

export default function RscError(props: { errorInfo: ErrorInfo }): ReactNode {
    // Errorinformation exception original＆throw.
    
    if (props.errorInfo.statusCode === 400) {
        // Bad Request
        throw new BusinessException(props.errorInfo.message)
    } else if (props.errorInfo.statusCode === 401) {
        // Unauthorized
        throw new AuthenticationException()
    } else if (props.errorInfo.statusCode === 403) {
        // Forbidden
        throw new ForbiddenException()
    } else if (props.errorInfo.statusCode === 504) {
        // GatewayTimeout
        throw new GatewayTimeoutException()
    } else if (props.errorInfo.statusCode === 409) {
        // Conflict
        throw new ConsistencyException()
    }

    // Other statuses are unexpected system errors.
    throw new SystemException()

    return <></>
}
