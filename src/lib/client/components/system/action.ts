import { fetchProxy } from '@/lib/client/utils/fetch_proxy'
import { LoginIF } from '@/lib/common/vo/api/auth/login/types'
import { VerifySessionIF } from '@/lib/common/vo/api/auth/verify_session/types'
import { NavigateOptions, PrefetchOptions } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import React from 'react'
import { ACTIONTYPE, RouterType } from './reducer'

export namespace SystemAction {

    export async function login(
        sysDispatch: React.Dispatch<ACTIONTYPE>,
        userId: string,
        pass: string
    ) {
        try {
            sysDispatch({ type: 'LOGIN_REQUEST', payload: { userId, pass } })

            const res = await fetchProxy(
                '/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({
                    userId,
                    pass
                } as LoginIF.POST.Request)
            })

            const result: LoginIF.POST.Response = await res.json()
            sysDispatch({
                type: 'LOGIN_SUCCESS',
                payload: {
                    loginUser: result.loginUser
                }
            })

            /* eslint-disable */
        } catch (e) {
            /* eslint-enable */
            sysDispatch({ type: 'LOGIN_FAILURE' })
            showMessage(sysDispatch, 'メッセージ', 'ログインIDまたはパスワードに誤りがあります。')

            // Exception.
            
            // throw e
        }
    }

    export async function logout(sysDispatch: React.Dispatch<ACTIONTYPE>) {
        try {
            sysDispatch({ type: 'LOGOUT_REQUEST' })

            const res = await fetchProxy('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({
                })
            })

            await res.json()
            sysDispatch({ type: 'LOGOUT_SUCCESS' })
        } catch (e) {
            sysDispatch({ type: 'LOGOUT_FAILURE' })
            throw e
        }
    }

    export async function verifySession(sysDispatch: React.Dispatch<ACTIONTYPE>) {
        try {
            sysDispatch({ type: 'VERIFY_SESSION_REQUEST' })
            const res = await fetchProxy('/api/auth/verify_session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({
                } as VerifySessionIF.POST.Request)
            })

            const result: VerifySessionIF.POST.Response = await res.json()
            sysDispatch({
                type: 'VERIFY_SESSION_SUCCESS',
                payload: {
                    isLoggedin: result.isLoggedin,
                    loginUser: result.loginUser
                }
            })
        } catch (e) {
            sysDispatch({ type: 'VERIFY_SESSION_FAILURE' })
            throw e
        }
    }

    export async function showMessage(sysDispatch: React.Dispatch<ACTIONTYPE>, title: string, message: string) {
        sysDispatch({ type: 'SHOW_MESSAGE', payload: { title, message } })
    }

    export async function hideMessage(sysDispatch: React.Dispatch<ACTIONTYPE>) {
        sysDispatch({ type: 'HIDE_MESSAGE' })
    }

    export async function verify() {
        try {
            await fetchProxy('/api/auth/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({})
            })
        } catch (e) {
            throw e
        }
    }

    export async function setNavigationBlockEnabled(dispatch: React.Dispatch<ACTIONTYPE>, isEnable: boolean) {
        dispatch({ type: 'SET_NAVIGATE_BLOCK_ENABLED', payload: { isEnable } })
    }

    export async function showEditUncommittedDialog(
        dispatch: React.Dispatch<ACTIONTYPE>,
        routerProps: {
            type: RouterType,
            href?: string,
            navigatorOptions?: NavigateOptions,
            prefetchOptions?: PrefetchOptions
        }
    ) {
        dispatch({
            type: 'SHOW_EDIT_UNCOMMITTED_DIALOG',
            payload: routerProps
        })
    }

    export async function hideEditUncommittedDialog(sysDispatch: React.Dispatch<ACTIONTYPE>) {
        sysDispatch({ type: 'HIDE_EDIT_UNCOMMITTED_DIALOG' })
    }

    export async function navigatePage(sysDispatch: React.Dispatch<ACTIONTYPE>) {
        sysDispatch({ type: 'NAVIGATE_PAGE' })
    }

    export async function unsetNavigateBlock(sysDispatch: React.Dispatch<ACTIONTYPE>) {
        sysDispatch({ type: 'UNSET_NAVIGATE_BLOCK' })
    }

    export async function resetPostRenderCmd(sysDispatch: React.Dispatch<ACTIONTYPE>) {
        sysDispatch({ type: 'RESET_POST_RENDER_CMD' })
    }

}