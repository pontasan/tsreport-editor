import { describe, expect, it } from 'vitest'
import { createReport, type CrosstabElementDef } from 'tsreport-core'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'
import { createDefaultElement, createDefaultTemplate } from '../src/app/[lang]/editor/reducer'

function createCrosstabTemplate() {
    const template = createDefaultTemplate()
    const crosstab = createDefaultElement('ct1', 'crosstab', 0, 0, 400, 200)
    crosstab.crosstabRowGroups = [{ field: 'region' }]
    crosstab.crosstabColumnGroups = [{ field: 'quarter' }]
    crosstab.crosstabMeasures = [{ field: 'sales', calculation: 'sum', format: '#,##0' }]
    crosstab.rowHeaderWidth = 90
    crosstab.columnHeaderHeight = 24
    crosstab.cellWidth = 70
    crosstab.cellHeight = 18
    crosstab.showGrandTotal = true
    const detailIdx = template.bands.findIndex(function (b) { return b.type === 'detail' })
    template.bands[detailIdx] = {
        ...template.bands[detailIdx],
        height: 220,
        elements: [crosstab],
    }
    return template
}

describe('editor crosstab → core crosstab conversion', () => {
    // Verify all crosstab properties survive the editor-to-core template conversion
    it('converts crosstab element with groups and measures (no rectangle fallback)', () => {
        const core = convertEditorTemplateToCore(createCrosstabTemplate())
        const detail = core.bands.details![0]!
        const el = detail.elements![0]!
        expect(el.type).toBe('crosstab')
        const ct = el as CrosstabElementDef
        expect(ct.rowGroups).toEqual([{ field: 'region' }])
        expect(ct.columnGroups).toEqual([{ field: 'quarter' }])
        expect(ct.measures).toEqual([{ field: 'sales', calculation: 'sum', format: '#,##0' }])
        expect(ct.rowHeaderWidth).toBe(90)
        expect(ct.columnHeaderHeight).toBe(24)
        expect(ct.cellWidth).toBe(70)
        expect(ct.cellHeight).toBe(18)
        expect(ct.showGrandTotal).toBe(true)
        expect(ct.border).toEqual({ color: '#000000', width: 1 })
    })

    // Verify a converted crosstab renders end-to-end with row/column values in the output
    it('renders crosstab through core engine (values appear in output)', () => {
        const core = convertEditorTemplateToCore(createCrosstabTemplate())
        const report = createReport(core, {
            rows: [
                { region: 'East', quarter: 'Q1', sales: 100 },
                { region: 'East', quarter: 'Q2', sales: 200 },
                { region: 'West', quarter: 'Q1', sales: 300 },
            ],
        })
        expect(report.pages.length).toBeGreaterThan(0)
        const texts: string[] = []
        function collect(node: { children?: unknown[], type?: string, text?: string }) {
            if (node.type === 'text' && typeof node.text === 'string') texts.push(node.text)
            if (Array.isArray(node.children)) {
                for (const child of node.children) collect(child as { children?: unknown[] })
            }
        }
        collect(report.pages[0] as unknown as { children?: unknown[] })
        const joined = texts.join('|')
        expect(joined).toContain('East')
        expect(joined).toContain('West')
        expect(joined).toContain('Q1')
        expect(joined).toContain('Q2')
    })
})
