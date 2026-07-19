'use client'

import React, { useRef, useState } from 'react'
import styles from './json_tree_panel.module.css'

type Props = {
    content: string
    onNodeClick?: (path: string) => void
}

type ParseCache = {
    source: string
    parsed: unknown
    error: string | null
}

// Determine whether a value is an object or array
function isStructural(value: unknown): boolean {
    return value !== null && typeof value === 'object'
}

// Return the structural child keys of an object (keys whose value is an object/array)
function getStructuralKeys(obj: Record<string, unknown>): string[] {
    const keys = Object.keys(obj)
    const result: string[] = []
    for (let i = 0; i < keys.length; i++) {
        if (isStructural(obj[keys[i]])) {
            result.push(keys[i])
        }
    }
    return result
}

// Render an object node.
function renderObjectNode(key: string | number, obj: Record<string, unknown>, depth: number, collapsed: Set<string>, path: string, toggle: (path: string) => void, onNodeClick: ((path: string) => void) | undefined): React.JSX.Element {
    const allKeys = Object.keys(obj)
    const structuralKeys = getStructuralKeys(obj)
    const isCollapsed = collapsed.has(path)
    const label = typeof key === 'number' ? '[' + key + ']' : key
    const summary = allKeys.length + ' props'

    if (structuralKeys.length === 0) {
        // No structural children; render as a leaf node.
        return (
            <div key={key} className={styles.row} style={{ paddingLeft: (0.5 + depth * 0.875) + 'rem' }}
                onClick={onNodeClick !== undefined ? function () { onNodeClick(path) } : undefined}>
                <span className={styles.expandPlaceholder} />
                <span className={styles.key}>{label}</span>
                <span className={styles.badge}>{'{' + summary + '}'}</span>
            </div>
        )
    }

    return (
        <div key={key}>
            <div className={styles.row} style={{ paddingLeft: (0.5 + depth * 0.875) + 'rem' }}
                onClick={function () { toggle(path); if (onNodeClick !== undefined) onNodeClick(path) }}>
                <span className={styles.expandToggle}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                <span className={styles.key}>{label}</span>
                <span className={styles.badge}>{'{' + summary + '}'}</span>
            </div>
            {!isCollapsed && (
                <div>
                    {structuralKeys.map(function (k) {
                        return renderNode(k, obj[k], depth + 1, collapsed, path + '/' + k, toggle, onNodeClick)
                    })}
                </div>
            )}
        </div>
    )
}

// Render an array node.
function renderArrayNode(key: string | number, arr: unknown[], depth: number, collapsed: Set<string>, path: string, toggle: (path: string) => void, onNodeClick: ((path: string) => void) | undefined): React.JSX.Element {
    const isCollapsed = collapsed.has(path)
    const label = typeof key === 'number' ? '[' + key + ']' : key

    // Check whether structural elements exist.
    let hasStructural = false
    for (let i = 0; i < arr.length; i++) {
        if (isStructural(arr[i])) { hasStructural = true; break }
    }

    if (!hasStructural) {
        // All elements are primitive values; render as a leaf node.
        return (
            <div key={key} className={styles.row} style={{ paddingLeft: (0.5 + depth * 0.875) + 'rem' }}
                onClick={onNodeClick !== undefined ? function () { onNodeClick(path) } : undefined}>
                <span className={styles.expandPlaceholder} />
                <span className={styles.key}>{label}</span>
                <span className={styles.badge}>{'[' + arr.length + ']'}</span>
            </div>
        )
    }

    return (
        <div key={key}>
            <div className={styles.row} style={{ paddingLeft: (0.5 + depth * 0.875) + 'rem' }}
                onClick={function () { toggle(path); if (onNodeClick !== undefined) onNodeClick(path) }}>
                <span className={styles.expandToggle}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                <span className={styles.key}>{label}</span>
                <span className={styles.badge}>{'[' + arr.length + ']'}</span>
            </div>
            {!isCollapsed && (
                <div>
                    {arr.map(function (item, i) {
                        if (!isStructural(item)) return null
                        return renderNode(i, item, depth + 1, collapsed, path + '/' + i, toggle, onNodeClick)
                    })}
                </div>
            )}
        </div>
    )
}

// Render a node as an object or array.
function renderNode(key: string | number, value: unknown, depth: number, collapsed: Set<string>, path: string, toggle: (path: string) => void, onNodeClick: ((path: string) => void) | undefined): React.JSX.Element | null {
    if (!isStructural(value)) return null
    if (Array.isArray(value)) {
        return renderArrayNode(key, value, depth, collapsed, path, toggle, onNodeClick)
    }
    return renderObjectNode(key, value as Record<string, unknown>, depth, collapsed, path, toggle, onNodeClick)
}

export default function JsonTreePanel(props: Props) {
    const cacheRef = useRef<ParseCache>({ source: '', parsed: null, error: null })
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

    // Parse cache.
    let parsed: unknown = null
    let error: string | null = null
    if (props.content === cacheRef.current.source) {
        parsed = cacheRef.current.parsed
        error = cacheRef.current.error
    } else {
        try {
            parsed = JSON.parse(props.content)
            error = null
        } catch (e) {
            parsed = null
            error = e instanceof Error ? e.message : String(e)
        }
        cacheRef.current = { source: props.content, parsed: parsed, error: error }
    }

    function toggle(path: string) {
        setCollapsed(function (prev) {
            const next = new Set(prev)
            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }
            return next
        })
    }

    if (error !== null) {
        return (
            <div className={styles.panel}>
                <div className={styles.header}>JSON Structure</div>
                <div className={styles.error}>{error}</div>
            </div>
        )
    }

    if (!isStructural(parsed)) {
        return (
            <div className={styles.panel}>
                <div className={styles.header}>JSON Structure</div>
                <div className={styles.primitive}>{String(parsed)}</div>
            </div>
        )
    }

    const isArray = Array.isArray(parsed)
    const rootCollapsed = collapsed.has('$')

    // Root summary.
    let rootSummary: string
    let rootChildren: React.JSX.Element[] | null = null

    if (isArray) {
        rootSummary = '[' + (parsed as unknown[]).length + ']'
        if (!rootCollapsed) {
            const items: React.JSX.Element[] = []
            const arr = parsed as unknown[]
            for (let i = 0; i < arr.length; i++) {
                if (isStructural(arr[i])) {
                    const node = renderNode(i, arr[i], 1, collapsed, '$/' + i, toggle, props.onNodeClick)
                    if (node !== null) items.push(node)
                }
            }
            rootChildren = items
        }
    } else {
        const obj = parsed as Record<string, unknown>
        rootSummary = '{' + Object.keys(obj).length + ' props}'
        if (!rootCollapsed) {
            const structuralKeys = getStructuralKeys(obj)
            const items: React.JSX.Element[] = []
            for (let i = 0; i < structuralKeys.length; i++) {
                const node = renderNode(structuralKeys[i], obj[structuralKeys[i]], 1, collapsed, '$/' + structuralKeys[i], toggle, props.onNodeClick)
                if (node !== null) items.push(node)
            }
            rootChildren = items
        }
    }

    return (
        <div className={styles.panel}>
            <div className={styles.header}>JSON Structure</div>
            <div className={styles.tree}>
                <div className={styles.row} style={{ paddingLeft: '0.5rem' }}
                    onClick={function () { toggle('$'); if (props.onNodeClick !== undefined) props.onNodeClick('$') }}>
                    <span className={styles.expandToggle}>{rootCollapsed ? '\u25B6' : '\u25BC'}</span>
                    <span className={styles.key}>root</span>
                    <span className={styles.badge}>{rootSummary}</span>
                </div>
                {rootChildren !== null && rootChildren.length > 0 && (
                    <div>{rootChildren}</div>
                )}
            </div>
        </div>
    )
}
