'use client'

import { PrimeReactLocale } from "@/app/[lang]/primereact_locale"
import { ClientExceptionHandler } from "@/lib/client/exception/client_exception_handler"
import { ClientDictionaryType } from "@/lib/server/i18n/dictionaries/client/type"
import { PrimeReactProvider } from "primereact/api"
import { Dialog } from "primereact/dialog"
import { ReactNode } from "react"
import { SystemAction } from "./action"
import { useSystemReducer } from "./reducer"
import { SysContext, SysDispatchContext } from "./sys_context"

export type Props = {
    children?: ReactNode,
    lang: string,
    dictionary: ClientDictionaryType
}

export default function App(props: Props) {
    const [sysState, sysDispatch] = useSystemReducer({
        isLoggedin: false,
        lang: props.lang,
        dictionary: props.dictionary
    })

    return (
        <>
            <PrimeReactProvider>
                <PrimeReactLocale lang={props.lang} messages={props.dictionary.primeReact} />
                <SysContext.Provider value={sysState}>
                    <SysDispatchContext.Provider value={sysDispatch}>
                        <ClientExceptionHandler lang={props.lang} dictionary={props.dictionary}>
                            {props.children}

                            <Dialog visible={sysState.isVisible}
                                header={sysState.header}
                                style={{ width: '25rem' }}
                                onHide={() => { SystemAction.hideMessage(sysDispatch) }}
                            >
                                <p>{sysState.message}</p>
                            </Dialog>
                        </ClientExceptionHandler>
                    </SysDispatchContext.Provider>
                </SysContext.Provider>
            </PrimeReactProvider>
        </>
    )
}
