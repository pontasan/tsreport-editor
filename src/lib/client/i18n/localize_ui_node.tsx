'use client'

import { UI_SOURCE_MESSAGE_IDS, type UiMessages } from '@/lib/common/i18n/ui_messages'
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'

const LOCALIZED_STRING_PROPS = ['header', 'label', 'title', 'placeholder', 'aria-label'] as const

export function localizeUiText(value: string, messages: UiMessages): string {
    const exactId = UI_SOURCE_MESSAGE_IDS[value]
    if (exactId !== undefined) return messages[exactId]

    const trimmed = value.trim()
    if (trimmed !== value) {
        const trimmedId = UI_SOURCE_MESSAGE_IDS[trimmed]
        if (trimmedId !== undefined) {
            const start = value.indexOf(trimmed)
            return value.substring(0, start) + messages[trimmedId] + value.substring(start + trimmed.length)
        }
    }

    const unitStart = value.indexOf(' (')
    if (unitStart > 0) {
        const prefixId = UI_SOURCE_MESSAGE_IDS[value.substring(0, unitStart)]
        if (prefixId !== undefined) return messages[prefixId] + value.substring(unitStart)
    }
    return value
}

export function localizeUiNode(node: ReactNode, messages: UiMessages): ReactNode {
    if (typeof node === 'string') return localizeUiText(node, messages)
    if (Array.isArray(node)) {
        return Children.map(node, function (child) { return localizeUiNode(child, messages) })
    }
    if (!isValidElement(node)) return node

    const element = node as ReactElement<Record<string, unknown>>
    const nextProps: Record<string, unknown> = {}
    for (let i = 0; i < LOCALIZED_STRING_PROPS.length; i++) {
        const name = LOCALIZED_STRING_PROPS[i]
        const value = element.props[name]
        if (typeof value === 'string') nextProps[name] = localizeUiText(value, messages)
    }
    if (element.props.children !== undefined) {
        nextProps.children = Children.map(element.props.children as ReactNode, function (child) {
            return localizeUiNode(child, messages)
        })
    }
    return cloneElement(element, nextProps)
}
