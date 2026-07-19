import { useEffect } from "react"

/**
  * Mounttime hooks.
  * Mode mountafter 1process rowcase for.
  * Mode with, hydrate2useEffect.
  * UseEffectprocessrowcase for.(updateprocess)
 */

// https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development
export function useMount(onComponentDidMount: () => void) {
    useEffect(() => {
        let ignore = false

        // Rowtimeasyncprocess cleanupfunction from,.
        // 2rowtime!ignore.
        
        
        const dummyFnc = async () => {
            await (async () => {
                // NOP
            })()

            if (!ignore) {
                onComponentDidMount()
            }
        }

        dummyFnc()

        return () => {
            ignore = true
        }
        /* eslint-disable */
    }, [])
    /* eslint-enable */
}