import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Canvas, { isPointInsideCanvasBand, partitionEnabledCanvasBands } from '../src/app/[lang]/editor/canvas'
import LayerPanel, { orderBandsForLayerPanel } from '../src/app/[lang]/editor/layer_panel'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'
import {
    createDefaultElement,
    createDefaultTemplate,
    defaultState,
    normalizeTemplate,
    reducer,
    type BandType,
} from '../src/app/[lang]/editor/reducer'
import { getClientCatalog } from '../src/lib/server/i18n/dictionaries/client/catalog'

const OPTIONAL_BAND_TYPES: BandType[] = ['background', 'lastPageFooter', 'noData']
const TEST_UI = getClientCatalog('en').ui

describe('initially disabled report bands', function () {
    it('lists background, lastPageFooter, and noData from the initial template', function () {
        const state = defaultState()
        const markup = renderToStaticMarkup(createElement(LayerPanel, {
            state,
            dispatch: function () {},
            messages: TEST_UI,
        }))

        expect(markup).toContain('Background')
        expect(markup).toContain('Last Page Footer')
        expect(markup).toContain('No Data')
        expect(markup.indexOf('Background')).toBeGreaterThan(markup.indexOf('No Data'))
        for (let i = 0; i < OPTIONAL_BAND_TYPES.length; i++) {
            const band = state.template.bands.find(function (candidate) {
                return candidate.type === OPTIONAL_BAND_TYPES[i]
            })
            expect(band?.enabled).toBe(false)
        }
        expect(state.template.bands.map(function (band) { return band.type })).toEqual([
            'background',
            'title',
            'pageHeader',
            'columnHeader',
            'detail',
            'columnFooter',
            'pageFooter',
            'lastPageFooter',
            'summary',
            'noData',
        ])
        expect(orderBandsForLayerPanel(state.template.bands).map(function (band) { return band.type }).at(-1)).toBe('background')
    })

    it('adds missing bands when loading an existing report and keeps existing bands unchanged', function () {
        const report = createDefaultTemplate()
        report.pageSettings.height = 500
        report.pageSettings.marginTop = 10
        report.pageSettings.marginBottom = 20
        report.bands = report.bands.filter(function (band) {
            return band.type !== 'background' && band.type !== 'noData'
        })
        const lastPageFooter = report.bands.find(function (band) { return band.type === 'lastPageFooter' })!
        lastPageFooter.enabled = true
        lastPageFooter.height = 73
        lastPageFooter.elements.push(createDefaultElement('existing_footer_text', 'staticText', 0, 0, 100, 20))

        const normalized = normalizeTemplate(report)
        const background = normalized.bands.find(function (band) { return band.type === 'background' })!
        const preservedFooter = normalized.bands.find(function (band) { return band.type === 'lastPageFooter' })!
        const noData = normalized.bands.find(function (band) { return band.type === 'noData' })!

        expect(background.enabled).toBe(false)
        expect(background.height).toBe(470)
        expect(noData.enabled).toBe(false)
        expect(preservedFooter.id).toBe(lastPageFooter.id)
        expect(preservedFooter.enabled).toBe(true)
        expect(preservedFooter.height).toBe(73)
        expect(preservedFooter.elements[0]?.id).toBe('existing_footer_text')
    })

    it('selects and enables synthesized bands while omitting disabled bands from print conversion', function () {
        const report = createDefaultTemplate()
        report.bands = report.bands.filter(function (band) {
            return band.type !== 'background' && band.type !== 'lastPageFooter' && band.type !== 'noData'
        })
        let state = reducer(defaultState(), { type: 'LOAD_TEMPLATE', payload: { template: report } })
        const disabledCore = convertEditorTemplateToCore(state.template)
        expect(disabledCore.bands.background).toBeUndefined()
        expect(disabledCore.bands.lastPageFooter).toBeUndefined()
        expect(disabledCore.bands.noData).toBeUndefined()

        for (let i = 0; i < OPTIONAL_BAND_TYPES.length; i++) {
            const band = state.template.bands.find(function (candidate) {
                return candidate.type === OPTIONAL_BAND_TYPES[i]
            })!
            state = reducer(state, { type: 'SELECT_BAND', payload: { bandId: band.id } })
            expect(state.selectedBandId).toBe(band.id)
            state = reducer(state, { type: 'TOGGLE_BAND_ENABLED', payload: { bandId: band.id } })
            expect(state.template.bands.find(function (candidate) { return candidate.id === band.id })?.enabled).toBe(true)
        }

        const enabledCore = convertEditorTemplateToCore(state.template)
        expect(enabledCore.bands.background).toBeDefined()
        expect(enabledCore.bands.lastPageFooter).toBeDefined()
        expect(enabledCore.bands.noData).toBeDefined()

        const canvasBands = partitionEnabledCanvasBands(state.template.bands)
        expect(canvasBands.background?.type).toBe('background')
        expect(canvasBands.flow.some(function (band) { return band.type === 'background' })).toBe(false)
    })

    it('keeps background and flow bands as siblings so resizing a flow band repositions following bands', function () {
        const state = defaultState()
        for (let i = 0; i < state.template.bands.length; i++) {
            state.template.bands[i]!.elements = []
            if (state.template.bands[i]!.type === 'background') state.template.bands[i]!.enabled = true
        }
        const markup = renderToStaticMarkup(createElement(Canvas, {
            messages: TEST_UI,
            state,
            dispatch: function () {},
            fontRegistry: new Map(),
            defaultFontId: '',
            mathFonts: {},
            mathFontResource: null,
            currentFile: null,
            openReportTemplates: [],
            suspended: false,
            onPlaceSubreport: function () {},
            onOpenImageSlice: function () {},
        }))

        const parentByBand = new Map<string, number>()
        const divStack: number[] = []
        let nextDivId = 0
        const tags = markup.match(/<\/?div\b[^>]*>/g) ?? []
        for (let i = 0; i < tags.length; i++) {
            const tag = tags[i]!
            if (tag.startsWith('</')) {
                divStack.pop()
                continue
            }
            const divId = nextDivId++
            const bandType = tag.match(/data-canvas-band="([^"]+)"/)
            if (bandType !== null) parentByBand.set(bandType[1]!, divStack[divStack.length - 1]!)
            divStack.push(divId)
        }

        expect(parentByBand.get('background')).toBe(parentByBand.get('detail'))
        expect(parentByBand.get('detail')).toBe(parentByBand.get('summary'))
    })

    it('does not consume or collapse flow band height when background is enabled', function () {
        let state = defaultState()
        for (let i = 0; i < state.template.bands.length; i++) {
            const band = state.template.bands[i]!
            band.enabled = band.type === 'background'
                || band.type === 'title'
                || band.type === 'detail'
                || band.type === 'summary'
        }
        const background = state.template.bands.find(function (band) { return band.type === 'background' })!
        const detail = state.template.bands.find(function (band) { return band.type === 'detail' })!
        const summary = state.template.bands.find(function (band) { return band.type === 'summary' })!
        const summaryHeight = summary.height

        state = reducer(state, {
            type: 'UPDATE_BAND_HEIGHT',
            payload: { bandId: detail.id, height: detail.height + 50 },
        })

        expect(state.template.bands.find(function (band) { return band.id === detail.id })!.height).toBe(detail.height + 50)
        expect(state.template.bands.find(function (band) { return band.id === summary.id })!.height).toBe(summaryHeight)

        state = reducer(state, {
            type: 'UPDATE_BAND_HEIGHT',
            payload: { bandId: background.id, height: background.height - 25 },
        })

        expect(state.template.bands.find(function (band) { return band.id === summary.id })!.height).toBe(summaryHeight)
    })

    it('limits the lowest-priority background fallback selection to its page area', function () {
        expect(isPointInsideCanvasBand(150, 250, 100, 200, 500, 700)).toBe(true)
        expect(isPointInsideCanvasBand(99, 250, 100, 200, 500, 700)).toBe(false)
        expect(isPointInsideCanvasBand(150, 901, 100, 200, 500, 700)).toBe(false)
    })

    it('routes creation tools to the explicitly selected background across the page', function () {
        const state = defaultState()
        const background = state.template.bands.find(function (band) { return band.type === 'background' })!
        background.enabled = true
        state.selectedBandId = background.id
        state.activeTool = 'rectangle'

        const markup = renderToStaticMarkup(createElement(Canvas, {
            messages: TEST_UI,
            state,
            dispatch: function () {},
            fontRegistry: new Map(),
            defaultFontId: '',
            mathFonts: {},
            mathFontResource: null,
            currentFile: null,
            openReportTemplates: [],
            suspended: false,
            onPlaceSubreport: function () {},
            onOpenImageSlice: function () {},
        }))

        expect(markup).toContain('data-background-tool-input="true"')
    })

    it('keeps the enabled background available behind foreground bands during creation', function () {
        const state = defaultState()
        const background = state.template.bands.find(function (band) { return band.type === 'background' })!
        const detail = state.template.bands.find(function (band) { return band.type === 'detail' })!
        background.enabled = true
        state.selectedBandId = detail.id
        state.activeTool = 'rectangle'

        const markup = renderToStaticMarkup(createElement(Canvas, {
            messages: TEST_UI,
            state,
            dispatch: function () {},
            fontRegistry: new Map(),
            defaultFontId: '',
            mathFonts: {},
            mathFontResource: null,
            currentFile: null,
            openReportTemplates: [],
            suspended: false,
            onPlaceSubreport: function () {},
            onOpenImageSlice: function () {},
        }))

        const backgroundStart = markup.indexOf('data-canvas-band="background"')
        const backgroundTag = markup.slice(backgroundStart, markup.indexOf('>', backgroundStart))
        expect(backgroundStart).toBeGreaterThan(-1)
        expect(backgroundTag).not.toContain('pointer-events:none')
        expect(markup).not.toContain('data-background-tool-input="true"')
    })

    it('keeps only the element interaction elevated after selecting a background element', function () {
        const state = defaultState()
        const background = state.template.bands.find(function (band) { return band.type === 'background' })!
        const rectangle = createDefaultElement('background_rectangle', 'rectangle', 40, 50, 100, 60)
        background.enabled = true
        background.elements.push(rectangle)
        state.selectedBandId = background.id
        state.selectedElementIds = [rectangle.id]

        const markup = renderToStaticMarkup(createElement(Canvas, {
            messages: TEST_UI,
            state,
            dispatch: function () {},
            fontRegistry: new Map(),
            defaultFontId: '',
            mathFonts: {},
            mathFontResource: null,
            currentFile: null,
            openReportTemplates: [],
            suspended: false,
            onPlaceSubreport: function () {},
            onOpenImageSlice: function () {},
        }))

        expect(markup).not.toContain('data-background-selection-input="true"')
        expect(markup).toContain('data-background-element-interaction="background_rectangle"')
    })
})
