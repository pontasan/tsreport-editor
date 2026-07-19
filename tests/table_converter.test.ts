import { describe, expect, it } from 'vitest'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'
import { createDefaultElement, createDefaultTemplate, normalizeTemplate, type ReportTemplate } from '../src/app/[lang]/editor/reducer'
import { getTableColumns, getTableSectionRows, setTableColumns, setTableSectionRows, updateTableChildren } from '../src/app/[lang]/editor/table_editor_model'

describe('table editor integration', () => {
    // Verify legacy flat table properties migrate into the children-tree structure on normalize
    it('normalizes persisted table structure (migration from old format)', () => {
        const raw = {
            ...createDefaultTemplate(),
            bands: [{
                type: 'detail',
                height: 120,
                startNewPage: false,
                splitType: 'Stretch',
                enabled: true,
                printWhenExpression: '',
                elements: [{
                    ...createDefaultElement('table_1', 'table', 10, 10, 200, 80),
                    // Legacy flat properties (children emptied to reproduce the old format)
                    children: [],
                    tableColumns: [
                        { width: 90, style: { forecolor: '#123456' } },
                        { width: 110 },
                    ],
                    tableHeaderRows: [{
                        height: 24,
                        cells: [
                            { text: 'Header A', colSpan: 2, style: { backcolor: '#EEEEEE' } },
                        ],
                    }],
                    tableDetailRows: [{
                        height: 18,
                        cells: [
                            { expression: 'field.name' },
                            { expression: 'field.value', rowSpan: 1 },
                        ],
                    }],
                    tableFooterRows: [{
                        height: 20,
                        cells: [
                            { text: 'Total' },
                            { expression: 'field.total' },
                        ],
                    }],
                }],
            }],
        } as unknown as ReportTemplate

        const normalized = normalizeTemplate(raw)
        const detail = normalized.bands.find(function (band) { return band.type === 'detail' })!
        const element = detail.elements[0]!

        // In the new format, data is read through accessors
        const columns = getTableColumns(element)
        expect(columns[0]!.width).toBe(90)
        expect(columns[0]!.style.forecolor).toBe('#123456')

        const headerRows = getTableSectionRows(element, 'header')
        expect(headerRows[0]!.cells[0]!.colSpan).toBe(2)
        expect(headerRows[0]!.cells[0]!.style.backcolor).toBe('#EEEEEE')

        const footerRows = getTableSectionRows(element, 'footer')
        expect(footerRows).toHaveLength(1)
    })

    // Verify columns, merged header cells, and detail rows convert into the core table definition
    it('converts editor table model into core table definition', () => {
        const template = createDefaultTemplate()
        const detailBand = template.bands.find(function (band) { return band.type === 'detail' })!
        const table = createDefaultElement('table_1', 'table', 0, 0, 220, 100)

        // Modify column definitions through the accessor
        const columns = getTableColumns(table)
        const newColumns = [
            {
                width: 100,
                style: {
                    ...columns[0]!.style,
                    forecolor: '#0000FF',
                    border: {
                        top: null,
                        bottom: null,
                        left: null,
                        right: { width: 1.5, color: '#008800', style: 'solid' as const },
                    },
                },
            },
            { ...columns[1]! },
        ]

        const headerRows = getTableSectionRows(table, 'header')
        const newHeaderRows = [{
            height: 20,
            cells: [
                {
                    ...headerRows[0]!.cells[0]!,
                    expression: '"Merged"',
                    colSpan: 2,
                    rowSpan: 1,
                    style: {
                        ...headerRows[0]!.cells[0]!.style,
                        backcolor: '#FFF4CC',
                    },
                },
            ],
        }]

        const detailRows = getTableSectionRows(table, 'detail')
        const newDetailRows = [{
            height: 18,
            cells: [
                { ...detailRows[0]!.cells[0]!, expression: 'field.name' },
                { ...detailRows[0]!.cells[1]!, expression: 'field.value' },
            ],
        }]

        const updated = { ...table, ...updateTableChildren(table, {
            columns: newColumns,
            headerRows: newHeaderRows,
            detailRows: newDetailRows,
        }) }

        detailBand.elements = [updated]

        const converted = convertEditorTemplateToCore(template)
        const detail = converted.bands.details?.[0]
        expect(detail).toBeDefined()
        const element = detail!.elements?.[0] as any

        expect(element.type).toBe('table')
        expect(element.columns[0].style.forecolor).toBe('#0000FF')
        expect(element.columns[0].style.border.right.color).toBe('#008800')
        expect(element.headerRows[0].cells[0].colSpan).toBe(2)
        expect(element.headerRows[0].cells[0].backcolor).toBe('#FFF4CC')
        expect(element.detailRows[0].cells[0].expression).toBe('field.name')
    })
})
