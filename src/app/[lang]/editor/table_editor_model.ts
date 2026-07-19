import { createDefaultElement, createDefaultTableCell, createDefaultTableCellStyle, createDefaultTableRow, findParentElement, type BorderSide, type TableCell, type TableCellStyle, type TableColumn, type TableRow, type TableSectionKey, type TemplateElement } from './reducer'

export type { TableSectionKey }

export type TablePlacement = {
    row: number,
    col: number,
    cell: TableCell
}

export type TableBorderSideKey = 'top' | 'bottom' | 'left' | 'right'

type TableOrigin = {
    row: number,
    col: number,
    cell: TableCell
}

export function cloneTableCellStyle(style: TableCell['style']): TableCell['style'] {
    return {
        hAlign: style.hAlign,
        vAlign: style.vAlign,
        rotation: style.rotation,
        backcolor: style.backcolor,
        forecolor: style.forecolor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikethrough: style.strikethrough,
        lineSpacingType: style.lineSpacingType,
        lineSpacingValue: style.lineSpacingValue,
        letterSpacing: style.letterSpacing,
        wordSpacing: style.wordSpacing,
        firstLineIndent: style.firstLineIndent,
        leftIndent: style.leftIndent,
        rightIndent: style.rightIndent,
        wrap: style.wrap,
        shrinkToFit: style.shrinkToFit,
        minFontSize: style.minFontSize,
        fitWidth: style.fitWidth,
        outlineText: style.outlineText,
        padding: style.padding,
        border: {
            top: style.border.top !== null ? { ...style.border.top } : null,
            bottom: style.border.bottom !== null ? { ...style.border.bottom } : null,
            left: style.border.left !== null ? { ...style.border.left } : null,
            right: style.border.right !== null ? { ...style.border.right } : null,
        },
        opacity: style.opacity,
    }
}

export function cloneTableCell(cell: TableCell): TableCell {
    return {
        expression: cell.expression,
        colSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
        style: cloneTableCellStyle(cell.style),
        children: cell.children.map(function (c) { return structuredClone(c) }),
    }
}

export function cloneTableRow(row: TableRow): TableRow {
    return {
        height: row.height,
        cells: row.cells.map(cloneTableCell),
    }
}

export function cloneTableColumn(column: TableColumn): TableColumn {
    return {
        width: column.width,
        style: cloneTableCellStyle(column.style),
    }
}

export function updateTableColumnStyle(columns: TableColumn[], columnIndex: number, style: Partial<TableColumn['style']>): TableColumn[] {
    const nextColumns = columns.map(cloneTableColumn)
    if (columnIndex < 0 || columnIndex >= nextColumns.length) return nextColumns
    nextColumns[columnIndex] = {
        ...nextColumns[columnIndex]!,
        style: {
            ...nextColumns[columnIndex]!.style,
            ...style,
        },
    }
    return nextColumns
}

export function updateTableColumnBorder(columns: TableColumn[], columnIndex: number, side: TableBorderSideKey, value: BorderSide | null): TableColumn[] {
    const nextColumns = columns.map(cloneTableColumn)
    if (columnIndex < 0 || columnIndex >= nextColumns.length) return nextColumns
    nextColumns[columnIndex] = {
        ...nextColumns[columnIndex]!,
        style: {
            ...nextColumns[columnIndex]!.style,
            border: {
                ...nextColumns[columnIndex]!.style.border,
                [side]: value !== null ? { ...value } : null,
            },
        },
    }
    return nextColumns
}

// =====================================
// children tree accessors
// =====================================

/** Get the Column Frame */
export function getTableColumnFrame(element: TemplateElement): TemplateElement | null {
    for (let i = 0; i < element.children.length; i++) {
        if (element.children[i].kind === 'tableColumnFrame') return element.children[i]
    }
    return null
}

/** Get the Row Frame for the given section */
export function getTableRowFrame(element: TemplateElement, section: TableSectionKey): TemplateElement | null {
    if (section === 'header') return getTableColumnFrame(element)
    for (let i = 0; i < element.children.length; i++) {
        if (element.children[i].kind === 'tableRowFrame' && element.children[i].tableSection === section) return element.children[i]
    }
    return null
}

/** Get the column definitions (from the Column Frame's tableColumns) */
export function getTableColumns(element: TemplateElement): TableColumn[] {
    const frame = getTableColumnFrame(element)
    return frame !== null ? frame.tableColumns : []
}

/** Get the column count */
export function getTableColumnCount(element: TemplateElement): number {
    const frame = getTableColumnFrame(element)
    return frame !== null ? frame.tableColumns.length : 0
}

/** Build TableRow[] from children */
function childrenToTableRows(frame: TemplateElement): TableRow[] {
    const rows: TableRow[] = []
    for (let ri = 0; ri < frame.children.length; ri++) {
        const rowEl = frame.children[ri]
        if (rowEl.kind !== 'tableRow') continue
        const cells: TableCell[] = []
        for (let ci = 0; ci < rowEl.children.length; ci++) {
            const cellEl = rowEl.children[ci]
            cells.push({
                expression: cellEl.expression,
                colSpan: cellEl.colSpan,
                rowSpan: cellEl.rowSpan,
                style: cellEl.tableCellStyle,
                children: cellEl.children,
            })
        }
        rows.push({ height: rowEl.height, cells })
    }
    return rows
}

/** Get the section rows */
export function getTableSectionRows(element: TemplateElement, section: TableSectionKey): TableRow[] {
    const frame = getTableRowFrame(element, section)
    return frame !== null ? childrenToTableRows(frame) : []
}

/** Build the child element tree inside the Row Frame from TableRow[] */
function tableRowsToChildren(rows: TableRow[], parentId: string, cellKind: 'tableColumn' | 'tableCell'): TemplateElement[] {
    const result: TemplateElement[] = []
    for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri]!
        const rowEl = createDefaultElement(parentId + '_r' + ri, 'tableRow', 0, 0, 0, row.height)
        const cellChildren: TemplateElement[] = []
        for (let ci = 0; ci < row.cells.length; ci++) {
            const cell = row.cells[ci]!
            const cellEl = createDefaultElement(parentId + '_c' + ri + '_' + ci, cellKind, 0, 0, 0, 0)
            cellEl.expression = cell.expression
            cellEl.colSpan = cell.colSpan
            cellEl.rowSpan = cell.rowSpan
            cellEl.tableCellStyle = cell.style
            cellEl.children = cell.children
            cellChildren.push(cellEl)
        }
        rowEl.children = cellChildren
        result.push(rowEl)
    }
    return result
}

/** Update the column definitions (returns a Partial<TemplateElement>) */
export function setTableColumns(element: TemplateElement, columns: TableColumn[]): Partial<TemplateElement> {
    const children = element.children.slice()
    for (let i = 0; i < children.length; i++) {
        if (children[i].kind === 'tableColumnFrame') {
            children[i] = { ...children[i], tableColumns: columns }
            return { children }
        }
    }
    return {}
}

/** Update the section rows (returns a Partial<TemplateElement>) */
export function setTableSectionRows(element: TemplateElement, section: TableSectionKey, rows: TableRow[]): Partial<TemplateElement> {
    const children = element.children.slice()
    if (section === 'header') {
        for (let i = 0; i < children.length; i++) {
            if (children[i].kind === 'tableColumnFrame') {
                children[i] = { ...children[i], children: tableRowsToChildren(rows, children[i].id, 'tableColumn') }
                return { children }
            }
        }
    } else {
        for (let i = 0; i < children.length; i++) {
            if (children[i].kind === 'tableRowFrame' && children[i].tableSection === section) {
                children[i] = { ...children[i], children: tableRowsToChildren(rows, children[i].id, 'tableCell') }
                return { children }
            }
        }
    }
    return {}
}

/** Batch-update the table structure */
export function updateTableChildren(
    element: TemplateElement,
    updates: { columns?: TableColumn[], headerRows?: TableRow[], detailRows?: TableRow[], footerRows?: TableRow[] }
): Partial<TemplateElement> {
    const children = element.children.slice()
    for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.kind === 'tableColumnFrame') {
            let updated = child
            if (updates.columns !== undefined) updated = { ...updated, tableColumns: updates.columns }
            if (updates.headerRows !== undefined) updated = { ...updated, children: tableRowsToChildren(updates.headerRows, child.id, 'tableColumn') }
            children[i] = updated
        } else if (child.kind === 'tableRowFrame') {
            if (child.tableSection === 'detail' && updates.detailRows !== undefined) {
                children[i] = { ...child, children: tableRowsToChildren(updates.detailRows, child.id, 'tableCell') }
            } else if (child.tableSection === 'footer' && updates.footerRows !== undefined) {
                children[i] = { ...child, children: tableRowsToChildren(updates.footerRows, child.id, 'tableCell') }
            }
        }
    }
    return { children }
}

export function computeTableContentHeight(element: TemplateElement): number {
    let total = 0
    const sections: TableSectionKey[] = ['header', 'detail', 'footer']
    for (let si = 0; si < sections.length; si++) {
        const rows = getTableSectionRows(element, sections[si])
        for (let ri = 0; ri < rows.length; ri++) {
            total += rows[ri]!.height
        }
    }
    return total
}

/**
 * Get the container size for a table cell element's children.
 * cellElement is a TemplateElement of kind tableColumn or tableCell.
 * elements is the array of elements directly under the band.
 * Computes and returns the content area size from the cell's column width, row height, and padding.
 */
export function getTableCellContainerSize(
    elements: TemplateElement[],
    cellElement: TemplateElement,
): { width: number, height: number } | undefined {
    // Walk up the parent chain: cell -> tableRow -> frame -> table
    const tableRow = findParentElement(elements, cellElement.id)
    if (tableRow === undefined || tableRow.kind !== 'tableRow') return undefined
    const frame = findParentElement(elements, tableRow.id)
    if (frame === undefined) return undefined
    const table = (frame.kind === 'tableColumnFrame' || frame.kind === 'tableRowFrame')
        ? findParentElement(elements, frame.id)
        : undefined
    if (table === undefined || table.kind !== 'table') return undefined

    // Get the column definitions and section rows
    const columns = getTableColumns(table)
    if (columns.length === 0) return undefined
    const columnPositions = computeTableColumnPositions(columns, table.width)

    // Compute the cell's row/col index
    const cellIndexInRow = tableRow.children.indexOf(cellElement)
    if (cellIndexInRow === -1) return undefined

    // Get the section rows and derive the exact col position from the placement
    const section: TableSectionKey = frame.kind === 'tableColumnFrame' ? 'header'
        : (frame.tableSection as TableSectionKey) || 'detail'
    const sectionRows = getTableSectionRows(table, section)
    const placements = buildTablePlacements(sectionRows, columns.length)

    // rowIndex: the tableRow's index within the frame
    let rowIndex = -1
    for (let i = 0; i < frame.children.length; i++) {
        if (frame.children[i].kind === 'tableRow') {
            rowIndex++
            if (frame.children[i].id === tableRow.id) break
        }
    }
    if (rowIndex === -1) return undefined

    // Find this cell from the placements
    let placement: TablePlacement | undefined
    for (let i = 0; i < placements.length; i++) {
        if (placements[i]!.row === rowIndex) {
            // Check whether this is the cellIndexInRow-th cell
            let count = 0
            for (let j = 0; j <= i; j++) {
                if (placements[j]!.row === rowIndex) {
                    if (count === cellIndexInRow) { placement = placements[j]; break }
                    count++
                }
            }
            if (placement !== undefined) break
        }
    }
    if (placement === undefined) return undefined

    // Cell width: sum of column widths across the colSpan
    const col = placement.col
    const colSpan = placement.cell.colSpan
    const colEnd = col + colSpan
    const cellLeft = columnPositions[col]!
    const cellRight = colEnd < columnPositions.length ? columnPositions[colEnd]! : table.width
    const cellWidth = cellRight - cellLeft

    // Cell height: sum of row heights across the rowSpan
    const rowSpan = placement.cell.rowSpan
    let cellHeight = 0
    for (let r = 0; r < rowSpan && rowIndex + r < sectionRows.length; r++) {
        cellHeight += sectionRows[rowIndex + r]!.height
    }

    const pad = placement.cell.style.padding
    return {
        width: cellWidth - pad * 2,
        height: cellHeight - pad * 2,
    }
}

export function computeTableColumnPositions(columns: TableColumn[], totalWidth: number): number[] {
    const positions: number[] = []
    let fixedWidth = 0
    for (let i = 0; i < columns.length; i++) {
        fixedWidth += columns[i]!.width
    }
    const scale = fixedWidth > 0 ? totalWidth / fixedWidth : 1
    let x = 0
    for (let i = 0; i < columns.length; i++) {
        positions.push(x)
        x += columns[i]!.width * scale
    }
    return positions
}

export function computeTableRowOffsets(rows: TableRow[]): number[] {
    const offsets: number[] = []
    let y = 0
    for (let i = 0; i < rows.length; i++) {
        offsets.push(y)
        y += rows[i]!.height
    }
    return offsets
}

function buildTableOrigins(rows: TableRow[], columnCount: number): TableOrigin[] {
    const origins: TableOrigin[] = []
    const occupied = new Set<string>()
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex]!
        let colIndex = 0
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex++) {
            while (colIndex < columnCount && occupied.has(`${rowIndex}:${colIndex}`)) colIndex += 1
            if (colIndex >= columnCount) break
            const cell = cloneTableCell(row.cells[cellIndex]!)
            origins.push({ row: rowIndex, col: colIndex, cell })
            for (let r = 0; r < cell.rowSpan; r++) {
                for (let c = 0; c < cell.colSpan; c++) {
                    if (r === 0 && c === 0) continue
                    occupied.add(`${rowIndex + r}:${colIndex + c}`)
                }
            }
            colIndex += cell.colSpan
        }
    }
    return origins
}

function buildTableRowsFromOrigins(origins: TableOrigin[], rowHeights: number[], columnCount: number): TableRow[] {
    const rows: TableRow[] = []
    const originMap = new Map<string, TableCell>()
    const occupied = new Set<string>()
    for (let i = 0; i < origins.length; i++) {
        originMap.set(`${origins[i]!.row}:${origins[i]!.col}`, cloneTableCell(origins[i]!.cell))
    }
    for (let rowIndex = 0; rowIndex < rowHeights.length; rowIndex++) {
        const cells: TableCell[] = []
        let colIndex = 0
        while (colIndex < columnCount) {
            if (occupied.has(`${rowIndex}:${colIndex}`)) {
                colIndex += 1
                continue
            }
            const originCell = originMap.get(`${rowIndex}:${colIndex}`)
            if (originCell) {
                cells.push(cloneTableCell(originCell))
                for (let r = 0; r < originCell.rowSpan; r++) {
                    for (let c = 0; c < originCell.colSpan; c++) {
                        occupied.add(`${rowIndex + r}:${colIndex + c}`)
                    }
                }
                colIndex += originCell.colSpan
                continue
            }
            cells.push(createDefaultTableCell())
            occupied.add(`${rowIndex}:${colIndex}`)
            colIndex += 1
        }
        rows.push(createDefaultTableRow(cells, rowHeights[rowIndex]!))
    }
    return rows
}

export function buildTablePlacements(rows: TableRow[], columnCount: number): TablePlacement[] {
    const placements: TablePlacement[] = []
    const occupied = new Set<string>()
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex]!
        let colIndex = 0
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex++) {
            while (colIndex < columnCount && occupied.has(`${rowIndex}:${colIndex}`)) colIndex += 1
            if (colIndex >= columnCount) break
            const cell = row.cells[cellIndex]!
            placements.push({ row: rowIndex, col: colIndex, cell })
            for (let r = 0; r < cell.rowSpan; r++) {
                for (let c = 0; c < cell.colSpan; c++) {
                    occupied.add(`${rowIndex + r}:${colIndex + c}`)
                }
            }
            colIndex += cell.colSpan
        }
    }
    return placements
}

export function findTablePlacement(placements: TablePlacement[], row: number, col: number): TablePlacement | null {
    for (let i = 0; i < placements.length; i++) {
        const placement = placements[i]!
        if (
            placement.row <= row
            && row < placement.row + placement.cell.rowSpan
            && placement.col <= col
            && col < placement.col + placement.cell.colSpan
        ) {
            return placement
        }
    }
    return null
}

function intersectsTableRect(aRow: number, aCol: number, aRowSpan: number, aColSpan: number, bRow: number, bCol: number, bRowSpan: number, bColSpan: number): boolean {
    return !(
        aRow + aRowSpan <= bRow
        || bRow + bRowSpan <= aRow
        || aCol + aColSpan <= bCol
        || bCol + bColSpan <= aCol
    )
}

function containsTableRect(outerRow: number, outerCol: number, outerRowSpan: number, outerColSpan: number, innerRow: number, innerCol: number, innerRowSpan: number, innerColSpan: number): boolean {
    return outerRow <= innerRow
        && outerCol <= innerCol
        && outerRow + outerRowSpan >= innerRow + innerRowSpan
        && outerCol + outerColSpan >= innerCol + innerColSpan
}

export function updateTableCellSpan(rows: TableRow[], columnCount: number, targetRow: number, targetCol: number, requestedRowSpan: number, requestedColSpan: number): TableRow[] {
    const placements = buildTablePlacements(rows, columnCount)
    const targetPlacement = findTablePlacement(placements, targetRow, targetCol)
    if (targetPlacement === null) return rows

    const rowCount = rows.length
    const origins = buildTableOrigins(rows, columnCount)
    const originIndex = origins.findIndex(function (origin) {
        return origin.row === targetPlacement.row && origin.col === targetPlacement.col
    })
    if (originIndex === -1) return rows

    let nextRowSpan = Math.max(1, Math.min(requestedRowSpan, rowCount - targetPlacement.row))
    let nextColSpan = Math.max(1, Math.min(requestedColSpan, columnCount - targetPlacement.col))
    let valid = false

    while (nextRowSpan >= 1 && !valid) {
        let testColSpan = nextColSpan
        while (testColSpan >= 1) {
            let blocked = false
            for (let i = 0; i < origins.length; i++) {
                if (i === originIndex) continue
                const other = origins[i]!
                if (!intersectsTableRect(targetPlacement.row, targetPlacement.col, nextRowSpan, testColSpan, other.row, other.col, other.cell.rowSpan, other.cell.colSpan)) continue
                if (!containsTableRect(targetPlacement.row, targetPlacement.col, nextRowSpan, testColSpan, other.row, other.col, other.cell.rowSpan, other.cell.colSpan)) {
                    blocked = true
                    break
                }
            }
            if (!blocked) {
                nextColSpan = testColSpan
                valid = true
                break
            }
            testColSpan -= 1
        }
        if (!valid) nextRowSpan -= 1
    }

    if (!valid) return rows

    const nextOrigins: TableOrigin[] = []
    for (let i = 0; i < origins.length; i++) {
        if (i === originIndex) continue
        const other = origins[i]!
        if (containsTableRect(targetPlacement.row, targetPlacement.col, nextRowSpan, nextColSpan, other.row, other.col, other.cell.rowSpan, other.cell.colSpan)) {
            continue
        }
        nextOrigins.push(other)
    }

    const targetOrigin = origins[originIndex]!
    targetOrigin.cell.colSpan = nextColSpan
    targetOrigin.cell.rowSpan = nextRowSpan
    nextOrigins.push(targetOrigin)

    return buildTableRowsFromOrigins(nextOrigins, rows.map(function (row) { return row.height }), columnCount)
}

export function updateTableCell(rows: TableRow[], columnCount: number, targetRow: number, targetCol: number, props: Partial<TableCell>): TableRow[] {
    const nextRows = rows.map(cloneTableRow)
    const placements = buildTablePlacements(nextRows, columnCount)
    const targetPlacement = findTablePlacement(placements, targetRow, targetCol)
    if (targetPlacement === null) return nextRows
    targetPlacement.cell.expression = props.expression ?? targetPlacement.cell.expression
    targetPlacement.cell.colSpan = props.colSpan ?? targetPlacement.cell.colSpan
    targetPlacement.cell.rowSpan = props.rowSpan ?? targetPlacement.cell.rowSpan
    if (props.style !== undefined) {
        targetPlacement.cell.style = cloneTableCellStyle(props.style)
    }
    return nextRows
}

export function updateTableCellStyle(rows: TableRow[], columnCount: number, targetRow: number, targetCol: number, style: Partial<TableCell['style']>): TableRow[] {
    const nextRows = rows.map(cloneTableRow)
    const placements = buildTablePlacements(nextRows, columnCount)
    const targetPlacement = findTablePlacement(placements, targetRow, targetCol)
    if (targetPlacement === null) return nextRows
    targetPlacement.cell.style = {
        ...targetPlacement.cell.style,
        ...style,
    }
    return nextRows
}

export function updateTableCellBorder(rows: TableRow[], columnCount: number, targetRow: number, targetCol: number, side: TableBorderSideKey, value: BorderSide | null): TableRow[] {
    const nextRows = rows.map(cloneTableRow)
    const placements = buildTablePlacements(nextRows, columnCount)
    const targetPlacement = findTablePlacement(placements, targetRow, targetCol)
    if (targetPlacement === null) return nextRows
    targetPlacement.cell.style.border = {
        ...targetPlacement.cell.style.border,
        [side]: value !== null ? { ...value } : null,
    }
    return nextRows
}

export function insertTableColumn(rows: TableRow[], columnCount: number, insertAt: number): TableRow[] {
    const origins = buildTableOrigins(rows, columnCount)
    for (let i = 0; i < origins.length; i++) {
        const origin = origins[i]!
        if (origin.col < insertAt && origin.col + origin.cell.colSpan > insertAt) {
            origin.cell.colSpan += 1
        } else if (origin.col >= insertAt) {
            origin.col += 1
        }
    }
    return buildTableRowsFromOrigins(origins, rows.map(function (row) { return row.height }), columnCount + 1)
}

export function removeTableColumn(rows: TableRow[], columnCount: number, removeAt: number): TableRow[] {
    if (columnCount <= 1) return rows
    const origins = buildTableOrigins(rows, columnCount)
    const nextOrigins: TableOrigin[] = []
    for (let i = 0; i < origins.length; i++) {
        const origin = origins[i]!
        const endCol = origin.col + origin.cell.colSpan
        if (origin.col > removeAt) {
            origin.col -= 1
            nextOrigins.push(origin)
            continue
        }
        if (origin.col <= removeAt && endCol > removeAt) {
            if (origin.cell.colSpan > 1) {
                origin.cell.colSpan -= 1
                nextOrigins.push(origin)
            }
            continue
        }
        nextOrigins.push(origin)
    }
    return buildTableRowsFromOrigins(nextOrigins, rows.map(function (row) { return row.height }), columnCount - 1)
}

export function insertTableRow(rows: TableRow[], columnCount: number, insertAt: number): TableRow[] {
    const origins = buildTableOrigins(rows, columnCount)
    for (let i = 0; i < origins.length; i++) {
        const origin = origins[i]!
        if (origin.row < insertAt && origin.row + origin.cell.rowSpan > insertAt) {
            origin.cell.rowSpan += 1
        } else if (origin.row >= insertAt) {
            origin.row += 1
        }
    }
    const rowHeights = rows.map(function (row) { return row.height })
    rowHeights.splice(insertAt, 0, 18)
    return buildTableRowsFromOrigins(origins, rowHeights, columnCount)
}

export function removeTableRow(rows: TableRow[], columnCount: number, removeAt: number): TableRow[] {
    if (rows.length <= 1) return rows
    const origins = buildTableOrigins(rows, columnCount)
    const nextOrigins: TableOrigin[] = []
    for (let i = 0; i < origins.length; i++) {
        const origin = origins[i]!
        const endRow = origin.row + origin.cell.rowSpan
        if (origin.row > removeAt) {
            origin.row -= 1
            nextOrigins.push(origin)
            continue
        }
        if (origin.row <= removeAt && endRow > removeAt) {
            if (origin.cell.rowSpan > 1) {
                origin.cell.rowSpan -= 1
                nextOrigins.push(origin)
            }
            continue
        }
        nextOrigins.push(origin)
    }
    const rowHeights = rows.map(function (row) { return row.height })
    rowHeights.splice(removeAt, 1)
    return buildTableRowsFromOrigins(nextOrigins, rowHeights, columnCount)
}

export function createDefaultCanvasTableColumn(): TableColumn {
    return {
        width: 80,
        style: createDefaultTableCellStyle(),
    }
}

// =====================================
// Parent fit (fitParentHorizontal / fitParentVertical)
// =====================================

function fitChild(child: TemplateElement, contentW: number | undefined, contentH: number | undefined): TemplateElement {
    if (child.pdfSourceLocked) return child
    if (!child.fitParentHorizontal && !child.fitParentVertical) return child
    let x = child.x
    let width = child.width
    let y = child.y
    let height = child.height
    if (child.fitParentHorizontal && contentW !== undefined && contentW > 0) {
        x = 0
        width = contentW
    }
    if (child.fitParentVertical && contentH !== undefined && contentH > 0) {
        y = 0
        height = contentH
    }
    if (x === child.x && width === child.width && y === child.y && height === child.height) return child
    return { ...child, x, width, y, height }
}

function applyParentFitWalk(
    rootElements: TemplateElement[],
    elements: TemplateElement[],
): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = new Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]!
        let newChildren = el.children

        if (el.kind === 'frame') {
            // frame's content area = size - padding
            const pad = el.style.padding
            const contentW = el.width - pad.left - pad.right
            const contentH = el.height - pad.top - pad.bottom
            let childChanged = false
            const fitted: TemplateElement[] = new Array(el.children.length)
            for (let j = 0; j < el.children.length; j++) {
                const next = fitChild(el.children[j]!, contentW, contentH)
                if (next !== el.children[j]) childChanged = true
                fitted[j] = next
            }
            newChildren = childChanged ? fitted : el.children
        } else if ((el.kind === 'tableCell' || el.kind === 'tableColumn') && el.children.length > 0) {
            // A cell's / column header's content area is derived from the table definition (column width, row height, padding)
            const size = getTableCellContainerSize(rootElements, el)
            if (size !== undefined) {
                let childChanged = false
                const fitted: TemplateElement[] = new Array(el.children.length)
                for (let j = 0; j < el.children.length; j++) {
                    const next = fitChild(el.children[j]!, size.width, size.height)
                    if (next !== el.children[j]) childChanged = true
                    fitted[j] = next
                }
                newChildren = childChanged ? fitted : el.children
            }
        }

        // Recurse into descendants
        const walked = newChildren.length > 0 ? applyParentFitWalk(rootElements, newChildren) : newChildren
        if (walked !== el.children) {
            result[i] = { ...el, children: walked }
            changed = true
        } else {
            result[i] = el
        }
    }
    return changed ? result : elements
}

/**
 * Applies the parent-fit settings (fitParentHorizontal / fitParentVertical) across the entire band element tree.
 * Target parents: frame / tableColumn / tableCell. Returns the same reference if nothing changed.
 */
export function applyParentFitToBandElements(elements: TemplateElement[]): TemplateElement[] {
    return applyParentFitWalk(elements, elements)
}
