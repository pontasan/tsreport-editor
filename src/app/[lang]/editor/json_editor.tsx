'use client'

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import styles from './json_editor.module.css'

type Props = {
    initialState: EditorState
    onViewCreated: (view: EditorView) => void
}

export default function JsonEditor(props: Props) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(function () {
        const container = containerRef.current
        if (container === null) return

        const view = new EditorView({
            state: props.initialState,
            parent: container
        })

        props.onViewCreated(view)

        return function () {
            view.destroy()
        }
    }, [props.initialState])

    return <div ref={containerRef} className={styles.container} />
}
