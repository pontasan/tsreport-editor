import { describe, expect, it } from 'vitest'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'
import { createDefaultElement, createDefaultTemplate } from '../src/app/[lang]/editor/reducer'

describe('path converter', () => {
    it('converts editor path elements into core PathDef', () => {
        const template = createDefaultTemplate()
        const detailBand = template.bands.find(function (band) { return band.type === 'detail' })!
        const path = createDefaultElement('path_1', 'path', 10, 20, 100, 80)
        path.pathSubpaths = [{
            closed: true,
            anchors: [
                { x: 0, y: 70, inX: 0, inY: 70, outX: 25, outY: 0, handleMode: 'independent' },
                { x: 100, y: 10, inX: 60, inY: 0, outX: 100, outY: 10, handleMode: 'independent' },
                { x: 80, y: 80, inX: 80, inY: 80, outX: 80, outY: 80, handleMode: 'independent' },
            ],
        }]
        path.pathFillType = 'linear'
        path.pathGradient = {
            ...path.pathGradient,
            stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
            ],
        }
        path.stroke = '#003366'
        path.strokeWidth = 2
        path.pathStrokeDash = [4, 2]
        path.pathStrokeCap = 'round'
        path.pathStrokeJoin = 'bevel'
        detailBand.elements.push(path)

        const core = convertEditorTemplateToCore(template)
        const converted = core.bands.details![0]!.elements![0]!
        expect(converted).toMatchObject({
            type: 'path',
            x: 10,
            y: 20,
            width: 100,
            height: 80,
            fill: { type: 'linearGradient', stops: [{ color: '#ff0000' }, { color: '#0000ff' }] },
            stroke: '#003366',
            strokeWidth: 2,
            strokeDasharray: [4, 2],
            strokeLinecap: 'round',
            strokeLinejoin: 'bevel',
        })
        expect(converted.type === 'path' ? converted.d : '').toContain('C')
    })

    it('converts rectangle and ellipse gradient fills', () => {
        const template = createDefaultTemplate()
        const detailBand = template.bands.find(function (band) { return band.type === 'detail' })!
        const rect = createDefaultElement('rect_1', 'rectangle', 0, 0, 100, 40)
        rect.shapeFillType = 'linear'
        rect.shapeGradient = {
            ...rect.shapeGradient,
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
            stops: [
                { offset: 0, color: '#ffffff' },
                { offset: 1, color: '#111111' },
            ],
        }
        const ellipse = createDefaultElement('ellipse_1', 'ellipse', 0, 50, 80, 40)
        ellipse.shapeFillType = 'radial'
        ellipse.shapeGradient = {
            ...ellipse.shapeGradient,
            cx: 0.4,
            cy: 0.5,
            r: 0.7,
            stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff', opacity: 0.5 },
            ],
        }
        detailBand.elements.push(rect, ellipse)

        const core = convertEditorTemplateToCore(template)
        const convertedRect = core.bands.details![0]!.elements![0]!
        const convertedEllipse = core.bands.details![0]!.elements![1]!

        expect(convertedRect).toMatchObject({
            type: 'rectangle',
            fill: { type: 'linearGradient', x1: 0, y1: 0, x2: 1, y2: 1 },
        })
        expect(convertedEllipse).toMatchObject({
            type: 'ellipse',
            fill: { type: 'radialGradient', cx: 0.4, cy: 0.5, r: 0.7 },
        })
    })
})
