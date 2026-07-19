import { useEffect, useState, type RefObject } from 'react'

// PrimeReact Dropdown relies on a document-level mousedown listener to close its
// overlay on an outside click. The editor canvas stops propagation (and calls
// preventDefault) on mousedown, so that listener never fires and focus never
// leaves the trigger. This hook, wired to a Dropdown ref via its onShow/onHide,
// watches for an outside mousedown in the CAPTURE phase (before the canvas can
// stop it) while the panel is open, then closes the overlay AND blurs the
// trigger so no focus ring lingers.

type DropdownInstance = {
    getElement?: () => HTMLElement | null
    getOverlay?: () => HTMLElement | null
    getFocusInput?: () => HTMLElement | null
    hide?: () => void
}

export function useDropdownAutoClose(ref: RefObject<unknown>): {
    onShow: () => void
    onHide: () => void
} {
    const [open, setOpen] = useState(false)

    useEffect(function () {
        if (!open) return
        function onDown(e: MouseEvent) {
            const instance = ref.current as DropdownInstance | null
            if (instance === null) return
            const trigger = instance.getElement ? instance.getElement() : null
            const overlay = instance.getOverlay ? instance.getOverlay() : null
            const target = e.target as Node
            if ((trigger !== null && trigger.contains(target)) || (overlay !== null && overlay.contains(target))) {
                return
            }
            if (instance.hide) instance.hide()
            // Drop focus so the dropdown does not keep a focus ring after closing.
            const focusInput = instance.getFocusInput ? instance.getFocusInput() : null
            if (focusInput !== null) {
                focusInput.blur()
            } else if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur()
            }
        }
        document.addEventListener('mousedown', onDown, true)
        return function () { document.removeEventListener('mousedown', onDown, true) }
    }, [open, ref])

    return {
        onShow: function () { setOpen(true) },
        onHide: function () { setOpen(false) },
    }
}
