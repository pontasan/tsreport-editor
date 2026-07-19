'use client'

// Visual color picker shared by every color mode: a saturation/value field
// with a hue slider (identical operation for RGB and CMYK), plus C/M/Y/K
// channel sliders in the print-color modes so the black plate stays under
// direct control. Manual entry lives here too: a hex field in RGB mode and
// per-channel numeric fields (plus the spot name) in the print modes.
// Values commit live while dragging.

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { CmnInputText } from '@/lib/client/components/input/cmn-input-text'
import { NumberUtils } from '@/lib/common/utils/number_utils'
import {
    cmykComponentsOf, cmykSliderTrack, displayHexOf, formatCmykColor,
    formatRgbHex, formatSpotColor, hexToHsv, hsvToHex, normalizeHexColorInput,
    rgbComponentsOf, rgbSliderTrack, spotNameOf,
    type ColorMode, type HsvColor,
} from './color_input_util'
import styles from './color_picker.module.css'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'

const CMYK_LABELS = ['C', 'M', 'Y', 'K'] as const
const RGB_LABELS = ['R', 'G', 'B'] as const
const HUE_TRACK = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'

export type ColorPickerPanelProps = {
    mode: ColorMode,
    value: string,
    onChange: (color: string) => void
}

export function ColorPickerPanel({ mode, value, onChange }: ColorPickerPanelProps) {
    const ui = useUiMessages()
    // Hue/saturation are kept locally so a gray or white pick does not reset
    // the hue; the state reseeds only when the value changes from outside
    const [hsv, setHsv] = useState<HsvColor>(function () { return hexToHsv(displayHexOf(value)) })
    const fieldRef = useRef<HTMLDivElement>(null)

    const displayHex = displayHexOf(value)
    useEffect(() => {
        setHsv(function (current) {
            return hsvToHex(current.h, current.s, current.v) === displayHex ? current : hexToHsv(displayHex)
        })
    }, [displayHex])

    const commitCmyk = function (comps: [number, number, number, number]): void {
        if (mode === 'spot') onChange(formatSpotColor(spotNameOf(value), comps[0], comps[1], comps[2], comps[3]))
        else onChange(formatCmykColor(comps[0], comps[1], comps[2], comps[3]))
    }

    const commitHex = function (hex: string): void {
        if (mode === 'rgb') {
            onChange(hex)
            return
        }
        commitCmyk(cmykComponentsOf(hex))
    }

    const applyHsv = function (next: HsvColor): void {
        setHsv(next)
        commitHex(hsvToHex(next.h, next.s, next.v))
    }

    const pickFromField = function (e: PointerEvent<HTMLDivElement>): void {
        const rect = fieldRef.current!.getBoundingClientRect()
        const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const v = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        applyHsv({ h: hsv.h, s, v })
    }

    const onFieldPointerDown = function (e: PointerEvent<HTMLDivElement>): void {
        e.currentTarget.setPointerCapture(e.pointerId)
        pickFromField(e)
    }

    const onFieldPointerMove = function (e: PointerEvent<HTMLDivElement>): void {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pickFromField(e)
    }

    const changeChannel = function (channel: number, raw: string): void {
        const parsed = NumberUtils.parseNumber(raw)
        if (parsed === undefined) return
        const comps = cmykComponentsOf(value)
        comps[channel] = parsed
        commitCmyk(comps)
    }

    const changeHexInput = function (raw: string): void {
        const normalized = normalizeHexColorInput(raw)
        if (normalized !== undefined) commitHex(normalized)
    }

    const changeSpotName = function (name: string): void {
        const comps = cmykComponentsOf(value)
        onChange(formatSpotColor(name, comps[0], comps[1], comps[2], comps[3]))
    }

    const changeRgbChannel = function (channel: number, raw: string): void {
        const parsed = NumberUtils.parseNumber(raw)
        if (parsed === undefined) return
        const rgb = rgbComponentsOf(value)
        rgb[channel] = parsed
        onChange(formatRgbHex(rgb[0], rgb[1], rgb[2]))
    }

    const comps = cmykComponentsOf(value)
    const rgb = rgbComponentsOf(value)
    const hueColor = hsvToHex(hsv.h, 1, 1)

    return (
        <div className={styles.picker}>
            <div ref={fieldRef} className={styles.svField} style={{ backgroundColor: hueColor }}
                onPointerDown={onFieldPointerDown} onPointerMove={onFieldPointerMove}>
                <div className={styles.svWhite} />
                <div className={styles.svBlack} />
                <div className={styles.svKnob}
                    style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: displayHex }} />
            </div>
            <input className={styles.hueSlider} type="range" min={0} max={360} step={1}
                style={{ background: HUE_TRACK }}
                value={Math.round(hsv.h)}
                onChange={(e) => applyHsv({ h: Number(e.target.value), s: hsv.s, v: hsv.v })} />
            {mode !== 'rgb' && (
                <div className={styles.channels}>
                    {mode === 'spot' && (
                        <input className={styles.spotName} type="text" value={spotNameOf(value)}
                            placeholder={ui.spotColorName}
                            onChange={(e) => changeSpotName(e.target.value)} />
                    )}
                    {CMYK_LABELS.map(function (label, channel) {
                        return (
                            <div key={label} className={styles.channelRow}>
                                <span className={styles.channelLabel}>{label}</span>
                                <input className={styles.channelSlider} type="range" min={0} max={100} step={1}
                                    style={{ background: cmykSliderTrack(comps, channel) }}
                                    value={comps[channel]}
                                    onChange={(e) => changeChannel(channel, e.target.value)} />
                                <CmnInputText className={styles.channelInput}
                                    value={String(comps[channel])}
                                    onBlur={(e) => changeChannel(channel, e.target.value)} />
                            </div>
                        )
                    })}
                </div>
            )}
            {mode === 'rgb' && (
                <div className={styles.channels}>
                    {RGB_LABELS.map(function (label, channel) {
                        return (
                            <div key={label} className={styles.channelRow}>
                                <span className={styles.channelLabel}>{label}</span>
                                <input className={styles.channelSlider} type="range" min={0} max={255} step={1}
                                    style={{ background: rgbSliderTrack(rgb, channel) }}
                                    value={rgb[channel]}
                                    onChange={(e) => changeRgbChannel(channel, e.target.value)} />
                                <CmnInputText className={styles.channelInput}
                                    value={String(rgb[channel])}
                                    onBlur={(e) => changeRgbChannel(channel, e.target.value)} />
                            </div>
                        )
                    })}
                    <div className={styles.hexRow}>
                        <span className={styles.hexLabel}>HEX</span>
                        <CmnInputText className={styles.hexInput}
                            value={value}
                            onBlur={(e) => changeHexInput(e.target.value)} />
                    </div>
                </div>
            )}
        </div>
    )
}
