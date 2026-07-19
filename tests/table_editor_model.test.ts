import { describe, expect, it } from 'vitest'
import { createDefaultElement } from '../src/app/[lang]/editor/reducer'
import {
    buildTablePlacements,
    computeTableColumnPositions,
    computeTableContentHeight,
    getTableColumnCount,
    getTableColumns,
    getTableSectionRows,
    insertTableColumn,
    insertTableRow,
    removeTableColumn,
    removeTableRow,
    setTableSectionRows,
    updateTableCell,
    updateTableCellBorder,
    updateTableCellStyle,
    updateTableCellSpan,
    updateTableColumnBorder,
    updateTableColumnStyle,
} from '../src/app/[lang]/editor/table_editor_model'

describe('table editor model helpers', () => {
    // Verify colSpan of a merged cell grows/shrinks when a column is inserted/removed inside it
    it('inserts and removes columns while preserving merged cells', () => {
        const element = createDefaultElement('table_1', 'table', 0, 0, 200, 100)
        const headerRows = getTableSectionRows(element, 'header')
        const columnCount = getTableColumnCount(element)
        headerRows[0]!.cells[0]!.colSpan = 2

        const inserted = insertTableColumn(headerRows, columnCount, 1)
        const insertedPlacements = buildTablePlacements(inserted, columnCount + 1)
        expect(insertedPlacements[0]!.cell.colSpan).toBe(3)

        const removed = removeTableColumn(inserted, columnCount + 1, 1)
        const removedPlacements = buildTablePlacements(removed, columnCount)
        expect(removedPlacements[0]!.cell.colSpan).toBe(2)
    })

    // Verify rowSpan of a merged cell grows/shrinks when a row is inserted/removed inside it
    it('inserts and removes rows while preserving rowspan cells', () => {
        const element = createDefaultElement('table_1', 'table', 0, 0, 200, 100)
        const headerRows = getTableSectionRows(element, 'header')
        const columnCount = getTableColumnCount(element)
        headerRows[0]!.cells[0]!.rowSpan = 2
        headerRows.push({
            height: 18,
            cells: [{ ...headerRows[0]!.cells[1]! }],
        })

        const inserted = insertTableRow(headerRows, columnCount, 1)
        const insertedPlacements = buildTablePlacements(inserted, columnCount)
        expect(insertedPlacements[0]!.cell.rowSpan).toBe(3)

        const removed = removeTableRow(inserted, columnCount, 1)
        const removedPlacements = buildTablePlacements(removed, columnCount)
        expect(removedPlacements[0]!.cell.rowSpan).toBe(2)
    })

    // Verify widening a cell span produces a valid placement without overlapping neighbors
    it('updates cell span without overlapping partial merged cells', () => {
        const element = createDefaultElement('table_1', 'table', 0, 0, 200, 100)
        const headerRows = getTableSectionRows(element, 'header')
        const columnCount = getTableColumnCount(element)
        const widened = updateTableCellSpan(headerRows, columnCount, 0, 0, 1, 2)
        const placements = buildTablePlacements(widened, columnCount)
        expect(placements[0]!.cell.colSpan).toBe(2)
    })

    // Verify column x-positions and content height are computed for the canvas preview
    it('computes preview geometry from relative column widths and row heights', () => {
        const element = createDefaultElement('table_1', 'table', 0, 0, 240, 100)
        const columns = getTableColumns(element)
        columns[0]!.width = 80
        columns[1]!.width = 160
        const positions = computeTableColumnPositions(columns, element.width)

        expect(positions[0]).toBe(0)
        expect(positions[1]).toBe(80)
        expect(computeTableContentHeight(element)).toBeGreaterThan(0)
    })

    // Verify column style/border updates are immutable and scoped to the target column
    it('updates selected column style and border without mutating siblings', () => {
        const element = createDefaultElement('table_1', 'table', 0, 0, 200, 100)
        const columns = getTableColumns(element)
        const styledColumns = updateTableColumnStyle(columns, 0, { backcolor: '#ffeeaa', bold: true })
        const borderedColumns = updateTableColumnBorder(styledColumns, 0, 'right', { width: 1.5, color: '#008800', style: 'dashed' })

        expect(borderedColumns[0]!.style.backcolor).toBe('#ffeeaa')
        expect(borderedColumns[0]!.style.bold).toBe(true)
        expect(borderedColumns[0]!.style.border.right?.color).toBe('#008800')
        expect(borderedColumns[1]!.style.backcolor).toBe('#FFFFFF')
        // Original element columns should not be mutated
        expect(getTableColumns(element)[0]!.style.backcolor).toBe('#FFFFFF')
    })

    // Verify cell content/style/border updates addressed by grid coordinates reach a merged cell
    it('updates merged cell content and border through placement coordinates', () => {
        const element = createDefaultElement('table_1', 'table', 0, 0, 200, 100)
        const headerRows = getTableSectionRows(element, 'header')
        const columnCount = getTableColumnCount(element)
        const mergedRows = updateTableCellSpan(headerRows, columnCount, 0, 0, 1, 2)
        const textRows = updateTableCell(mergedRows, columnCount, 0, 1, { expression: 'field.title' })
        const styleRows = updateTableCellStyle(textRows, columnCount, 0, 1, { forecolor: '#112233', padding: 6 })
        const borderedRows = updateTableCellBorder(styleRows, columnCount, 0, 1, 'bottom', { width: 2, color: '#ff0000', style: 'solid' })
        const placements = buildTablePlacements(borderedRows, columnCount)

        expect(placements[0]!.cell.expression).toBe('field.title')
        expect(placements[0]!.cell.style.forecolor).toBe('#112233')
        expect(placements[0]!.cell.style.padding).toBe(6)
        expect(placements[0]!.cell.style.border.bottom?.width).toBe(2)
    })

    // Verify createDefaultElement builds the expected table children tree (column/row frames)
    it('creates table with correct children tree structure', () => {
        const element = createDefaultElement('t1', 'table', 0, 0, 200, 100)
        // Table should have Column Frame + Detail Row Frame + Footer Row Frame
        expect(element.children.length).toBe(3)
        expect(element.children[0].kind).toBe('tableColumnFrame')
        expect(element.children[1].kind).toBe('tableRowFrame')
        expect(element.children[1].tableSection).toBe('detail')
        expect(element.children[2].kind).toBe('tableRowFrame')
        expect(element.children[2].tableSection).toBe('footer')

        // Column Frame should have tableColumns and header rows as children
        const cf = element.children[0]
        expect(cf.tableColumns.length).toBe(2)
        expect(cf.children.length).toBe(1) // 1 header row
        expect(cf.children[0].kind).toBe('tableRow')
        expect(cf.children[0].children.length).toBe(2) // 2 columns
        expect(cf.children[0].children[0].kind).toBe('tableColumn')
        expect(cf.children[0].children[0].expression).toBe('"Column 1"')

        // Detail Row Frame
        const df = element.children[1]
        expect(df.children.length).toBe(1) // 1 detail row
        expect(df.children[0].kind).toBe('tableRow')
        expect(df.children[0].children.length).toBe(2)
        expect(df.children[0].children[0].kind).toBe('tableCell')
        expect(df.children[0].children[0].expression).toBe('"Cell 1"')
    })

    // Verify getTableColumns/getTableSectionRows read columns and section rows from the tree
    it('accessor functions read correctly from children tree', () => {
        const element = createDefaultElement('t1', 'table', 0, 0, 200, 100)
        const columns = getTableColumns(element)
        expect(columns.length).toBe(2)
        expect(columns[0]!.width).toBe(80)

        const headerRows = getTableSectionRows(element, 'header')
        expect(headerRows.length).toBe(1)
        expect(headerRows[0]!.cells.length).toBe(2)
        expect(headerRows[0]!.cells[0]!.expression).toBe('"Column 1"')

        const detailRows = getTableSectionRows(element, 'detail')
        expect(detailRows.length).toBe(1)
        expect(detailRows[0]!.cells[0]!.expression).toBe('"Cell 1"')

        const footerRows = getTableSectionRows(element, 'footer')
        expect(footerRows.length).toBe(0)
    })

    // Verify setTableSectionRows writes modified rows back into the children tree
    it('setTableSectionRows updates children tree correctly', () => {
        const element = createDefaultElement('t1', 'table', 0, 0, 200, 100)
        const headerRows = getTableSectionRows(element, 'header')
        headerRows[0]!.cells[0]!.expression = '"Updated"'
        const update = setTableSectionRows(element, 'header', headerRows)
        const updated = { ...element, ...update }
        const newHeaderRows = getTableSectionRows(updated, 'header')
        expect(newHeaderRows[0]!.cells[0]!.expression).toBe('"Updated"')
    })
})
