import { describe, expect, test } from 'vitest'
import { createReport } from 'tsreport-core'
import { createEditorSubreportResolver } from '../src/app/[lang]/editor/subreport_support'
import { convertEditorTemplateToCore } from '../src/app/[lang]/editor/template_converter'

function createBaseStyle() {
    return {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        forecolor: '#000000',
        backcolor: '#FFFFFF',
        mode: 'transparent' as const,
        hAlign: 'left' as const,
        vAlign: 'middle' as const,
        rotation: 0 as const,
        border: { top: null, bottom: null, left: null, right: null },
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        opacity: 1,
    }
}

function createRectangleElement() {
    return {
        id: 'rect_1',
        kind: 'rectangle' as const,
        x: 10,
        y: 12,
        width: 40,
        height: 18,
        text: '',
        expression: '',
        style: createBaseStyle(),
        styleName: '',
        positionType: 'float' as const,
        stretchType: 'noStretch' as const,
        printWhenExpression: '',
        isRemoveLineWhenBlank: false,
        isPrintRepeatedValues: true,
        markup: 'none' as const,
        direction: 'ltr' as const,
        writingMode: 'horizontal-tb' as const,
        lineSpacingType: 'single' as const,
        lineSpacingValue: 0,
        letterSpacing: 0,
        wordSpacing: 0,
        firstLineIndent: 0,
        leftIndent: 0,
        rightIndent: 0,
        tabStopWidth: 40,
        wrap: true,
        shrinkToFit: false,
        minFontSize: 4,
        fitWidth: false,
        anchorName: '',
        bookmarkLevel: 0,
        hyperlinkType: '' as const,
        hyperlinkTarget: '',
        hyperlinkRemoteDocument: '',
        pattern: '',
        blankWhenNull: false,
        stretchWithOverflow: false,
        evaluationTime: 'now' as const,
        evaluationGroup: '',
        textTruncate: 'none' as const,
        lineWidth: 1,
        lineStyle: 'solid' as const,
        lineColor: '#000000',
        radius: 0,
        topLeftRadius: 0,
        topRightRadius: 0,
        bottomRightRadius: 0,
        bottomLeftRadius: 0,
        fill: '#eeeeee',
        stroke: '#000000',
        strokeWidth: 1,
        source: '',
        sourceExpression: '',
        scaleMode: 'clip' as const,
        imageHAlign: 'left' as const,
        imageVAlign: 'top' as const,
        onError: 'error' as const,
        lazy: false,
        svgContent: '',
        barcodeType: 'code128',
        showText: true,
        errorCorrectionLevel: 'M' as const,
        formula: '',
        mathFontFamily: 'STIXTwoMath',
        mathFontSize: 12,
        mathColor: '#000000',
        breakType: 'page' as const,
        templateExpression: '',
        dataSourceExpression: '',
        tableBorderColor: '#000000',
        tableBorderWidth: 1,
        tableInnerColor: '#000000',
        tableInnerWidth: 1,
        rowHeaderWidth: 60,
        columnHeaderHeight: 24,
        cellWidth: 60,
        cellHeight: 20,
        crosstabBorderColor: '#000000',
        crosstabBorderWidth: 1,
        showSubtotals: true,
        showGrandTotal: true,
        crosstabDataSourceExpression: '',
        children: [],
    }
}

function createTemplate(name: string, elements: unknown[], bandType: 'detail' | 'title' = 'detail') {
    return {
        name,
        pageSettings: {
            size: 'custom',
            width: 160,
            height: 100,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            orientation: 'portrait' as const,
            columnCount: 1,
            columnWidth: 160,
            columnSpacing: 0,
            columnPrintOrder: 'vertical' as const,
        },
        bands: [{
            id: 'band_' + bandType,
            type: bandType,
            height: 80,
            startNewPage: false,
            splitType: 'Stretch' as const,
            printWhenExpression: '',
            enabled: true,
            elements,
        }],
        groups: [],
        titleNewPage: false,
        summaryNewPage: false,
        summaryWithPageHeaderAndFooter: false,
        testDataPath: '',
    }
}

// Editor-side subreport resolver: supplies child templates to core report creation
describe('createEditorSubreportResolver', function () {
    // Verify the resolver serves a preloaded child template so the host report renders it
    test('resolves a child template and allows host report creation', function () {
        const child = createTemplate('child', [createRectangleElement()])
        const subreport = {
            ...createRectangleElement(),
            id: 'sub_1',
            kind: 'subreport' as const,
            fill: '',
            templateExpression: "'child.report'",
        }
        const root = createTemplate('root', [subreport], 'title')
        const resolver = createEditorSubreportResolver(
            { workspace: 'demo', path: 'reports/root.report' },
            root,
            [{ path: 'reports/child.report', template: child }],
        )

        expect(resolver).not.toBeUndefined()

        const report = createReport(convertEditorTemplateToCore(root), { rows: [{}] }, {
            resolveSubreportTemplate: resolver,
        })

        expect(report.pages.length).toBe(1)
        expect(report.pages[0].children.length).toBeGreaterThan(0)
    })
})
