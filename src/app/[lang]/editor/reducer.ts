import type {
    ElementDef,
    FrameDef,
    FunctionShadingDef,
    ImageDef,
    MeshGradientDef,
    PageTransparencyGroupDef,
    PdfAxialRadialShadingDef,
    PdfSourceVectorDef,
    PdfSpecialColorDef,
    TilingPatternDef,
} from 'tsreport-core'
import { materializePdfSourceVector } from 'tsreport-core'
import { convertColorToMode } from './color_input_util'
// Report editor state management

import { DisplayUnit, UnitUtils } from '@/lib/common/utils/unit_utils'
import { DEFAULT_FONT_ID, MATH_FONT_ID } from '@/lib/common/font_ids'
import { applyParentFitToBandElements } from './table_editor_model'
import { createRectanglePath, pathArraysToSubpaths, type PathSubpath } from './path_model'

// =====================================
// Band types
// =====================================
export type BandType =
    | 'background'
    | 'draft'
    | 'title'
    | 'pageHeader'
    | 'columnHeader'
    | 'groupHeader'
    | 'detail'
    | 'groupFooter'
    | 'columnFooter'
    | 'pageFooter'
    | 'lastPageFooter'
    | 'summary'
    | 'noData'

// =====================================
// Element types
// =====================================
export type ElementKind =
    | 'staticText'
    | 'formField'
    | 'textField'
    | 'line'
    | 'rectangle'
    | 'ellipse'
    | 'path'
    | 'image'
    | 'svg'
    | 'frame'
    | 'table'
    | 'tableColumnFrame'
    | 'tableColumn'
    | 'tableRowFrame'
    | 'tableRow'
    | 'tableCell'
    | 'crosstab'
    | 'subreport'
    | 'barcode'
    | 'math'
    | 'break'

// =====================================
// Tool types
// =====================================
export type ToolType =
    | 'select'
    | 'staticText'
    | 'formField'
    | 'textField'
    | 'line'
    | 'rectangle'
    | 'ellipse'
    | 'path'
    | 'image'
    | 'svg'
    | 'frame'
    | 'table'
    | 'crosstab'
    | 'subreport'
    | 'barcode'
    | 'math'
    | 'break'

// =====================================
// Text alignment
// =====================================
export type HAlign = 'left' | 'center' | 'right' | 'justified'
export type VAlign = 'top' | 'middle' | 'bottom'
export type PdfTextMode = 'embedded' | 'outline' | 'system'

// =====================================
// Border
// =====================================
export type BorderSide = {
    width: number,
    color: string,
    style: 'solid' | 'dashed' | 'dotted'
}

export type Border = {
    top: BorderSide | null,
    bottom: BorderSide | null,
    left: BorderSide | null,
    right: BorderSide | null
}

// =====================================
// Padding
// =====================================
export type Padding = {
    top: number,
    bottom: number,
    left: number,
    right: number
}

// =====================================
// Element style
// =====================================
export type ElementStyle = {
    fontFamily: string,
    fontSize: number,
    bold: boolean,
    italic: boolean,
    underline: boolean,
    strikethrough: boolean,
    forecolor: string,
    backcolor: string,
    mode: 'transparent' | 'opaque',
    hAlign: HAlign,
    vAlign: VAlign,
    rotation: 0 | 90 | 180 | 270,
    border: Border,
    padding: Padding,
    opacity: number
}

export type TableCellStyle = {
    hAlign: 'left' | 'center' | 'right',
    vAlign: 'top' | 'middle' | 'bottom',
    rotation: 0 | 90 | 180 | 270,
    backcolor: string,
    forecolor: string,
    fontFamily: string,
    fontSize: number,
    bold: boolean,
    italic: boolean,
    underline: boolean,
    strikethrough: boolean,
    lineSpacingType: 'single' | '1.5' | 'double' | 'proportional' | 'fixed' | 'minimum',
    lineSpacingValue: number,
    letterSpacing: number,
    wordSpacing: number,
    firstLineIndent: number,
    leftIndent: number,
    rightIndent: number,
    wrap: boolean,
    shrinkToFit: boolean,
    minFontSize: number,
    fitWidth: boolean,
    outlineText: boolean,
    padding: number,
    border: Border,
    opacity: number
}

export type TableColumn = {
    width: number,
    style: TableCellStyle
}

export type TableCell = {
    expression: string,
    colSpan: number,
    rowSpan: number,
    style: TableCellStyle,
    children: TemplateElement[]
}

export type TableRow = {
    height: number,
    cells: TableCell[]
}

// =====================================
// Crosstab
// =====================================
export type CrosstabGroup = {
    field: string
}

export type CrosstabMeasure = {
    field: string,
    calculation: 'sum' | 'count' | 'average' | 'min' | 'max',
    format: string
}

/**
 * PDF painting properties that have no editable control in the design UI.
 * They remain structured core semantics so import, editing, preview, and
 * re-output all use the same renderer without flattening the PDF artwork.
 */
export type ImportedPdfRenderState = {
    common: {
        blendMode?: ElementDef['blendMode'],
        overprintFill?: boolean,
        overprintStroke?: boolean,
        overprintMode?: ElementDef['overprintMode'],
        renderingIntent?: ElementDef['renderingIntent'],
        alphaIsShape?: boolean,
        textKnockout?: boolean,
        optionalContent?: ElementDef['optionalContent'],
    },
    text?: {
        baselineOffset?: number,
    },
    path?: {
        affineTransform?: [number, number, number, number, number, number],
        pdfSourceVector?: PdfSourceVectorDef,
        fillRule?: 'nonzero' | 'evenodd',
        strokeMiterLimit?: number,
        strokeDashoffset?: number,
    },
    image?: {
        affineTransform?: [number, number, number, number, number, number],
        interpolate?: boolean,
        alternates?: ImageDef['alternates'],
        opi?: ImageDef['opi'],
        measure?: ImageDef['measure'],
        pointData?: ImageDef['pointData'],
    },
    frame?: {
        clip?: boolean,
        rotation?: number,
        rotationOriginX?: number,
        rotationOriginY?: number,
        affineTransform?: [number, number, number, number, number, number],
        pdfForm?: FrameDef['pdfForm'],
        transparencyGroup?: boolean,
        isolated?: boolean,
        knockout?: boolean,
        softMask?: FrameDef['softMask'],
        deviceParams?: FrameDef['deviceParams'],
    },
}

// =====================================
// Template element
// =====================================
export type TemplateElement = {
    id: string,
    kind: ElementKind,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    expression: string,
    style: ElementStyle,

    // === Common to all elements ===
    styleName: string,
    positionType: 'float' | 'fixRelativeToTop' | 'fixRelativeToBottom',
    stretchType: 'noStretch' | 'containerHeight' | 'containerBottom',
    printWhenExpression: string,
    isRemoveLineWhenBlank: boolean,
    isPrintRepeatedValues: boolean,

    // === Common to text elements (staticText/textField) ===
    markup: 'none' | 'styled' | 'html',
    direction: 'ltr' | 'rtl' | 'auto',
    writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr',
    lineSpacingType: 'single' | '1.5' | 'double' | 'proportional' | 'fixed' | 'minimum',
    lineSpacingValue: number,
    letterSpacing: number,
    wordSpacing: number,
    horizontalScale: number,
    firstLineIndent: number,
    leftIndent: number,
    rightIndent: number,
    tabStopWidth: number,
    wrap: boolean,
    shrinkToFit: boolean,
    minFontSize: number,
    fitWidth: boolean,
    anchorName: string,
    bookmarkLevel: number,
    hyperlinkType: '' | 'reference' | 'localAnchor' | 'localPage' | 'remoteAnchor' | 'remotePage',
    hyperlinkTarget: string,
    hyperlinkRemoteDocument: string,
    outlineText: boolean,
    pdfTextMode: PdfTextMode,

    // === textField specific ===
    pattern: string,
    blankWhenNull: boolean,
    stretchWithOverflow: boolean,
    evaluationTime: 'now' | 'band' | 'column' | 'page' | 'group' | 'report' | 'auto',
    evaluationGroup: string,
    textTruncate: 'none' | 'truncate' | 'ellipsisChar' | 'ellipsisWord',

    // === line specific ===
    lineWidth: number,
    lineStyle: 'solid' | 'dashed' | 'dotted',
    lineColor: string,

    // === rectangle specific ===
    radius: number,
    topLeftRadius: number,
    topRightRadius: number,
    bottomRightRadius: number,
    bottomLeftRadius: number,
    fill: string,
    shapeFillType: 'none' | 'solid' | 'linear' | 'radial' | 'special',
    shapeComplexFill: PdfSpecialColorDef | null,
    shapeFillColor: string,
    shapeGradient: {
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        cx: number,
        cy: number,
        r: number,
        stops: { offset: number, color: string, opacity?: number }[],
        /** Exact imported PDF function/placement metadata; cleared by gradient edits. */
        pdfShading?: PdfAxialRadialShadingDef,
    },
    stroke: string,
    strokeWidth: number,

    // === path specific ===
    pathSubpaths: PathSubpath[],
    pathFillType: 'none' | 'solid' | 'linear' | 'radial' | 'mesh' | 'pattern' | 'special',
    /** Opaque complex fill preserved from PDF import (mesh gradient / tiling pattern; not editable in the UI) */
    pathComplexFill: MeshGradientDef | TilingPatternDef | FunctionShadingDef | PdfSpecialColorDef | null,
    pathFillColor: string,
    pathFillOpacity: number,
    pathGradient: {
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        cx: number,
        cy: number,
        r: number,
        stops: { offset: number, color: string, opacity?: number }[],
        /** Exact imported PDF function/placement metadata; cleared by gradient edits. */
        pdfShading?: PdfAxialRadialShadingDef,
    },
    pathStrokeOpacity: number,
    pathStrokeDash: number[],
    pathStrokeCap: 'butt' | 'round' | 'square',
    pathStrokeJoin: 'miter' | 'round' | 'bevel',

    // === image specific ===
    source: string,
    sourceExpression: string,
    scaleMode: 'clip' | 'fillFrame' | 'retainShape' | 'realSize',
    imageHAlign: 'left' | 'center' | 'right',
    imageVAlign: 'top' | 'middle' | 'bottom',
    onError: 'error' | 'blank' | 'icon',
    lazy: boolean,
    lockAspectRatio: boolean,

    // === svg specific ===
    svgContent: string,

    // === barcode specific ===
    barcodeType: string,
    showText: boolean,
    errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H',

    // === math specific ===
    formula: string,
    mathFontFamily: string,
    mathFontSize: number,
    mathColor: string,

    // === formField specific ===
    formFieldType: 'text' | 'checkbox' | 'radio' | 'pushbutton' | 'dropdown' | 'listbox' | 'signature',
    formFieldName: string,
    formFieldValue: string,
    formFieldChecked: string,
    formFieldExportValue: string,
    formFieldOptions: { value: string, label: string }[],
    formFieldEditable: boolean,
    formFieldMultiSelect: boolean,
    formFieldCaption: string,
    formFieldAction: string,
    formFieldMultiline: boolean,
    formFieldReadOnly: boolean,
    formFieldRequired: boolean,
    formFieldMaxLength: number,
    formFieldBorderColor: string,
    formFieldBackgroundColor: string,

    // === break specific ===
    breakType: 'page' | 'column',

    // === frame specific (clip path imported from PDF, not editable in the UI) ===
    frameClipPathD: string,
    frameClipPathRule: 'nonzero' | 'evenodd',
    importedPdfRenderState: ImportedPdfRenderState | null,
    /** Imported PDF vector geometry is immutable until explicitly unlocked. */
    pdfSourceLocked: boolean,

    // === subreport specific ===
    templateExpression: string,
    dataSourceExpression: string,

    // === table specific ===
    tableColumns: TableColumn[],

    // === table child element specific ===
    tableSection: TableSectionKey | '',
    tableCellStyle: TableCellStyle,
    colSpan: number,
    rowSpan: number,

    // === crosstab specific ===
    crosstabRowGroups: CrosstabGroup[],
    crosstabColumnGroups: CrosstabGroup[],
    crosstabMeasures: CrosstabMeasure[],
    rowHeaderWidth: number,
    columnHeaderHeight: number,
    cellWidth: number,
    cellHeight: number,
    crosstabBorderColor: string,
    crosstabBorderWidth: number,
    showSubtotals: boolean,
    showGrandTotal: boolean,
    crosstabDataSourceExpression: string,

    // === Parent fit (applies to child elements of frame / tableColumn / tableCell) ===
    fitParentHorizontal: boolean,
    fitParentVertical: boolean,

    // === Container (frame, etc.) ===
    children: TemplateElement[]
}

// =====================================
// Band
// =====================================
export type Band = {
    /** Band identifier. Since multiple bands of the same type can exist, uniquely identify by id rather than type */
    id: string,
    type: BandType,
    /** groupHeader/groupFooter only: the name of the group it belongs to (reference to ReportGroup.name) */
    groupName?: string,
    height: number,
    startNewPage: boolean,
    splitType: 'Stretch' | 'Prevent' | 'Immediate',
    elements: TemplateElement[],
    printWhenExpression: string,
    enabled: boolean
}

/** Per-band element assignment produced by the PDF import dialog */
export type PdfImportBandContent = {
    type: BandType,
    height: number,
    elements: TemplateElement[]
}

/** Canonical top-to-bottom band order used when inserting a new band */
const BAND_INSERT_ORDER: BandType[] = [
    'background', 'draft', 'title', 'pageHeader', 'columnHeader', 'groupHeader',
    'detail', 'groupFooter', 'columnFooter', 'pageFooter', 'lastPageFooter', 'summary', 'noData',
]

export function insertBandInOrder(bands: Band[], band: Band): Band[] {
    const order = BAND_INSERT_ORDER.indexOf(band.type)
    for (let i = 0; i < bands.length; i++) {
        if (BAND_INSERT_ORDER.indexOf(bands[i]!.type) > order) {
            return [...bands.slice(0, i), band, ...bands.slice(i)]
        }
    }
    return [...bands, band]
}

// =====================================
// Group (control break)
// =====================================
export type ReportGroup = {
    name: string,
    expression: string,
    startNewPage: boolean,
    startNewColumn: boolean,
    reprintHeaderOnEachPage: boolean,
    resetPageNumber: boolean,
    keepTogether: boolean,
    minHeightToStartNewPage: number,
    footerPosition: 'normal' | 'stackAtBottom' | 'forceAtBottom' | 'collateAtBottom'
}

// =====================================
// Page settings
// =====================================
export type PageSettings = {
    size: string,
    width: number,
    height: number,
    marginTop: number,
    marginBottom: number,
    marginLeft: number,
    marginRight: number,
    orientation: 'portrait' | 'landscape',
    columnCount: number,
    columnWidth: number,
    columnSpacing: number,
    columnPrintOrder: 'vertical' | 'horizontal',
    transparencyGroup?: PageTransparencyGroupDef
}

// =====================================
// Template
// =====================================
export type ReportTemplate = {
    name: string,
    pageSettings: PageSettings,
    bands: Band[],
    groups: ReportGroup[],
    titleNewPage: boolean,
    summaryNewPage: boolean,
    summaryWithPageHeaderAndFooter: boolean,
    testDataPath: string
}

const INITIALLY_DISABLED_BAND_TYPES: BandType[] = ['background', 'lastPageFooter', 'noData']

function createAvailableBand(type: BandType, id: string, height: number): Band {
    return {
        id,
        type,
        height,
        startNewPage: false,
        splitType: 'Stretch',
        elements: [],
        printWhenExpression: '',
        enabled: false,
    }
}

function addMissingInitiallyDisabledBands(
    bands: Band[],
    pageSettings: PageSettings,
    usedIds: Set<string>,
): Band[] {
    let result = bands
    for (let i = 0; i < INITIALLY_DISABLED_BAND_TYPES.length; i++) {
        const type = INITIALLY_DISABLED_BAND_TYPES[i]!
        let exists = false
        for (let bandIndex = 0; bandIndex < result.length; bandIndex++) {
            if (result[bandIndex]!.type === type) {
                exists = true
                break
            }
        }
        if (exists) continue

        let id = 'band_' + type
        while (usedIds.has(id)) id += '_'
        usedIds.add(id)

        let height = 125
        if (type === 'background') {
            height = pageSettings.height - pageSettings.marginTop - pageSettings.marginBottom
        } else if (type === 'lastPageFooter') {
            height = 54
        }
        result = insertBandInOrder(result, createAvailableBand(type, id, height))
    }
    return result
}

// =====================================
// Action types
// =====================================
export type ActionType =
    //=============================================================================
    { type: 'SELECT_ELEMENT', payload: { elementId: string, bandId: string } } |
    { type: 'SELECT_BAND', payload: { bandId: string } } |
    { type: 'DESELECT_ALL' } |
    { type: 'TOGGLE_ELEMENT_SELECTION', payload: { elementId: string, bandId: string } } |
    { type: 'SELECT_ELEMENTS', payload: { elementIds: string[], bandId: string } } |
    //=============================================================================
    { type: 'SET_ACTIVE_TOOL', payload: { tool: ToolType } } |
    //=============================================================================
    { type: 'ADD_ELEMENT', payload: { bandId: string, element: TemplateElement } } |
    { type: 'UPDATE_ELEMENT', payload: { elementId: string, bandId: string, props: Partial<TemplateElement> } } |
    { type: 'UPDATE_ELEMENT_STYLE', payload: { elementId: string, bandId: string, style: Partial<ElementStyle> } } |
    { type: 'DELETE_ELEMENT', payload: { elementId: string, bandId: string } } |
    { type: 'DELETE_ELEMENTS', payload: { elementIds: string[], bandId: string } } |
    { type: 'MOVE_ELEMENT', payload: { elementId: string, bandId: string, x: number, y: number } } |
    { type: 'MOVE_ELEMENTS', payload: { deltas: Array<{ elementId: string, bandId: string, x: number, y: number }> } } |
    { type: 'RESIZE_ELEMENT', payload: { elementId: string, bandId: string, x: number, y: number, width: number, height: number } } |
    { type: 'UPDATE_PATH_GEOMETRY', payload: { elementId: string, bandId: string, pathSubpaths: PathSubpath[], x?: number, y?: number, width?: number, height?: number } } |
    { type: 'UNLOCK_PDF_SOURCE_ELEMENTS', payload: { elementIds: string[], bandId: string } } |
    { type: 'REPARENT_ELEMENT', payload: { elementId: string, bandId: string, targetParentId: string, x: number, y: number, index?: number } } |
    { type: 'MOVE_ELEMENT_TO_BAND', payload: { elementId: string, sourceBandId: string, targetBandId: string, x: number, y: number } } |
    { type: 'ADD_ELEMENT_TO_PARENT', payload: { bandId: string, parentId: string, element: TemplateElement } } |
    //=============================================================================
    { type: 'UPDATE_BAND_HEIGHT', payload: { bandId: string, height: number } } |
    { type: 'UPDATE_BAND_START_NEW_PAGE', payload: { bandId: string, startNewPage: boolean } } |
    { type: 'UPDATE_BAND_SPLIT_TYPE', payload: { bandId: string, splitType: Band['splitType'] } } |
    { type: 'UPDATE_BAND_PRINT_WHEN_EXPRESSION', payload: { bandId: string, printWhenExpression: string } } |
    { type: 'TOGGLE_BAND_ENABLED', payload: { bandId: string } } |
    //=============================================================================
    { type: 'BEGIN_TEXT_INPUT' } |
    { type: 'END_TEXT_INPUT' } |
    //=============================================================================
    { type: 'ADD_BAND', payload: { band: Band } } |
    { type: 'REMOVE_BAND', payload: { bandId: string } } |
    //=============================================================================
    { type: 'ADD_GROUP', payload: { group: ReportGroup } } |
    { type: 'UPDATE_GROUP', payload: { name: string, props: Partial<ReportGroup> } } |
    { type: 'REMOVE_GROUP', payload: { name: string } } |
    //=============================================================================
    { type: 'SET_ZOOM', payload: { zoom: number } } |
    //=============================================================================
    { type: 'TOGGLE_PROPERTY_PANEL' } |
    { type: 'TOGGLE_LAYER_PANEL' } |
    { type: 'TOGGLE_GRID' } |
    { type: 'SET_GRID_SIZE', payload: { sizePt: number } } |
    //=============================================================================
    { type: 'UPDATE_PAGE_SETTINGS', payload: { settings: Partial<PageSettings> } } |
    { type: 'APPLY_PDF_IMPORT', payload: { pageSettings: PageSettings, bands: PdfImportBandContent[], disabledBandTypes: BandType[], nextElementIdCounter: number } } |
    { type: 'APPLY_IMAGE_SLICE', payload: { bandId: string, elementId: string, pieces: TemplateElement[], nextElementIdCounter: number } } |
    //=============================================================================
    { type: 'UPDATE_REPORT_SETTINGS', payload: { settings: Partial<Pick<ReportTemplate, 'name' | 'titleNewPage' | 'summaryNewPage' | 'summaryWithPageHeaderAndFooter' | 'testDataPath'>> } } |
    //=============================================================================
    { type: 'LOAD_TEMPLATE', payload: { template: ReportTemplate } } |
    //=============================================================================
    { type: 'SET_DISPLAY_UNIT', payload: { unit: DisplayUnit } } |
    { type: 'SET_DEFAULT_COLOR_MODE', payload: { mode: 'rgb' | 'cmyk' } } |
    //=============================================================================
    { type: 'START_EDITING', payload: { elementId: string } } |
    { type: 'STOP_EDITING', payload: { text: string } } |
    //=============================================================================
    { type: 'PASTE_ELEMENTS', payload: { bandId: string, elements: TemplateElement[] } } |
    //=============================================================================
    { type: 'SET_TABLE_SELECTION', payload: { selection: TableSelection | null } } |
    { type: 'SET_PATH_EDIT', payload: { editing: PathEditing | null } } |
    //=============================================================================
    { type: 'UNDO' } |
    { type: 'REDO' } |
    { type: 'COMMIT_HISTORY' }
    //=============================================================================

// =====================================
// Editor state
// =====================================
export type State = {
    // Template
    template: ReportTemplate,

    // Selection (supports multi-select)
    selectedElementIds: string[],
    selectedBandId: string | null,

    // Inline editing
    editingElementId: string | null,

    // Viewport
    zoom: number,

    // Tool
    activeTool: ToolType,

    // UI panels
    isPropertyPanelVisible: boolean,
    isLayerPanelVisible: boolean,

    // Grid
    isGridEnabled: boolean,
    // Grid/snap spacing in pt (canonical). Shown and edited in the display unit.
    gridSizePt: number,

    // Counter for element ID numbering
    elementIdCounter: number,

    // Display unit
    displayUnit: DisplayUnit,
    /** Account-level default color mode: new elements get their colors in this form */
    defaultColorMode: 'rgb' | 'cmyk',

    // Table-internal selection
    tableSelection: TableSelection | null,

    // Path-internal selection
    pathEditing: PathEditing | null,

    // Undo/redo history
    history: { past: ReportTemplate[], future: ReportTemplate[], baseSnapshot: ReportTemplate | null, textInputActive: boolean }
}

export type TableSectionKey = 'header' | 'detail' | 'footer'

export type TableSelection =
    | { type: 'cell', section: TableSectionKey, row: number, col: number }
    | { type: 'row', section: TableSectionKey, row: number }
    | { type: 'column', col: number }

export type PathEditing = {
    elementId: string,
    bandId: string,
    anchor: { subpathIndex: number, anchorIndex: number, handle: 'point' | 'in' | 'out' } | null
}

// =====================================
// Default style
// =====================================
export function createDefaultStyle(): ElementStyle {
    return {
        fontFamily: DEFAULT_FONT_ID,
        fontSize: 10,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        forecolor: '#000000',
        backcolor: '#FFFFFF',
        mode: 'transparent',
        hAlign: 'left',
        vAlign: 'top',
        rotation: 0,
        border: {
            top: null,
            bottom: null,
            left: null,
            right: null
        },
        padding: {
            top: 0,
            bottom: 0,
            left: 2,
            right: 2
        },
        opacity: 1.0
    }
}

export function createDefaultTableCellStyle(): TableCellStyle {
    return {
        hAlign: 'left',
        vAlign: 'middle',
        rotation: 0,
        backcolor: '#FFFFFF',
        forecolor: '#000000',
        fontFamily: DEFAULT_FONT_ID,
        fontSize: 10,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        lineSpacingType: 'single',
        lineSpacingValue: 0,
        letterSpacing: 0,
        wordSpacing: 0,
        firstLineIndent: 0,
        leftIndent: 0,
        rightIndent: 0,
        wrap: true,
        shrinkToFit: false,
        minFontSize: 4,
        fitWidth: false,
        outlineText: false,
        padding: 2,
        border: {
            top: null,
            bottom: { width: 0.5, color: '#000000', style: 'solid' },
            left: null,
            right: { width: 0.5, color: '#000000', style: 'solid' },
        },
        opacity: 1,
    }
}

export function createDefaultTableCell(expression: string = ''): TableCell {
    return {
        expression,
        colSpan: 1,
        rowSpan: 1,
        style: createDefaultTableCellStyle(),
        children: [],
    }
}

export function createDefaultTableRow(cells: TableCell[], height: number): TableRow {
    return {
        height,
        cells,
    }
}

// =====================================
// Page size constants
// =====================================
export const PAGE_SIZES: Record<string, { width: number, height: number }> = {
    A0: { width: 2384, height: 3370 },
    A1: { width: 1684, height: 2384 },
    A2: { width: 1191, height: 1684 },
    A3: { width: 842, height: 1191 },
    A4: { width: 595, height: 842 },
    A5: { width: 420, height: 595 },
    A6: { width: 298, height: 420 },
    B4: { width: 729, height: 1032 },
    B5: { width: 516, height: 729 },
    Letter: { width: 612, height: 792 },
    Legal: { width: 612, height: 1008 },
    Tabloid: { width: 792, height: 1224 },
}

// =====================================
// Default element creation
// =====================================
/**
 * Converts the color fields of a newly created element (and its children)
 * to the account's default color mode. Only #hex values convert — print
 * colors, '' (no stroke) and 'transparent' stay untouched. Paste/duplicate
 * flows do not pass through here, so existing artwork keeps its colors.
 */
export function applyDefaultColorMode(element: TemplateElement, mode: 'rgb' | 'cmyk'): TemplateElement {
    if (mode === 'rgb') return element
    const conv = function (color: string): string {
        return color.startsWith('#') ? convertColorToMode(color, 'cmyk') : color
    }
    const convStops = function <T extends { color: string }>(stops: T[]): T[] {
        return stops.map(function (stop) { return { ...stop, color: conv(stop.color) } })
    }
    const convBorderSide = function <T extends { color: string } | null>(side: T): T {
        return side === null ? side : { ...side, color: conv(side.color) }
    }
    return {
        ...element,
        style: {
            ...element.style,
            forecolor: conv(element.style.forecolor),
            backcolor: conv(element.style.backcolor),
            border: {
                top: convBorderSide(element.style.border.top),
                bottom: convBorderSide(element.style.border.bottom),
                left: convBorderSide(element.style.border.left),
                right: convBorderSide(element.style.border.right),
            },
        },
        lineColor: conv(element.lineColor),
        shapeFillColor: conv(element.shapeFillColor),
        shapeGradient: { ...element.shapeGradient, stops: convStops(element.shapeGradient.stops) },
        stroke: conv(element.stroke),
        pathFillColor: conv(element.pathFillColor),
        pathGradient: { ...element.pathGradient, stops: convStops(element.pathGradient.stops) },
        mathColor: conv(element.mathColor),
        crosstabBorderColor: conv(element.crosstabBorderColor),
        tableColumns: element.tableColumns.map(function (column) {
            return { ...column, style: { ...column.style, forecolor: conv(column.style.forecolor), backcolor: conv(column.style.backcolor) } }
        }),
        children: element.children.map(function (child) { return applyDefaultColorMode(child, mode) }),
    }
}

export function createDefaultElement(
    id: string, kind: ElementKind, x: number, y: number, width: number, height: number
): TemplateElement {
    const base: TemplateElement = {
        id, kind, x, y, width, height,
        text: '',
        expression: '',
        style: createDefaultStyle(),

        // Common to all elements
        styleName: '',
        positionType: 'fixRelativeToTop',
        stretchType: 'noStretch',
        printWhenExpression: '',
        isRemoveLineWhenBlank: false,
        isPrintRepeatedValues: true,

        // Common to text elements
        markup: 'none',
        direction: 'ltr',
        writingMode: 'horizontal-tb',
        lineSpacingType: 'single',
        lineSpacingValue: 0,
        letterSpacing: 0,
        wordSpacing: 0,
        horizontalScale: 1,
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
        hyperlinkType: '',
        hyperlinkTarget: '',
        hyperlinkRemoteDocument: '',
        outlineText: false,
        pdfTextMode: 'embedded',
        frameClipPathD: '',
        frameClipPathRule: 'nonzero',
        importedPdfRenderState: null,
        pdfSourceLocked: false,

        // textField specific
        pattern: '',
        blankWhenNull: false,
        stretchWithOverflow: false,
        evaluationTime: 'now',
        evaluationGroup: '',
        textTruncate: 'none',

        // line specific
        lineWidth: 1,
        lineStyle: 'solid',
        lineColor: '#000000',

        // rectangle specific
        radius: 0,
        topLeftRadius: 0,
        topRightRadius: 0,
        bottomRightRadius: 0,
        bottomLeftRadius: 0,
        fill: '',
        shapeFillType: 'none',
        shapeComplexFill: null,
        shapeFillColor: '#FFFFFF',
        shapeGradient: {
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 0,
            cx: 0.5,
            cy: 0.5,
            r: 0.5,
            stops: [
                { offset: 0, color: '#FFFFFF' },
                { offset: 1, color: '#000000' },
            ],
        },
        stroke: '#000000',
        strokeWidth: 1,
        pathSubpaths: createRectanglePath(width, height),
        pathFillType: 'solid',
        pathComplexFill: null,
        pathFillColor: '#FFFFFF',
        pathFillOpacity: 1,
        pathGradient: {
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 0,
            cx: 0.5,
            cy: 0.5,
            r: 0.5,
            stops: [
                { offset: 0, color: '#FFFFFF' },
                { offset: 1, color: '#000000' },
            ],
        },
        pathStrokeOpacity: 1,
        pathStrokeDash: [],
        pathStrokeCap: 'butt',
        pathStrokeJoin: 'miter',

        // image specific
        source: '',
        sourceExpression: '',
        scaleMode: 'retainShape',
        imageHAlign: 'center',
        imageVAlign: 'middle',
        onError: 'error',
        lazy: false,
        lockAspectRatio: false,

        // svg specific
        svgContent: '',

        // barcode specific
        barcodeType: 'qr',
        showText: true,
        errorCorrectionLevel: 'M',

        // math specific
        formula: '',
        mathFontFamily: MATH_FONT_ID,
        mathFontSize: 10,
        mathColor: '#000000',

        // formField specific
        formFieldType: 'text',
        formFieldName: '',
        formFieldValue: '',
        formFieldChecked: '',
        formFieldExportValue: '',
        formFieldOptions: [],
        formFieldEditable: false,
        formFieldMultiSelect: false,
        formFieldCaption: '',
        formFieldAction: '',
        formFieldMultiline: false,
        formFieldReadOnly: false,
        formFieldRequired: false,
        formFieldMaxLength: 0,
        formFieldBorderColor: '#999999',
        formFieldBackgroundColor: '',

        // break specific
        breakType: 'page',

        // subreport specific
        templateExpression: '',
        dataSourceExpression: '',

        // table specific
        tableColumns: [],

        // table child element specific
        tableSection: '',
        tableCellStyle: createDefaultTableCellStyle(),
        colSpan: 1,
        rowSpan: 1,

        // crosstab specific
        crosstabRowGroups: [],
        crosstabColumnGroups: [],
        crosstabMeasures: [],
        rowHeaderWidth: 80,
        columnHeaderHeight: 20,
        cellWidth: 60,
        cellHeight: 20,
        crosstabBorderColor: '#000000',
        crosstabBorderWidth: 1,
        showSubtotals: false,
        showGrandTotal: false,
        crosstabDataSourceExpression: '',

        // Parent fit
        fitParentHorizontal: false,
        fitParentVertical: false,

        // Container
        children: [],
    }

    // Override default values based on kind
    switch (kind) {
        case 'staticText':
            base.text = 'Static Text'
            break
        case 'textField':
            base.expression = ''
            break
        case 'barcode':
            base.expression = ''
            break
        case 'image':
            base.lockAspectRatio = true
            break
        case 'path':
            base.fill = ''
            base.stroke = '#000000'
            base.pathFillColor = '#FFFFFF'
            break
        case 'math':
            base.formula = 'x^2 + y^2'
            break
        case 'formField':
            base.formFieldName = 'field1'
            break
        case 'table':
            base.children = buildDefaultTableChildren(id)
            // Table outer border on all four sides; cells only bottom+right so borders don't overlap
            base.style.border = {
                top: { width: 0.5, color: '#000000', style: 'solid' },
                bottom: { width: 0.5, color: '#000000', style: 'solid' },
                left: { width: 0.5, color: '#000000', style: 'solid' },
                right: { width: 0.5, color: '#000000', style: 'solid' },
            }
            break
    }

    return base
}

function buildDefaultTableChildren(tableId: string): TemplateElement[] {
    // Header row: has Column elements
    const hCol1 = createDefaultElement(tableId + '_hc0_0', 'tableColumn', 0, 0, 0, 0)
    hCol1.expression = '"Column 1"'
    const hCol2 = createDefaultElement(tableId + '_hc0_1', 'tableColumn', 0, 0, 0, 0)
    hCol2.expression = '"Column 2"'
    const headerRow = createDefaultElement(tableId + '_hr0', 'tableRow', 0, 0, 0, 20)
    headerRow.children = [hCol1, hCol2]

    // Column Frame: column definitions + header row
    const columnFrame = createDefaultElement(tableId + '_cf', 'tableColumnFrame', 0, 0, 0, 0)
    // Column style uses default font/color (borders are held per cell)
    const defaultColumnStyle = createDefaultTableCellStyle()
    defaultColumnStyle.border = { top: null, bottom: null, left: null, right: null }
    const defaultColumnStyle2 = createDefaultTableCellStyle()
    defaultColumnStyle2.border = { top: null, bottom: null, left: null, right: null }
    columnFrame.tableColumns = [
        { width: 80, style: defaultColumnStyle },
        { width: 80, style: defaultColumnStyle2 },
    ]
    columnFrame.children = [headerRow]

    // Detail row: has Cell elements
    const dCell1 = createDefaultElement(tableId + '_dc0_0', 'tableCell', 0, 0, 0, 0)
    dCell1.expression = '"Cell 1"'
    const dCell2 = createDefaultElement(tableId + '_dc0_1', 'tableCell', 0, 0, 0, 0)
    dCell2.expression = '"Cell 2"'
    const detailRow = createDefaultElement(tableId + '_dr0', 'tableRow', 0, 0, 0, 18)
    detailRow.children = [dCell1, dCell2]

    // Row Frame (detail)
    const detailFrame = createDefaultElement(tableId + '_df', 'tableRowFrame', 0, 0, 0, 0)
    detailFrame.tableSection = 'detail'
    detailFrame.children = [detailRow]

    // Row Frame (footer)
    const footerFrame = createDefaultElement(tableId + '_ff', 'tableRowFrame', 0, 0, 0, 0)
    footerFrame.tableSection = 'footer'

    return [columnFrame, detailFrame, footerFrame]
}

// =====================================
// Template normalization (fills in default values when loading JSON)
// =====================================

/** Reference default style values (used to fill in missing properties) */
const DEFAULT_STYLE = createDefaultStyle()
const DEFAULT_TABLE_CELL_STYLE = createDefaultTableCellStyle()

/** Reference default element values (used to fill in missing properties) */
const DEFAULT_ELEMENT = createDefaultElement('_', 'staticText', 0, 0, 0, 0)

function hasAnyBorder(border: Border): boolean {
    return border.top !== null || border.bottom !== null || border.left !== null || border.right !== null
}

function emptyBorder(): Border {
    return { top: null, bottom: null, left: null, right: null }
}

function defaultTableBorderSide(): BorderSide {
    return { width: 0.5, color: '#000000', style: 'solid' }
}

function normalizeBorderSide(raw: unknown): BorderSide | null {
    if (raw === null || raw === undefined) return null
    const obj = raw as Record<string, unknown>
    if (typeof obj.width !== 'number' || typeof obj.color !== 'string') return null
    return { width: obj.width, color: obj.color, style: typeof obj.style === 'string' ? obj.style as BorderSide['style'] : 'solid' }
}

function normalizeStyle(raw: Record<string, unknown>): ElementStyle {
    const d = DEFAULT_STYLE
    const border = raw.border as Record<string, unknown> | undefined
    const padding = raw.padding as Record<string, unknown> | undefined
    return {
        fontFamily: typeof raw.fontFamily === 'string' ? raw.fontFamily : d.fontFamily,
        fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : d.fontSize,
        bold: typeof raw.bold === 'boolean' ? raw.bold : d.bold,
        italic: typeof raw.italic === 'boolean' ? raw.italic : d.italic,
        underline: typeof raw.underline === 'boolean' ? raw.underline : d.underline,
        strikethrough: typeof raw.strikethrough === 'boolean' ? raw.strikethrough : d.strikethrough,
        forecolor: typeof raw.forecolor === 'string' ? raw.forecolor : d.forecolor,
        backcolor: typeof raw.backcolor === 'string' ? raw.backcolor : d.backcolor,
        mode: raw.mode === 'opaque' ? 'opaque' : raw.mode === 'transparent' ? 'transparent' : d.mode,
        hAlign: typeof raw.hAlign === 'string' ? raw.hAlign as ElementStyle['hAlign'] : d.hAlign,
        vAlign: typeof raw.vAlign === 'string' ? raw.vAlign as ElementStyle['vAlign'] : d.vAlign,
        rotation: typeof raw.rotation === 'number' ? raw.rotation as ElementStyle['rotation'] : d.rotation,
        border: border !== undefined && border !== null ? {
            top: border.top as ElementStyle['border']['top'],
            bottom: border.bottom as ElementStyle['border']['bottom'],
            left: border.left as ElementStyle['border']['left'],
            right: border.right as ElementStyle['border']['right'],
        } : { top: null, bottom: null, left: null, right: null },
        padding: padding !== undefined && padding !== null ? {
            top: typeof padding.top === 'number' ? padding.top : d.padding.top,
            bottom: typeof padding.bottom === 'number' ? padding.bottom : d.padding.bottom,
            left: typeof padding.left === 'number' ? padding.left : d.padding.left,
            right: typeof padding.right === 'number' ? padding.right : d.padding.right,
        } : { top: d.padding.top, bottom: d.padding.bottom, left: d.padding.left, right: d.padding.right },
        opacity: typeof raw.opacity === 'number' ? raw.opacity : d.opacity,
    }
}

function normalizeTableCellStyle(raw: Record<string, unknown> | undefined): TableCellStyle {
    const border = raw?.border as Record<string, unknown> | undefined
    // lineSpacing supports both the editor internal form and the core form.
    const lineSpacingObj = raw?.lineSpacing as { type?: string; value?: number } | undefined
    let lineSpacingType = DEFAULT_TABLE_CELL_STYLE.lineSpacingType as TableCellStyle['lineSpacingType']
    let lineSpacingValue = DEFAULT_TABLE_CELL_STYLE.lineSpacingValue
    if (typeof raw?.lineSpacingType === 'string') {
        lineSpacingType = raw.lineSpacingType as TableCellStyle['lineSpacingType']
        lineSpacingValue = typeof raw?.lineSpacingValue === 'number' ? raw.lineSpacingValue : 0
    } else if (lineSpacingObj && typeof lineSpacingObj.type === 'string') {
        lineSpacingType = lineSpacingObj.type as TableCellStyle['lineSpacingType']
        lineSpacingValue = typeof lineSpacingObj.value === 'number' ? lineSpacingObj.value : 0
    }
    return {
        hAlign: typeof raw?.hAlign === 'string' ? raw.hAlign as TableCellStyle['hAlign'] : DEFAULT_TABLE_CELL_STYLE.hAlign,
        vAlign: typeof raw?.vAlign === 'string' ? raw.vAlign as TableCellStyle['vAlign'] : DEFAULT_TABLE_CELL_STYLE.vAlign,
        rotation: typeof raw?.rotation === 'number' ? raw.rotation as TableCellStyle['rotation'] : DEFAULT_TABLE_CELL_STYLE.rotation,
        backcolor: typeof raw?.backcolor === 'string' ? raw.backcolor : DEFAULT_TABLE_CELL_STYLE.backcolor,
        forecolor: typeof raw?.forecolor === 'string' ? raw.forecolor : DEFAULT_TABLE_CELL_STYLE.forecolor,
        fontFamily: typeof raw?.fontFamily === 'string' ? raw.fontFamily : typeof raw?.fontId === 'string' ? raw.fontId as string : DEFAULT_TABLE_CELL_STYLE.fontFamily,
        fontSize: typeof raw?.fontSize === 'number' ? raw.fontSize : DEFAULT_TABLE_CELL_STYLE.fontSize,
        bold: typeof raw?.bold === 'boolean' ? raw.bold : DEFAULT_TABLE_CELL_STYLE.bold,
        italic: typeof raw?.italic === 'boolean' ? raw.italic : DEFAULT_TABLE_CELL_STYLE.italic,
        underline: typeof raw?.underline === 'boolean' ? raw.underline : DEFAULT_TABLE_CELL_STYLE.underline,
        strikethrough: typeof raw?.strikethrough === 'boolean' ? raw.strikethrough : DEFAULT_TABLE_CELL_STYLE.strikethrough,
        lineSpacingType,
        lineSpacingValue,
        letterSpacing: typeof raw?.letterSpacing === 'number' ? raw.letterSpacing : DEFAULT_TABLE_CELL_STYLE.letterSpacing,
        wordSpacing: typeof raw?.wordSpacing === 'number' ? raw.wordSpacing : DEFAULT_TABLE_CELL_STYLE.wordSpacing,
        firstLineIndent: typeof raw?.firstLineIndent === 'number' ? raw.firstLineIndent : DEFAULT_TABLE_CELL_STYLE.firstLineIndent,
        leftIndent: typeof raw?.leftIndent === 'number' ? raw.leftIndent : DEFAULT_TABLE_CELL_STYLE.leftIndent,
        rightIndent: typeof raw?.rightIndent === 'number' ? raw.rightIndent : DEFAULT_TABLE_CELL_STYLE.rightIndent,
        wrap: typeof raw?.wrap === 'boolean' ? raw.wrap : DEFAULT_TABLE_CELL_STYLE.wrap,
        shrinkToFit: typeof raw?.shrinkToFit === 'boolean' ? raw.shrinkToFit : DEFAULT_TABLE_CELL_STYLE.shrinkToFit,
        minFontSize: typeof raw?.minFontSize === 'number' ? raw.minFontSize : DEFAULT_TABLE_CELL_STYLE.minFontSize,
        fitWidth: typeof raw?.fitWidth === 'boolean' ? raw.fitWidth : DEFAULT_TABLE_CELL_STYLE.fitWidth,
        outlineText: typeof raw?.outlineText === 'boolean' ? raw.outlineText : DEFAULT_TABLE_CELL_STYLE.outlineText,
        padding: typeof raw?.padding === 'number' ? raw.padding : DEFAULT_TABLE_CELL_STYLE.padding,
        border: border !== undefined && border !== null ? {
            top: normalizeBorderSide(border.top) ?? defaultTableBorderSide(),
            bottom: normalizeBorderSide(border.bottom) ?? defaultTableBorderSide(),
            left: normalizeBorderSide(border.left) ?? defaultTableBorderSide(),
            right: normalizeBorderSide(border.right) ?? defaultTableBorderSide(),
        } : {
            top: defaultTableBorderSide(),
            bottom: defaultTableBorderSide(),
            left: defaultTableBorderSide(),
            right: defaultTableBorderSide(),
        },
        opacity: typeof raw?.opacity === 'number' ? raw.opacity : DEFAULT_TABLE_CELL_STYLE.opacity,
    }
}

function normalizeTableCell(raw: Record<string, unknown>): TableCell {
    // Migrate the old text+expression form by converting text to a quoted expression when present.
    let expression = ''
    if (typeof raw.expression === 'string' && raw.expression !== '') {
        expression = raw.expression
    } else if (typeof raw.text === 'string' && raw.text !== '') {
        expression = '"' + raw.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
    }
    return {
        expression,
        colSpan: typeof raw.colSpan === 'number' && raw.colSpan > 0 ? raw.colSpan : 1,
        rowSpan: typeof raw.rowSpan === 'number' && raw.rowSpan > 0 ? raw.rowSpan : 1,
        style: normalizeTableCellStyle(raw.style as Record<string, unknown> | undefined),
        children: Array.isArray(raw.children) ? (raw.children as Record<string, unknown>[]).map(normalizeElement) : [],
    }
}

function normalizeTableRow(raw: Record<string, unknown>): TableRow {
    const cells = Array.isArray(raw.cells)
        ? (raw.cells as Record<string, unknown>[]).map(normalizeTableCell)
        : []
    return {
        height: typeof raw.height === 'number' ? raw.height : 18,
        cells,
    }
}

function normalizeTableColumn(raw: Record<string, unknown>): TableColumn {
    return {
        width: typeof raw.width === 'number' ? raw.width : 80,
        style: normalizeTableCellStyle(raw.style as Record<string, unknown> | undefined),
    }
}

function normalizeCrosstabGroup(raw: Record<string, unknown>): CrosstabGroup {
    return {
        field: typeof raw.field === 'string' ? raw.field : '',
    }
}

function normalizeCrosstabMeasure(raw: Record<string, unknown>): CrosstabMeasure {
    return {
        field: typeof raw.field === 'string' ? raw.field : '',
        calculation: typeof raw.calculation === 'string' ? raw.calculation as CrosstabMeasure['calculation'] : 'sum',
        format: typeof raw.format === 'string' ? raw.format : '',
    }
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number'
}

function normalizePathSubpaths(value: unknown, defaultValue: PathSubpath[]): PathSubpath[] {
    if (!Array.isArray(value)) return defaultValue
    const subpaths: PathSubpath[] = []
    for (let si = 0; si < value.length; si++) {
        const rawSubpath = value[si]
        if (rawSubpath === null || typeof rawSubpath !== 'object') continue
        const subpathRecord = rawSubpath as Record<string, unknown>
        const rawAnchors = subpathRecord.anchors
        if (!Array.isArray(rawAnchors)) continue
        const anchors: PathSubpath['anchors'] = []
        for (let ai = 0; ai < rawAnchors.length; ai++) {
            const rawAnchor = rawAnchors[ai]
            if (rawAnchor === null || typeof rawAnchor !== 'object') continue
            const a = rawAnchor as Record<string, unknown>
            if (!isNumber(a.x) || !isNumber(a.y)) continue
            anchors.push({
                x: a.x,
                y: a.y,
                inX: isNumber(a.inX) ? a.inX : a.x,
                inY: isNumber(a.inY) ? a.inY : a.y,
                outX: isNumber(a.outX) ? a.outX : a.x,
                outY: isNumber(a.outY) ? a.outY : a.y,
                handleMode: a.handleMode === 'symmetric' ? 'symmetric' : 'independent',
            })
        }
        if (anchors.length > 0) subpaths.push({ anchors, closed: subpathRecord.closed === true })
    }
    return subpaths.length > 0 ? subpaths : defaultValue
}

function normalizePathGradient(value: Record<string, unknown> | undefined, defaultValue: TemplateElement['pathGradient']): TemplateElement['pathGradient'] {
    if (value === undefined) return defaultValue
    const rawStops = value.stops
    const stops = Array.isArray(rawStops)
        ? rawStops.map(function (stop) {
            const s = stop as Record<string, unknown>
            return {
                offset: typeof s.offset === 'number' ? s.offset : 0,
                color: typeof s.color === 'string' ? s.color : '#000000',
                opacity: typeof s.opacity === 'number' ? s.opacity : undefined,
            }
        })
        : defaultValue.stops
    return {
        x1: typeof value.x1 === 'number' ? value.x1 : defaultValue.x1,
        y1: typeof value.y1 === 'number' ? value.y1 : defaultValue.y1,
        x2: typeof value.x2 === 'number' ? value.x2 : defaultValue.x2,
        y2: typeof value.y2 === 'number' ? value.y2 : defaultValue.y2,
        cx: typeof value.cx === 'number' ? value.cx : defaultValue.cx,
        cy: typeof value.cy === 'number' ? value.cy : defaultValue.cy,
        r: typeof value.r === 'number' ? value.r : defaultValue.r,
        stops,
        pdfShading: normalizePdfShading(value.pdfShading),
    }
}

function normalizeShapeGradient(value: Record<string, unknown> | undefined, defaultValue: TemplateElement['shapeGradient']): TemplateElement['shapeGradient'] {
    if (value === undefined) return defaultValue
    const rawStops = value.stops
    const stops = Array.isArray(rawStops)
        ? rawStops.map(function (stop) {
            const s = stop as Record<string, unknown>
            return {
                offset: typeof s.offset === 'number' ? s.offset : 0,
                color: typeof s.color === 'string' ? s.color : '#000000',
                opacity: typeof s.opacity === 'number' ? s.opacity : undefined,
            }
        })
        : defaultValue.stops
    return {
        x1: typeof value.x1 === 'number' ? value.x1 : defaultValue.x1,
        y1: typeof value.y1 === 'number' ? value.y1 : defaultValue.y1,
        x2: typeof value.x2 === 'number' ? value.x2 : defaultValue.x2,
        y2: typeof value.y2 === 'number' ? value.y2 : defaultValue.y2,
        cx: typeof value.cx === 'number' ? value.cx : defaultValue.cx,
        cy: typeof value.cy === 'number' ? value.cy : defaultValue.cy,
        r: typeof value.r === 'number' ? value.r : defaultValue.r,
        stops,
        pdfShading: normalizePdfShading(value.pdfShading),
    }
}

function normalizePdfShading(value: unknown): PdfAxialRadialShadingDef | undefined {
    if (value === undefined) return undefined
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('PDFグラデーション保持情報の形式が不正です')
    }
    return value as PdfAxialRadialShadingDef
}

function scalePathSubpaths(subpaths: PathSubpath[], oldWidth: number, oldHeight: number, newWidth: number, newHeight: number): PathSubpath[] {
    const sx = oldWidth === 0 ? 1 : newWidth / oldWidth
    const sy = oldHeight === 0 ? 1 : newHeight / oldHeight
    return subpaths.map(function (subpath) {
        return {
            closed: subpath.closed,
            anchors: subpath.anchors.map(function (a) {
                return {
                    x: a.x * sx,
                    y: a.y * sy,
                    inX: a.inX * sx,
                    inY: a.inY * sy,
                    outX: a.outX * sx,
                    outY: a.outY * sy,
                    handleMode: a.handleMode,
                }
            }),
        }
    })
}

function normalizeElement(raw: Record<string, unknown>): TemplateElement {
    const d = DEFAULT_ELEMENT
    const kind = typeof raw.kind === 'string' ? raw.kind as ElementKind : d.kind
    const style = raw.style !== undefined && raw.style !== null && typeof raw.style === 'object'
        ? normalizeStyle(raw.style as Record<string, unknown>)
        : createDefaultStyle()
    const normalizedStyle = (kind === 'line' || kind === 'rectangle' || kind === 'ellipse' || kind === 'path') && hasAnyBorder(style.border)
        ? { ...style, border: emptyBorder() }
        : style

    const children = Array.isArray(raw.children)
        ? (raw.children as Record<string, unknown>[]).map(normalizeElement)
        : []
    const rawRadius = typeof raw.radius === 'number' ? raw.radius : d.radius
    const topLeftRadius = typeof raw.topLeftRadius === 'number' ? raw.topLeftRadius : rawRadius
    const topRightRadius = typeof raw.topRightRadius === 'number' ? raw.topRightRadius : rawRadius
    const bottomRightRadius = typeof raw.bottomRightRadius === 'number' ? raw.bottomRightRadius : rawRadius
    const bottomLeftRadius = typeof raw.bottomLeftRadius === 'number' ? raw.bottomLeftRadius : rawRadius
    const radius = topLeftRadius === topRightRadius
        && topLeftRadius === bottomRightRadius
        && topLeftRadius === bottomLeftRadius
        ? topLeftRadius
        : 0
    const rawFill = typeof raw.fill === 'string' ? raw.fill : ''
    const shapeFillType = typeof raw.shapeFillType === 'string'
        ? raw.shapeFillType as TemplateElement['shapeFillType']
        : (rawFill !== '' ? 'solid' : d.shapeFillType)
    const shapeFillColor = typeof raw.shapeFillColor === 'string'
        ? raw.shapeFillColor
        : (rawFill !== '' ? rawFill : d.shapeFillColor)

    const element: TemplateElement = {
        id: typeof raw.id === 'string' ? raw.id : '',
        kind,
        x: typeof raw.x === 'number' ? raw.x : d.x,
        y: typeof raw.y === 'number' ? raw.y : d.y,
        width: typeof raw.width === 'number' ? raw.width : d.width,
        height: typeof raw.height === 'number' ? raw.height : d.height,
        text: typeof raw.text === 'string' ? raw.text : d.text,
        expression: typeof raw.expression === 'string' ? raw.expression : d.expression,
        style: normalizedStyle,
        styleName: typeof raw.styleName === 'string' ? raw.styleName : d.styleName,
        positionType: typeof raw.positionType === 'string' ? raw.positionType as TemplateElement['positionType'] : d.positionType,
        stretchType: typeof raw.stretchType === 'string' ? raw.stretchType as TemplateElement['stretchType'] : d.stretchType,
        printWhenExpression: typeof raw.printWhenExpression === 'string' ? raw.printWhenExpression : d.printWhenExpression,
        isRemoveLineWhenBlank: typeof raw.isRemoveLineWhenBlank === 'boolean' ? raw.isRemoveLineWhenBlank : d.isRemoveLineWhenBlank,
        isPrintRepeatedValues: typeof raw.isPrintRepeatedValues === 'boolean' ? raw.isPrintRepeatedValues : d.isPrintRepeatedValues,
        markup: typeof raw.markup === 'string' ? raw.markup as TemplateElement['markup'] : d.markup,
        direction: typeof raw.direction === 'string' ? raw.direction as TemplateElement['direction'] : d.direction,
        writingMode: typeof raw.writingMode === 'string' ? raw.writingMode as TemplateElement['writingMode'] : d.writingMode,
        lineSpacingType: typeof raw.lineSpacingType === 'string' ? raw.lineSpacingType as TemplateElement['lineSpacingType'] : d.lineSpacingType,
        lineSpacingValue: typeof raw.lineSpacingValue === 'number' ? raw.lineSpacingValue : d.lineSpacingValue,
        letterSpacing: typeof raw.letterSpacing === 'number' ? raw.letterSpacing : d.letterSpacing,
        wordSpacing: typeof raw.wordSpacing === 'number' ? raw.wordSpacing : d.wordSpacing,
        horizontalScale: typeof raw.horizontalScale === 'number' ? raw.horizontalScale : d.horizontalScale,
        firstLineIndent: typeof raw.firstLineIndent === 'number' ? raw.firstLineIndent : d.firstLineIndent,
        leftIndent: typeof raw.leftIndent === 'number' ? raw.leftIndent : d.leftIndent,
        rightIndent: typeof raw.rightIndent === 'number' ? raw.rightIndent : d.rightIndent,
        tabStopWidth: typeof raw.tabStopWidth === 'number' ? raw.tabStopWidth : d.tabStopWidth,
        wrap: typeof raw.wrap === 'boolean' ? raw.wrap : d.wrap,
        shrinkToFit: typeof raw.shrinkToFit === 'boolean' ? raw.shrinkToFit : d.shrinkToFit,
        minFontSize: typeof raw.minFontSize === 'number' ? raw.minFontSize : d.minFontSize,
        fitWidth: typeof raw.fitWidth === 'boolean' ? raw.fitWidth : d.fitWidth,
        anchorName: typeof raw.anchorName === 'string' ? raw.anchorName : d.anchorName,
        bookmarkLevel: typeof raw.bookmarkLevel === 'number' ? raw.bookmarkLevel : d.bookmarkLevel,
        hyperlinkType: typeof raw.hyperlinkType === 'string' ? raw.hyperlinkType as TemplateElement['hyperlinkType'] : d.hyperlinkType,
        hyperlinkTarget: typeof raw.hyperlinkTarget === 'string' ? raw.hyperlinkTarget : d.hyperlinkTarget,
        hyperlinkRemoteDocument: typeof raw.hyperlinkRemoteDocument === 'string' ? raw.hyperlinkRemoteDocument : d.hyperlinkRemoteDocument,
        outlineText: false,
        pdfTextMode: raw.pdfTextMode === 'outline' || raw.pdfTextMode === 'system' || raw.pdfTextMode === 'embedded'
            ? raw.pdfTextMode
            : raw.outlineText === true ? 'outline' : d.pdfTextMode,
        frameClipPathD: typeof raw.frameClipPathD === 'string' ? raw.frameClipPathD : d.frameClipPathD,
        frameClipPathRule: raw.frameClipPathRule === 'evenodd' ? 'evenodd' : d.frameClipPathRule,
        importedPdfRenderState: raw.importedPdfRenderState !== undefined && raw.importedPdfRenderState !== null
            ? raw.importedPdfRenderState as ImportedPdfRenderState
            : null,
        pdfSourceLocked: typeof raw.pdfSourceLocked === 'boolean' ? raw.pdfSourceLocked : d.pdfSourceLocked,
        pattern: typeof raw.pattern === 'string' ? raw.pattern : d.pattern,
        blankWhenNull: typeof raw.blankWhenNull === 'boolean' ? raw.blankWhenNull : d.blankWhenNull,
        stretchWithOverflow: typeof raw.stretchWithOverflow === 'boolean' ? raw.stretchWithOverflow : d.stretchWithOverflow,
        evaluationTime: typeof raw.evaluationTime === 'string' ? raw.evaluationTime as TemplateElement['evaluationTime'] : d.evaluationTime,
        evaluationGroup: typeof raw.evaluationGroup === 'string' ? raw.evaluationGroup : d.evaluationGroup,
        textTruncate: typeof raw.textTruncate === 'string' ? raw.textTruncate as TemplateElement['textTruncate'] : d.textTruncate,
        lineWidth: typeof raw.lineWidth === 'number' ? raw.lineWidth : d.lineWidth,
        lineStyle: typeof raw.lineStyle === 'string' ? raw.lineStyle as TemplateElement['lineStyle'] : d.lineStyle,
        lineColor: typeof raw.lineColor === 'string' ? raw.lineColor : d.lineColor,
        radius,
        topLeftRadius,
        topRightRadius,
        bottomRightRadius,
        bottomLeftRadius,
        fill: rawFill !== '' ? rawFill : d.fill,
        shapeFillType,
        shapeComplexFill: raw.shapeComplexFill !== undefined && raw.shapeComplexFill !== null
            ? raw.shapeComplexFill as TemplateElement['shapeComplexFill']
            : null,
        shapeFillColor,
        shapeGradient: normalizeShapeGradient(raw.shapeGradient as Record<string, unknown> | undefined, d.shapeGradient),
        stroke: typeof raw.stroke === 'string' ? raw.stroke : d.stroke,
        strokeWidth: typeof raw.strokeWidth === 'number' ? raw.strokeWidth : d.strokeWidth,
        pathSubpaths: normalizePathSubpaths(raw.pathSubpaths, d.pathSubpaths),
        pathFillType: typeof raw.pathFillType === 'string' ? raw.pathFillType as TemplateElement['pathFillType'] : d.pathFillType,
        pathComplexFill: raw.pathComplexFill !== undefined && raw.pathComplexFill !== null ? raw.pathComplexFill as TemplateElement['pathComplexFill'] : null,
        pathFillColor: typeof raw.pathFillColor === 'string' ? raw.pathFillColor : d.pathFillColor,
        pathFillOpacity: typeof raw.pathFillOpacity === 'number' ? raw.pathFillOpacity : d.pathFillOpacity,
        pathGradient: normalizePathGradient(raw.pathGradient as Record<string, unknown> | undefined, d.pathGradient),
        pathStrokeOpacity: typeof raw.pathStrokeOpacity === 'number' ? raw.pathStrokeOpacity : d.pathStrokeOpacity,
        pathStrokeDash: Array.isArray(raw.pathStrokeDash) ? (raw.pathStrokeDash as unknown[]).filter(isNumber) : d.pathStrokeDash,
        pathStrokeCap: typeof raw.pathStrokeCap === 'string' ? raw.pathStrokeCap as TemplateElement['pathStrokeCap'] : d.pathStrokeCap,
        pathStrokeJoin: typeof raw.pathStrokeJoin === 'string' ? raw.pathStrokeJoin as TemplateElement['pathStrokeJoin'] : d.pathStrokeJoin,
        source: typeof raw.source === 'string' ? raw.source : d.source,
        sourceExpression: typeof raw.sourceExpression === 'string' ? raw.sourceExpression : d.sourceExpression,
        scaleMode: typeof raw.scaleMode === 'string' ? raw.scaleMode as TemplateElement['scaleMode'] : d.scaleMode,
        imageHAlign: typeof raw.imageHAlign === 'string' ? raw.imageHAlign as TemplateElement['imageHAlign'] : d.imageHAlign,
        imageVAlign: typeof raw.imageVAlign === 'string' ? raw.imageVAlign as TemplateElement['imageVAlign'] : d.imageVAlign,
        onError: typeof raw.onError === 'string' ? raw.onError as TemplateElement['onError'] : d.onError,
        lazy: typeof raw.lazy === 'boolean' ? raw.lazy : d.lazy,
        lockAspectRatio: typeof raw.lockAspectRatio === 'boolean' ? raw.lockAspectRatio : d.lockAspectRatio,
        svgContent: typeof raw.svgContent === 'string' ? raw.svgContent : d.svgContent,
        barcodeType: typeof raw.barcodeType === 'string' ? raw.barcodeType : d.barcodeType,
        showText: typeof raw.showText === 'boolean' ? raw.showText : d.showText,
        errorCorrectionLevel: typeof raw.errorCorrectionLevel === 'string' ? raw.errorCorrectionLevel as TemplateElement['errorCorrectionLevel'] : d.errorCorrectionLevel,
        formula: typeof raw.formula === 'string' ? raw.formula : d.formula,
        mathFontFamily: typeof raw.mathFontFamily === 'string' ? raw.mathFontFamily : d.mathFontFamily,
        mathFontSize: typeof raw.mathFontSize === 'number' ? raw.mathFontSize : d.mathFontSize,
        mathColor: typeof raw.mathColor === 'string' ? raw.mathColor : d.mathColor,
        formFieldType: (['text', 'checkbox', 'radio', 'pushbutton', 'dropdown', 'listbox', 'signature'] as const).includes(raw.formFieldType as never) ? raw.formFieldType as TemplateElement['formFieldType'] : d.formFieldType,
        formFieldName: typeof raw.formFieldName === 'string' ? raw.formFieldName : d.formFieldName,
        formFieldValue: typeof raw.formFieldValue === 'string' ? raw.formFieldValue : d.formFieldValue,
        formFieldChecked: typeof raw.formFieldChecked === 'string' ? raw.formFieldChecked : d.formFieldChecked,
        formFieldExportValue: typeof raw.formFieldExportValue === 'string' ? raw.formFieldExportValue : d.formFieldExportValue,
        formFieldOptions: Array.isArray(raw.formFieldOptions)
            ? raw.formFieldOptions.filter((o: unknown): o is { value: string, label: string } =>
                typeof o === 'object' && o !== null && typeof (o as { value?: unknown }).value === 'string')
                .map((o) => ({ value: o.value, label: typeof o.label === 'string' ? o.label : o.value }))
            : d.formFieldOptions,
        formFieldEditable: typeof raw.formFieldEditable === 'boolean' ? raw.formFieldEditable : d.formFieldEditable,
        formFieldMultiSelect: typeof raw.formFieldMultiSelect === 'boolean' ? raw.formFieldMultiSelect : d.formFieldMultiSelect,
        formFieldCaption: typeof raw.formFieldCaption === 'string' ? raw.formFieldCaption : d.formFieldCaption,
        formFieldAction: typeof raw.formFieldAction === 'string' ? raw.formFieldAction : d.formFieldAction,
        formFieldMultiline: typeof raw.formFieldMultiline === 'boolean' ? raw.formFieldMultiline : d.formFieldMultiline,
        formFieldReadOnly: typeof raw.formFieldReadOnly === 'boolean' ? raw.formFieldReadOnly : d.formFieldReadOnly,
        formFieldRequired: typeof raw.formFieldRequired === 'boolean' ? raw.formFieldRequired : d.formFieldRequired,
        formFieldMaxLength: typeof raw.formFieldMaxLength === 'number' ? raw.formFieldMaxLength : d.formFieldMaxLength,
        formFieldBorderColor: typeof raw.formFieldBorderColor === 'string' ? raw.formFieldBorderColor : d.formFieldBorderColor,
        formFieldBackgroundColor: typeof raw.formFieldBackgroundColor === 'string' ? raw.formFieldBackgroundColor : d.formFieldBackgroundColor,
        breakType: typeof raw.breakType === 'string' ? raw.breakType as TemplateElement['breakType'] : d.breakType,
        templateExpression: typeof raw.templateExpression === 'string' ? raw.templateExpression : d.templateExpression,
        dataSourceExpression: typeof raw.dataSourceExpression === 'string' ? raw.dataSourceExpression : d.dataSourceExpression,
        tableColumns: Array.isArray(raw.tableColumns)
            ? (raw.tableColumns as Record<string, unknown>[]).map(normalizeTableColumn)
            : d.tableColumns,
        tableSection: typeof raw.tableSection === 'string' ? raw.tableSection as TableSectionKey : '',
        tableCellStyle: normalizeTableCellStyle(raw.tableCellStyle as Record<string, unknown> | undefined),
        colSpan: typeof raw.colSpan === 'number' && raw.colSpan > 0 ? raw.colSpan : 1,
        rowSpan: typeof raw.rowSpan === 'number' && raw.rowSpan > 0 ? raw.rowSpan : 1,
        crosstabRowGroups: Array.isArray(raw.crosstabRowGroups)
            ? (raw.crosstabRowGroups as Record<string, unknown>[]).map(normalizeCrosstabGroup)
            : d.crosstabRowGroups,
        crosstabColumnGroups: Array.isArray(raw.crosstabColumnGroups)
            ? (raw.crosstabColumnGroups as Record<string, unknown>[]).map(normalizeCrosstabGroup)
            : d.crosstabColumnGroups,
        crosstabMeasures: Array.isArray(raw.crosstabMeasures)
            ? (raw.crosstabMeasures as Record<string, unknown>[]).map(normalizeCrosstabMeasure)
            : d.crosstabMeasures,
        rowHeaderWidth: typeof raw.rowHeaderWidth === 'number' ? raw.rowHeaderWidth : d.rowHeaderWidth,
        columnHeaderHeight: typeof raw.columnHeaderHeight === 'number' ? raw.columnHeaderHeight : d.columnHeaderHeight,
        cellWidth: typeof raw.cellWidth === 'number' ? raw.cellWidth : d.cellWidth,
        cellHeight: typeof raw.cellHeight === 'number' ? raw.cellHeight : d.cellHeight,
        crosstabBorderColor: typeof raw.crosstabBorderColor === 'string' ? raw.crosstabBorderColor : d.crosstabBorderColor,
        crosstabBorderWidth: typeof raw.crosstabBorderWidth === 'number' ? raw.crosstabBorderWidth : d.crosstabBorderWidth,
        showSubtotals: typeof raw.showSubtotals === 'boolean' ? raw.showSubtotals : d.showSubtotals,
        showGrandTotal: typeof raw.showGrandTotal === 'boolean' ? raw.showGrandTotal : d.showGrandTotal,
        crosstabDataSourceExpression: typeof raw.crosstabDataSourceExpression === 'string' ? raw.crosstabDataSourceExpression : d.crosstabDataSourceExpression,
        fitParentHorizontal: typeof raw.fitParentHorizontal === 'boolean' ? raw.fitParentHorizontal : d.fitParentHorizontal,
        fitParentVertical: typeof raw.fitParentVertical === 'boolean' ? raw.fitParentVertical : d.fitParentVertical,
        children,
    }

    // Migrate old flat table properties to the new children tree format.
    if (kind === 'table' && element.children.length === 0) {
        const oldHeaderRows = Array.isArray(raw.tableHeaderRows)
            ? (raw.tableHeaderRows as Record<string, unknown>[]).map(normalizeTableRow)
            : []
        const oldDetailRows = Array.isArray(raw.tableDetailRows)
            ? (raw.tableDetailRows as Record<string, unknown>[]).map(normalizeTableRow)
            : []
        const oldFooterRows = Array.isArray(raw.tableFooterRows)
            ? (raw.tableFooterRows as Record<string, unknown>[]).map(normalizeTableRow)
            : []
        element.children = migrateTableToChildren(element.id, element.tableColumns, oldHeaderRows, oldDetailRows, oldFooterRows)
        element.tableColumns = [] // Column definitions have moved to the column frame.
    }

    return element
}

/** Converts the old table format to a children tree. */
function migrateTableToChildren(
    tableId: string, columns: TableColumn[], headerRows: TableRow[], detailRows: TableRow[], footerRows: TableRow[]
): TemplateElement[] {
    const columnFrame = createDefaultElement(tableId + '_cf', 'tableColumnFrame', 0, 0, 0, 0)
    columnFrame.tableColumns = columns
    columnFrame.children = headerRows.map(function (row, ri) {
        const rowEl = createDefaultElement(tableId + '_hr' + ri, 'tableRow', 0, 0, 0, row.height)
        rowEl.children = row.cells.map(function (cell, ci) {
            const colEl = createDefaultElement(tableId + '_hc' + ri + '_' + ci, 'tableColumn', 0, 0, 0, 0)
            colEl.expression = cell.expression
            colEl.colSpan = cell.colSpan
            colEl.rowSpan = cell.rowSpan
            colEl.tableCellStyle = cell.style
            return colEl
        })
        return rowEl
    })

    function buildRowFrame(section: TableSectionKey, rows: TableRow[], prefix: string): TemplateElement {
        const frame = createDefaultElement(tableId + '_' + prefix + 'f', 'tableRowFrame', 0, 0, 0, 0)
        frame.tableSection = section
        frame.children = rows.map(function (row, ri) {
            const rowEl = createDefaultElement(tableId + '_' + prefix + 'r' + ri, 'tableRow', 0, 0, 0, row.height)
            rowEl.children = row.cells.map(function (cell, ci) {
                const cellEl = createDefaultElement(tableId + '_' + prefix + 'c' + ri + '_' + ci, 'tableCell', 0, 0, 0, 0)
                cellEl.expression = cell.expression
                cellEl.colSpan = cell.colSpan
                cellEl.rowSpan = cell.rowSpan
                cellEl.tableCellStyle = cell.style
                return cellEl
            })
            return rowEl
        })
        return frame
    }

    return [columnFrame, buildRowFrame('detail', detailRows, 'd'), buildRowFrame('footer', footerRows, 'ft')]
}

function normalizeBand(raw: Record<string, unknown>, index: number, usedIds: Set<string>): Band {
    const elements = Array.isArray(raw.elements)
        ? (raw.elements as Record<string, unknown>[]).map(normalizeElement)
        : []
    let id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : 'band_' + index
    while (usedIds.has(id)) id = id + '_'
    usedIds.add(id)
    return {
        id,
        type: typeof raw.type === 'string' ? raw.type as BandType : 'detail',
        groupName: typeof raw.groupName === 'string' && raw.groupName !== '' ? raw.groupName : undefined,
        height: typeof raw.height === 'number' ? raw.height : 0,
        startNewPage: typeof raw.startNewPage === 'boolean' ? raw.startNewPage : false,
        splitType: typeof raw.splitType === 'string' ? raw.splitType as Band['splitType'] : 'Stretch',
        elements,
        printWhenExpression: typeof raw.printWhenExpression === 'string' ? raw.printWhenExpression : '',
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    }
}

function assignUniqueElementIds(bands: Band[]): Band[] {
    const reservedIds = new Set<string>()

    function reserveExistingIds(elements: TemplateElement[]): void {
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i]!
            if (element.id.trim() !== '') reservedIds.add(element.id)
            reserveExistingIds(element.children)
        }
    }

    for (let i = 0; i < bands.length; i++) reserveExistingIds(bands[i]!.elements)

    const assignedIds = new Set<string>()
    let nextGeneratedId = 1

    function allocateId(): string {
        let id = `el_${nextGeneratedId++}`
        while (reservedIds.has(id) || assignedIds.has(id)) id = `el_${nextGeneratedId++}`
        return id
    }

    function assignElements(elements: TemplateElement[]): TemplateElement[] {
        return elements.map(function (element) {
            const keepExisting = element.id.trim() !== '' && !assignedIds.has(element.id)
            const id = keepExisting ? element.id : allocateId()
            assignedIds.add(id)
            const children = assignElements(element.children)
            return { ...element, id, children }
        })
    }

    return bands.map(function (band) {
        return { ...band, elements: assignElements(band.elements) }
    })
}

function normalizeGroup(raw: Record<string, unknown>, index: number): ReportGroup {
    return {
        name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : 'Group' + (index + 1),
        expression: typeof raw.expression === 'string' ? raw.expression : '',
        startNewPage: typeof raw.startNewPage === 'boolean' ? raw.startNewPage : false,
        startNewColumn: typeof raw.startNewColumn === 'boolean' ? raw.startNewColumn : false,
        reprintHeaderOnEachPage: typeof raw.reprintHeaderOnEachPage === 'boolean' ? raw.reprintHeaderOnEachPage : false,
        resetPageNumber: typeof raw.resetPageNumber === 'boolean' ? raw.resetPageNumber : false,
        keepTogether: typeof raw.keepTogether === 'boolean' ? raw.keepTogether : false,
        minHeightToStartNewPage: typeof raw.minHeightToStartNewPage === 'number' ? raw.minHeightToStartNewPage : 0,
        footerPosition: typeof raw.footerPosition === 'string' ? raw.footerPosition as ReportGroup['footerPosition'] : 'normal',
    }
}

/**
 * Reconcile groupHeader/groupFooter bands with group definitions.
 * Create and attach a group for group bands without groupName for old-format compatibility.
 * Create a missing group when a band references a non-existent group name.
 */
function reconcileGroups(bands: Band[], groups: ReportGroup[]): { bands: Band[], groups: ReportGroup[] } {
    const groupByName = new Map<string, ReportGroup>()
    for (let i = 0; i < groups.length; i++) groupByName.set(groups[i].name, groups[i])

    const resultGroups = groups.slice()
    let defaultGroupName: string | undefined
    const resultBands = bands.map(function (band) {
        if (band.type !== 'groupHeader' && band.type !== 'groupFooter') return band
        if (band.groupName !== undefined) {
            if (!groupByName.has(band.groupName)) {
                const created: ReportGroup = {
                    name: band.groupName,
                    expression: '',
                    startNewPage: false,
                    startNewColumn: false,
                    reprintHeaderOnEachPage: false,
                    resetPageNumber: false,
                    keepTogether: false,
                    minHeightToStartNewPage: 0,
                    footerPosition: 'normal',
                }
                groupByName.set(created.name, created)
                resultGroups.push(created)
            }
            return band
        }
        // Missing groupName in the old format; attach to the default group.
        if (defaultGroupName === undefined) {
            let n = 1
            while (groupByName.has('Group' + n)) n++
            defaultGroupName = 'Group' + n
            const created: ReportGroup = {
                name: defaultGroupName,
                expression: '',
                startNewPage: false,
                startNewColumn: false,
                reprintHeaderOnEachPage: false,
                resetPageNumber: false,
                keepTogether: false,
                minHeightToStartNewPage: 0,
                footerPosition: 'normal',
            }
            groupByName.set(created.name, created)
            resultGroups.push(created)
        }
        return { ...band, groupName: defaultGroupName }
    })
    return { bands: resultBands, groups: resultGroups }
}

function hasExplicitBandStartNewPage(rawBands: Record<string, unknown>[], bandType: BandType): boolean {
    for (let i = 0; i < rawBands.length; i++) {
        const rawBand = rawBands[i]
        if (rawBand.type !== bandType) continue
        return typeof rawBand.startNewPage === 'boolean'
    }
    return false
}

function syncLegacyReportFlags(template: ReportTemplate): ReportTemplate {
    const titleBand = template.bands.find(function (band) { return band.type === 'title' })
    const summaryBand = template.bands.find(function (band) { return band.type === 'summary' })
    return {
        ...template,
        titleNewPage: titleBand?.startNewPage ?? false,
        summaryNewPage: summaryBand?.startNewPage ?? false,
    }
}

/**
 * Fill all template properties with default values when loading external JSON.
 * This allows safe loading even when AI analysis or manual editing omitted properties.
 */
export function normalizeTemplate(raw: ReportTemplate): ReportTemplate {
    const ps = raw.pageSettings ?? {} as Record<string, unknown>
    const rawBands = Array.isArray(raw.bands)
        ? raw.bands as unknown as Record<string, unknown>[]
        : []
    const usedIds = new Set<string>()
    const normalizedBands = rawBands.map(function (rawBand, i) { return normalizeBand(rawBand, i, usedIds) })
    const bands = assignUniqueElementIds(normalizedBands)
    const rawGroups = Array.isArray(raw.groups)
        ? raw.groups as unknown as Record<string, unknown>[]
        : []
    const normalizedGroups = rawGroups.map(normalizeGroup)
    const pageSettings: PageSettings = {
        size: ps.size ?? 'A4',
        width: ps.width ?? 595,
        height: ps.height ?? 842,
        marginTop: ps.marginTop ?? 20,
        marginBottom: ps.marginBottom ?? 20,
        marginLeft: ps.marginLeft ?? 20,
        marginRight: ps.marginRight ?? 20,
        orientation: ps.orientation ?? 'portrait',
        columnCount: ps.columnCount ?? 1,
        columnWidth: ps.columnWidth ?? 0,
        columnSpacing: ps.columnSpacing ?? 0,
        columnPrintOrder: ps.columnPrintOrder ?? 'vertical',
        transparencyGroup: ps.transparencyGroup as PageTransparencyGroupDef | undefined,
    }
    const availableBands = addMissingInitiallyDisabledBands(bands, pageSettings, usedIds)
    const startNewPageAdjusted = availableBands.map(function (band) {
        if (band.type === 'title' && !hasExplicitBandStartNewPage(rawBands, 'title') && raw.titleNewPage === true) {
            return { ...band, startNewPage: true }
        }
        if (band.type === 'summary' && !hasExplicitBandStartNewPage(rawBands, 'summary') && raw.summaryNewPage === true) {
            return { ...band, startNewPage: true }
        }
        return band
    })
    const reconciled = reconcileGroups(startNewPageAdjusted, normalizedGroups)
    return syncLegacyReportFlags({
        ...raw,
        pageSettings,
        titleNewPage: raw.titleNewPage ?? false,
        summaryNewPage: raw.summaryNewPage ?? false,
        summaryWithPageHeaderAndFooter: raw.summaryWithPageHeaderAndFooter ?? false,
        testDataPath: raw.testDataPath ?? '',
        bands: reconciled.bands,
        groups: reconciled.groups,
    })
}

// =====================================
// Default A4 template.
// =====================================
export function createDefaultTemplate(): ReportTemplate {
    const pageSettings: PageSettings = {
        size: 'A4',
        // A4 in points; 1 pt = 1/72 inch.
        width: 595,
        height: 842,
        marginTop: 20,
        marginBottom: 20,
        marginLeft: 20,
        marginRight: 20,
        orientation: 'portrait',
        columnCount: 1,
        columnWidth: 555,
        columnSpacing: 0,
        columnPrintOrder: 'vertical'
    }
    const bands: Band[] = [
        { id: 'band_title', type: 'title', height: 79, startNewPage: false, splitType: 'Stretch', elements: [], printWhenExpression: '', enabled: true },
        { id: 'band_pageHeader', type: 'pageHeader', height: 35, startNewPage: false, splitType: 'Stretch', elements: [], printWhenExpression: '', enabled: true },
        { id: 'band_columnHeader', type: 'columnHeader', height: 61, startNewPage: false, splitType: 'Stretch', elements: [], printWhenExpression: '', enabled: true },
        { id: 'band_detail', type: 'detail', height: 125, startNewPage: false, splitType: 'Stretch', elements: [], printWhenExpression: '', enabled: true },
        { id: 'band_columnFooter', type: 'columnFooter', height: 45, startNewPage: false, splitType: 'Stretch', elements: [], printWhenExpression: '', enabled: true },
        { id: 'band_pageFooter', type: 'pageFooter', height: 54, startNewPage: false, splitType: 'Stretch', elements: [], printWhenExpression: '', enabled: true },
        { id: 'band_summary', type: 'summary', height: 42, startNewPage: false, splitType: 'Stretch', elements: [], printWhenExpression: '', enabled: true },
    ]
    const usedIds = new Set<string>()
    for (let i = 0; i < bands.length; i++) usedIds.add(bands[i]!.id)
    return {
        name: '新規帳票',
        pageSettings,
        titleNewPage: false,
        summaryNewPage: false,
        summaryWithPageHeaderAndFooter: false,
        testDataPath: '',
        bands: addMissingInitiallyDisabledBands(bands, pageSettings, usedIds),
        groups: []
    }
}

// =====================================
// Initial state.
// =====================================
export function defaultState(): State {
    return {
        template: createDefaultTemplate(),
        selectedElementIds: [],
        selectedBandId: null,
        editingElementId: null,
        zoom: 1.0,
        activeTool: 'select',
        isPropertyPanelVisible: true,
        isLayerPanelVisible: true,
        isGridEnabled: false,
        gridSizePt: UnitUtils.mmToPt(5),
        elementIdCounter: 1,
        displayUnit: 'mm',
        defaultColorMode: 'rgb',
        tableSelection: null,
        pathEditing: null,
        history: { past: [], future: [], baseSnapshot: null, textInputActive: false }
    }
}

// =====================================
// Band labels.
// =====================================
export function getBandLabel(bandType: BandType): string {
    switch (bandType) {
        case 'background': return 'Background'
        case 'draft': return 'Draft'
        case 'title': return 'Title'
        case 'pageHeader': return 'Page Header'
        case 'columnHeader': return 'Column Header'
        case 'groupHeader': return 'Group Header'
        case 'detail': return 'Detail'
        case 'groupFooter': return 'Group Footer'
        case 'columnFooter': return 'Column Footer'
        case 'pageFooter': return 'Page Footer'
        case 'lastPageFooter': return 'Last Page Footer'
        case 'summary': return 'Summary'
        case 'noData': return 'No Data'
    }
}

// =====================================
// Band display labels; group bands include the group name.
// =====================================
export function getBandDisplayLabel(band: Band): string {
    if ((band.type === 'groupHeader' || band.type === 'groupFooter') && band.groupName !== undefined) {
        return getBandLabel(band.type) + ' (' + band.groupName + ')'
    }
    return getBandLabel(band.type)
}

// =====================================
// Band colors.
// =====================================
export function getBandColor(bandType: BandType): string {
    switch (bandType) {
        case 'background': return '#E0E0E0'
        case 'draft': return '#E0CCF5'
        case 'title': return '#B3D9FF'
        case 'pageHeader': return '#B3FFB3'
        case 'columnHeader': return '#B3FFFF'
        case 'groupHeader': return '#FFD9B3'
        case 'detail': return '#FFFFB3'
        case 'groupFooter': return '#FFD9B3'
        case 'columnFooter': return '#B3FFFF'
        case 'pageFooter': return '#B3FFB3'
        case 'lastPageFooter': return '#8FD98F'
        case 'summary': return '#D9B3FF'
        case 'noData': return '#FFB3B3'
    }
}

// =====================================
// Element ID counter.
// =====================================

function collectMaxElementId(elements: TemplateElement[], current: number): number {
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id.startsWith('el_')) {
            const n = parseInt(el.id.substring(3), 10)
            if (n >= current) current = n + 1
        }
        current = collectMaxElementId(el.children, current)
    }
    return current
}

export function computeElementIdCounter(template: ReportTemplate): number {
    let counter = 1
    for (let i = 0; i < template.bands.length; i++) {
        counter = collectMaxElementId(template.bands[i].elements, counter)
    }
    return counter
}

// =====================================
// Tree operation helpers.
// =====================================

// Find an element by ID in a tree.
export function findElementInTree(elements: TemplateElement[], id: string): TemplateElement | undefined {
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === id) return el
        const found = findElementInTree(el.children, id)
        if (found !== undefined) return found
    }
    return undefined
}

// Update element properties in a tree while preserving reference equality.
export function updateElementInTree(
    elements: TemplateElement[], id: string, props: Partial<TemplateElement>
): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = new Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === id) {
            result[i] = { ...el, ...props }
            changed = true
        } else {
            const newChildren = updateElementInTree(el.children, id, props)
            if (newChildren !== el.children) {
                result[i] = { ...el, children: newChildren }
                changed = true
            } else {
                result[i] = el
            }
        }
    }
    return changed ? result : elements
}

// Update element style in a tree while preserving reference equality.
export function updateElementStyleInTree(
    elements: TemplateElement[], id: string, style: Partial<ElementStyle>
): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = new Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === id) {
            result[i] = { ...el, style: { ...el.style, ...style } }
            changed = true
        } else {
            const newChildren = updateElementStyleInTree(el.children, id, style)
            if (newChildren !== el.children) {
                result[i] = { ...el, children: newChildren }
                changed = true
            } else {
                result[i] = el
            }
        }
    }
    return changed ? result : elements
}

// Table internal elements cannot be deleted individually; delete the table instead.
const TABLE_INTERNAL_KINDS: Set<ElementKind> = new Set([
    'tableColumnFrame', 'tableColumn', 'tableRowFrame', 'tableRow', 'tableCell'
])

// Delete an element from the tree and promote children to the parent level with adjusted coordinates.
export function deleteElementFromTree(elements: TemplateElement[], id: string): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = []
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === id) {
            // Do not allow individual deletion of table internal elements.
            if (TABLE_INTERNAL_KINDS.has(el.kind)) {
                result.push(el)
                continue
            }
            // Promote children to the parent level with adjusted coordinates.
            for (let j = 0; j < el.children.length; j++) {
                const child = el.children[j]
                result.push({ ...child, x: child.x + el.x, y: child.y + el.y })
            }
            changed = true
        } else {
            const newChildren = deleteElementFromTree(el.children, id)
            if (newChildren !== el.children) {
                result.push({ ...el, children: newChildren })
                changed = true
            } else {
                result.push(el)
            }
        }
    }
    return changed ? result : elements
}

// Remove an element from the tree for reparenting while preserving children.
export function removeElementFromTree(
    elements: TemplateElement[], id: string
): [TemplateElement[], TemplateElement | undefined] {
    let removed: TemplateElement | undefined = undefined
    const result: TemplateElement[] = []
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === id) {
            removed = el
        } else {
            const [newChildren, found] = removeElementFromTree(el.children, id)
            if (found !== undefined) {
                removed = found
                result.push({ ...el, children: newChildren })
            } else {
                result.push(el)
            }
        }
    }
    return removed !== undefined ? [result, removed] : [elements, undefined]
}

// Add a child to the parent element.
export function addElementToParentInTree(
    elements: TemplateElement[], parentId: string, child: TemplateElement
): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = new Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === parentId) {
            result[i] = { ...el, children: [...el.children, child] }
            changed = true
        } else {
            const newChildren = addElementToParentInTree(el.children, parentId, child)
            if (newChildren !== el.children) {
                result[i] = { ...el, children: newChildren }
                changed = true
            } else {
                result[i] = el
            }
        }
    }
    return changed ? result : elements
}

// Insert a child at a specific parent children index recursively while preserving reference equality.
export function addElementToParentInTreeAt(
    elements: TemplateElement[], parentId: string, child: TemplateElement, index: number
): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = new Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === parentId) {
            const newChildren = el.children.slice()
            newChildren.splice(index, 0, child)
            result[i] = { ...el, children: newChildren }
            changed = true
        } else {
            const newChildren = addElementToParentInTreeAt(el.children, parentId, child, index)
            if (newChildren !== el.children) {
                result[i] = { ...el, children: newChildren }
                changed = true
            } else {
                result[i] = el
            }
        }
    }
    return changed ? result : elements
}

// Find the parent element.
export function findParentElement(
    elements: TemplateElement[], id: string
): TemplateElement | undefined {
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        for (let j = 0; j < el.children.length; j++) {
            if (el.children[j].id === id) return el
        }
        const found = findParentElement(el.children, id)
        if (found !== undefined) return found
    }
    return undefined
}

// Get the absolute element position by accumulating parent coordinates.
export function getElementAbsolutePosition(
    elements: TemplateElement[], id: string
): { x: number, y: number } | undefined {
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        if (el.id === id) return { x: el.x, y: el.y }
        const found = getElementAbsolutePosition(el.children, id)
        if (found !== undefined) return { x: el.x + found.x, y: el.y + found.y }
    }
    return undefined
}

// Find the deepest frame containing the specified rectangle.
export function findContainingFrame(
    elements: TemplateElement[],
    absX: number, absY: number, w: number, h: number,
    excludeId: string,
    offsetX: number, offsetY: number
): { frameId: string, relX: number, relY: number } | undefined {
    // Search backward to prefer higher Z-order elements.
    for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i]
        if (el.id === excludeId) continue
        if (el.kind !== 'frame') continue

        const frameAbsX = offsetX + el.x
        const frameAbsY = offsetY + el.y

        // Check whether the element is fully contained in the frame.
        if (absX >= frameAbsX && absY >= frameAbsY &&
            absX + w <= frameAbsX + el.width && absY + h <= frameAbsY + el.height) {
            // Search deeper frames.
            const deeper = findContainingFrame(
                el.children, absX, absY, w, h, excludeId, frameAbsX, frameAbsY
            )
            if (deeper !== undefined) return deeper
            return {
                frameId: el.id,
                relX: absX - frameAbsX,
                relY: absY - frameAbsY
            }
        }
    }
    return undefined
}

// =====================================
// Get the selected element for single selection only.
// =====================================
export function getSelectedElement(state: State): TemplateElement | undefined {
    if (state.selectedElementIds.length !== 1 || state.selectedBandId === null) return undefined
    const band = state.template.bands.find(b => b.id === state.selectedBandId)
    if (band === undefined) return undefined
    return findElementInTree(band.elements, state.selectedElementIds[0])
}

// =====================================
// Reducer.
// =====================================
export function hasLockedPdfSource(element: TemplateElement): boolean {
    if (element.pdfSourceLocked) return true
    for (let i = 0; i < element.children.length; i++) {
        if (hasLockedPdfSource(element.children[i]!)) return true
    }
    return false
}

function lockedElementInBand(state: State, bandId: string, elementId: string): boolean {
    const band = state.template.bands.find(function (candidate) { return candidate.id === bandId })
    if (band === undefined) return false
    const element = findElementInTree(band.elements, elementId)
    return element !== undefined && hasLockedPdfSource(element)
}

function actionMutatesLockedPdfSource(state: State, action: ActionType): boolean {
    switch (action.type) {
        case 'UPDATE_ELEMENT':
        case 'UPDATE_ELEMENT_STYLE':
        case 'UPDATE_PATH_GEOMETRY':
        case 'DELETE_ELEMENT':
        case 'MOVE_ELEMENT':
        case 'RESIZE_ELEMENT':
        case 'REPARENT_ELEMENT':
            return lockedElementInBand(state, action.payload.bandId, action.payload.elementId)
        case 'MOVE_ELEMENT_TO_BAND':
            return lockedElementInBand(state, action.payload.sourceBandId, action.payload.elementId)
        case 'DELETE_ELEMENTS':
            for (let i = 0; i < action.payload.elementIds.length; i++) {
                if (lockedElementInBand(state, action.payload.bandId, action.payload.elementIds[i]!)) return true
            }
            return false
        case 'MOVE_ELEMENTS':
            for (let i = 0; i < action.payload.deltas.length; i++) {
                const delta = action.payload.deltas[i]!
                if (lockedElementInBand(state, delta.bandId, delta.elementId)) return true
            }
            return false
        case 'APPLY_IMAGE_SLICE':
            return lockedElementInBand(state, action.payload.bandId, action.payload.elementId)
        case 'START_EDITING':
            return state.selectedBandId !== null && lockedElementInBand(state, state.selectedBandId, action.payload.elementId)
        case 'SET_PATH_EDIT':
            return action.payload.editing !== null
                && lockedElementInBand(state, action.payload.editing.bandId, action.payload.editing.elementId)
        default:
            return false
    }
}

function unlockPdfSourceTree(element: TemplateElement, selectedIds: ReadonlySet<string>, parentSelected: boolean): TemplateElement {
    const selected = parentSelected || selectedIds.has(element.id)
    let next = element
    if (selected && element.pdfSourceLocked) {
        let importedPdfRenderState = element.importedPdfRenderState
        let pathSubpaths = element.pathSubpaths
        const source = importedPdfRenderState?.path?.pdfSourceVector
        if (element.kind === 'path' && source !== undefined) {
            const materialized = materializePdfSourceVector(source)
            pathSubpaths = pathArraysToSubpaths(materialized.commands, materialized.coords)
            const { pdfSourceVector: _source, ...ordinaryPathState } = importedPdfRenderState!.path!
            importedPdfRenderState = { ...importedPdfRenderState!, path: ordinaryPathState }
        }
        next = { ...element, pdfSourceLocked: false, pathSubpaths, importedPdfRenderState }
    }
    if (element.children.length === 0) return next
    let childrenChanged = false
    const children = element.children.map(function (child) {
        const unlocked = unlockPdfSourceTree(child, selectedIds, selected)
        if (unlocked !== child) childrenChanged = true
        return unlocked
    })
    return childrenChanged ? { ...next, children } : next
}

export function reducer(state: State, action: ActionType): State {
    if (actionMutatesLockedPdfSource(state, action)) return state
    const next = reducerCore(state, action)
    if (next.template === state.template) return next

    // Apply parent fit settings: fitParentHorizontal and fitParentVertical.
    // For all changed template bands, make fit-enabled children follow the parent content area.
    let changed = false
    const bands = next.template.bands.map(function (band) {
        const fitted = applyParentFitToBandElements(band.elements)
        if (fitted === band.elements) return band
        changed = true
        return { ...band, elements: fitted }
    })
    if (!changed) return next
    return { ...next, template: { ...next.template, bands } }
}

function reducerCore(state: State, action: ActionType): State {
    switch (action.type) {
        //=============================================================================
        case 'SELECT_ELEMENT': return {
            ...state,
            selectedElementIds: [action.payload.elementId],
            selectedBandId: action.payload.bandId,
            tableSelection: null,
            pathEditing: null,
        }
        case 'SELECT_BAND': return {
            ...state,
            selectedElementIds: [],
            selectedBandId: action.payload.bandId,
            tableSelection: null,
            pathEditing: null,
        }
        case 'DESELECT_ALL': return {
            ...state,
            selectedElementIds: [],
            selectedBandId: null,
            tableSelection: null,
            pathEditing: null,
        }
        case 'TOGGLE_ELEMENT_SELECTION': {
            const { elementId, bandId } = action.payload
            // Switch selection instead of toggling elements from another band.
            if (state.selectedBandId !== null && state.selectedBandId !== bandId) {
                return { ...state, selectedElementIds: [elementId], selectedBandId: bandId, tableSelection: null, pathEditing: null }
            }
            const idx = state.selectedElementIds.indexOf(elementId)
            if (idx >= 0) {
                const next = state.selectedElementIds.filter((_, i) => i !== idx)
                return { ...state, selectedElementIds: next, selectedBandId: next.length > 0 ? bandId : null, tableSelection: null, pathEditing: null }
            }
            return { ...state, selectedElementIds: [...state.selectedElementIds, elementId], selectedBandId: bandId, tableSelection: null, pathEditing: null }
        }
        case 'SELECT_ELEMENTS': return {
            ...state,
            selectedElementIds: action.payload.elementIds,
            selectedBandId: action.payload.elementIds.length > 0 ? action.payload.bandId : state.selectedBandId,
            tableSelection: null,
            pathEditing: null,
        }
        //=============================================================================
        case 'SET_ACTIVE_TOOL': return {
            ...state,
            activeTool: action.payload.tool
        }
        //=============================================================================
        case 'ADD_ELEMENT': {
            const { bandId } = action.payload
            const element = applyDefaultColorMode(action.payload.element, state.defaultColorMode)
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(band => {
                        if (band.id !== bandId) return band
                        // Automatically make the element a child when it fits fully inside a frame.
                        const frame = findContainingFrame(
                            band.elements, element.x, element.y, element.width, element.height, '', 0, 0
                        )
                        if (frame !== undefined) {
                            const childElement = { ...element, x: frame.relX, y: frame.relY }
                            return { ...band, elements: addElementToParentInTree(band.elements, frame.frameId, childElement) }
                        }
                        return { ...band, elements: [...band.elements, element] }
                    })
                },
                selectedElementIds: [element.id],
                selectedBandId: bandId,
                activeTool: 'select',
                elementIdCounter: state.elementIdCounter + 1
            }
        }
        case 'UPDATE_ELEMENT': return {
            ...state,
            template: {
                ...state.template,
                bands: state.template.bands.map(band =>
                    band.id !== action.payload.bandId ? band : {
                        ...band,
                        elements: updateElementInTree(band.elements, action.payload.elementId, action.payload.props)
                    }
                )
            }
        }
        case 'UPDATE_ELEMENT_STYLE': return {
            ...state,
            template: {
                ...state.template,
                bands: state.template.bands.map(band =>
                    band.id !== action.payload.bandId ? band : {
                        ...band,
                        elements: updateElementStyleInTree(band.elements, action.payload.elementId, action.payload.style)
                    }
                )
            }
        }
        case 'UPDATE_PATH_GEOMETRY': {
            const props: Partial<TemplateElement> = { pathSubpaths: action.payload.pathSubpaths }
            if (action.payload.x !== undefined) props.x = action.payload.x
            if (action.payload.y !== undefined) props.y = action.payload.y
            if (action.payload.width !== undefined) props.width = action.payload.width
            if (action.payload.height !== undefined) props.height = action.payload.height
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(band =>
                        band.id !== action.payload.bandId ? band : {
                            ...band,
                            elements: updateElementInTree(band.elements, action.payload.elementId, props)
                        }
                    )
                }
            }
        }
        case 'UNLOCK_PDF_SOURCE_ELEMENTS': {
            const selectedIds = new Set(action.payload.elementIds)
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(function (band) {
                        if (band.id !== action.payload.bandId) return band
                        let changed = false
                        const elements = band.elements.map(function (element) {
                            const unlocked = unlockPdfSourceTree(element, selectedIds, false)
                            if (unlocked !== element) changed = true
                            return unlocked
                        })
                        return changed ? { ...band, elements } : band
                    }),
                },
                pathEditing: null,
            }
        }
        case 'DELETE_ELEMENT': return {
            ...state,
            template: {
                ...state.template,
                bands: state.template.bands.map(band =>
                    band.id !== action.payload.bandId ? band : {
                        ...band,
                        elements: deleteElementFromTree(band.elements, action.payload.elementId)
                    }
                )
            },
            selectedElementIds: [],
            selectedBandId: null,
            pathEditing: null
        }
        case 'DELETE_ELEMENTS': {
            const { elementIds, bandId } = action.payload
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(band => {
                        if (band.id !== bandId) return band
                        let elements = band.elements
                        for (let i = 0; i < elementIds.length; i++) {
                            elements = deleteElementFromTree(elements, elementIds[i])
                        }
                        return { ...band, elements }
                    })
                },
                selectedElementIds: [],
                selectedBandId: null,
                pathEditing: null
            }
        }
        case 'PASTE_ELEMENTS': {
            const { bandId, elements } = action.payload
            let counter = state.elementIdCounter
            function reassignIds(els: TemplateElement[]): TemplateElement[] {
                const result: TemplateElement[] = new Array(els.length)
                for (let i = 0; i < els.length; i++) {
                    const el = els[i]
                    result[i] = { ...el, id: `el_${counter}`, children: reassignIds(el.children) }
                    counter++
                }
                return result
            }
            const newElements = reassignIds(elements)
            const newIds = newElements.map(function (el) { return el.id })
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(function (band) {
                        if (band.id !== bandId) return band
                        return { ...band, elements: band.elements.concat(newElements) }
                    })
                },
                selectedElementIds: newIds,
                selectedBandId: bandId,
                elementIdCounter: counter
            }
        }
        case 'MOVE_ELEMENT': return {
            ...state,
            template: {
                ...state.template,
                bands: state.template.bands.map(band =>
                    band.id !== action.payload.bandId ? band : {
                        ...band,
                        elements: updateElementInTree(band.elements, action.payload.elementId, {
                            x: action.payload.x, y: action.payload.y
                        })
                    }
                )
            }
        }
        case 'RESIZE_ELEMENT': {
            const current = findElementInTree(
                state.template.bands.find(function (band) { return band.id === action.payload.bandId })?.elements ?? [],
                action.payload.elementId,
            )
            const scaledPath = current !== undefined && current.kind === 'path'
                ? scalePathSubpaths(current.pathSubpaths, current.width, current.height, action.payload.width, action.payload.height)
                : undefined
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(band =>
                        band.id !== action.payload.bandId ? band : {
                            ...band,
                            elements: updateElementInTree(band.elements, action.payload.elementId, {
                                x: action.payload.x, y: action.payload.y,
                                width: action.payload.width, height: action.payload.height,
                                ...(scaledPath !== undefined ? { pathSubpaths: scaledPath } : {}),
                            })
                        }
                    )
                }
            }
        }
        case 'MOVE_ELEMENTS': {
            const { deltas } = action.payload
            const bandUpdates = new Map<string, Array<{ elementId: string, x: number, y: number }>>()
            for (let i = 0; i < deltas.length; i++) {
                const d = deltas[i]
                let arr = bandUpdates.get(d.bandId)
                if (arr === undefined) { arr = []; bandUpdates.set(d.bandId, arr) }
                arr.push({ elementId: d.elementId, x: d.x, y: d.y })
            }
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(band => {
                        const updates = bandUpdates.get(band.id)
                        if (updates === undefined) return band
                        let elements = band.elements
                        for (let i = 0; i < updates.length; i++) {
                            elements = updateElementInTree(elements, updates[i].elementId, {
                                x: updates[i].x, y: updates[i].y
                            })
                        }
                        return { ...band, elements }
                    })
                }
            }
        }
        case 'REPARENT_ELEMENT': {
            const { elementId, bandId, targetParentId, x, y, index } = action.payload
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(band => {
                        if (band.id !== bandId) return band
                        const [removed, element] = removeElementFromTree(band.elements, elementId)
                        if (element === undefined) return band
                        const movedElement = { ...element, x, y }
                        // Empty targetParentId places the element directly under the band.
                        if (targetParentId === '') {
                            if (index !== undefined) {
                                const newElements = removed.slice()
                                newElements.splice(index, 0, movedElement)
                                return { ...band, elements: newElements }
                            }
                            return { ...band, elements: [...removed, movedElement] }
                        }
                        if (index !== undefined) {
                            return { ...band, elements: addElementToParentInTreeAt(removed, targetParentId, movedElement, index) }
                        }
                        return { ...band, elements: addElementToParentInTree(removed, targetParentId, movedElement) }
                    })
                }
            }
        }
        case 'MOVE_ELEMENT_TO_BAND': {
            const { elementId, sourceBandId, targetBandId, x, y } = action.payload
            let movedElement: TemplateElement | undefined
            const newBands = state.template.bands.map(function (band) {
                if (band.id === sourceBandId) {
                    const [removed, element] = removeElementFromTree(band.elements, elementId)
                    if (element === undefined) return band
                    movedElement = { ...element, x, y }
                    return { ...band, elements: removed }
                }
                return band
            })
            if (movedElement === undefined) return state
            const el = movedElement
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: newBands.map(function (band) {
                        if (band.id !== targetBandId) return band
                        return { ...band, elements: [...band.elements, el] }
                    })
                },
                selectedBandId: targetBandId,
            }
        }
        case 'ADD_ELEMENT_TO_PARENT': return {
            ...state,
            template: {
                ...state.template,
                bands: state.template.bands.map(band =>
                    band.id !== action.payload.bandId ? band : {
                        ...band,
                        elements: addElementToParentInTree(band.elements, action.payload.parentId, applyDefaultColorMode(action.payload.element, state.defaultColorMode))
                    }
                )
            },
            selectedElementIds: [action.payload.element.id],
            selectedBandId: action.payload.bandId,
            activeTool: 'select',
            elementIdCounter: state.elementIdCounter + 1
        }
        //=============================================================================
        case 'UPDATE_BAND_HEIGHT': {
            const { bandId, height } = action.payload
            const ps = state.template.pageSettings
            const ph = ps.height - ps.marginTop - ps.marginBottom
            const bands = state.template.bands

            // Target band index.
            const targetIdx = bands.findIndex(b => b.id === bandId)

            // Set the target band height and absorb overflow from lower bands.
            const newBands = bands.slice()
            newBands[targetIdx] = { ...newBands[targetIdx], height }

            // Background is an independent page overlay. Its height neither
            // consumes vertical band flow nor shrinks a following band.
            if (newBands[targetIdx]!.type === 'background') {
                return {
                    ...state,
                    template: { ...state.template, bands: newBands }
                }
            }

            // Calculate total height using only enabled flow bands because
            // disabled bands and the background overlay are not in canvas flow.
            let total = 0
            for (let i = 0; i < newBands.length; i++) {
                if (newBands[i].enabled && newBands[i].type !== 'background') total += newBands[i].height
            }
            let excess = total - ph

            // Only the immediately following enabled band absorbs overflow.
            if (excess > 0) {
                for (let i = targetIdx + 1; i < newBands.length; i++) {
                    if (!newBands[i].enabled) continue
                    const shrink = Math.min(newBands[i].height, excess)
                    newBands[i] = { ...newBands[i], height: newBands[i].height - shrink }
                    excess -= shrink
                    break
                }
            }

            // If the next band cannot absorb the overflow, suppress the target band itself.
            if (excess > 0) {
                newBands[targetIdx] = { ...newBands[targetIdx], height: height - excess }
            }

            return {
                ...state,
                template: { ...state.template, bands: newBands }
            }
        }
        case 'UPDATE_BAND_START_NEW_PAGE': {
            const { bandId, startNewPage } = action.payload
            const bands = state.template.bands.map(function (band) {
                if (band.id !== bandId) return band
                return { ...band, startNewPage }
            })
            return {
                ...state,
                template: syncLegacyReportFlags({ ...state.template, bands })
            }
        }
        case 'UPDATE_BAND_SPLIT_TYPE': {
            const { bandId, splitType } = action.payload
            const bands = state.template.bands.map(function (b) {
                if (b.id !== bandId) return b
                return { ...b, splitType }
            })
            return { ...state, template: { ...state.template, bands } }
        }
        case 'UPDATE_BAND_PRINT_WHEN_EXPRESSION': {
            const { bandId, printWhenExpression } = action.payload
            const bands = state.template.bands.map(function (band) {
                if (band.id !== bandId) return band
                return { ...band, printWhenExpression }
            })
            return { ...state, template: { ...state.template, bands } }
        }
        case 'TOGGLE_BAND_ENABLED': {
            const { bandId } = action.payload
            const bands = state.template.bands.map(function (b) {
                if (b.id !== bandId) return b
                return { ...b, enabled: !b.enabled }
            })
            return { ...state, template: { ...state.template, bands } }
        }
        case 'ADD_BAND': return {
            ...state,
            template: {
                ...state.template,
                bands: [...state.template.bands, action.payload.band]
            }
        }
        case 'REMOVE_BAND': return {
            ...state,
            template: {
                ...state.template,
                bands: state.template.bands.filter(band => band.id !== action.payload.bandId)
            },
            selectedBandId: state.selectedBandId === action.payload.bandId ? null : state.selectedBandId,
            selectedElementIds: state.selectedBandId === action.payload.bandId ? [] : state.selectedElementIds
        }
        //=============================================================================
        case 'ADD_GROUP': {
            const { group } = action.payload
            // Do not add duplicate group names.
            if (state.template.groups.some(function (g) { return g.name === group.name })) return state
            const headerBand: Band = {
                id: 'band_groupHeader_' + group.name,
                type: 'groupHeader',
                groupName: group.name,
                height: 30,
                startNewPage: false,
                splitType: 'Stretch',
                elements: [],
                printWhenExpression: '',
                enabled: true,
            }
            const footerBand: Band = {
                id: 'band_groupFooter_' + group.name,
                type: 'groupFooter',
                groupName: group.name,
                height: 30,
                startNewPage: false,
                splitType: 'Stretch',
                elements: [],
                printWhenExpression: '',
                enabled: true,
            }
            // New groups are innermost; insert the header before the first detail and the footer after the last detail.
            const bands = state.template.bands
            let firstDetailIdx = bands.findIndex(function (b) { return b.type === 'detail' })
            if (firstDetailIdx === -1) firstDetailIdx = bands.length
            let lastDetailIdx = -1
            for (let i = 0; i < bands.length; i++) {
                if (bands[i].type === 'detail') lastDetailIdx = i
            }
            const newBands = bands.slice()
            newBands.splice(firstDetailIdx, 0, headerBand)
            // Inserting the header shifts the detail position by one.
            const footerInsertIdx = lastDetailIdx === -1 ? firstDetailIdx + 1 : lastDetailIdx + 2
            newBands.splice(footerInsertIdx, 0, footerBand)
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: newBands,
                    groups: [...state.template.groups, group],
                },
                selectedBandId: headerBand.id,
                selectedElementIds: [],
            }
        }
        case 'UPDATE_GROUP': {
            const { name, props } = action.payload
            const target = state.template.groups.find(function (g) { return g.name === name })
            if (target === undefined) return state
            const newName = props.name !== undefined ? props.name : name
            // Ignore renames that collide with an existing group name.
            if (newName !== name && state.template.groups.some(function (g) { return g.name === newName })) return state
            const groups = state.template.groups.map(function (g) {
                if (g.name !== name) return g
                return { ...g, ...props }
            })
            const bands = newName === name ? state.template.bands : state.template.bands.map(function (b) {
                if (b.groupName !== name) return b
                return { ...b, groupName: newName }
            })
            return { ...state, template: { ...state.template, groups, bands } }
        }
        case 'REMOVE_GROUP': {
            const { name } = action.payload
            const removedBandIds = new Set<string>()
            const bands = state.template.bands.filter(function (b) {
                if (b.groupName === name) { removedBandIds.add(b.id); return false }
                return true
            })
            const groups = state.template.groups.filter(function (g) { return g.name !== name })
            const selectionRemoved = state.selectedBandId !== null && removedBandIds.has(state.selectedBandId)
            return {
                ...state,
                template: { ...state.template, bands, groups },
                selectedBandId: selectionRemoved ? null : state.selectedBandId,
                selectedElementIds: selectionRemoved ? [] : state.selectedElementIds,
            }
        }
        //=============================================================================
        case 'SET_ZOOM': return {
            ...state,
            zoom: action.payload.zoom
        }
        //=============================================================================
        case 'TOGGLE_PROPERTY_PANEL': return {
            ...state,
            isPropertyPanelVisible: !state.isPropertyPanelVisible
        }
        case 'TOGGLE_LAYER_PANEL': return {
            ...state,
            isLayerPanelVisible: !state.isLayerPanelVisible
        }
        case 'TOGGLE_GRID': return {
            ...state,
            isGridEnabled: !state.isGridEnabled
        }
        case 'SET_GRID_SIZE': {
            // Ignore non-positive/invalid sizes so snapping never divides by zero.
            const sizePt = action.payload.sizePt
            if (!Number.isFinite(sizePt) || sizePt <= 0) {
                return state
            }
            return { ...state, gridSizePt: sizePt }
        }
        //=============================================================================
        case 'UPDATE_PAGE_SETTINGS': return {
            ...state,
            template: {
                ...state.template,
                pageSettings: { ...state.template.pageSettings, ...action.payload.settings }
            }
        }
        case 'APPLY_IMAGE_SLICE': {
            // Replaces an image element (possibly nested in a frame) with its
            // slice pieces in place; one undoable unit restores the original
            const pieces = action.payload.pieces
            const bands = state.template.bands.map(function (band) {
                if (band.id !== action.payload.bandId) return band
                const elements = replaceElementWithElements(band.elements, action.payload.elementId, pieces)
                return elements === band.elements ? band : { ...band, elements }
            })
            return {
                ...state,
                template: { ...state.template, bands },
                selectedElementIds: pieces.map(function (piece) { return piece.id }),
                selectedBandId: action.payload.bandId,
                editingElementId: null,
                elementIdCounter: Math.max(state.elementIdCounter, action.payload.nextElementIdCounter),
                pathEditing: null,
                tableSelection: null,
            }
        }
        //=============================================================================
        case 'APPLY_PDF_IMPORT': {
            const pageSettings = action.payload.pageSettings
            let bands = state.template.bands
            for (let i = 0; i < action.payload.bands.length; i++) {
                const content = action.payload.bands[i]!
                const existing = bands.find(function (band) { return band.type === content.type })
                if (existing !== undefined) {
                    bands = bands.map(function (band) {
                        if (band !== existing) return band
                        return {
                            ...band,
                            height: content.height,
                            enabled: true,
                            elements: band.elements.concat(content.elements),
                        }
                    })
                } else {
                    const created: Band = {
                        id: 'band_' + content.type,
                        type: content.type,
                        height: content.height,
                        startNewPage: false,
                        splitType: 'Stretch',
                        elements: content.elements,
                        printWhenExpression: '',
                        enabled: true,
                    }
                    bands = insertBandInOrder(bands, created)
                }
            }
            // A band-assignment import disables the bands the user left out
            // of the assignment so only the assigned bands remain active
            for (let i = 0; i < action.payload.disabledBandTypes.length; i++) {
                const disabledType = action.payload.disabledBandTypes[i]!
                bands = bands.map(function (band) {
                    if (band.type !== disabledType || !band.enabled) return band
                    return { ...band, enabled: false }
                })
            }
            return {
                ...state,
                template: {
                    ...state.template,
                    pageSettings,
                    bands,
                },
                selectedBandId: null,
                selectedElementIds: [],
                editingElementId: null,
                elementIdCounter: Math.max(state.elementIdCounter, action.payload.nextElementIdCounter),
                activeTool: 'select',
                pathEditing: null,
                tableSelection: null,
            }
        }
        //=============================================================================
        case 'UPDATE_REPORT_SETTINGS': {
            let template: ReportTemplate = {
                ...state.template,
                ...action.payload.settings
            }
            if (typeof action.payload.settings.titleNewPage === 'boolean') {
                template = {
                    ...template,
                    bands: template.bands.map(function (band) {
                        if (band.type !== 'title') return band
                        return { ...band, startNewPage: action.payload.settings.titleNewPage! }
                    })
                }
            }
            if (typeof action.payload.settings.summaryNewPage === 'boolean') {
                template = {
                    ...template,
                    bands: template.bands.map(function (band) {
                        if (band.type !== 'summary') return band
                        return { ...band, startNewPage: action.payload.settings.summaryNewPage! }
                    })
                }
            }
            return {
                ...state,
                template: syncLegacyReportFlags(template)
            }
        }
        //=============================================================================
        case 'LOAD_TEMPLATE': {
            const loadedTemplate = normalizeTemplate(action.payload.template)
            return {
                ...state,
                template: loadedTemplate,
                selectedElementIds: [],
                selectedBandId: null,
                elementIdCounter: computeElementIdCounter(loadedTemplate)
            }
        }
        //=============================================================================
        case 'SET_DISPLAY_UNIT': return {
            ...state,
            displayUnit: action.payload.unit
        }

        case 'SET_DEFAULT_COLOR_MODE': return {
            ...state,
            defaultColorMode: action.payload.mode
        }
        //=============================================================================
        case 'SET_TABLE_SELECTION': return {
            ...state,
            tableSelection: action.payload.selection
        }
        case 'SET_PATH_EDIT': return {
            ...state,
            pathEditing: action.payload.editing,
            tableSelection: action.payload.editing === null ? state.tableSelection : null
        }
        //=============================================================================
        case 'START_EDITING': return {
            ...state,
            editingElementId: action.payload.elementId
        }
        case 'STOP_EDITING': {
            if (state.editingElementId === null || state.selectedBandId === null) {
                return { ...state, editingElementId: null }
            }
            const editId = state.editingElementId
            const band = state.template.bands.find(b => b.id === state.selectedBandId)
            if (band === undefined) return { ...state, editingElementId: null }
            const el = findElementInTree(band.elements, editId)
            if (el === undefined) return { ...state, editingElementId: null }
            const prop = el.kind === 'staticText' ? 'text' : 'expression'
            return {
                ...state,
                template: {
                    ...state.template,
                    bands: state.template.bands.map(b =>
                        b.id !== state.selectedBandId ? b : {
                            ...b,
                            elements: updateElementInTree(b.elements, editId, { [prop]: action.payload.text })
                        }
                    )
                },
                editingElementId: null
            }
        }
        //=============================================================================
        case 'UNDO': {
            const pastLen = state.history.past.length
            if (pastLen === 0) return state
            const prev = state.history.past[pastLen - 1]
            const past = state.history.past.slice(0, pastLen - 1)
            const future = state.history.future.slice()
            future.push(state.template)
            return {
                ...state,
                template: prev,
                selectedElementIds: [],
                selectedBandId: null,
                editingElementId: null,
                pathEditing: null,
                history: { ...state.history, past, future }
            }
        }
        case 'REDO': {
            const futureLen = state.history.future.length
            if (futureLen === 0) return state
            const next = state.history.future[futureLen - 1]
            const future = state.history.future.slice(0, futureLen - 1)
            const past = state.history.past.slice()
            past.push(state.template)
            return {
                ...state,
                template: next,
                selectedElementIds: [],
                selectedBandId: null,
                editingElementId: null,
                pathEditing: null,
                history: { ...state.history, past, future }
            }
        }
        //=============================================================================
    }

    return state
}

/** Replaces the element with the given id by the replacement elements, recursing into frame children. */
function replaceElementWithElements(elements: TemplateElement[], elementId: string, replacements: TemplateElement[]): TemplateElement[] {
    let changed = false
    const result: TemplateElement[] = []
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        if (element.id === elementId) {
            for (let j = 0; j < replacements.length; j++) result.push(replacements[j]!)
            changed = true
            continue
        }
        if (element.children.length > 0) {
            const children = replaceElementWithElements(element.children, elementId, replacements)
            if (children !== element.children) {
                result.push({ ...element, children })
                changed = true
                continue
            }
        }
        result.push(element)
    }
    return changed ? result : elements
}

// =====================================
// History limit.
// =====================================
const HISTORY_LIMIT = 100

// =====================================
// Auto-commit actions.
// =====================================
const AUTO_COMMIT_ACTIONS: Set<string> = new Set([
    'ADD_ELEMENT', 'UPDATE_ELEMENT', 'UPDATE_ELEMENT_STYLE', 'DELETE_ELEMENT',
    'DELETE_ELEMENTS', 'PASTE_ELEMENTS', 'REPARENT_ELEMENT', 'MOVE_ELEMENT_TO_BAND', 'ADD_ELEMENT_TO_PARENT',
    'ADD_BAND', 'REMOVE_BAND', 'TOGGLE_BAND_ENABLED', 'UPDATE_BAND_PRINT_WHEN_EXPRESSION',
    'ADD_GROUP', 'UPDATE_GROUP', 'REMOVE_GROUP',
    'UPDATE_PAGE_SETTINGS', 'APPLY_PDF_IMPORT', 'APPLY_IMAGE_SLICE', 'UPDATE_REPORT_SETTINGS',
    'LOAD_TEMPLATE', 'STOP_EDITING'
])

// =====================================
// Helper that pushes history to the past stack.
// =====================================
function pushToPast(past: ReportTemplate[], snapshot: ReportTemplate): ReportTemplate[] {
    if (past.length >= HISTORY_LIMIT) {
        const trimmed = past.slice(1)
        trimmed.push(snapshot)
        return trimmed
    }
    const result = past.slice()
    result.push(snapshot)
    return result
}

// =====================================
// Reducer with history management.
// =====================================
export function reducerWithHistory(state: State, action: ActionType): State {
    // BEGIN_TEXT_INPUT starts a text input transaction.
    if (action.type === 'BEGIN_TEXT_INPUT') {
        if (state.history.baseSnapshot !== null) {
            return { ...state, history: { ...state.history, textInputActive: true } }
        }
        return {
            ...state,
            history: { ...state.history, baseSnapshot: state.template, textInputActive: true }
        }
    }

    // END_TEXT_INPUT commits a text input transaction.
    if (action.type === 'END_TEXT_INPUT') {
        const snapshot = state.history.baseSnapshot
        if (snapshot === null) {
            return { ...state, history: { ...state.history, textInputActive: false } }
        }
        // Do not add history when the template did not change.
        if (state.template === snapshot) {
            return { ...state, history: { ...state.history, baseSnapshot: null, textInputActive: false } }
        }
        return {
            ...state,
            history: {
                past: pushToPast(state.history.past, snapshot),
                future: [],
                baseSnapshot: null,
                textInputActive: false
            }
        }
    }

    const prevTemplate = state.template
    const next = reducer(state, action)

    // UNDO/REDO clears baseSnapshot; the inner reducer already handled past, future, and template.
    if (action.type === 'UNDO' || action.type === 'REDO') {
        if (next === state) return state
        return { ...next, history: { ...next.history, baseSnapshot: null } }
    }

    // COMMIT_HISTORY pushes baseSnapshot to past when a drag operation is committed.
    if (action.type === 'COMMIT_HISTORY') {
        const snapshot = state.history.baseSnapshot
        if (snapshot === null) return state
        return {
            ...state,
            history: {
                past: pushToPast(state.history.past, snapshot),
                future: [],
                baseSnapshot: null,
                textInputActive: state.history.textInputActive
            }
        }
    }

    // Return as-is when the template did not change.
    if (next.template === prevTemplate) return next

    // Inside a transaction with baseSnapshot already set; do not auto-commit.
    if (state.history.baseSnapshot !== null) return next

    // For auto-commit actions, push prevTemplate to past.
    // Suppress this during text input because transaction mode handles it.
    if (AUTO_COMMIT_ACTIONS.has(action.type) && !state.history.textInputActive) {
        return {
            ...next,
            history: {
                past: pushToPast(state.history.past, prevTemplate),
                future: [],
                baseSnapshot: null,
                textInputActive: false
            }
        }
    }

    // Start a transaction for non-auto-commit actions such as dragging or during text input.
    return {
        ...next,
        history: { ...next.history, baseSnapshot: prevTemplate }
    }
}
