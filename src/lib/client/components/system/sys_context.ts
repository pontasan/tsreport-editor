import { ACTIONTYPE, State } from '@/lib/client/components/system/reducer'
import { createContext } from 'react'

export const SysContext = createContext({} as State)
export const SysDispatchContext = createContext({} as React.Dispatch<ACTIONTYPE>)