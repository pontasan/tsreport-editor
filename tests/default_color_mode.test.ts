// Account-level default color mode: newly created elements get their colors
// in the account's mode (cmyk() strings when CMYK), while paste/duplicate and
// existing artwork keep their original color forms.

import { describe, expect, it } from 'vitest'
import {
    applyDefaultColorMode,
    createDefaultElement,
    defaultState,
    reducer,
    type State,
    type TemplateElement,
} from '../src/app/[lang]/editor/reducer'

function getBandElements(state: State, bandId: string): TemplateElement[] {
    return state.template.bands.find(b => b.id === bandId)!.elements
}

describe('applyDefaultColorMode', () => {
    it('rgb mode keeps the element untouched', () => {
        const element = createDefaultElement('el1', 'staticText', 0, 0, 100, 20)
        expect(applyDefaultColorMode(element, 'rgb')).toBe(element)
    })

    it('cmyk mode converts the default hex colors', () => {
        const element = createDefaultElement('el1', 'staticText', 0, 0, 100, 20)
        const converted = applyDefaultColorMode(element, 'cmyk')
        expect(converted.style.forecolor).toBe('cmyk(0,0,0,100)')
        expect(converted.style.backcolor).toBe('cmyk(0,0,0,0)')
    })

    it('cmyk mode leaves empty and non-hex values untouched', () => {
        const element = createDefaultElement('el1', 'path', 0, 0, 100, 20)
        element.stroke = ''
        element.pathFillColor = 'cmyk(10,20,30,40)'
        const converted = applyDefaultColorMode(element, 'cmyk')
        expect(converted.stroke).toBe('')
        expect(converted.pathFillColor).toBe('cmyk(10,20,30,40)')
    })

    it('converts children recursively', () => {
        const frame = createDefaultElement('frame1', 'frame', 0, 0, 200, 100)
        const child = createDefaultElement('child1', 'staticText', 0, 0, 50, 20)
        frame.children = [child]
        const converted = applyDefaultColorMode(frame, 'cmyk')
        expect(converted.children[0]!.style.forecolor).toBe('cmyk(0,0,0,100)')
    })
})

describe('ADD_ELEMENT with the account default color mode', () => {
    it('converts new element colors when the mode is cmyk', () => {
        const state = reducer(defaultState(), { type: 'SET_DEFAULT_COLOR_MODE', payload: { mode: 'cmyk' } })
        const element = createDefaultElement('el1', 'rectangle', 0, 0, 100, 50)
        const next = reducer(state, { type: 'ADD_ELEMENT', payload: { bandId: 'band_detail', element } })
        const added = getBandElements(next, 'band_detail').find(e => e.id === 'el1')!
        expect(added.shapeFillColor).toBe('cmyk(0,0,0,0)')
        expect(added.stroke).toBe('cmyk(0,0,0,100)')
    })

    it('keeps hex colors when the mode is rgb (default)', () => {
        const element = createDefaultElement('el1', 'rectangle', 0, 0, 100, 50)
        const next = reducer(defaultState(), { type: 'ADD_ELEMENT', payload: { bandId: 'band_detail', element } })
        const added = getBandElements(next, 'band_detail').find(e => e.id === 'el1')!
        expect(added.shapeFillColor.startsWith('#')).toBe(true)
    })
})
