'use client'

import { CoreUtils } from "@/lib/common/utils/core_utils"
import { getCSRFToken } from "@/lib/server/action/csrf"
import { ReactNode, useEffect, useRef, useState } from "react"
import styles from './csrf_guard.module.css'

type Props = {
    children: ReactNode
}

export default function CsrfGuard(props: Props) {
    const [token, setToken] = useState<string>('')
    const scrollRef = useRef<number>(0)

    useEffect(() => {
        (async () => {
            const newToken = await getCSRFToken()
            setToken(newToken)

            scrollRef.current = window.scrollY
        })()
    }, [])

    useEffect(() => {
        if (!CoreUtils.isEmpty(token)) {
            if (!CoreUtils.isEmpty(window.location.hash)) {
                // for Scrolling fragment
                const dom = document.querySelector(`${window.location.hash}`)
                if (dom !== null) {
                    dom.scrollIntoView()
                }
            } else {
                // for restore scroll position
                if (scrollRef.current !== 0) {
                    window.scrollTo(0, scrollRef.current)
                }
            }
        }
    }, [token])

    // TODO: setting a custom attribute instead of value is a rough workaround.
    // The update is outside React's lifecycle, so this avoids Virtual DOM synchronization.
    // This may stop working in a future React/runtime change.
    return <>
        <input type='hidden' id='___csrf___' data-token={token} />
        {!CoreUtils.isEmpty(token) ? props.children : <div className={styles.dummy}></div>}
    </>
}
