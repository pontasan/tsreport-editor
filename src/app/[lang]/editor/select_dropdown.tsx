'use client'

import { Dropdown } from 'primereact/dropdown'
import { Children, isValidElement, useRef, type ReactNode } from 'react'
import { useDropdownAutoClose } from './use_dropdown_auto_close'

// Drop-in replacement for a native <select> that renders a PrimeReact Dropdown
// while keeping the <select> authoring interface: <option> children and an
// onChange handler that receives an event with { target: { value: string } }.
// Values are exposed as strings (like a native select), so existing handlers
// that read e.target.value (optionally wrapped in Number()) keep working.

type OptionItem = { label: string, value: string }

type Props = {
    value: string | number
    onChange: (e: { target: { value: string } }) => void
    className?: string
    disabled?: boolean
    children: ReactNode
}

function collectOptions(children: ReactNode): OptionItem[] {
    const items: OptionItem[] = []
    Children.forEach(children, function (child) {
        if (!isValidElement(child)) return
        const props = child.props as { value?: unknown, children?: ReactNode }
        // Only <option> elements carry a value; skip anything else.
        if (props.value === undefined) return
        items.push({ label: optionLabel(props.children), value: String(props.value) })
    })
    return items
}

function optionLabel(children: ReactNode): string {
    if (typeof children === 'string' || typeof children === 'number') return String(children)
    // Labels are simple text in the property panel; join any text fragments.
    let text = ''
    Children.forEach(children, function (part) {
        if (typeof part === 'string' || typeof part === 'number') text += String(part)
    })
    return text
}

export default function SelectDropdown(props: Props) {
    const options = collectOptions(props.children)
    const ref = useRef<Dropdown>(null)
    // Close (and blur) on an outside click even though the canvas stops mousedown.
    const autoClose = useDropdownAutoClose(ref)

    return (
        <Dropdown
            ref={ref}
            className={props.className}
            panelClassName="tsr-compact-dropdown-panel"
            disabled={props.disabled}
            value={String(props.value)}
            options={options}
            onChange={function (e) { props.onChange({ target: { value: String(e.value) } }) }}
            onShow={autoClose.onShow}
            onHide={autoClose.onHide}
            appendTo={typeof document !== 'undefined' ? document.body : undefined}
        />
    )
}
