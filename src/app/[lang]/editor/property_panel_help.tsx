'use client'

import { createPortal } from 'react-dom'
import { useRef, useEffect, useState, type RefObject } from 'react'
import { FIELD_HELP } from './property_panel_help_data'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { localizeUiText } from '@/lib/client/i18n/localize_ui_node'
import styles from './property_panel_help.module.css'

const GAP = 16

export function FieldHelpTooltip(props: {
    helpKey: string
    anchorRect: DOMRect
    panelRef: RefObject<HTMLDivElement | null>
}) {
    const entry = FIELD_HELP[props.helpKey]
    if (entry === undefined) return null

    return (
        <TooltipPortal
            entry={entry}
            anchorRect={props.anchorRect}
            panelRef={props.panelRef}
        />
    )
}

function TooltipPortal(props: {
    entry: { label: string, description: string, references?: { syntax: string, description: string }[], examples?: string[] }
    anchorRect: DOMRect
    panelRef: RefObject<HTMLDivElement | null>
}) {
    const ui = useUiMessages()
    const tooltipRef = useRef<HTMLDivElement>(null)
    const [layout, setLayout] = useState<{ left: number, top: number, maxHeight: number } | null>(null)

    useEffect(function () {
        const tooltip = tooltipRef.current
        const panel = props.panelRef.current
        if (tooltip === null || panel === null) return

        const panelRect = panel.getBoundingClientRect()
        const anchorY = props.anchorRect.top
        const anchorBottom = props.anchorRect.bottom
        const vh = window.innerHeight

        // Determine whether there is more space above or below the anchor
        const spaceAbove = anchorBottom - GAP
        const spaceBelow = vh - anchorY - GAP

        // Remove max-height to measure the natural height
        tooltip.style.maxHeight = 'none'
        const naturalHeight = tooltip.offsetHeight
        tooltip.style.maxHeight = ''

        let top: number
        let maxHeight: number
        if (spaceBelow >= naturalHeight || spaceBelow >= spaceAbove) {
            // Expand downward
            top = anchorY
            maxHeight = vh - anchorY - GAP
        } else {
            // Expand upward (upward from the anchor's bottom edge)
            const h = Math.min(naturalHeight, spaceAbove)
            top = anchorBottom - h
            maxHeight = spaceAbove
        }
        if (top < GAP) top = GAP

        const tooltipWidth = tooltip.offsetWidth
        const left = panelRect.left - tooltipWidth - GAP

        setLayout({ left, top, maxHeight })
    }, [props.anchorRect, props.panelRef])

    const style: React.CSSProperties = layout !== null
        ? { left: layout.left, top: layout.top, maxHeight: layout.maxHeight, opacity: 1 }
        : { left: -9999, top: -9999, opacity: 0 }

    return createPortal(
        <div ref={tooltipRef} className={styles.helpTooltip} style={style}>
            <div className={styles.helpTitle}>{localizeUiText(props.entry.label, ui)}</div>
            <div className={styles.helpDescription}>{props.entry.description}</div>
            {props.entry.references !== undefined && props.entry.references.length > 0 && (
                <div className={styles.helpSection}>
                    <div className={styles.helpSectionTitle}>{ui.referenceValues}</div>
                    <table className={styles.helpTable}>
                        <tbody>
                            {props.entry.references.map(function (ref, i) {
                                return (
                                    <tr key={i}>
                                        <td className={styles.helpSyntax}>{ref.syntax}</td>
                                        <td className={styles.helpRefDesc}>{ref.description}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {props.entry.examples !== undefined && props.entry.examples.length > 0 && (
                <div className={styles.helpSection}>
                    <div className={styles.helpSectionTitle}>{ui.examples}</div>
                    <ul className={styles.helpExamples}>
                        {props.entry.examples.map(function (ex, i) {
                            return <li key={i}>{ex}</li>
                        })}
                    </ul>
                </div>
            )}
        </div>,
        document.body
    )
}
