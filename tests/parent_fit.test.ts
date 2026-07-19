import { describe, expect, it } from 'vitest'
import {
    createDefaultElement,
    defaultState,
    findElementInTree,
    reducer,
    type State,
    type TemplateElement,
} from '../src/app/[lang]/editor/reducer'
import { getTableColumns, setTableColumns } from '../src/app/[lang]/editor/table_editor_model'

function stateWithFrameChild(fitH: boolean, fitV: boolean): { state: State, frame: TemplateElement, child: TemplateElement } {
    const state = defaultState()
    const frame = createDefaultElement('frame1', 'frame', 10, 10, 200, 100)
    frame.style.padding = { top: 5, bottom: 5, left: 10, right: 10 }
    const child = createDefaultElement('child1', 'staticText', 20, 20, 50, 30)
    child.fitParentHorizontal = fitH
    child.fitParentVertical = fitV
    frame.children = [child]
    const withFrame = reducer(state, {
        type: 'ADD_ELEMENT',
        payload: { bandId: 'band_detail', element: frame },
    })
    return { state: withFrame, frame, child }
}

function getBandElements(state: State, bandId: string): TemplateElement[] {
    return state.template.bands.find(b => b.id === bandId)!.elements
}

// Parent-fit constraints (fitParentHorizontal / fitParentVertical) on frame and table cell children
describe('親フィット設定（fitParentHorizontal / fitParentVertical）', () => {
    // Verify a horizontally fitted child snaps to x=0 and the frame content width on ADD_ELEMENT
    it('水平フィット: 追加時に x=0, width=フレームのコンテンツ幅になる', () => {
        const { state } = stateWithFrameChild(true, false)
        const child = findElementInTree(getBandElements(state, 'band_detail'), 'child1')!
        expect(child.x).toBe(0)
        expect(child.width).toBe(200 - 10 - 10) // width minus left/right padding
        // Vertical axis is not fitted
        expect(child.y).toBe(20)
        expect(child.height).toBe(30)
    })

    // Verify a vertically fitted child snaps to y=0 and the frame content height
    it('垂直フィット: y=0, height=フレームのコンテンツ高さになる', () => {
        const { state } = stateWithFrameChild(false, true)
        const child = findElementInTree(getBandElements(state, 'band_detail'), 'child1')!
        expect(child.y).toBe(0)
        expect(child.height).toBe(100 - 5 - 5)
        expect(child.x).toBe(20)
        expect(child.width).toBe(50)
    })

    // Verify fitted children resize together with their parent frame on RESIZE_ELEMENT
    it('親フレームのリサイズに子要素が追従する', () => {
        const { state } = stateWithFrameChild(true, true)
        const resized = reducer(state, {
            type: 'RESIZE_ELEMENT',
            payload: { elementId: 'frame1', bandId: 'band_detail', x: 10, y: 10, width: 300, height: 150 },
        })
        const child = findElementInTree(getBandElements(resized, 'band_detail'), 'child1')!
        expect(child.width).toBe(300 - 20)
        expect(child.height).toBe(150 - 10)
    })

    // Verify manual moves on the fitted axis are cancelled while the free axis still moves
    it('フィットした子要素の手動移動は打ち消される（制約として機能）', () => {
        const { state } = stateWithFrameChild(true, false)
        const moved = reducer(state, {
            type: 'MOVE_ELEMENT',
            payload: { elementId: 'child1', bandId: 'band_detail', x: 30, y: 40 },
        })
        const child = findElementInTree(getBandElements(moved, 'band_detail'), 'child1')!
        expect(child.x).toBe(0) // horizontal axis is constrained back to 0
        expect(child.y).toBe(40) // vertical axis is free
    })

    // Verify children with fit disabled keep their original geometry
    it('フィット無効の子要素は影響を受けない', () => {
        const { state } = stateWithFrameChild(false, false)
        const child = findElementInTree(getBandElements(state, 'band_detail'), 'child1')!
        expect(child.x).toBe(20)
        expect(child.y).toBe(20)
        expect(child.width).toBe(50)
        expect(child.height).toBe(30)
    })

    // Verify a fitted child inside a table cell tracks the column width, including width updates
    it('テーブルセル内の子要素が列幅に追従する', () => {
        const state = defaultState()
        const table = createDefaultElement('t1', 'table', 0, 0, 160, 100)
        // Place a child element in the first detail cell
        const detailFrame = table.children.find(c => c.kind === 'tableRowFrame' && c.tableSection === 'detail')!
        const cell = detailFrame.children[0]!.children[0]!
        const cellChild = createDefaultElement('cellChild', 'staticText', 5, 5, 20, 10)
        cellChild.fitParentHorizontal = true
        cell.children = [cellChild]

        const withTable = reducer(state, {
            type: 'ADD_ELEMENT',
            payload: { bandId: 'band_detail', element: table },
        })
        const t = findElementInTree(getBandElements(withTable, 'band_detail'), 't1')!
        const columns = getTableColumns(t)
        const cellPadding = 2 // TableCellStyle default
        const fitted1 = findElementInTree(getBandElements(withTable, 'band_detail'), 'cellChild')!
        expect(fitted1.x).toBe(0)
        expect(fitted1.width).toBe(columns[0]!.width - cellPadding * 2)

        // Changing the column width propagates (widths scale relative to table width 160: 120/200*160=96)
        const newColumns = columns.map((c, i) => i === 0 ? { ...c, width: 120 } : c)
        const updated = reducer(withTable, {
            type: 'UPDATE_ELEMENT',
            payload: { elementId: 't1', bandId: 'band_detail', props: setTableColumns(t, newColumns) },
        })
        const fitted2 = findElementInTree(getBandElements(updated, 'band_detail'), 'cellChild')!
        expect(fitted2.width).toBe(96 - cellPadding * 2)
    })
})
