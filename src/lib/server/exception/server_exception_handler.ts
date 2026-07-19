import RscError from '@/lib/client/exception/rsc_error'
import { AuthenticationException } from "@/lib/common/exception/authentication_exception"
import { BusinessException } from "@/lib/common/exception/business_exception"
import { ConsistencyException } from "@/lib/common/exception/consistency_exception"
import { create as createErrorInfo, ErrorInfo } from "@/lib/common/exception/error_info"
import { ForbiddenException } from "@/lib/common/exception/forbidden_exception"
import { GatewayTimeoutException } from '@/lib/common/exception/gateway_timeout_exception'
import { NotFoundException } from "@/lib/common/exception/not_found_exception"
import { NotSupportedException } from "@/lib/common/exception/not_supported_exception"
import { SystemException } from "@/lib/common/exception/system_exception"
import { DbUtils } from "@/lib/server/utils/db_utils"
import { NextResponse } from "next/server"
import { ClientBase } from "pg"
import React from "react"

export namespace ServerExceptionHandler {

    export async function handleWithTx<T>(callback: (client: ClientBase) => Promise<NextResponse<T | ErrorInfo>>) {
        try {
            return await DbUtils.transaction(async (client) => await callback(client))
        } catch (e) {
            return handleInner(e)
        }
    }

    async function handleInner(e: any) {
        // Log
        console.log(e)
        // console.trace()

        if (e instanceof AuthenticationException) {
            // Authentication error
            // Unauthorized
            return NextResponse.json({
                ...createErrorInfo(),
                statusCode: 401,
                message: '認証エラー',
                headers: {
                    'Set-Cookie': 'token=; Path=/; SameSite=Lax; HttpOnly; Secure;'
                }
            }, { status: 401 })
        } else if (e instanceof BusinessException) {
            // Bad Request
            return NextResponse.json({
                ...createErrorInfo(),
                statusCode: 400,
                message: e.message
            }, { status: 400 })
        } else if (e instanceof ConsistencyException) {
            // Error for optimistic locking conflicts or inconsistencies. Also used when data retrieval fails.
            // (Depending on the operation, telling the user data could not be retrieved wouldn't intuitively convey the cause anyway)
            // Conflict
            return NextResponse.json({
                ...createErrorInfo(),
                statusCode: 409,
                message: '更新前にデータが変化したため処理を中断しました。画面を更新して再試行してください。'
            }, { status: 409 })
        } else if (e instanceof ForbiddenException) {
            // Forbidden
            return NextResponse.json({
                ...createErrorInfo(),
                statusCode: 403,
            }, { status: 403 })
        } else if (e instanceof NotFoundException) {
            // Not Found
            return NextResponse.json({
                ...createErrorInfo(),
                message: e.message,
                statusCode: 404,
            }, { status: 404 })
        } else if (e instanceof GatewayTimeoutException) {
            // Gateway Timeout
            return NextResponse.json({
                ...createErrorInfo(),
                statusCode: 504,
            }, { status: 504 })
        } else if (e instanceof SystemException) {
            // Server error
            return NextResponse.json({
                ...createErrorInfo(),
                statusCode: 500,
                message: 'サーバーエラー'
            }, { status: 500 })
        } else if (e instanceof NotSupportedException) {
            // Unsupported operation, etc.
            return NextResponse.json({
                ...createErrorInfo(),
                statusCode: 500,
                message: 'サーバーエラー (未対応の操作を検知)'
            }, { status: 500 })
        }

        // Unexpected exception
        return NextResponse.json({
            ...createErrorInfo(),
            statusCode: 500,
            message: 'サーバーエラー'
        }, { status: 500 })
    }

    export async function handle<T>(callback: () => Promise<NextResponse<T | ErrorInfo>>) {
        try {
            return await callback()
        } catch (e) {
            return await handleInner(e)
        }
    }

    export async function handleWithTxForServerComponent<T>(callback: (client: ClientBase) => Promise<T>) {
        try {
            return await DbUtils.transaction(async (client) => await callback(client))
        } catch (e) {
            const errorInfo = handleInnerForServerComponent(e)
            return React.createElement(RscError, { errorInfo })
        }
    }

    function handleInnerForServerComponent(e: any): ErrorInfo {
        // Log
        console.log(e)
        // console.trace()

        if (e instanceof AuthenticationException) {
            // Authentication error
            // Unauthorized
            return {
                ...createErrorInfo(),
                statusCode: 401,
                message: '認証エラー'
            }
        } else if (e instanceof BusinessException) {
            // Bad Request
            return {
                ...createErrorInfo(),
                statusCode: 400,
                message: e.message
            }
        } else if (e instanceof ConsistencyException) {
            // Error for optimistic locking conflicts or inconsistencies. Also used when data retrieval fails.
            // (Depending on the operation, telling the user data could not be retrieved wouldn't intuitively convey the cause anyway)
            // Conflict
            return {
                ...createErrorInfo(),
                statusCode: 409,
                message: '更新前にデータが変化したため処理を中断しました。画面を更新して再試行してください。'
            }
        } else if (e instanceof SystemException) {
            // Server error
            return {
                ...createErrorInfo(),
                statusCode: 500,
                message: 'サーバーエラー'
            }
        } else if (e instanceof NotSupportedException) {
            // Unsupported operation, etc.
            return {
                ...createErrorInfo(),
                statusCode: 500,
                message: 'サーバーエラー (未対応の操作を検知)'
            }
        }

        // Treat unexpected exceptions as server errors.
        return {
            ...createErrorInfo(),
            statusCode: 500,
            message: 'サーバーエラー'
        }
    }
}