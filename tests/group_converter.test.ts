import { describe, expect, it } from 'vitest'
import { createReport } from 'tsreport-core'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'
import {
    createDefaultElement,
    createDefaultTemplate,
    normalizeTemplate,
    reducer,
    defaultState,
    type Band,
    type ReportGroup,
    type ReportTemplate,
    type State,
} from '../src/app/[lang]/editor/reducer'

function createGroup(name: string, expression: string, overrides?: Partial<ReportGroup>): ReportGroup {
    return {
        name,
        expression,
        startNewPage: false,
        startNewColumn: false,
        reprintHeaderOnEachPage: false,
        resetPageNumber: false,
        keepTogether: false,
        minHeightToStartNewPage: 0,
        footerPosition: 'normal',
        ...overrides,
    }
}

function createTextField(id: string, expression: string): ReturnType<typeof createDefaultElement> {
    const el = createDefaultElement(id, 'textField', 0, 0, 200, 14)
    el.expression = expression
    return el
}

describe('editor group model → core groups conversion', () => {
    it('converts frame hyperlinks into core FrameDef', () => {
        const template = createDefaultTemplate()
        const detail = template.bands.find(function (band) { return band.type === 'detail' })!
        const frame = createDefaultElement('link_frame', 'frame', 10, 20, 80, 30)
        frame.hyperlinkType = 'reference'
        frame.hyperlinkTarget = 'https://example.test/form'
        detail.elements.push(frame)

        const core = convertEditorTemplateToCore(template)
        expect(core.bands.details![0]!.elements![0]).toMatchObject({
            type: 'frame',
            x: 10,
            y: 20,
            width: 80,
            height: 30,
            hyperlink: { type: 'reference', target: '"https://example.test/form"' },
        })
    })

    it('converts text horizontalScale into core text properties', () => {
        const template = createDefaultTemplate()
        const detail = template.bands.find(function (band) { return band.type === 'detail' })!
        const text = createDefaultElement('scaled_text', 'staticText', 10, 20, 100, 20)
        text.text = 'scaled'
        text.horizontalScale = 0.75
        detail.elements.push(text)

        const core = convertEditorTemplateToCore(template)
        expect(core.bands.details![0]!.elements![0]).toMatchObject({
            type: 'staticText',
            text: 'scaled',
            horizontalScale: 0.75,
        })
    })

    // Verify group definitions and their header/footer bands map to core GroupDef with all options
    it('converts groups with header/footer bands into core GroupDef', () => {
        const template = createDefaultTemplate()
        template.groups = [createGroup('ByCategory', 'field.category', {
            startNewPage: true,
            reprintHeaderOnEachPage: true,
            footerPosition: 'forceAtBottom',
            minHeightToStartNewPage: 50,
        })]
        const headerBand: Band = {
            id: 'band_groupHeader_ByCategory',
            type: 'groupHeader',
            groupName: 'ByCategory',
            height: 20,
            startNewPage: false,
            splitType: 'Stretch',
            elements: [createTextField('gh1', 'field.category')],
            printWhenExpression: '',
            enabled: true,
        }
        const footerBand: Band = {
            id: 'band_groupFooter_ByCategory',
            type: 'groupFooter',
            groupName: 'ByCategory',
            height: 20,
            startNewPage: false,
            splitType: 'Stretch',
            elements: [createTextField('gf1', 'vars.categoryTotal')],
            printWhenExpression: '',
            enabled: true,
        }
        const detailIdx = template.bands.findIndex(function (b) { return b.type === 'detail' })
        template.bands.splice(detailIdx, 0, headerBand)
        template.bands.splice(detailIdx + 2, 0, footerBand)

        const core = convertEditorTemplateToCore(template)
        expect(core.groups).toBeDefined()
        expect(core.groups!.length).toBe(1)
        const g = core.groups![0]!
        expect(g.name).toBe('ByCategory')
        expect(g.expression).toBe('field.category')
        expect(g.startNewPage).toBe(true)
        expect(g.reprintHeaderOnEachPage).toBe(true)
        expect(g.footerPosition).toBe('forceAtBottom')
        expect(g.minHeightToStartNewPage).toBe(50)
        expect(g.header).toBeDefined()
        expect(g.header!.elements!.length).toBe(1)
        expect(g.footer).toBeDefined()
        expect(g.footer!.elements!.length).toBe(1)
        // Group bands must not leak into columnHeader/columnFooter
        expect(core.bands.columnHeader?.elements ?? []).not.toContain(g.header!.elements![0])
    })

    // Verify end-to-end rendering emits one group header/footer per distinct group value
    it('renders control break: group header appears per distinct group value', () => {
        const template = createDefaultTemplate()
        // Disable unneeded bands to keep the layout simple
        for (let i = 0; i < template.bands.length; i++) {
            const b = template.bands[i]
            if (b.type !== 'detail') template.bands[i] = { ...b, enabled: b.type === 'pageHeader' }
        }
        const detailIdx = template.bands.findIndex(function (b) { return b.type === 'detail' })
        template.bands[detailIdx] = {
            ...template.bands[detailIdx],
            height: 16,
            elements: [createTextField('d1', 'field.name')],
        }
        template.groups = [createGroup('ByCategory', 'field.category')]
        template.bands.splice(detailIdx, 0, {
            id: 'band_groupHeader_ByCategory',
            type: 'groupHeader',
            groupName: 'ByCategory',
            height: 18,
            startNewPage: false,
            splitType: 'Stretch',
            elements: [createTextField('gh1', 'field.category')],
            printWhenExpression: '',
            enabled: true,
        })
        template.bands.splice(detailIdx + 2, 0, {
            id: 'band_groupFooter_ByCategory',
            type: 'groupFooter',
            groupName: 'ByCategory',
            height: 18,
            startNewPage: false,
            splitType: 'Stretch',
            elements: [createTextField('gf1', '"小計"')],
            printWhenExpression: '',
            enabled: true,
        })

        const core = convertEditorTemplateToCore(template)
        const report = createReport(core, {
            rows: [
                { category: 'A', name: 'a1' },
                { category: 'A', name: 'a2' },
                { category: 'B', name: 'b1' },
            ],
        })

        expect(report.pages.length).toBe(1)
        // Collect all text content from the rendered page
        const texts: string[] = []
        function collect(node: { children?: unknown[], type?: string, text?: string }) {
            if (node.type === 'text' && typeof node.text === 'string') {
                texts.push(node.text)
            }
            if (Array.isArray(node.children)) {
                for (const child of node.children) collect(child as { children?: unknown[] })
            }
        }
        collect(report.pages[0] as unknown as { children?: unknown[] })
        const joined = texts.join('|')
        // Group header appears twice (A / B) and group footer twice
        expect(joined).toContain('A')
        expect(joined).toContain('B')
        expect(joined.split('小計').length - 1).toBe(2)
    })

    // Verify ADD_GROUP band placement: header before detail, footer after, nested groups innermost
    it('ADD_GROUP inserts header before detail and footer after detail (innermost)', () => {
        const state: State = { ...defaultState() }
        const next = reducer(state, {
            type: 'ADD_GROUP',
            payload: { group: createGroup('G1', 'field.a') },
        })
        const types = next.template.bands.filter(function (b) { return b.enabled }).map(function (b) { return b.type })
        const ghIdx = types.indexOf('groupHeader')
        const dIdx = types.indexOf('detail')
        const gfIdx = types.indexOf('groupFooter')
        expect(ghIdx).toBeGreaterThan(-1)
        expect(dIdx).toBe(ghIdx + 1)
        expect(gfIdx).toBe(dIdx + 1)

        // The second group is innermost (inside the G1 header)
        const next2 = reducer(next, {
            type: 'ADD_GROUP',
            payload: { group: createGroup('G2', 'field.b') },
        })
        const bands2 = next2.template.bands
        const gh1 = bands2.findIndex(function (b) { return b.type === 'groupHeader' && b.groupName === 'G1' })
        const gh2 = bands2.findIndex(function (b) { return b.type === 'groupHeader' && b.groupName === 'G2' })
        const d2 = bands2.findIndex(function (b) { return b.type === 'detail' })
        const gf2 = bands2.findIndex(function (b) { return b.type === 'groupFooter' && b.groupName === 'G2' })
        const gf1 = bands2.findIndex(function (b) { return b.type === 'groupFooter' && b.groupName === 'G1' })
        expect(gh1).toBeLessThan(gh2)
        expect(gh2).toBeLessThan(d2)
        expect(d2).toBeLessThan(gf2)
        expect(gf2).toBeLessThan(gf1)
    })

    // Verify renaming a group relinks its bands and removing a group deletes its bands
    it('UPDATE_GROUP rename keeps band linkage / REMOVE_GROUP removes bands', () => {
        const state: State = { ...defaultState() }
        const withGroup = reducer(state, {
            type: 'ADD_GROUP',
            payload: { group: createGroup('G1', 'field.a') },
        })
        const renamed = reducer(withGroup, {
            type: 'UPDATE_GROUP',
            payload: { name: 'G1', props: { name: 'Region' } },
        })
        expect(renamed.template.groups[0]!.name).toBe('Region')
        const linkedBands = renamed.template.bands.filter(function (b) { return b.groupName === 'Region' })
        expect(linkedBands.length).toBe(2)

        const removed = reducer(renamed, {
            type: 'REMOVE_GROUP',
            payload: { name: 'Region' },
        })
        expect(removed.template.groups.length).toBe(0)
        expect(removed.template.bands.some(function (b) { return b.type === 'groupHeader' || b.type === 'groupFooter' })).toBe(false)
    })

    // Verify legacy templates lacking a groups property get a synthesized group and unique band ids
    it('normalizeTemplate synthesizes group for legacy groupHeader band without groups', () => {
        const raw = {
            ...createDefaultTemplate(),
            bands: [
                ...createDefaultTemplate().bands,
                {
                    type: 'groupHeader',
                    height: 20,
                    startNewPage: false,
                    splitType: 'Stretch',
                    elements: [],
                    printWhenExpression: '',
                    enabled: true,
                },
            ],
        } as unknown as ReportTemplate
        // No groups property (legacy format)
        delete (raw as unknown as Record<string, unknown>).groups
        const normalized = normalizeTemplate(raw)
        expect(normalized.groups.length).toBe(1)
        const gh = normalized.bands.find(function (b) { return b.type === 'groupHeader' })
        expect(gh!.groupName).toBe(normalized.groups[0]!.name)
        // Every band receives a unique id
        const ids = new Set(normalized.bands.map(function (b) { return b.id }))
        expect(ids.size).toBe(normalized.bands.length)
    })
})
