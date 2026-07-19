// Regression tests for reducer actions not covered elsewhere:
// TOGGLE_BAND_ENABLED and the UNDO/REDO history flow (reducerWithHistory).

import { describe, expect, it } from 'vitest'
import {
    createDefaultElement,
    defaultState,
    reducer,
    reducerWithHistory,
    type State,
} from '../src/app/[lang]/editor/reducer'
import { createCornerAnchor } from '../src/app/[lang]/editor/path_model'

describe('reducer band toggling and undo/redo history', () => {
    it('blocks every vector mutation until an explicit source unlock materializes the path', () => {
        const state = defaultState()
        const path = createDefaultElement('locked', 'path', 10, 20, 30, 10)
        path.pdfSourceLocked = true
        path.pathSubpaths = []
        path.importedPdfRenderState = {
            common: {},
            path: {
                pdfSourceVector: {
                    definitions: [{ commands: [0, 1, 1, 3], coords: [0, 0, 10, 0, 10, 10] }],
                    instances: [
                        { definitionIndex: 0, matrix: [1, 0, 0, 1, 0, 0] },
                        { definitionIndex: 0, matrix: [1, 0, 0, 1, 20, 0] },
                    ],
                },
            },
        }
        const added = reducer(state, { type: 'ADD_ELEMENT', payload: { bandId: 'band_detail', element: path } })
        expect(reducer(added, {
            type: 'MOVE_ELEMENT', payload: { elementId: 'locked', bandId: 'band_detail', x: 40, y: 50 },
        })).toBe(added)
        expect(reducer(added, {
            type: 'UPDATE_ELEMENT_STYLE', payload: { elementId: 'locked', bandId: 'band_detail', style: { opacity: 0.5 } },
        })).toBe(added)
        expect(reducer(added, {
            type: 'DELETE_ELEMENT', payload: { elementId: 'locked', bandId: 'band_detail' },
        })).toBe(added)

        const unlocked = reducer(added, {
            type: 'UNLOCK_PDF_SOURCE_ELEMENTS', payload: { elementIds: ['locked'], bandId: 'band_detail' },
        })
        const unlockedPath = unlocked.template.bands.find(function (band) { return band.id === 'band_detail' })!.elements[0]!
        expect(unlockedPath.pdfSourceLocked).toBe(false)
        expect(unlockedPath.pathSubpaths).toHaveLength(2)
        expect(unlockedPath.importedPdfRenderState?.path?.pdfSourceVector).toBeUndefined()

        const moved = reducer(unlocked, {
            type: 'MOVE_ELEMENT', payload: { elementId: 'locked', bandId: 'band_detail', x: 40, y: 50 },
        })
        expect(moved.template.bands.find(function (band) { return band.id === 'band_detail' })!.elements[0]!.x).toBe(40)
    })

    // Verify TOGGLE_BAND_ENABLED flips the enabled flag of the target band only
    it('TOGGLE_BAND_ENABLED toggles only the target band', () => {
        const state: State = defaultState()
        const toggled = reducer(state, {
            type: 'TOGGLE_BAND_ENABLED',
            payload: { bandId: 'band_summary' },
        })
        expect(toggled.template.bands.find(b => b.id === 'band_summary')!.enabled).toBe(false)
        for (let i = 0; i < state.template.bands.length; i++) {
            const before = state.template.bands[i]!
            if (before.id === 'band_summary') continue
            const after = toggled.template.bands.find(function (band) { return band.id === before.id })!
            expect(after.enabled).toBe(before.enabled)
        }

        const toggledBack = reducer(toggled, {
            type: 'TOGGLE_BAND_ENABLED',
            payload: { bandId: 'band_summary' },
        })
        expect(toggledBack.template.bands.find(b => b.id === 'band_summary')!.enabled).toBe(true)
    })

    // Verify an auto-commit action pushes history and UNDO/REDO walk the template snapshots
    it('UNDO reverts an auto-committed action and REDO reapplies it', () => {
        const state: State = defaultState()
        const element = createDefaultElement('el1', 'staticText', 0, 0, 100, 20)
        const added = reducerWithHistory(state, {
            type: 'ADD_ELEMENT',
            payload: { bandId: 'band_detail', element },
        })
        expect(added.history.past.length).toBe(1)
        expect(added.template.bands.find(b => b.id === 'band_detail')!.elements.length).toBe(1)

        const undone = reducerWithHistory(added, { type: 'UNDO' })
        expect(undone.template.bands.find(b => b.id === 'band_detail')!.elements.length).toBe(0)
        expect(undone.history.past.length).toBe(0)
        expect(undone.history.future.length).toBe(1)

        const redone = reducerWithHistory(undone, { type: 'REDO' })
        expect(redone.template.bands.find(b => b.id === 'band_detail')!.elements.length).toBe(1)
        expect(redone.history.past.length).toBe(1)
        expect(redone.history.future.length).toBe(0)
    })

    // Verify UNDO/REDO with empty stacks are no-ops returning the same state
    it('UNDO with empty past and REDO with empty future do nothing', () => {
        const state: State = defaultState()
        expect(reducerWithHistory(state, { type: 'UNDO' })).toBe(state)
        expect(reducerWithHistory(state, { type: 'REDO' })).toBe(state)
    })

    // Verify a new committed action after UNDO clears the redo (future) stack
    it('a new auto-committed action after UNDO clears the future stack', () => {
        const state: State = defaultState()
        const added = reducerWithHistory(state, {
            type: 'ADD_ELEMENT',
            payload: { bandId: 'band_detail', element: createDefaultElement('el1', 'staticText', 0, 0, 100, 20) },
        })
        const undone = reducerWithHistory(added, { type: 'UNDO' })
        expect(undone.history.future.length).toBe(1)

        const toggled = reducerWithHistory(undone, {
            type: 'TOGGLE_BAND_ENABLED',
            payload: { bandId: 'band_summary' },
        })
        expect(toggled.history.past.length).toBe(1)
        expect(toggled.history.future.length).toBe(0)
    })

    it('path geometry updates stay in one transaction until committed', () => {
        const state: State = defaultState()
        const path = createDefaultElement('path1', 'path', 0, 0, 100, 100)
        const added = reducerWithHistory(state, {
            type: 'ADD_ELEMENT',
            payload: { bandId: 'band_detail', element: path },
        })

        const firstPath = [{
            closed: false,
            anchors: [createCornerAnchor(0, 0), createCornerAnchor(50, 0)],
        }]
        const first = reducerWithHistory(added, {
            type: 'UPDATE_PATH_GEOMETRY',
            payload: { elementId: 'path1', bandId: 'band_detail', pathSubpaths: firstPath, x: 10, y: 20, width: 50, height: 1 },
        })

        const secondPath = [{
            closed: false,
            anchors: [createCornerAnchor(0, 0), createCornerAnchor(80, 0)],
        }]
        const second = reducerWithHistory(first, {
            type: 'UPDATE_PATH_GEOMETRY',
            payload: { elementId: 'path1', bandId: 'band_detail', pathSubpaths: secondPath, x: 10, y: 20, width: 80, height: 1 },
        })

        expect(first.history.past.length).toBe(1)
        expect(first.history.baseSnapshot).toBe(added.template)
        expect(second.history.past.length).toBe(1)
        expect(second.history.baseSnapshot).toBe(added.template)

        const committed = reducerWithHistory(second, { type: 'COMMIT_HISTORY' })
        expect(committed.history.past.length).toBe(2)
        expect(committed.history.baseSnapshot).toBeNull()
        expect(getPathWidth(committed)).toBe(80)

        const undone = reducerWithHistory(committed, { type: 'UNDO' })
        expect(getPathWidth(undone)).toBe(100)
        expect(undone.pathEditing).toBeNull()
    })

    it('path editing selection is cleared by editor-level selection changes', () => {
        const state: State = {
            ...defaultState(),
            pathEditing: {
                elementId: 'path1',
                bandId: 'band_detail',
                anchor: { subpathIndex: 0, anchorIndex: 0, handle: 'point' },
            },
        }

        const selected = reducer(state, {
            type: 'SELECT_ELEMENT',
            payload: { elementId: 'other', bandId: 'band_detail' },
        })
        const setAgain = reducer(selected, {
            type: 'SET_PATH_EDIT',
            payload: { editing: { elementId: 'path1', bandId: 'band_detail', anchor: null } },
        })
        const deleted = reducer(setAgain, {
            type: 'DELETE_ELEMENT',
            payload: { elementId: 'path1', bandId: 'band_detail' },
        })

        expect(selected.pathEditing).toBeNull()
        expect(setAgain.pathEditing).toMatchObject({ elementId: 'path1', bandId: 'band_detail' })
        expect(deleted.pathEditing).toBeNull()
    })

    it('PDF import applies page settings and background elements as one undo unit', () => {
        const state: State = {
            ...defaultState(),
            selectedElementIds: ['previous_element'],
            selectedBandId: 'band_detail',
            editingElementId: 'previous_element',
        }
        const imported = createDefaultElement('el_5', 'path', 0, 0, 100, 100)
        const applied = reducerWithHistory(state, {
            type: 'APPLY_PDF_IMPORT',
            payload: {
                pageSettings: {
                    size: 'custom',
                    width: 300,
                    height: 200,
                    marginTop: 0,
                    marginBottom: 0,
                    marginLeft: 0,
                    marginRight: 0,
                    orientation: 'landscape',
                    columnCount: 1,
                    columnWidth: 300,
                    columnSpacing: 0,
                    columnPrintOrder: 'vertical',
                },
                bands: [{ type: 'background', height: 200, elements: [imported] }],
                disabledBandTypes: [],
                nextElementIdCounter: 6,
            },
        })

        const background = applied.template.bands.find(function (band) { return band.type === 'background' })!
        expect(applied.history.past.length).toBe(1)
        expect(applied.template.pageSettings.width).toBe(300)
        expect(background.enabled).toBe(true)
        expect(background.height).toBe(200)
        expect(background.elements[0]!.id).toBe('el_5')
        expect(applied.elementIdCounter).toBe(6)
        expect(applied.selectedElementIds).toEqual([])
        expect(applied.selectedBandId).toBeNull()
        expect(applied.editingElementId).toBeNull()

        const undone = reducerWithHistory(applied, { type: 'UNDO' })
        const restoredBackground = undone.template.bands.find(function (band) { return band.type === 'background' })!
        expect(restoredBackground.enabled).toBe(false)
        expect(restoredBackground.elements).toEqual([])
        expect(undone.template.pageSettings.width).toBe(595)
    })

    it('PDF import can target the draft band and multiple assigned bands as one undo unit', () => {
        const state = defaultState()
        const draftElement = createDefaultElement('el_5', 'path', 0, 0, 100, 100)
        const applied = reducerWithHistory(state, {
            type: 'APPLY_PDF_IMPORT',
            payload: {
                pageSettings: { ...state.template.pageSettings },
                bands: [{ type: 'draft', height: state.template.pageSettings.height, elements: [draftElement] }],
                disabledBandTypes: [],
                nextElementIdCounter: 6,
            },
        })
        const draft = applied.template.bands.find(function (band) { return band.type === 'draft' })!
        expect(draft.enabled).toBe(true)
        expect(draft.elements[0]!.id).toBe('el_5')
        // Draft precedes title in the canonical band order
        const draftIndex = applied.template.bands.findIndex(function (band) { return band.type === 'draft' })
        const titleIndex = applied.template.bands.findIndex(function (band) { return band.type === 'title' })
        if (titleIndex >= 0) expect(draftIndex).toBeLessThan(titleIndex)

        const multi = reducerWithHistory(state, {
            type: 'APPLY_PDF_IMPORT',
            payload: {
                pageSettings: { ...state.template.pageSettings },
                bands: [
                    { type: 'pageHeader', height: 60, elements: [createDefaultElement('el_5', 'staticText', 0, 10, 50, 12)] },
                    { type: 'detail', height: 700, elements: [createDefaultElement('el_6', 'staticText', 0, 20, 50, 12)] },
                ],
                disabledBandTypes: ['title', 'columnHeader', 'columnFooter', 'pageFooter', 'summary'],
                nextElementIdCounter: 7,
            },
        })
        const header = multi.template.bands.find(function (band) { return band.type === 'pageHeader' })!
        const detail = multi.template.bands.find(function (band) { return band.type === 'detail' })!
        expect(header.height).toBe(60)
        expect(header.elements.some(function (el) { return el.id === 'el_5' })).toBe(true)
        expect(detail.elements.some(function (el) { return el.id === 'el_6' })).toBe(true)
        expect(multi.history.past.length).toBe(1)
        // Bands left out of the assignment are disabled by the import
        for (const type of ['title', 'columnHeader', 'columnFooter', 'pageFooter', 'summary']) {
            const band = multi.template.bands.find(function (b) { return b.type === type })!
            expect(band.enabled).toBe(false)
        }
        expect(header.enabled).toBe(true)
        expect(detail.enabled).toBe(true)

        const undone = reducerWithHistory(multi, { type: 'UNDO' })
        expect(undone.template.bands.every(function (band) { return band.elements.length === 0 })).toBe(true)
        for (let i = 0; i < state.template.bands.length; i++) {
            const before = state.template.bands[i]!
            const restored = undone.template.bands.find(function (band) { return band.id === before.id })!
            expect(restored.enabled).toBe(before.enabled)
        }
    })

    it('image slice replaces the element in place and one undo restores it', () => {
        const state = defaultState()
        const frame = createDefaultElement('el_1', 'frame', 10, 10, 200, 100)
        const image = createDefaultElement('el_2', 'image', 5, 5, 100, 50)
        image.source = 'photo.png'
        frame.children = [image]
        const withImage: State = {
            ...state,
            template: {
                ...state.template,
                bands: state.template.bands.map(function (band) {
                    return band.id === 'band_detail' ? { ...band, elements: [frame] } : band
                }),
            },
        }
        const pieceA = createDefaultElement('el_5', 'image', 5, 5, 50, 50)
        const pieceB = createDefaultElement('el_6', 'image', 55, 5, 50, 50)
        const sliced = reducerWithHistory(withImage, {
            type: 'APPLY_IMAGE_SLICE',
            payload: { bandId: 'band_detail', elementId: 'el_2', pieces: [pieceA, pieceB], nextElementIdCounter: 7 },
        })
        const band = sliced.template.bands.find(function (b) { return b.id === 'band_detail' })!
        const slicedFrame = band.elements.find(function (el) { return el.id === 'el_1' })!
        // The nested image is replaced in place by the two pieces
        expect(slicedFrame.children.map(function (el) { return el.id })).toEqual(['el_5', 'el_6'])
        expect(sliced.selectedElementIds).toEqual(['el_5', 'el_6'])
        expect(sliced.elementIdCounter).toBe(7)

        const undone = reducerWithHistory(sliced, { type: 'UNDO' })
        const undoneBand = undone.template.bands.find(function (b) { return b.id === 'band_detail' })!
        const undoneFrame = undoneBand.elements.find(function (el) { return el.id === 'el_1' })!
        expect(undoneFrame.children.map(function (el) { return el.id })).toEqual(['el_2'])
        expect(undoneFrame.children[0]!.source).toBe('photo.png')
    })
})

function getPathWidth(state: State): number {
    const band = state.template.bands.find(function (b) { return b.id === 'band_detail' })!
    const element = band.elements.find(function (el) { return el.id === 'path1' })!
    return element.width
}
