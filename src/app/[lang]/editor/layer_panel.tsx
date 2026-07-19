'use client'

import { useEffect, useRef, useState } from 'react'
import { UnitUtils } from '@/lib/common/utils/unit_utils'
import { Action } from './action'
import styles from './layer_panel.module.css'
import type { TableSelection } from './reducer'
import {
    ActionType, getBandColor, State, TemplateElement,
    findElementInTree, findParentElement, getElementAbsolutePosition
} from './reducer'
import type { UiMessages } from '@/lib/common/i18n/ui_messages'
import { getLocalizedBandDisplayLabel, getLocalizedElementKindLabel } from './localized_editor_labels'

type Props = {
    state: State,
    dispatch: React.Dispatch<ActionType>,
    messages: UiMessages
}

// Get the icon class for the element type.
// Returns the ids of all container ancestors of the target element (outermost
// first), so the tree can expand the path down to it before scrolling.
function findAncestorIds(bands: { elements: TemplateElement[] }[], targetId: string): string[] {
    for (let i = 0; i < bands.length; i++) {
        const path = findPath(bands[i]!.elements, targetId)
        if (path !== null) return path
    }
    return []
}

function findPath(elements: TemplateElement[], targetId: string): string[] | null {
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]!
        if (el.id === targetId) return []
        if (el.children.length > 0) {
            const child = findPath(el.children, targetId)
            if (child !== null) return [el.id, ...child]
        }
    }
    return null
}

// Minimal CSS attribute-selector escape for element ids used in querySelector.
function cssEscape(value: string): string {
    return value.replace(/["\\]/g, '\\$&')
}

function getElementIcon(kind: string): string {
    switch (kind) {
        case 'staticText': return 'pi pi-align-left'
        case 'textField': return 'pi pi-file-edit'
        case 'line': return 'pi pi-minus'
        case 'rectangle': return 'pi pi-stop'
        case 'ellipse': return 'pi pi-circle'
        case 'path': return 'pi pi-pencil'
        case 'image': return 'pi pi-image'
        case 'svg': return 'pi pi-pencil'
        case 'frame': return 'pi pi-th-large'
        case 'table': return 'pi pi-table'
        case 'tableColumnFrame': return 'pi pi-th-large'
        case 'tableRowFrame': return 'pi pi-th-large'
        case 'tableRow': return 'pi pi-bars'
        case 'tableColumn': return 'pi pi-align-left'
        case 'tableCell': return 'pi pi-align-left'
        case 'crosstab': return 'pi pi-th-large'
        case 'subreport': return 'pi pi-clone'
        case 'barcode': return 'pi pi-qrcode'
        case 'math': return 'pi pi-calculator'
        case 'formField': return 'pi pi-check-square'
        case 'break': return 'pi pi-arrows-v'
        default: return 'pi pi-box'
    }
}

// Get the display name for the element.
function getElementLabel(element: TemplateElement, messages: UiMessages): string {
    switch (element.kind) {
        case 'staticText': return element.text ? `${messages.staticText} [${element.id}] ${element.text}` : `${messages.staticText} [${element.id}]`
        case 'textField': return element.expression ? `${messages.textField} [${element.id}] ${element.expression}` : `${messages.textField} [${element.id}]`
        case 'path': return `${messages.path} [${element.id}]`
        case 'tableColumnFrame': return messages.column + ' ' + messages.frame
        case 'tableRowFrame': {
            const sectionLabel = element.tableSection === 'header'
                ? messages.header
                : element.tableSection === 'detail'
                    ? messages.detailSection
                    : messages.footer
            return sectionLabel + ' ' + messages.row + ' ' + messages.frame
        }
        case 'tableRow': return messages.row
        case 'tableColumn': return element.expression || messages.column
        case 'tableCell': return element.expression || messages.cell
        default: return `${getLocalizedElementKindLabel(element.kind, messages)} [${element.id}]`
    }
}

export function orderBandsForLayerPanel<T extends { type: string }>(bands: T[]): T[] {
    const ordered: T[] = []
    for (let i = 0; i < bands.length; i++) {
        if (bands[i]!.type !== 'background') ordered.push(bands[i]!)
    }
    for (let i = 0; i < bands.length; i++) {
        if (bands[i]!.type === 'background') ordered.push(bands[i]!)
    }
    return ordered
}

// Tableinternalelement.

const TABLE_INTERNAL_KINDS = new Set(['tableColumnFrame', 'tableColumn', 'tableRowFrame', 'tableRow', 'tableCell'])

// Childelement possibleelement.

const CONTAINER_KINDS = new Set(['frame', 'tableCell', 'tableColumn'])

// TableSelectiondetect.

function isTableSelectionMatch(a: TableSelection | null, b: TableSelection | null): boolean {
    if (a === null || b === null) return a === b
    if (a.type !== b.type) return false
    if (a.type === 'cell' && b.type === 'cell') {
        return a.section === b.section && a.row === b.row && a.col === b.col
    }
    if (a.type === 'row' && b.type === 'row') {
        return a.section === b.section && a.row === b.row
    }
    if (a.type === 'column' && b.type === 'column') {
        return a.col === b.col
    }
    return false
}

// Tableinternalelementtop with selectionstate detect.

function isTableInternalSelected(
    bandElements: TemplateElement[],
    elementId: string,
    elementKind: string,
    selectedIdSet: Set<string>,
    tableSelection: TableSelection | null
): boolean {
    // Canvastop with selection.
    
    if (elementKind === 'tableColumnFrame' || elementKind === 'tableRowFrame') return false
    const resolved = resolveTableSelection(bandElements, elementId, elementKind)
    if (resolved === null) return false
    if (!selectedIdSet.has(resolved.tableId)) return false
    return isTableSelectionMatch(tableSelection, resolved.selection)
}

// Tablechildelement from parenttableIDTableSelection.

function resolveTableSelection(
    bandElements: TemplateElement[],
    elementId: string,
    elementKind: string
): { tableId: string, selection: TableSelection | null } | null {
    if (!TABLE_INTERNAL_KINDS.has(elementKind)) return null

    // Table.
    
    let tableElement: TemplateElement | undefined
    let current = elementId
    for (;;) {
        const parent = findParentElement(bandElements, current)
        if (parent === undefined) return null
        if (parent.kind === 'table') {
            tableElement = parent
            break
        }
        current = parent.id
    }
    if (tableElement === undefined) return null

    // With selection.
    
    if (elementKind === 'tableColumnFrame' || elementKind === 'tableRowFrame') {
        return { tableId: tableElement.id, selection: null }
    }

    if (elementKind === 'tableRow') {
        // ParentColumnFrame -> headerrow, parentRowFrame -> detail/footerrow.
        
        const parent = findParentElement(bandElements, elementId)!
        if (parent.kind === 'tableColumnFrame') {
            const rowIndex = parent.children.findIndex(c => c.id === elementId)
            return { tableId: tableElement.id, selection: { type: 'row', section: 'header', row: rowIndex } }
        }
        if (parent.kind === 'tableRowFrame' && parent.tableSection !== '') {
            const rowIndex = parent.children.findIndex(c => c.id === elementId)
            return { tableId: tableElement.id, selection: { type: 'row', section: parent.tableSection as 'detail' | 'footer', row: rowIndex } }
        }
        return { tableId: tableElement.id, selection: null }
    }

    if (elementKind === 'tableColumn' || elementKind === 'tableCell') {
        // Parent tableRow, parent.
        
        const rowElement = findParentElement(bandElements, elementId)
        if (rowElement === undefined || rowElement.kind !== 'tableRow') return { tableId: tableElement.id, selection: null }
        const colIndex = rowElement.children.findIndex(c => c.id === elementId)
        const frameElement = findParentElement(bandElements, rowElement.id)
        if (frameElement === undefined) return { tableId: tableElement.id, selection: null }

        if (frameElement.kind === 'tableColumnFrame') {
            const rowIndex = frameElement.children.findIndex(c => c.id === rowElement.id)
            return { tableId: tableElement.id, selection: { type: 'cell', section: 'header', row: rowIndex, col: colIndex } }
        }
        if (frameElement.kind === 'tableRowFrame' && frameElement.tableSection !== '') {
            const rowIndex = frameElement.children.findIndex(c => c.id === rowElement.id)
            return { tableId: tableElement.id, selection: { type: 'cell', section: frameElement.tableSection as 'detail' | 'footer', row: rowIndex, col: colIndex } }
        }
        return { tableId: tableElement.id, selection: null }
    }

    return null
}

export default function LayerPanel(props: Props) {
    const ui = props.messages
    const { state, dispatch } = props
    const { template, selectedElementIds, selectedBandId } = state
    const layerBands = orderBandsForLayerPanel(template.bands)
    const selectedIdSet = new Set(selectedElementIds)
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
    const [dragElementId, setDragElementId] = useState<string | null>(null)
    const [dragBandId, setDragBandId] = useState<string | null>(null)
    const [dropTarget, setDropTarget] = useState<{ elementId: string, position: 'before' | 'after' | 'inside' } | null>(null)

    // Scroll the tree to the selected element, expanding its ancestor containers
    // first. This is also the single expansion path for newly inserted children:
    // expanding every container whose child count changed would unfold an entire
    // imported document and create thousands of layer rows in one React commit.
    const treeRef = useRef<HTMLDivElement>(null)
    const selectedKey = selectedElementIds.length === 1 ? selectedElementIds[0]! : ''
    useEffect(() => {
        if (selectedKey === '') return
        // Expand every container on the path to the selected element
        const ancestors = findAncestorIds(template.bands, selectedKey)
        if (ancestors.length > 0) {
            setExpandedIds(prev => {
                let changed = false
                const next = new Set(prev)
                for (let i = 0; i < ancestors.length; i++) {
                    if (!next.has(ancestors[i]!)) { next.add(ancestors[i]!); changed = true }
                }
                return changed ? next : prev
            })
        }
    }, [selectedKey, template.bands])
    // Scroll only once per new selection (after ancestor auto-expand renders the
    // node), not every time an unrelated container is expanded.
    const pendingScrollRef = useRef<string>('')
    useEffect(() => { pendingScrollRef.current = selectedKey }, [selectedKey])
    useEffect(() => {
        if (selectedKey === '' || pendingScrollRef.current !== selectedKey || treeRef.current === null) return
        const node = treeRef.current.querySelector('[data-element-id="' + cssEscape(selectedKey) + '"]')
        if (node !== null) {
            node.scrollIntoView({ block: 'nearest' })
            pendingScrollRef.current = ''
        }
    }, [selectedKey, expandedIds])

    function toggleExpand(id: string) {
        setExpandedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    // Positiondetect.
    
    function computeDropPosition(e: React.DragEvent, isContainer: boolean): 'before' | 'after' | 'inside' {
        const rect = e.currentTarget.getBoundingClientRect()
        const y = e.clientY - rect.top
        if (isContainer) {
            const third = rect.height / 3
            if (y < third) return 'before'
            if (y > third * 2) return 'after'
            return 'inside'
        }
        return y < rect.height / 2 ? 'before' : 'after'
    }

    // (): ancestorIddescendantId with.
    
    function isAncestor(elements: TemplateElement[], ancestorId: string, descendantId: string): boolean {
        const ancestor = findElementInTree(elements, ancestorId)
        if (ancestor === undefined) return false
        return findElementInTree(ancestor.children, descendantId) !== undefined
    }

    // Recursiveelementdraw.
    
    function renderElementNode(element: TemplateElement, bandId: string, depth: number) {
        const isTableInternal = TABLE_INTERNAL_KINDS.has(element.kind)
        const bandElements = isTableInternal ? template.bands.find(b => b.id === bandId)?.elements : undefined
        const isElementSelected = isTableInternal
            ? bandElements !== undefined && isTableInternalSelected(bandElements, element.id, element.kind, selectedIdSet, state.tableSelection)
            : selectedIdSet.has(element.id)
        const hasChildren = element.children.length > 0
        const isExpanded = expandedIds.has(element.id)
        const label = getElementLabel(element, props.messages)

        // PositionCSSclass.
        
        const isDropTarget = dropTarget !== null && dropTarget.elementId === element.id
        let dropClass = ''
        if (isDropTarget) {
            switch (dropTarget.position) {
                case 'before': dropClass = styles.dropBefore; break
                case 'after': dropClass = styles.dropAfter; break
                case 'inside': dropClass = styles.dropInside; break
            }
        }

        return (
            <div key={element.id}>
                <div
                    data-element-id={element.id}
                    className={`${styles.elementItem} ${isElementSelected ? styles.selected : ''} ${dropClass}`}
                    style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}
                    draggable={!isTableInternal}
                    onClick={(e) => {
                        e.stopPropagation()
                        if (isTableInternal) {
                            const band = template.bands.find(b => b.id === bandId)
                            if (band === undefined) return
                            const resolved = resolveTableSelection(band.elements, element.id, element.kind)
                            if (resolved === null) return
                            Action.selectElement(dispatch, resolved.tableId, bandId)
                            Action.setTableSelection(dispatch, resolved.selection)
                        } else {
                            Action.selectElement(dispatch, element.id, bandId)
                        }
                    }}
                    onDragStart={(e) => {
                        if (isTableInternal) { e.preventDefault(); return }
                        e.stopPropagation()
                        setDragElementId(element.id)
                        setDragBandId(bandId)
                        e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                        setDragElementId(null)
                        setDragBandId(null)
                        setDropTarget(null)
                    }}
                    onDragOver={(e) => {
                        if (dragElementId === null || dragElementId === element.id) return
                        const isContainer = CONTAINER_KINDS.has(element.kind)
                        if (isTableInternal && !isContainer) return
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'move'
                        // Tableinternal (tableCell/tableColumn) inside.
                        
                        const position = (isTableInternal && isContainer) ? 'inside' as const
                            : computeDropPosition(e, isContainer)
                        setDropTarget({ elementId: element.id, position })
                    }}
                    onDragLeave={() => {
                        if (dropTarget !== null && dropTarget.elementId === element.id) setDropTarget(null)
                    }}
                    onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDropTarget(null)
                        if (dragElementId === null || dragBandId === null) return
                        if (dragElementId === element.id) return

                        const band = template.bands.find(b => b.id === bandId)
                        if (band === undefined) return

                        const isContainer = CONTAINER_KINDS.has(element.kind)
                        const position = (isTableInternal && isContainer) ? 'inside' as const
                            : computeDropPosition(e, isContainer)

                        if (position === 'inside') {
                            // Drop into the target container.
                            if (!isContainer) return
                            // Reparenting into a container is only handled within
                            // one band; a cross-band container drop would remove
                            // the element from its band without re-inserting it.
                            if (dragBandId !== band.id) return
                            // Prevent moving an ancestor into its own descendant.
                            if (isAncestor(band.elements, dragElementId, element.id)) return
                            Action.reparentElement(dispatch, dragElementId, dragBandId, element.id, 0, 0)
                        } else {
                            // Drop before or after the target element.
                            // Prevent moving an ancestor next to its own descendant.
                            if (isAncestor(band.elements, dragElementId, element.id)) return

                            const parent = findParentElement(band.elements, element.id)
                            const siblings = parent !== undefined ? parent.children : band.elements
                            const targetParentId = parent !== undefined ? parent.id : ''

                            // Calculate the destination index.
                            let targetIndex = siblings.findIndex(el => el.id === element.id)
                            if (position === 'after') targetIndex++

                            // Coordinatecalculate.
                            
                            let newX: number, newY: number
                            const dragElement = findElementInTree(band.elements, dragElementId)
                            if (dragElement === undefined) return

                            // Originalparent.
                            
                            const dragParent = findParentElement(band.elements, dragElementId)
                            const dragParentId = dragParent !== undefined ? dragParent.id : ''

                            if (dragParentId === targetParentId) {
                                // Parent with move -> coordinate.
                                
                                newX = dragElement.x
                                newY = dragElement.y

                                // Originalprevious case, removeafter.
                                
                                const dragIndex = siblings.findIndex(el => el.id === dragElementId)
                                if (dragIndex !== -1 && dragIndex < targetIndex) {
                                    targetIndex--
                                }
                            } else {
                                // Parentmove -> coordinate -> coordinateconvert.
                                
                                const absPos = getElementAbsolutePosition(band.elements, dragElementId)
                                if (absPos === undefined) return

                                if (targetParentId === '') {
                                    // Bandbottom to move.
                                    
                                    newX = absPos.x
                                    newY = absPos.y
                                } else {
                                    // Parentelement to move.
                                    
                                    const parentAbsPos = getElementAbsolutePosition(band.elements, targetParentId)
                                    if (parentAbsPos === undefined) return
                                    newX = absPos.x - parentAbsPos.x
                                    newY = absPos.y - parentAbsPos.y
                                }
                            }

                            Action.reparentElement(dispatch, dragElementId, dragBandId, targetParentId, newX, newY, targetIndex)
                        }
                        setDragElementId(null)
                        setDragBandId(null)
                    }}
                >
                    {}
                    {hasChildren ? (
                        <span
                            className={styles.expandToggle}
                            onClick={(e) => {
                                e.stopPropagation()
                                toggleExpand(element.id)
                            }}
                        >
                            {isExpanded ? '▼' : '▶'}
                        </span>
                    ) : (
                        <span className={styles.expandPlaceholder} />
                    )}
                    <i className={`${getElementIcon(element.kind)} ${styles.elementIcon}`}></i>
                    <span className={styles.elementName}>
                        {label}
                    </span>
                </div>
                {}
                {hasChildren && isExpanded && (
                    <div>
                        {element.children.map(child => renderElementNode(child, bandId, depth + 1))}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>{ui.layerPanel}</div>

            <div className={styles.tree} ref={treeRef}>
                {layerBands.map(band => {
                    const isBandSelected = selectedBandId === band.id && selectedElementIds.length === 0
                    const bandColor = getBandColor(band.type)
                    const isBandDropTarget = dropTarget !== null && dropTarget.elementId === `band:${band.id}`

                    return (
                        <div key={band.id} className={styles.bandNode}>
                            {}
                            <div
                                className={`${styles.bandItem} ${isBandSelected ? styles.selected : ''} ${isBandDropTarget ? styles.dropTarget : ''}`}
                                style={!band.enabled ? { opacity: 0.4 } : undefined}
                                onClick={() => Action.selectBand(dispatch, band.id)}
                                onDragOver={(e) => {
                                    if (dragElementId === null) return
                                    e.preventDefault()
                                    e.dataTransfer.dropEffect = 'move'
                                    setDropTarget({ elementId: `band:${band.id}`, position: 'inside' })
                                }}
                                onDragLeave={() => {
                                    if (dropTarget !== null && dropTarget.elementId === `band:${band.id}`) setDropTarget(null)
                                }}
                                onDrop={(e) => {
                                    e.preventDefault()
                                    setDropTarget(null)
                                    if (dragElementId === null || dragBandId === null) return

                                        // Bandmove.
                                    if (dragBandId !== band.id) {
                                        
                                        const sourceBand = template.bands.find(function (b) { return b.id === dragBandId })
                                        if (sourceBand === undefined) return
                                        const dragElement = findElementInTree(sourceBand.elements, dragElementId)
                                        if (dragElement === undefined) return
                                        const absPos = getElementAbsolutePosition(sourceBand.elements, dragElementId)
                                        if (absPos === undefined) return
                                        Action.moveElementToBand(dispatch, dragElementId, dragBandId, band.id, absPos.x, absPos.y)
                                    } else {
                                        // Band (coordinate convert)
                                        
                                        const dragElement = findElementInTree(band.elements, dragElementId)
                                        if (dragElement === undefined) return
                                        const absPos = getElementAbsolutePosition(band.elements, dragElementId)
                                        if (absPos === undefined) return
                                        Action.reparentElement(dispatch, dragElementId, dragBandId, '', absPos.x, absPos.y)
                                    }
                                    setDragElementId(null)
                                    setDragBandId(null)
                                }}
                            >
                                <div
                                    className={styles.bandColorDot}
                                    style={{ backgroundColor: bandColor }}
                                />
                                <span className={styles.bandName}>
                                    {getLocalizedBandDisplayLabel(band, props.messages)}
                                </span>
                                <span className={styles.bandHeight}>
                                    {UnitUtils.ptToDisplayRounded(band.height, state.displayUnit)}{UnitUtils.getUnitLabel(state.displayUnit)}
                                </span>
                            </div>

                            {}
                            {band.elements.length > 0 && (
                                <div className={styles.elementList}>
                                    {band.elements.map(element => renderElementNode(element, band.id, 0))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
