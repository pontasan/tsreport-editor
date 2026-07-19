import { StringUtils } from '@/lib/common/utils/string_utils'
import { UserAccountVO } from '@/lib/common/vo/entity/user_account'
import { ClientDictionaryType } from '@/lib/server/i18n/dictionaries/client/type'
import { NavigateOptions, PrefetchOptions } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { useReducer } from 'react'

export type ACTIONTYPE =
    { type: 'LOGIN_REQUEST', payload: { userId: string, pass: string } } |
    {
        type: 'LOGIN_SUCCESS',
        payload: {
            loginUser: UserAccountVO.Type
        }
    } |
    { type: 'LOGIN_FAILURE' } |

    { type: 'RESET_POST_RENDER_CMD' } |

    { type: 'LOGOUT_REQUEST' } |
    { type: 'LOGOUT_SUCCESS' } |
    { type: 'LOGOUT_FAILURE' } |

    { type: 'VERIFY_SESSION_REQUEST' } |
    {
        type: 'VERIFY_SESSION_SUCCESS',
        payload: {
            isLoggedin: boolean,
            loginUser: UserAccountVO.Type
        }
    } |
    { type: 'VERIFY_SESSION_FAILURE' } |

    { type: 'SHOW_MESSAGE', payload: { title: string, message: string } } |
    { type: 'HIDE_MESSAGE' } |

    { type: 'SET_NAVIGATE_BLOCK_ENABLED', payload: { isEnable: boolean } } |
    {
        type: 'SHOW_EDIT_UNCOMMITTED_DIALOG',
        payload: {
            type: RouterType,
            href?: string,
            navigateOptions?: NavigateOptions,
            prefetchOptions?: PrefetchOptions
        }
    } |
    { type: 'HIDE_EDIT_UNCOMMITTED_DIALOG' } |
    { type: 'NAVIGATE_PAGE' } |
    { type: 'UNSET_NAVIGATE_BLOCK' } |
    { type: 'NAVIGATE_HOME_AFTER' }


type Props = {
    isLoggedin: boolean,
    lang: string,
    dictionary: ClientDictionaryType
}

export type RouterType = ''
    | 'back'
    | 'forward'
    | 'refresh'
    | 'push'
    | 'replace'
    | 'prefetch'

export type State = {
    isWaiting: boolean,
    beforeVerification: boolean,
    isLoggedin: boolean,

    loginUser: UserAccountVO.Type,

    // Support.
    
    lang: string,
    dictionary: ClientDictionaryType,

    // Pagefor.
    
    isEnableNavigateBlock: boolean,
    isVisibleUncommittedDialog: boolean,
    routerType: RouterType,
    href: string,
    navigateOptions?: NavigateOptions,
    prefetchOptions?: PrefetchOptions,

    isVisible: boolean,
    header: string,
    message: string,

    postRenderCmd: string
}

export function useSystemReducer(props: Props): [State, React.Dispatch<ACTIONTYPE>] {
    const initialState: State = {
        isWaiting: false,
        beforeVerification: true,
        isLoggedin: props.isLoggedin,

        loginUser: UserAccountVO.create(),

        // Support.
        
        lang: props.lang,
        dictionary: props.dictionary,

        // Pagefor.
        
        isEnableNavigateBlock: false,
        isVisibleUncommittedDialog: false,
        routerType: '',
        href: '',

        isVisible: false,
        header: '',
        message: '',

        postRenderCmd: ''
    }

    const [state, dispatch] = useReducer((state: State, action: ACTIONTYPE): State => {
        switch (action.type) {
            case 'LOGIN_REQUEST': return {
                ...state,
                isWaiting: true
            }
            case 'LOGIN_SUCCESS': {
                return {
                    ...state,
                    isWaiting: false,
                    beforeVerification: false,
                    isLoggedin: true,
                    loginUser: action.payload.loginUser,
                    postRenderCmd: 'NAVIGATE_HOME'
                }
            }
            case 'LOGIN_FAILURE': {
                return {
                    ...state,
                    isWaiting: false
                }
            }

            case 'LOGOUT_REQUEST': return {
                ...state,
                isWaiting: true
            }
            case 'LOGOUT_SUCCESS': return {
                ...state,
                isWaiting: false,
                beforeVerification: true,
                isLoggedin: false,
                postRenderCmd: 'NAVIGATE_LOGIN_FORM'
            }
            case 'LOGOUT_FAILURE': return {
                ...state,
                isWaiting: false
            }

            case 'RESET_POST_RENDER_CMD': return {
                ...state,
                postRenderCmd: ''
            }

            case 'VERIFY_SESSION_REQUEST': return {
                ...state,
                isWaiting: true,
                beforeVerification: true
            }
            case 'VERIFY_SESSION_SUCCESS': return {
                ...state,
                isWaiting: false,
                beforeVerification: false,
                isLoggedin: action.payload.isLoggedin,
                loginUser: action.payload.loginUser
            }
            case 'VERIFY_SESSION_FAILURE': return {
                ...state,
                isWaiting: false,
                beforeVerification: true,
                isLoggedin: false
            }

            case 'SHOW_MESSAGE': return {
                ...state,
                isVisible: true,
                header: action.payload.title,
                message: action.payload.message
            }
            case 'HIDE_MESSAGE': {
                return {
                    ...state,
                    isVisible: false
                }
            }

            case 'SET_NAVIGATE_BLOCK_ENABLED': return {
                ...state,
                isEnableNavigateBlock: action.payload.isEnable
            }

            case 'SHOW_EDIT_UNCOMMITTED_DIALOG': return {
                ...state,
                isVisibleUncommittedDialog: true,
                routerType: action.payload.type,
                href: StringUtils.nvl(action.payload.href),
                navigateOptions: action.payload.navigateOptions,
                prefetchOptions: action.payload.prefetchOptions
            }

            case 'HIDE_EDIT_UNCOMMITTED_DIALOG': return {
                ...state,
                isVisibleUncommittedDialog: false
            }

            case 'NAVIGATE_PAGE': return {
                ...state,
                isEnableNavigateBlock: false,
                isVisibleUncommittedDialog: false,
                postRenderCmd: 'NAVIGATE_PAGE'
            }

            case 'UNSET_NAVIGATE_BLOCK': return {
                ...state,
                isEnableNavigateBlock: false,
                postRenderCmd: '',
                routerType: '',
                href: '',
                navigateOptions: undefined,
                prefetchOptions: undefined
            }

            default:
                throw new Error()
        }
    }, initialState)

    return [state, dispatch]
}