import { describe, expect, it } from 'vitest'
import {
    computeElementIdCounter,
    createDefaultElement,
    createDefaultTemplate,
    normalizeTemplate,
    type TemplateElement,
} from '../src/app/[lang]/editor/reducer'

function removeId(element: TemplateElement): TemplateElement {
    delete (element as { id?: string }).id
    return element
}

function collectIds(elements: TemplateElement[], ids: string[]): void {
    for (let i = 0; i < elements.length; i++) {
        ids.push(elements[i]!.id)
        collectIds(elements[i]!.children, ids)
    }
}

function allElementIds(template: ReturnType<typeof createDefaultTemplate>): string[] {
    const ids: string[] = []
    for (let i = 0; i < template.bands.length; i++) collectIds(template.bands[i]!.elements, ids)
    return ids
}

describe('element identity normalization', function () {
    it('deterministically fills missing, blank, nested, and duplicate ids without replacing unique ids', function () {
        const template = createDefaultTemplate()
        const detail = template.bands.find(function (band) { return band.type === 'detail' })!
        const summary = template.bands.find(function (band) { return band.type === 'summary' })!

        const frame = createDefaultElement('el_1', 'frame', 0, 0, 100, 100)
        frame.children = [
            removeId(createDefaultElement('unused', 'rectangle', 0, 0, 20, 20)),
            createDefaultElement('el_1', 'rectangle', 30, 0, 20, 20),
        ]
        detail.elements = [
            createDefaultElement('custom', 'rectangle', 0, 0, 10, 10),
            removeId(createDefaultElement('unused', 'rectangle', 10, 0, 10, 10)),
            createDefaultElement('   ', 'rectangle', 20, 0, 10, 10),
            frame,
            createDefaultElement('el_3', 'rectangle', 30, 0, 10, 10),
        ]
        summary.elements = [createDefaultElement('custom', 'rectangle', 0, 0, 10, 10)]

        const normalized = normalizeTemplate(template)
        const ids = allElementIds(normalized)

        expect(ids).toEqual(['custom', 'el_2', 'el_4', 'el_1', 'el_5', 'el_6', 'el_3', 'el_7'])
        expect(new Set(ids).size).toBe(ids.length)
        expect(computeElementIdCounter(normalized)).toBe(8)
        expect(allElementIds(normalizeTemplate(normalized))).toEqual(ids)
    })
})
