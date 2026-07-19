// Converts an editor template to a core template
// Editor format: elements grouped by BandType in a flat bands[] array
// Core format: structured into a BandSet object with title/pageHeader/detail/etc.

import type {
    ReportTemplate as CoreTemplate,
    BandDef,
    BandSet,
    GroupDef,
    ElementDef,
    StaticTextDef,
    TextFieldDef,
    LineDef,
    RectangleDef,
    EllipseDef,
    PathDef,
    FillDef,
    ImageDef,
    FrameDef,
    BreakDef,
    BarcodeDef,
    MathDef, FormFieldDef,
    SvgElementDef,
    SubreportDef,
    CrosstabElementDef,
    HyperlinkDef,
    LineSpacingDef,
    BorderDef,
    Padding,
    StyleDef,
} from 'tsreport-core'
import type { Band, BandType, ReportTemplate, TableCell, TableCellStyle, TableColumn, TableRow, TemplateElement } from './reducer'
import { getTableColumns, getTableSectionRows } from './table_editor_model'
import { buildPathD } from './path_model'

// Context for generating a text element's font style info as a core style
type StyleContext = {
    styles: Map<string, StyleDef>
    counter: number
}

// Quote a raw string as an expression-language string literal.
// Backslashes and quotes must be escaped; otherwise sequences such as a
// LaTeX \frac would be decoded as escape characters by the expression lexer.
function quoteExpressionStringLiteral(value: string): string {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function getRectangleCornerRadii(el: TemplateElement): RectangleDef['cornerRadii'] | undefined {
    if (
        el.topLeftRadius === 0
        && el.topRightRadius === 0
        && el.bottomRightRadius === 0
        && el.bottomLeftRadius === 0
    ) {
        return undefined
    }
    return {
        topLeft: el.topLeftRadius !== 0 ? el.topLeftRadius : undefined,
        topRight: el.topRightRadius !== 0 ? el.topRightRadius : undefined,
        bottomRight: el.bottomRightRadius !== 0 ? el.bottomRightRadius : undefined,
        bottomLeft: el.bottomLeftRadius !== 0 ? el.bottomLeftRadius : undefined,
    }
}

function getOrCreateElementStyle(ctx: StyleContext, el: TemplateElement): string {
    const s = el.style
    const key = s.fontFamily
        + '|' + s.fontSize
        + '|' + (s.bold ? '1' : '0')
        + '|' + (s.italic ? '1' : '0')
        + '|' + (s.underline ? '1' : '0')
        + '|' + (s.strikethrough ? '1' : '0')
        + '|' + s.opacity
        + '|' + el.writingMode
    const existing = ctx.styles.get(key)
    if (existing !== undefined) return existing.name

    const name = '_s' + ctx.counter++
    ctx.styles.set(key, {
        name,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        bold: s.bold || undefined,
        italic: s.italic || undefined,
        underline: s.underline || undefined,
        strikethrough: s.strikethrough || undefined,
        opacity: s.opacity !== 1 ? s.opacity : undefined,
        writingMode: el.writingMode !== 'horizontal-tb' ? el.writingMode : undefined,
    })
    return name
}

function convertBorder(el: TemplateElement): BorderDef | undefined {
    const b = el.style.border
    if (b.top === null && b.bottom === null && b.left === null && b.right === null) return undefined
    return {
        top: b.top !== null ? { width: b.top.width, color: b.top.color, style: b.top.style } : null,
        bottom: b.bottom !== null ? { width: b.bottom.width, color: b.bottom.color, style: b.bottom.style } : null,
        left: b.left !== null ? { width: b.left.width, color: b.left.color, style: b.left.style } : null,
        right: b.right !== null ? { width: b.right.width, color: b.right.color, style: b.right.style } : null,
    }
}

function convertPadding(el: TemplateElement): Padding | undefined {
    const p = el.style.padding
    if (p.top === 0 && p.bottom === 0 && p.left === 0 && p.right === 0) return undefined
    return { top: p.top, bottom: p.bottom, left: p.left, right: p.right }
}

// If the expression is a string literal ("..."), return its content, unescaping it.
function extractStringLiteral(expression: string): string | undefined {
    const trimmed = expression.trim()
    if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
        return trimmed.substring(1, trimmed.length - 1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return undefined
}

function convertEditorBorder(border: TableCell['style']['border']): BorderDef | undefined {
    if (border.top === null && border.bottom === null && border.left === null && border.right === null) return undefined
    return {
        top: border.top !== null ? { width: border.top.width, color: border.top.color, style: border.top.style } : null,
        bottom: border.bottom !== null ? { width: border.bottom.width, color: border.bottom.color, style: border.bottom.style } : null,
        left: border.left !== null ? { width: border.left.width, color: border.left.color, style: border.left.style } : null,
        right: border.right !== null ? { width: border.right.width, color: border.right.color, style: border.right.style } : null,
    }
}

function convertTableCellStyleProps(style: TableCellStyle) {
    return {
        hAlign: style.hAlign,
        vAlign: style.vAlign,
        rotation: style.rotation || undefined,
        backcolor: style.backcolor !== '#FFFFFF' ? style.backcolor : undefined,
        forecolor: style.forecolor,
        fontId: style.fontFamily,
        fontSize: style.fontSize !== 10 ? style.fontSize : undefined,
        bold: style.bold || undefined,
        italic: style.italic || undefined,
        underline: style.underline || undefined,
        strikethrough: style.strikethrough || undefined,
        lineSpacing: convertCellLineSpacing(style),
        letterSpacing: style.letterSpacing || undefined,
        wordSpacing: style.wordSpacing || undefined,
        firstLineIndent: style.firstLineIndent || undefined,
        leftIndent: style.leftIndent || undefined,
        rightIndent: style.rightIndent || undefined,
        wrap: style.wrap === false ? false : undefined,
        shrinkToFit: style.shrinkToFit || undefined,
        minFontSize: style.shrinkToFit && style.minFontSize !== 4 ? style.minFontSize : undefined,
        fitWidth: style.fitWidth || undefined,
        outlineText: style.outlineText || undefined,
        padding: style.padding !== 2 ? style.padding : undefined,
        border: convertEditorBorder(style.border),
        opacity: style.opacity < 1 ? style.opacity : undefined,
    }
}

function convertTableColumn(column: TableColumn) {
    return {
        width: column.width,
        style: convertTableCellStyleProps(column.style),
    }
}

function convertTableCell(cell: TableCell, ctx: StyleContext) {
    const literal = extractStringLiteral(cell.expression)
    const styleProps = convertTableCellStyleProps(cell.style)
    return {
        text: literal,
        expression: literal === undefined && cell.expression !== '' ? cell.expression : undefined,
        colSpan: cell.colSpan !== 1 ? cell.colSpan : undefined,
        rowSpan: cell.rowSpan !== 1 ? cell.rowSpan : undefined,
        ...styleProps,
        elements: cell.children.length > 0 ? cell.children.map(function (c) { return convertElement(c, ctx) }) : undefined,
    }
}

function convertTableRows(rows: TableRow[] | undefined, ctx: StyleContext) {
    if (rows === undefined || rows.length === 0) return undefined
    return rows.map(function (row) {
        return {
            height: row.height,
            cells: row.cells.map(function (cell) { return convertTableCell(cell, ctx) }),
        }
    })
}

function convertLineSpacing(el: TemplateElement): LineSpacingDef | undefined {
    if (el.lineSpacingType === 'single' && el.lineSpacingValue === 0) return undefined
    if (el.lineSpacingType === 'proportional' || el.lineSpacingType === 'fixed' || el.lineSpacingType === 'minimum') {
        return { type: el.lineSpacingType, value: el.lineSpacingValue }
    }
    return { type: el.lineSpacingType }
}

function convertCellLineSpacing(style: TableCellStyle): LineSpacingDef | undefined {
    if (style.lineSpacingType === 'single' && style.lineSpacingValue === 0) return undefined
    if (style.lineSpacingType === 'proportional' || style.lineSpacingType === 'fixed' || style.lineSpacingType === 'minimum') {
        return { type: style.lineSpacingType, value: style.lineSpacingValue }
    }
    return { type: style.lineSpacingType }
}

function toLiteralExpression(value: string): string {
    return JSON.stringify(value)
}

function convertHyperlink(el: TemplateElement): HyperlinkDef | undefined {
    if (el.hyperlinkType === '' || el.hyperlinkTarget.trim() === '') return undefined
    return {
        type: el.hyperlinkType,
        target: toLiteralExpression(el.hyperlinkTarget),
        remoteDocument: el.hyperlinkRemoteDocument.trim() !== '' ? toLiteralExpression(el.hyperlinkRemoteDocument) : undefined,
    }
}

function convertPathFill(el: TemplateElement): FillDef | undefined {
    if (el.pathFillType === 'none') return undefined
    if (el.pathFillType === 'solid') return el.pathFillColor
    if (el.pathFillType === 'mesh' || el.pathFillType === 'pattern' || el.pathFillType === 'special') {
        if (el.pathComplexFill === null) throw new Error('パス要素の複合塗り（メッシュ/パターン）定義がありません')
        return el.pathComplexFill
    }
    if (el.pathFillType === 'linear') {
        return {
            type: 'linearGradient',
            x1: el.pathGradient.x1,
            y1: el.pathGradient.y1,
            x2: el.pathGradient.x2,
            y2: el.pathGradient.y2,
            stops: el.pathGradient.stops,
            pdfShading: el.pathGradient.pdfShading,
        }
    }
    return {
        type: 'radialGradient',
        cx: el.pathGradient.cx,
        cy: el.pathGradient.cy,
        r: el.pathGradient.r,
        stops: el.pathGradient.stops,
        pdfShading: el.pathGradient.pdfShading,
    }
}

function convertShapeFill(el: TemplateElement): FillDef | undefined {
    if (el.shapeFillType === 'special') {
        if (el.shapeComplexFill === null) throw new Error('図形要素のPDF特殊色定義がありません')
        return el.shapeComplexFill
    }
    if (el.shapeFillType !== 'none' && el.shapeFillType !== 'solid' && el.shapeFillType !== 'linear' && el.shapeFillType !== 'radial') return el.fill || undefined
    if (el.shapeFillType === 'none') return undefined
    if (el.shapeFillType === 'solid') return el.shapeFillColor
    if (el.shapeFillType === 'linear') {
        return {
            type: 'linearGradient',
            x1: el.shapeGradient.x1,
            y1: el.shapeGradient.y1,
            x2: el.shapeGradient.x2,
            y2: el.shapeGradient.y2,
            stops: el.shapeGradient.stops,
            pdfShading: el.shapeGradient.pdfShading,
        }
    }
    return {
        type: 'radialGradient',
        cx: el.shapeGradient.cx,
        cy: el.shapeGradient.cy,
        r: el.shapeGradient.r,
        stops: el.shapeGradient.stops,
        pdfShading: el.shapeGradient.pdfShading,
    }
}

function convertElement(el: TemplateElement, ctx: StyleContext): ElementDef {
    try {
        return convertElementBody(el, ctx)
    } catch (e) {
        // Locate conversion failures for the caller (validate_template / MCP):
        // prefix the element id and kind once, innermost element wins
        const message = e instanceof Error ? e.message : String(e)
        if (message.startsWith('要素 ')) throw e
        throw new Error(`要素 ${el.id} (${el.kind}): ${message}`)
    }
}

function convertElementBody(el: TemplateElement, ctx: StyleContext): ElementDef {
    const styleName = (el.kind === 'staticText' || el.kind === 'textField' || el.style.opacity !== 1 || el.writingMode !== 'horizontal-tb')
        ? getOrCreateElementStyle(ctx, el)
        : undefined
    const base = {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        style: styleName,
        positionType: el.positionType,
        stretchType: el.stretchType,
        printWhenExpression: el.printWhenExpression || undefined,
        isRemoveLineWhenBlank: el.isRemoveLineWhenBlank || undefined,
        isPrintRepeatedValues: el.isPrintRepeatedValues === false ? false : undefined,
        mode: el.style.mode,
        forecolor: el.style.forecolor,
        backcolor: el.style.backcolor !== '#FFFFFF' ? el.style.backcolor : undefined,
        border: convertBorder(el),
        padding: convertPadding(el),
        ...el.importedPdfRenderState?.common,
    } as const

    switch (el.kind) {
        case 'staticText': {
            const def: StaticTextDef = {
                ...base,
                type: 'staticText',
                text: el.text,
                markup: el.markup !== 'none' ? el.markup : undefined,
                hAlign: el.style.hAlign === 'justified' ? 'justify' : el.style.hAlign,
                vAlign: el.style.vAlign,
                rotation: el.style.rotation !== 0 ? el.style.rotation : undefined,
                lineSpacing: convertLineSpacing(el),
                letterSpacing: el.letterSpacing !== 0 ? el.letterSpacing : undefined,
                wordSpacing: el.wordSpacing !== 0 ? el.wordSpacing : undefined,
                horizontalScale: el.horizontalScale !== 1 ? el.horizontalScale : undefined,
                firstLineIndent: el.firstLineIndent !== 0 ? el.firstLineIndent : undefined,
                leftIndent: el.leftIndent !== 0 ? el.leftIndent : undefined,
                rightIndent: el.rightIndent !== 0 ? el.rightIndent : undefined,
                direction: el.direction !== 'ltr' ? el.direction : undefined,
                wrap: el.wrap === false ? false : undefined,
                shrinkToFit: el.shrinkToFit || undefined,
                minFontSize: el.shrinkToFit && el.minFontSize !== 4 ? el.minFontSize : undefined,
                fitWidth: el.fitWidth || undefined,
                outlineText: el.pdfTextMode === 'outline' || el.outlineText || undefined,
                pdfFontMode: el.pdfTextMode === 'system' ? 'reference' : undefined,
                ...el.importedPdfRenderState?.text,
                tabStopWidth: el.tabStopWidth !== 40 ? el.tabStopWidth : undefined,
                anchorName: el.anchorName || undefined,
                bookmarkLevel: el.bookmarkLevel !== 0 ? el.bookmarkLevel : undefined,
                hyperlink: convertHyperlink(el),
            }
            return def
        }
        case 'textField': {
            const def: TextFieldDef = {
                ...base,
                type: 'textField',
                expression: el.expression,
                pattern: el.pattern || undefined,
                blankWhenNull: el.blankWhenNull || undefined,
                stretchWithOverflow: el.stretchWithOverflow || undefined,
                evaluationTime: el.evaluationTime !== 'now' ? el.evaluationTime : undefined,
                evaluationGroup: el.evaluationTime === 'group' && el.evaluationGroup !== '' ? el.evaluationGroup : undefined,
                markup: el.markup !== 'none' ? el.markup : undefined,
                hAlign: el.style.hAlign === 'justified' ? 'justify' : el.style.hAlign,
                vAlign: el.style.vAlign,
                rotation: el.style.rotation !== 0 ? el.style.rotation : undefined,
                lineSpacing: convertLineSpacing(el),
                letterSpacing: el.letterSpacing !== 0 ? el.letterSpacing : undefined,
                wordSpacing: el.wordSpacing !== 0 ? el.wordSpacing : undefined,
                horizontalScale: el.horizontalScale !== 1 ? el.horizontalScale : undefined,
                firstLineIndent: el.firstLineIndent !== 0 ? el.firstLineIndent : undefined,
                leftIndent: el.leftIndent !== 0 ? el.leftIndent : undefined,
                rightIndent: el.rightIndent !== 0 ? el.rightIndent : undefined,
                direction: el.direction !== 'ltr' ? el.direction : undefined,
                textTruncate: el.textTruncate !== 'none' ? el.textTruncate : undefined,
                wrap: el.wrap === false ? false : undefined,
                shrinkToFit: el.shrinkToFit || undefined,
                minFontSize: el.shrinkToFit && el.minFontSize !== 4 ? el.minFontSize : undefined,
                fitWidth: el.fitWidth || undefined,
                outlineText: el.pdfTextMode === 'outline' || el.outlineText || undefined,
                pdfFontMode: el.pdfTextMode === 'system' ? 'reference' : undefined,
                tabStopWidth: el.tabStopWidth !== 40 ? el.tabStopWidth : undefined,
                anchorName: el.anchorName || undefined,
                bookmarkLevel: el.bookmarkLevel !== 0 ? el.bookmarkLevel : undefined,
                hyperlink: convertHyperlink(el),
            }
            return def
        }
        case 'line': {
            const def: LineDef = {
                ...base,
                border: undefined,
                type: 'line',
                lineWidth: el.lineWidth,
                lineStyle: el.lineStyle !== 'solid' ? el.lineStyle : undefined,
                lineColor: el.lineColor,
            }
            return def
        }
        case 'rectangle': {
            const hasUniformRadius = el.topLeftRadius === el.topRightRadius
                && el.topLeftRadius === el.bottomRightRadius
                && el.topLeftRadius === el.bottomLeftRadius
            const cornerRadii = getRectangleCornerRadii(el)
            const def: RectangleDef = {
                ...base,
                border: undefined,
                type: 'rectangle',
                radius: hasUniformRadius && el.topLeftRadius !== 0 ? el.topLeftRadius : undefined,
                cornerRadii: hasUniformRadius ? undefined : cornerRadii,
                fill: convertShapeFill(el),
                stroke: el.stroke,
                strokeWidth: el.strokeWidth,
            }
            return def
        }
        case 'ellipse': {
            const def: EllipseDef = {
                ...base,
                border: undefined,
                type: 'ellipse',
                fill: convertShapeFill(el),
                stroke: el.stroke,
                strokeWidth: el.strokeWidth,
            }
            return def
        }
        case 'path': {
            const sourceVector = el.pdfSourceLocked
                ? el.importedPdfRenderState?.path?.pdfSourceVector
                : undefined
            const def: PathDef = {
                ...base,
                ...el.importedPdfRenderState?.path,
                border: undefined,
                type: 'path',
                d: sourceVector === undefined ? buildPathD(el.pathSubpaths) : '',
                pdfSourceVector: sourceVector,
                fill: convertPathFill(el),
                fillOpacity: el.pathFillOpacity !== 1 ? el.pathFillOpacity : undefined,
                stroke: el.stroke,
                strokeWidth: el.strokeWidth,
                strokeOpacity: el.pathStrokeOpacity !== 1 ? el.pathStrokeOpacity : undefined,
                strokeDasharray: el.pathStrokeDash.length > 0 ? el.pathStrokeDash : undefined,
                strokeLinecap: el.pathStrokeCap,
                strokeLinejoin: el.pathStrokeJoin,
            }
            return def
        }
        case 'image': {
            const def: ImageDef = {
                ...base,
                ...el.importedPdfRenderState?.image,
                type: 'image',
                source: el.source || undefined,
                sourceExpression: el.sourceExpression || undefined,
                scaleMode: el.scaleMode,
                hAlign: el.imageHAlign,
                vAlign: el.imageVAlign,
                onError: el.onError,
                lazy: el.lazy || undefined,
                hyperlink: convertHyperlink(el),
            }
            return def
        }
        case 'frame': {
            const def: FrameDef = {
                ...base,
                ...el.importedPdfRenderState?.frame,
                type: 'frame',
                hyperlink: convertHyperlink(el),
                elements: el.children.length > 0 ? el.children.map(function (c) { return convertElement(c, ctx) }) : undefined,
            }
            if (el.frameClipPathD !== '') {
                def.clipPath = el.frameClipPathRule === 'evenodd'
                    ? { d: el.frameClipPathD, fillRule: 'evenodd' }
                    : { d: el.frameClipPathD }
            }
            return def
        }
        case 'svg': {
            const def: SvgElementDef = {
                ...base,
                type: 'svg',
                svgContent: el.svgContent,
            }
            return def
        }
        case 'break': {
            const def: BreakDef = {
                ...base,
                type: 'break',
                breakType: el.breakType,
            }
            return def
        }
        case 'barcode': {
            const def: BarcodeDef = {
                ...base,
                type: 'barcode',
                barcodeType: el.barcodeType,
                expression: el.expression,
                showText: el.showText,
                errorCorrectionLevel: el.errorCorrectionLevel,
            }
            return def
        }
        case 'formField': {
            const ft = el.formFieldType
            const valueBearing = ft === 'text' || ft === 'dropdown' || ft === 'listbox'
            const toggle = ft === 'checkbox' || ft === 'radio'
            const choice = ft === 'dropdown' || ft === 'listbox'
            const def: FormFieldDef = {
                ...base,
                type: 'formField',
                fieldType: ft,
                fieldName: el.formFieldName,
                value: valueBearing && el.formFieldValue !== '' ? el.formFieldValue : undefined,
                checked: toggle && el.formFieldChecked !== '' ? el.formFieldChecked : undefined,
                exportValue: toggle && el.formFieldExportValue !== '' ? el.formFieldExportValue : undefined,
                options: choice && el.formFieldOptions.length > 0
                    ? el.formFieldOptions.map((o) => ({ value: o.value, label: o.label !== '' && o.label !== o.value ? o.label : undefined }))
                    : undefined,
                editable: ft === 'dropdown' && el.formFieldEditable ? true : undefined,
                multiSelect: ft === 'listbox' && el.formFieldMultiSelect ? true : undefined,
                caption: ft === 'pushbutton' && el.formFieldCaption !== '' ? el.formFieldCaption : undefined,
                action: ft === 'pushbutton' && el.formFieldAction !== '' ? el.formFieldAction : undefined,
                multiline: ft === 'text' && el.formFieldMultiline ? true : undefined,
                readOnly: el.formFieldReadOnly || undefined,
                required: el.formFieldRequired || undefined,
                maxLength: ft === 'text' && el.formFieldMaxLength > 0 ? el.formFieldMaxLength : undefined,
                borderColor: el.formFieldBorderColor !== '' ? el.formFieldBorderColor : undefined,
                backgroundColor: el.formFieldBackgroundColor !== '' ? el.formFieldBackgroundColor : undefined,
            }
            return def
        }
        case 'math': {
            const def: MathDef = {
                ...base,
                type: 'math',
                formula: quoteExpressionStringLiteral(el.formula),
                mathFontFamily: el.mathFontFamily || undefined,
                fontSize: el.mathFontSize,
                color: el.mathColor,
            }
            return def
        }
        case 'subreport': {
            const def: SubreportDef = {
                ...base,
                type: 'subreport',
                templateExpression: el.templateExpression,
                dataSourceExpression: el.dataSourceExpression || undefined,
            }
            return def
        }
        case 'table': {
            return {
                ...base,
                type: 'table',
                columns: getTableColumns(el).map(convertTableColumn),
                headerRows: convertTableRows(getTableSectionRows(el, 'header'), ctx),
                detailRows: convertTableRows(getTableSectionRows(el, 'detail'), ctx),
                footerRows: convertTableRows(getTableSectionRows(el, 'footer'), ctx),
            }
        }
        case 'crosstab': {
            const def: CrosstabElementDef = {
                ...base,
                type: 'crosstab',
                rowGroups: el.crosstabRowGroups.map(function (g) { return { field: g.field } }),
                columnGroups: el.crosstabColumnGroups.map(function (g) { return { field: g.field } }),
                measures: el.crosstabMeasures.map(function (m) {
                    return {
                        field: m.field,
                        calculation: m.calculation,
                        format: m.format !== '' ? m.format : undefined,
                    }
                }),
                rowHeaderWidth: el.rowHeaderWidth,
                columnHeaderHeight: el.columnHeaderHeight,
                cellWidth: el.cellWidth,
                cellHeight: el.cellHeight,
                border: { color: el.crosstabBorderColor, width: el.crosstabBorderWidth },
                showSubtotals: el.showSubtotals || undefined,
                showGrandTotal: el.showGrandTotal || undefined,
                dataSourceExpression: el.crosstabDataSourceExpression !== '' ? el.crosstabDataSourceExpression : undefined,
            }
            return def
        }
        // Use a rectangle placeholder for internal table elements and other non-standalone core element types.
        default: {
            const def: RectangleDef = {
                ...base,
                type: 'rectangle',
                stroke: '#999999',
                strokeWidth: 1,
            }
            return def
        }
    }
}

function convertBand(band: Band, ctx: StyleContext): BandDef {
    return {
        height: band.height,
        startNewPage: band.startNewPage || undefined,
        splitType: band.splitType.toLowerCase() as 'stretch' | 'prevent' | 'immediate',
        printWhenExpression: band.printWhenExpression || undefined,
        elements: band.elements.length > 0 ? band.elements.map(function (el) { return convertElement(el, ctx) }) : undefined,
    }
}

const BAND_TYPE_TO_KEY: Record<Exclude<BandType, 'draft' | 'groupHeader' | 'groupFooter'>, keyof BandSet> = {
    background: 'background',
    title: 'title',
    pageHeader: 'pageHeader',
    columnHeader: 'columnHeader',
    detail: 'details',
    columnFooter: 'columnFooter',
    pageFooter: 'pageFooter',
    lastPageFooter: 'lastPageFooter',
    summary: 'summary',
    noData: 'noData',
}

export function convertEditorTemplateToCore(template: ReportTemplate): CoreTemplate {
    const ps = template.pageSettings
    const ctx: StyleContext = { styles: new Map(), counter: 0 }
    const enabledTitleBand = template.bands.find(function (band) { return band.type === 'title' && band.enabled })
    const enabledSummaryBand = template.bands.find(function (band) { return band.type === 'summary' && band.enabled })

    const bandSet: BandSet = {}
    const detailBands: BandDef[] = []
    const groupHeaderBands = new Map<string, BandDef>()
    const groupFooterBands = new Map<string, BandDef>()

    for (let i = 0; i < template.bands.length; i++) {
        const band = template.bands[i]
        if (!band.enabled) continue
        // Draft bands are an editor-only working layer and never reach print output
        if (band.type === 'draft') continue
        const converted = convertBand(band, ctx)
        if (band.type === 'groupHeader' || band.type === 'groupFooter') {
            if (band.groupName === undefined) continue
            if (band.type === 'groupHeader') groupHeaderBands.set(band.groupName, converted)
            else groupFooterBands.set(band.groupName, converted)
            continue
        }
        const key = BAND_TYPE_TO_KEY[band.type] as string
        if (key === 'details') {
            detailBands.push(converted)
        } else {
            (bandSet as Record<string, BandDef>)[key] = converted
        }
    }
    if (detailBands.length > 0) {
        bandSet.details = detailBands
    }

    // Group definitions; template.groups are ordered from outer to inner.
    const groups: GroupDef[] = []
    for (let i = 0; i < template.groups.length; i++) {
        const g = template.groups[i]
        const header = groupHeaderBands.get(g.name)
        const footer = groupFooterBands.get(g.name)
        groups.push({
            name: g.name,
            expression: g.expression,
            startNewPage: g.startNewPage || undefined,
            startNewColumn: g.startNewColumn || undefined,
            reprintHeaderOnEachPage: g.reprintHeaderOnEachPage || undefined,
            resetPageNumber: g.resetPageNumber || undefined,
            keepTogether: g.keepTogether || undefined,
            minHeightToStartNewPage: g.minHeightToStartNewPage !== 0 ? g.minHeightToStartNewPage : undefined,
            footerPosition: g.footerPosition !== 'normal' ? g.footerPosition : undefined,
            header,
            footer,
        })
    }

    // Collect style definitions.
    const styleArray: StyleDef[] = []
    ctx.styles.forEach(function (s) { styleArray.push(s) })

    return {
        name: template.name,
        page: {
            size: ps.size !== 'custom' ? ps.size : undefined,
            width: ps.width,
            height: ps.height,
            // Custom sizes already carry the real page dimensions; passing the
            // orientation would make the core engine swap them a second time
            orientation: ps.size !== 'custom' ? ps.orientation : undefined,
            margins: {
                top: ps.marginTop,
                bottom: ps.marginBottom,
                left: ps.marginLeft,
                right: ps.marginRight,
            },
            transparencyGroup: ps.transparencyGroup,
        },
        columns: ps.columnCount > 1 ? {
            count: ps.columnCount,
            width: ps.columnWidth,
            spacing: ps.columnSpacing,
            printOrder: ps.columnPrintOrder,
        } : undefined,
        styles: styleArray.length > 0 ? styleArray : undefined,
        groups: groups.length > 0 ? groups : undefined,
        bands: bandSet,
        titleNewPage: enabledTitleBand?.startNewPage || undefined,
        summaryNewPage: enabledSummaryBand?.startNewPage || undefined,
        summaryWithPageHeaderAndFooter: enabledSummaryBand?.startNewPage && template.summaryWithPageHeaderAndFooter ? true : undefined,
    }
}
