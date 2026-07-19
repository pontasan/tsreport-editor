'use client'

// Unified color input used by every color property in the editor.
// The inline row stays compact: a swatch button and the mode switcher.
// All editing — the visual picker and manual entry (hex / C,M,Y,K values /
// spot name) — happens inside the picker overlay (color_picker.tsx).
// Color forms:
//   RGB  — value '#RRGGBB'
//   CMYK — value 'cmyk(C,M,Y,K)' (percent)
//   特色 — value 'spot(Name,C,M,Y,K)' (spot with its CMYK alternate;
//          only offered when the value already is a spot color)
// Exactly one representation is stored; switching modes derives initial
// values via the naive conversion (non-reversible, so no auto round trip).

import { useRef } from 'react'
import { OverlayPanel } from 'primereact/overlaypanel'
import SelectDropdown from './select_dropdown'
import { colorModeOf, convertColorToMode, displayHexOf, type ColorMode } from './color_input_util'
import { ColorPickerPanel } from './color_picker'
import styles from './color_input.module.css'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'

export type ColorInputProps = {
    value: string,
    onChange: (color: string) => void,
    helpKey?: string
}

export function ColorInput({ value, onChange, helpKey }: ColorInputProps) {
    const ui = useUiMessages()
    const mode = colorModeOf(value)
    const overlayRef = useRef<OverlayPanel>(null)

    const changeMode = function (next: ColorMode): void {
        onChange(convertColorToMode(value, next))
    }

    return (
        <div className={styles.colorInputRoot} data-help={helpKey}>
            <div className={styles.mainRow}>
                <button type="button" className={styles.swatch} style={{ backgroundColor: displayHexOf(value) }}
                    title={ui.openColorPicker}
                    onClick={(e) => overlayRef.current?.toggle(e)} />
                <OverlayPanel ref={overlayRef} className={styles.pickerOverlay}>
                    <ColorPickerPanel mode={mode} value={value} onChange={onChange} />
                </OverlayPanel>
                <SelectDropdown className={styles.modeSelect} value={mode}
                    onChange={(e) => changeMode(e.target.value as ColorMode)}>
                    <option value="rgb">RGB</option>
                    <option value="cmyk">CMYK</option>
                    {/* Spot colors stay editable when a value arrives via import/MCP,
                        but the mode is not offered proactively */}
                    {mode === 'spot' && <option value="spot">{ui.spotColor}</option>}
                </SelectDropdown>
                <span className={styles.valueText}>
                    {mode === 'rgb' ? value : mode === 'spot' ? spotSummary(value, ui.unnamed) : cmykSummary(value)}
                </span>
            </div>
        </div>
    )
}

function cmykSummary(value: string): string {
    return value.replace(/^cmyk\(/i, '').replace(/\)$/, '').split(',').join(' / ')
}

function spotSummary(value: string, unnamed: string): string {
    const inner = value.replace(/^spot\(/i, '').replace(/\)$/, '')
    const parts = inner.split(',')
    const name = parts[0]?.trim()
    return (name !== undefined && name !== '' ? name : unnamed) + ' : ' + parts.slice(1).join(' / ')
}
