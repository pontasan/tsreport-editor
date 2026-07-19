import { SystemAction } from '@/lib/client/components/system/action'
import { ACTIONTYPE, State } from '@/lib/client/components/system/reducer'
import { SysContext, SysDispatchContext } from '@/lib/client/components/system/sys_context'
import { useMount } from '@/lib/client/hooks/mount'
import { NavigateOptions, PrefetchOptions } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { useRouter } from 'next/navigation'
import { useContext, useEffect } from 'react'

export function useSystem(): [State, React.Dispatch<ACTIONTYPE>] {
    const sysState = useContext(SysContext)
    const sysDispatch = useContext(SysDispatchContext)
    const router = useRouter()

    useEffect(() => {
        switch (sysState.postRenderCmd) {
            case 'NAVIGATE_HOME':
                router.push(`/${sysState.lang}/editor`)
                SystemAction.resetPostRenderCmd(sysDispatch)
                break
            case 'NAVIGATE_LOGIN_FORM':
                router.push(`/${sysState.lang}`)
                SystemAction.resetPostRenderCmd(sysDispatch)
                break
        }
    }, [sysState.postRenderCmd, sysState.lang, router, sysDispatch])

    return [sysState, sysDispatch]
}

export function useAuth(): [State, React.Dispatch<ACTIONTYPE>] {
    const [sysState, sysDispatch] = useSystem()
    const router = useRouter()

    useEffect(() => {
        switch (sysState.postRenderCmd) {
            case 'NAVIGATE_HOME':
                router.push(`/${sysState.lang}/editor`)
                SystemAction.resetPostRenderCmd(sysDispatch)
                break
            case 'NAVIGATE_LOGIN_FORM':
                router.push(`/${sysState.lang}`)
                SystemAction.resetPostRenderCmd(sysDispatch)
                break
        }
    }, [sysState.postRenderCmd, sysState.lang, router, sysDispatch])

    useMount(() => {
        SystemAction.verifySession(sysDispatch)
    })

    return [sysState, sysDispatch]
}

/**
 * useRouter wrapper for navigation guards.
 * Rationale for guarding screen navigation:
 *
 * 1. Screen navigation is centralized through useRouter in this application.
 *    Wrapping useRouter lets the guard intercept most internal navigation.
 *
 * 2. Leaving the page through another site or closing the tab can be intercepted by beforeunload.
 *    However, useRouter navigation cannot be detected by beforeunload.
 *
 * 3. Back and forward navigation cannot currently be blocked through the App Router.
 *
 * Related discussion: 41934
 * https://github.com/vercel/next.js/discussions/41934#discussioncomment-9299194
 *
 * A framework maintainer noted that browsers do not provide behavior to prevent
 * popstate navigation, so the router cannot add that behavior.
 *
 * @returns Wrapped router with navigation guard handling.
 */
type RouterType = {
    /**
     * Navigate to the previous history entry.
     */
    back(): void;
    /**
     * Navigate to the next history entry.
     */
    forward(): void;
    /**
     * Refresh the current page.
     */
    refresh(): void;
    /**
     * Navigate to the provided href.
     * Pushes a new history entry.
     */
    push(href: string, options?: NavigateOptions): void;
    /**
     * Navigate to the provided href.
     * Replaces the current history entry.
     */
    replace(href: string, options?: NavigateOptions): void;
    /**
     * Prefetch the provided href.
     */
    prefetch(href: string, options?: PrefetchOptions): void;
}

export function useRouterProxy(): RouterType {
    const [sysState, sysDispatch] = useSystem()
    const router = useRouter()

    return {
        back: () => {
            if (sysState.isEnableNavigateBlock) {
                SystemAction.showEditUncommittedDialog(sysDispatch, {
                    type: 'back'
                })

                return
            }
            router.back()
        },
        forward: () => {
            if (sysState.isEnableNavigateBlock) {
                SystemAction.showEditUncommittedDialog(sysDispatch, {
                    type: 'forward'
                })

                return
            }
            router.forward()
        },
        refresh: () => {
            if (sysState.isEnableNavigateBlock) {
                SystemAction.showEditUncommittedDialog(sysDispatch, {
                    type: 'refresh'
                })

                return
            }
            router.refresh()
        },
        push: (href: string, options?: NavigateOptions) => {
            if (sysState.isEnableNavigateBlock) {
                SystemAction.showEditUncommittedDialog(sysDispatch, {
                    type: 'push',
                    href,
                    navigatorOptions: options
                })

                return
            }
            router.push(href, options)
        },
        replace: (href: string, options?: NavigateOptions) => {
            if (sysState.isEnableNavigateBlock) {
                SystemAction.showEditUncommittedDialog(sysDispatch, {
                    type: 'replace',
                    href,
                    navigatorOptions: options
                })

                return
            }
            router.replace(href, options)
        },
        prefetch: (href: string, options?: PrefetchOptions) => {
            if (sysState.isEnableNavigateBlock) {
                SystemAction.showEditUncommittedDialog(sysDispatch, {
                    type: 'prefetch',
                    href,
                    prefetchOptions: options
                })

                return
            }
            router.prefetch(href, options)
        }
    }

}
