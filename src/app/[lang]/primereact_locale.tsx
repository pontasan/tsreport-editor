'use client'

import type { PrimeReactMessages } from '@/lib/common/i18n/ui_messages'
import { PrimeReactContext, addLocale } from 'primereact/api'
import { useContext, useEffect } from 'react'

type Props = {
    lang: string
    messages: PrimeReactMessages
}

function calendarNames(lang: string, option: 'weekday' | 'month', width: 'long' | 'short' | 'narrow'): string[] {
    const values: string[] = []
    const formatter = new Intl.DateTimeFormat(lang, { [option]: width, timeZone: 'UTC' })
    const count = option === 'weekday' ? 7 : 12
    for (let i = 0; i < count; i++) {
        const date = option === 'weekday'
            ? new Date(Date.UTC(2026, 0, 4 + i))
            : new Date(Date.UTC(2026, i, 1))
        values.push(formatter.format(date))
    }
    return values
}

function dateFormat(lang: string): string {
    if (lang === 'en') return 'mm/dd/yy'
    if (lang === 'ja' || lang === 'zh-CN' || lang === 'zh-TW' || lang === 'ko') return 'yy/mm/dd'
    return 'dd/mm/yy'
}

export function PrimeReactLocale(props: Props) {
    const messages = props.messages
    const { setLocale } = useContext(PrimeReactContext)
    useEffect(() => {
        addLocale(props.lang, {
            accept: messages.accept,
            reject: messages.reject,
            choose: messages.choose,
            upload: messages.upload,
            cancel: messages.cancel,
            clear: messages.clear,
            apply: messages.apply,
            emptyMessage: messages.emptyMessage,
            emptyFilterMessage: messages.emptyMessage,
            today: messages.today,
            weekHeader: messages.weekHeader,
            passwordPrompt: messages.passwordPrompt,
            dayNames: calendarNames(props.lang, 'weekday', 'long'),
            dayNamesShort: calendarNames(props.lang, 'weekday', 'short'),
            dayNamesMin: calendarNames(props.lang, 'weekday', 'narrow'),
            monthNames: calendarNames(props.lang, 'month', 'long'),
            monthNamesShort: calendarNames(props.lang, 'month', 'short'),
            firstDayOfWeek: props.lang === 'en' || props.lang === 'ja' ? 0 : 1,
            dateFormat: dateFormat(props.lang),
        })
        setLocale(props.lang)
    }, [messages, props.lang, setLocale])
    return null
}
