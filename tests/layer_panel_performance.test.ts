import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LayerPanel from '../src/app/[lang]/editor/layer_panel'
import { createDefaultElement, defaultState } from '../src/app/[lang]/editor/reducer'
import { getClientCatalog } from '../src/lib/server/i18n/dictionaries/client/catalog'

const TEST_UI = getClientCatalog('en').ui

describe('layer panel rendering', function () {
    it('renders only collapsed roots for a large imported element tree', function () {
        const state = defaultState()
        const roots = []
        for (let rootIndex = 0; rootIndex < 5; rootIndex++) {
            const root = createDefaultElement('root_' + rootIndex, 'frame', 0, rootIndex * 100, 100, 100)
            for (let childIndex = 0; childIndex < 1500; childIndex++) {
                root.children.push(createDefaultElement(
                    'child_' + rootIndex + '_' + childIndex,
                    'path',
                    0,
                    childIndex,
                    10,
                    10,
                ))
            }
            roots.push(root)
        }
        state.template.bands[0]!.elements = roots

        const markup = renderToStaticMarkup(createElement(LayerPanel, {
            state,
            dispatch: function () {},
            messages: TEST_UI,
        }))
        const renderedElementRows = markup.match(/data-element-id=/g) ?? []

        expect(renderedElementRows).toHaveLength(5)
        expect(markup).toContain('data-element-id="root_0"')
        expect(markup).not.toContain('data-element-id="child_0_0"')
    })
})
