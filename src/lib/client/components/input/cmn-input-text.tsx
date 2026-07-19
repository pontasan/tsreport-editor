'use client'

import { StringUtils } from '@/lib/common/utils/string_utils'
import { InputText } from 'primereact/inputtext'
import { CSSProperties, ChangeEvent, FocusEvent, MouseEvent, Ref, useEffect, useState } from 'react'

export function CmnInputText(props: {
    inputRef?: Ref<HTMLInputElement>,
    type?: string,
    id?: string,
    value?: string,
    placeholder?: string,
    className?: string,
    style?: CSSProperties,
    readOnly?: boolean,
    disabled?: boolean,
    fixTabIndex?: boolean,
    format?: 'hankaku' | 'katakana' | 'hiragana' | 'hankakukana' | undefined,
    disableAutoFocus?: boolean,
    onClick?: (e: MouseEvent<HTMLInputElement>) => void,
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void,
    onFocus?: (e: FocusEvent<HTMLInputElement>) => void,
    onBlur?: (e: FocusEvent<HTMLInputElement>) => void,
    onNativeBlur?: (e: FocusEvent<HTMLInputElement>) => void,
    onCommit?: (e: { value: string }) => void
}) {
    const [state, setState] = useState({
        value: props.value,
        editBeforeValue: '',
        enterKeyCounter: 0
    })

    useEffect(() => {
        setState({
            ...state,
            value: props.value
        })
        /* eslint-disable */
    }, [props.value])
    /* eslint-enable */

    return (
        <InputText
            ref={props.inputRef}
            value={state.value ? state.value : ''}
            type={props.type}
            id={props.id}
            placeholder={props.placeholder}
            className={props.className}
            style={props.style}
            readOnly={props.readOnly}
            disabled={props.disabled}
            onChange={(e) => {
                setState({
                    ...state,
                    value: e.target.value
                })

                if (props.onChange) {
                    props.onChange(e)
                }
            }}
            onFocus={(e) => {
                setState({
                    ...state,
                    editBeforeValue: e.target.value
                })
                if (props.onFocus) {
                    props.onFocus(e)
                }
            }}
            onBlur={(e) => {
                if (props.onBlur) {
                    const event = { ...e }

                    let v = event.target.value
                    if (props.format === 'hankaku') {
                        v = StringUtils.convertHankaku(v)
                    } else if (props.format === 'katakana') {
                        v = StringUtils.convertKatakana(v)
                    } else if (props.format === 'hiragana') {
                        v = StringUtils.convertHiragana(v)
                    } else if (props.format === 'hankakukana') {
                        v = StringUtils.convertHankaku(StringUtils.convertKatakana(v))
                    }
                    event.target.value = v

                    if (state.editBeforeValue !== v) {
                        props.onBlur(event)
                    }
                }
                if (props.onNativeBlur) {
                    props.onNativeBlur(e)
                }
            }}
            onKeyDown={(e) => {
                if (e.keyCode === 13) {
                    setState({
                        ...state,
                        enterKeyCounter: state.enterKeyCounter + 1
                    })
                }
            }}
            onKeyUp={(e) => {
                if (e.keyCode === 13) {
                    let noIME = false;
                    if (state.enterKeyCounter > 0) {
                        noIME = true;
                    }
                    setState({
                        ...state,
                        enterKeyCounter: 0
                    })

                    if (noIME) {
                        if (props.disableAutoFocus !== true) {
                            const nextElement = getAdjacentElement(1)
                            if (nextElement && !props.fixTabIndex) {
                                nextElement.focus()
                            }
                        }

                        if (props.onCommit) {
                            props.onCommit({
                                value: StringUtils.nvl(state.value)
                            })
                        }
                    }
                }
            }}
            onKeyPress={() => {
                setState({
                    ...state,
                    enterKeyCounter: state.enterKeyCounter + 1
                })
            }}
            onClick={(e) => {
                if (props.onClick) {
                    props.onClick(e)
                }
            }}
        />
    )

    function getAdjacentElement(direction: number, currentElement = document.activeElement): HTMLElement {
        const elements = [...document.querySelectorAll('input,textarea,button,select,*[tabindex],.p-dropdown,p-checkbox')] as Array<HTMLElement>  // NodeList -> Array
        const focusableElements = elements.filter(
            (v) => ((v.tabIndex && v.tabIndex >= 0) || !v.tabIndex) &&
                !v.classList.contains('p-datatable-row')
            // && !v.disabled
        )

        if (!focusableElements || focusableElements.length === 0) {
            return currentElement as HTMLElement
        }

        let curIdx = focusableElements.findIndex((v) => v === currentElement)
        if (direction >= 0) {
            const cnt = direction
            for (let i = 0; i < cnt; i++) {
                curIdx++
                if (curIdx >= focusableElements.length) {
                    curIdx = 0
                }
            }
            return focusableElements[curIdx]
        } else {
            const cnt = direction * -1
            for (let i = 0; i < cnt; i++) {
                curIdx--
                if (curIdx < 0) {
                    curIdx = focusableElements.length - 1
                }
            }
            return focusableElements[curIdx]
        }
    }

}