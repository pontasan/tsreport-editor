// Complete editor-template format reference served by the MCP tool
// "get_template_schema". The single source of truth for the format is the
// editor type model (app/[lang]/editor/reducer.ts); keep this file in sync
// with it. Everything an AI needs to author a template without guessing
// property names lives here.

export const TEMPLATE_SCHEMA = {
    overview: {
        description: 'A report template is a JSON object (editor template format). '
            + 'save_template / validate_template / render_report / layout_report all take this format. '
            + 'normalizeTemplate fills every omitted property with its default, so you only need to '
            + 'specify the properties that differ from the defaults shown here.',
        units: 'All coordinates and sizes are points (pt, 1pt = 1/72 inch). A4 portrait = 595.28 x 841.89pt.',
        coordinateSystem: 'Element x/y are relative to the top-left of the containing band '
            + '(or the parent container element for children of frame/tableCell). Bands stack vertically '
            + 'inside the page content area (page size minus margins); band y positions are computed '
            + 'automatically from band order and heights.',
        recommendedWorkflow: [
            '1. get_template_schema to learn the format.',
            '2. list_fonts / list_workspace_files to discover usable fontFamily ids and image paths.',
            '3. Build the template JSON and call validate_template.',
            '4. layout_report with representative data: check page count and the absolute geometry of every rendered item against the design.',
            '5. render_report (format png) and visually compare with the design original.',
            '6. save_template once it matches.',
        ],
    },

    expressionLanguage: {
        description: 'Expressions are JavaScript-like accessor chains evaluated per data row.',
        roots: {
            'field.*': 'Current data row field, e.g. field.customerName, field.items[0].price',
            'vars.*': 'Report variables (aggregations defined by groups), alias: var.*',
            'param.*': 'Values from dataSource.parameters',
        },
        reportVariables: 'Bare identifiers resolve to built-in report variables: PAGE_NUMBER, COLUMN_NUMBER, REPORT_COUNT, TOTAL_PAGES.',
        examples: ['field.item', 'param.title', 'field.unitPrice * field.quantity', '"第" + PAGE_NUMBER + "頁"'],
        usedIn: 'textField.expression, band/element printWhenExpression, image sourceExpression, '
            + 'subreport templateExpression/dataSourceExpression, group expression.',
    },

    dataSource: {
        description: 'The dataSource argument of render_report / layout_report.',
        shape: { rows: 'array of row objects (field.* resolves against the current row)', parameters: 'object (param.*)' },
        example: { rows: [{ item: 'Apple', price: 120 }], parameters: { title: 'Invoice' } },
    },

    template: {
        name: 'string — report name',
        pageSettings: 'PageSettings object (see pageSettings)',
        bands: 'Band[] (see band)',
        groups: 'ReportGroup[] (see group). Empty array when no control breaks.',
        titleNewPage: 'boolean (default false) — title band on its own page',
        summaryNewPage: 'boolean (default false)',
        summaryWithPageHeaderAndFooter: 'boolean (default false)',
        testDataPath: 'string — workspace-relative JSON path the editor preview uses as sample data. SET THIS to the test-data JSON you saved via save_workspace_file (same { rows, parameters } shape you pass to layout_report / render_report) so the human operator previews exactly the rows you verified. Use enough rows to overflow at least one page when the report has a repeating detail band',
    },

    pageSettings: {
        size: "string — 'A4' | 'A3' | 'A5' | 'B4' | 'B5' | 'letter' | 'legal' | 'custom'",
        width: 'number pt (595.28 for A4 portrait)',
        height: 'number pt (841.89 for A4 portrait)',
        marginTop: 'number pt', marginBottom: 'number pt', marginLeft: 'number pt', marginRight: 'number pt',
        orientation: "'portrait' | 'landscape'",
        columnCount: 'number (default 1)',
        columnWidth: 'number pt — content width per column',
        columnSpacing: 'number pt',
        columnPrintOrder: "'vertical' | 'horizontal'",
    },

    band: {
        id: 'string — unique id, e.g. "band_title"',
        type: "'background' | 'draft' | 'title' | 'pageHeader' | 'columnHeader' | 'groupHeader' | 'detail' | 'groupFooter' | 'columnFooter' | 'pageFooter' | 'lastPageFooter' | 'summary' | 'noData' — draft is an editor-only working layer excluded from print output",
        groupName: 'string — groupHeader/groupFooter only: name of the ReportGroup it belongs to',
        height: 'number pt — the detail band repeats once per data row',
        startNewPage: 'boolean',
        splitType: "'Stretch' | 'Prevent' | 'Immediate' — behavior when the band does not fit on the page",
        elements: 'TemplateElement[]',
        printWhenExpression: 'string expression ("" = always print)',
        enabled: 'boolean',
    },

    group: {
        name: 'string', expression: 'string — break expression, e.g. field.category',
        startNewPage: 'boolean', startNewColumn: 'boolean', reprintHeaderOnEachPage: 'boolean',
        resetPageNumber: 'boolean', keepTogether: 'boolean', minHeightToStartNewPage: 'number pt',
        footerPosition: "'normal' | 'stackAtBottom' | 'forceAtBottom' | 'collateAtBottom'",
    },

    element: {
        description: 'All element kinds share one flat object plus a nested "style" object. '
            + 'Only the properties relevant to the kind are used; omitted ones take defaults.',
        common: {
            id: 'string — unique within the template',
            kind: "'staticText' | 'textField' | 'line' | 'rectangle' | 'ellipse' | 'path' | 'image' | 'svg' | 'frame' | 'table' | 'crosstab' | 'subreport' | 'barcode' | 'math' | 'break'",
            x: 'number pt', y: 'number pt', width: 'number pt', height: 'number pt',
            style: 'ElementStyle object (see style)',
            styleName: 'string — named style reference ("" = none)',
            positionType: "'float' | 'fixRelativeToTop' | 'fixRelativeToBottom'",
            stretchType: "'noStretch' | 'containerHeight' | 'containerBottom'",
            printWhenExpression: 'string expression',
            isRemoveLineWhenBlank: 'boolean',
            isPrintRepeatedValues: 'boolean',
            fitParentHorizontal: 'boolean — children of frame/tableColumn/tableCell only',
            fitParentVertical: 'boolean',
            children: 'TemplateElement[] — container kinds (frame, tableCell children) only',
        },
        colorNote: "Every color-typed string accepts three forms: '#RRGGBB' (RGB), "
            + "'cmyk(C,M,Y,K)' (process color, percent 0-100), 'spot(Name,C,M,Y,K)' (spot color with its CMYK alternate). "
            + 'CMYK/spot output natively to PDF (DeviceCMYK / Separation); previews show an RGB approximation.',
        style: {
            fontFamily: 'string — a font id from list_fonts (default "builtin:NotoSansJP")',
            fontSize: 'number pt',
            bold: 'boolean', italic: 'boolean', underline: 'boolean', strikethrough: 'boolean',
            forecolor: "string color", backcolor: "string color",
            mode: "'transparent' | 'opaque' — opaque paints backcolor",
            hAlign: "'left' | 'center' | 'right' | 'justified'",
            vAlign: "'top' | 'middle' | 'bottom'",
            rotation: '0 | 90 | 180 | 270',
            border: '{ top, bottom, left, right } each null or { width: pt, color: "#RRGGBB", style: "solid"|"dashed"|"dotted" }',
            padding: '{ top, bottom, left, right } pt (default left/right 2)',
            opacity: 'number 0..1',
        },
        textCommon: {
            appliesTo: 'staticText / textField',
            text: 'string — staticText content',
            expression: 'string — textField content expression',
            markup: "'none' | 'styled' | 'html'",
            direction: "'ltr' | 'rtl' | 'auto'",
            writingMode: "'horizontal-tb' | 'vertical-rl' | 'vertical-lr'",
            lineSpacingType: "'single' | '1.5' | 'double' | 'proportional' | 'fixed' | 'minimum'",
            lineSpacingValue: 'number', letterSpacing: 'number pt', wordSpacing: 'number pt',
            firstLineIndent: 'number pt', leftIndent: 'number pt', rightIndent: 'number pt',
            tabStopWidth: 'number pt', wrap: 'boolean',
            shrinkToFit: 'boolean', minFontSize: 'number pt', fitWidth: 'boolean',
            anchorName: 'string', bookmarkLevel: 'number (0 = none)',
            hyperlinkType: "'' | 'reference' | 'localAnchor' | 'localPage' | 'remoteAnchor' | 'remotePage'",
            hyperlinkTarget: 'string', hyperlinkRemoteDocument: 'string',
            outlineText: 'boolean',
            pdfTextMode: "'embedded' | 'outline' | 'system' — Editor per-element PDF text output mode (default embedded)",
        },
        textField: {
            pattern: "string — format pattern, e.g. '#,##0', '¥#,##0', '0.00%', 'yyyy/MM/dd'",
            blankWhenNull: 'boolean', stretchWithOverflow: 'boolean',
            evaluationTime: "'now' | 'band' | 'column' | 'page' | 'group' | 'report' | 'auto' — 'report' resolves TOTAL_PAGES etc. at the end",
            evaluationGroup: 'string', textTruncate: "'none' | 'truncate' | 'ellipsisChar' | 'ellipsisWord'",
        },
        line: { lineWidth: 'number pt', lineStyle: "'solid' | 'dashed' | 'dotted'", lineColor: "'#RRGGBB'" },
        rectangleEllipse: {
            fill: "string — legacy solid fill '#RRGGBB' or 'transparent'; use shapeFillType/shapeFillColor/shapeGradient for new templates",
            shapeFillType: "'none' | 'solid' | 'linear' | 'radial'",
            shapeFillColor: "string '#RRGGBB' — used when shapeFillType='solid'",
            shapeGradient: '{ x1,y1,x2,y2,cx,cy,r,stops } — coordinates are 0..1 object-box ratios; stops = { offset, color, opacity? }[]',
            stroke: "string — '#RRGGBB' or 'transparent'",
            strokeWidth: 'number pt',
            radius: 'number pt (rectangle) — uniform corner radius',
            cornerRadii: 'topLeftRadius / topRightRadius / bottomRightRadius / bottomLeftRadius: number pt (rectangle, override radius per corner)',
        },
        path: {
            pathSubpaths: 'PathSubpath[] — each subpath has { closed, anchors }; anchor = { x,y,inX,inY,outX,outY,handleMode }. Coordinates are local pt inside the element box',
            pathFillType: "'none' | 'solid' | 'linear' | 'radial' | 'mesh' | 'pattern' — mesh/pattern hold a complex fill imported from a PDF (see pathComplexFill)",
            pathFillColor: "string color — used when pathFillType='solid'",
            pathComplexFill: 'MeshGradientDef | TilingPatternDef | null — opaque complex fill preserved by import_pdf when pathFillType is mesh/pattern. Keep it as-is; it is not meant to be authored by hand',
            pathGradient: '{ x1,y1,x2,y2,cx,cy,r,stops } — coordinates are 0..1 object-box ratios; stops = { offset, color, opacity? }[]',
            stroke: "string '#RRGGBB' or 'transparent'",
            strokeWidth: 'number pt',
            pathStrokeDash: 'number[] pt',
            pathStrokeCap: "'butt' | 'round' | 'square'",
            pathStrokeJoin: "'miter' | 'round' | 'bevel'",
        },
        image: {
            source: "string — workspace-relative path, e.g. 'assets/logo.png' (relative to the template's directory)",
            sourceExpression: 'string — dynamic source expression (overrides source)',
            scaleMode: "'clip' | 'fillFrame' | 'retainShape' | 'realSize'",
            imageHAlign: "'left' | 'center' | 'right'", imageVAlign: "'top' | 'middle' | 'bottom'",
            onError: "'error' | 'blank' | 'icon'", lazy: 'boolean', lockAspectRatio: 'boolean (editor-only aid)',
        },
        svg: { svgContent: "string EXPRESSION — evaluates to SVG markup. Wrap literal markup in quotes: svgContent: \"'<svg xmlns=...>...</svg>'\" (single quotes around the markup). Rendered as vectors" },
        frame: { description: 'Container that clips/groups children; children coordinates are relative to the frame.' },
        subreport: {
            templateExpression: "string — expression or quoted literal for the subreport path, e.g. 'sub.report' (workspace-relative, resolved against the template directory)",
            dataSourceExpression: 'string — expression producing the subreport data source ("" = inherit rows)',
        },
        table: {
            description: 'Fixed-grid table. tableColumns defines column widths/styles; children hold '
                + 'tableColumnFrame/tableRow structures maintained by the editor. For AI authoring, prefer '
                + 'composing detail bands with textFields; use table only when a fixed grid is required.',
            tableColumns: '{ width: pt, style: TableCellStyle }[]',
            tableCellStyle: 'TableCellStyle — like style plus wrap/shrinkToFit/padding(number)/fitWidth',
        },
        crosstab: {
            crosstabRowGroups: '{ field: string }[]', crosstabColumnGroups: '{ field: string }[]',
            crosstabMeasures: "{ field: string, calculation: 'sum'|'count'|'average'|'min'|'max', format: string }[]",
            rowHeaderWidth: 'number pt', columnHeaderHeight: 'number pt', cellWidth: 'number pt', cellHeight: 'number pt',
            crosstabBorderColor: "'#RRGGBB'", crosstabBorderWidth: 'number pt',
            showSubtotals: 'boolean', showGrandTotal: 'boolean',
            crosstabDataSourceExpression: 'string ("" = report rows)',
        },
        barcode: {
            barcodeType: "string — 'code128' | 'code39' | 'code93' | 'ean13' | 'ean8' | 'upca' | 'upce' | 'itf' | 'codabar' | 'msi' | 'qrcode' | 'datamatrix' | 'pdf417'",
            expression: 'string — barcode value expression (or text for a literal)',
            showText: 'boolean', errorCorrectionLevel: "'L' | 'M' | 'Q' | 'H' (QR)",
        },
        math: {
            formula: 'string — LaTeX-style formula',
            mathFontFamily: "string (default 'builtin:STIXTwoMath')", mathFontSize: 'number pt', mathColor: "'#RRGGBB'",
        },
        break: { breakType: "'page' | 'column'" },
    },

    designPatterns: {
        description: 'How to map common design-original structures onto the template model.',
        repeatingRows: 'A table whose row count follows the data: put ONE row of textFields into a detail band '
            + '(it repeats per dataSource row) and the column headings into a columnHeader band (it repeats per page). '
            + 'Give every cell a full border and identical heights so the rows form a ruled grid. '
            + 'For a fixed-height ruled grid (empty rows drawn to the bottom like many Japanese business forms), '
            + 'pad dataSource.rows with empty rows ({ "name": "", "qty": null, ... }) and set blankWhenNull on the numeric cells.',
        totals: 'Put subtotal/tax/total rows into a summary band (printed once after the last detail row). '
            + 'Compute them in dataSource.parameters and reference them with param.* — the layout engine does not aggregate for you.',
        controlBreaks: 'Groups (template.groups + groupHeader/groupFooter bands with groupName) restart sections '
            + 'when the group expression value changes: use for category sections, per-customer subtotals, resetPageNumber etc.',
        subreports: 'Use a subreport element when a region repeats with its OWN dataset (details inside details, '
            + 'attachments per row, a second independent table): create a separate .report file with its own detail band, '
            + 'save it next to the parent, then place a subreport element with templateExpression "\'sub.report\'" '
            + '(quoted literal = workspace-relative path from the parent template directory) and '
            + 'dataSourceExpression "field.details" (an array field of the current row becomes the subreport rows; '
            + '"" inherits the parent rows). The subreport lays out inside the element bounds and grows downward.',
        tableElement: 'The table element is a fixed grid (tableColumns + editor-managed rows) for static layouts. '
            + 'For data-driven rows always prefer the detail band (or a subreport); it paginates and stretches correctly.',
        assets: 'Upload images with save_workspace_file (contentBase64) into the workspace (e.g. assets/logo.png), '
            + 'then reference them from image elements via source with a path relative to the template directory. '
            + 'SVG can be uploaded as an asset or embedded inline in an svg element (svgContent is an expression — quote literal markup).',
        pageNumbers: 'PAGE_NUMBER in a textField expression prints the page. For "page X of Y" use TOTAL_PAGES '
            + 'with evaluationTime "report".',
        reproductionWorkflow: 'To match a design original exactly: measure the original (convert px to pt by '
            + 'pt = px * 72 / dpi), place elements with those coordinates, then verify numerically with '
            + 'layout_report (absolute geometry) and visually with render_report png. Iterate until both match, '
            + 'then save_template.',
    },

    minimalExample: {
        name: 'invoice',
        pageSettings: {
            size: 'A4', width: 595.28, height: 841.89,
            marginTop: 40, marginBottom: 40, marginLeft: 40, marginRight: 40,
            orientation: 'portrait', columnCount: 1, columnWidth: 515.28, columnSpacing: 0, columnPrintOrder: 'vertical',
        },
        bands: [
            {
                id: 'band_title', type: 'title', height: 60, startNewPage: false, splitType: 'Stretch',
                printWhenExpression: '', enabled: true,
                elements: [{
                    id: 'el_title', kind: 'staticText', x: 0, y: 10, width: 515, height: 30,
                    text: '請求書',
                    style: { fontFamily: 'builtin:NotoSansJP', fontSize: 20, bold: true, hAlign: 'center' },
                }],
            },
            {
                id: 'band_detail', type: 'detail', height: 24, startNewPage: false, splitType: 'Stretch',
                printWhenExpression: '', enabled: true,
                elements: [
                    { id: 'el_item', kind: 'textField', x: 0, y: 2, width: 300, height: 20, expression: 'field.item' },
                    { id: 'el_price', kind: 'textField', x: 315, y: 2, width: 200, height: 20, expression: 'field.price', pattern: '#,##0', style: { hAlign: 'right' } },
                ],
            },
        ],
        groups: [],
    },
} as const
