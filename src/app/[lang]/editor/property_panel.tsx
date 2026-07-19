'use client'

import { useState, useRef, useEffect } from 'react'
import { validateExpressionSource } from 'tsreport-core'
import { CmnInputText } from '@/lib/client/components/input/cmn-input-text'
import { NumberUtils } from '@/lib/common/utils/number_utils'
import { DisplayUnit, UnitUtils } from '@/lib/common/utils/unit_utils'
import { Action, type JsonFileInfo } from './action'
import { FontEntry } from './font_loader'
import SelectDropdown from './select_dropdown'
import { ColorInput } from './color_input'
import { displayHexOf } from './color_input_util'
import styles from './property_panel.module.css'
import type { EditorCurrentFile } from './resource_resolver'
import {
    ActionType,
    Band,
    Border,
    BorderSide,
    createDefaultTableCellStyle,
    createDefaultTableRow,
    CrosstabMeasure,
    ElementStyle,
    findParentElement,
    getSelectedElement,
    hasLockedPdfSource,
    ReportGroup,
    HAlign,
    PAGE_SIZES,
    State,
    TableCell,
    TableCellStyle,
    TableColumn,
    TableRow,
    TableSelection,
    TemplateElement,
    VAlign
} from './reducer'
import {
    buildTablePlacements,
    computeTableColumnPositions,
    computeTableRowOffsets,
    findTablePlacement,
    getTableColumnCount,
    getTableColumns,
    getTableSectionRows,
    setTableColumns,
    setTableSectionRows,
    updateTableCell,
    updateTableCellStyle,
    updateTableCellSpan,
    updateTableColumnStyle,
    type TableBorderSideKey,
} from './table_editor_model'
import type { OpenReportTemplate } from './subreport_support'
import { FieldHelpTooltip } from './property_panel_help'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { localizeUiNode } from '@/lib/client/i18n/localize_ui_node'
import { getLocalizedBandDisplayLabel, getLocalizedElementKindLabel } from './localized_editor_labels'
import type { UiMessages } from '@/lib/common/i18n/ui_messages'

type PathGradientStop = TemplateElement['pathGradient']['stops'][number]

type Props = {
    state: State,
    dispatch: React.Dispatch<ActionType>,
    fontList: FontEntry[],
    jsonFiles: JsonFileInfo[],
    currentFile: EditorCurrentFile | null,
    openReportTemplates: OpenReportTemplate[],
    onResolvedSubreportTemplates: (templates: OpenReportTemplate[]) => void
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}

function parseUnitIntervalPercent(value: string): number | undefined {
    const parsed = NumberUtils.parseNumber(value)
    if (parsed === undefined) return undefined
    return clamp01(parsed / 100)
}

function formatPercent(value: number): string {
    return NumberUtils.formatNumber(value * 100, 1)
}

function parseDashArray(value: string): number[] {
    return value
        .split(/[,\s]+/)
        .map(function (part) { return NumberUtils.parseNumber(part) })
        .filter(function (part): part is number { return part !== undefined && part > 0 })
}

function hexToRgb(hex: string): { r: number, g: number, b: number } {
    const value = hex.replace('#', '')
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16),
    }
}

function rgbToHex(r: number, g: number, b: number): string {
    const toHex = function (value: number) { return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0') }
    return '#' + toHex(r) + toHex(g) + toHex(b)
}

function interpolateStopColor(stops: PathGradientStop[], offset: number): string {
    const sorted = stops.slice().sort(function (a, b) { return a.offset - b.offset })
    if (sorted.length === 0) return '#FFFFFF'
    if (offset <= sorted[0]!.offset) return sorted[0]!.color
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!
        const next = sorted[i]!
        if (offset > next.offset) continue
        const span = next.offset - prev.offset
        const t = span === 0 ? 0 : (offset - prev.offset) / span
        const a = hexToRgb(prev.color)
        const b = hexToRgb(next.color)
        return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
    }
    return sorted[sorted.length - 1]!.color
}

// =====================================
// Expand/collapse section header
// =====================================
function CollapsibleHeader(props: { label: string, open: boolean, onToggle: () => void }) {
    return (
        <div className={styles.collapsibleHeader} onClick={props.onToggle}>
            <span className={`${styles.collapsibleArrow} ${props.open ? styles.collapsibleArrowOpen : ''}`}>&#9654;</span>
            {props.label}
        </div>
    )
}

function getExpressionError(value: string): ReturnType<typeof validateExpressionSource> {
    if (value.trim() === '') return null
    return validateExpressionSource(value)
}

function renderExpressionInput(props: {
    helpKey: string,
    label: string,
    value: string,
    placeholder?: string,
    readOnly?: boolean,
    onFocus?: () => void,
    onBlur?: () => void,
    onChange?: (value: string) => void
}) {
    const error = getExpressionError(props.value)
    const inputClassName = error === null ? styles.input : `${styles.input} ${styles.inputInvalid}`

    return (
        <div className={styles.field} data-help={props.helpKey}>
            <label className={styles.label}>{props.label}</label>
            <input
                className={inputClassName}
                type="text"
                value={props.value}
                placeholder={props.placeholder}
                readOnly={props.readOnly}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
                onChange={props.onChange ? (e) => props.onChange!(e.target.value) : undefined}
            />
            {error !== null && (
                <div className={styles.validationError}>
                    {error.message} ({'位置'} {error.position + 1})
                </div>
            )}
        </div>
    )
}

function SubreportTemplateExpressionField(props: {
    state: State,
    dispatch: React.Dispatch<ActionType>,
    bandId: string,
    element: TemplateElement,
    currentFile: EditorCurrentFile | null,
    openReportTemplates: OpenReportTemplate[],
    onResolvedSubreportTemplates: (templates: OpenReportTemplate[]) => void
}) {
    const ui = useUiMessages()
    const { state, dispatch, bandId, element, currentFile, openReportTemplates, onResolvedSubreportTemplates } = props
    const [draft, setDraft] = useState(element.templateExpression)
    const [validationError, setValidationError] = useState<string | null>(null)
    const [isValidating, setIsValidating] = useState(false)
    const requestIdRef = useRef(0)

    useEffect(function () {
        setDraft(element.templateExpression)
        setValidationError(null)
        setIsValidating(false)
        requestIdRef.current += 1
    }, [element.id, element.templateExpression])

    const syntaxError = getExpressionError(draft)
    const syntaxErrorMessage = syntaxError === null
        ? null
        : `${syntaxError.message} (${ui.position} ${syntaxError.position + 1})`
    const error = syntaxErrorMessage ?? validationError
    const inputClassName = error === null ? styles.input : `${styles.input} ${styles.inputInvalid}`

    async function handleBlur(): Promise<void> {
        Action.endTextInput(dispatch)

        if (syntaxErrorMessage !== null) {
            setValidationError(null)
            return
        }
        if (draft === element.templateExpression) {
            setValidationError(null)
            return
        }
        if (draft.trim() === '') {
            setValidationError(null)
            Action.updateElement(dispatch, element.id, bandId, { templateExpression: draft })
            return
        }
        if (currentFile === null) {
            setValidationError(ui.templateExpressionSavedOnly)
            return
        }

        const requestId = requestIdRef.current + 1
        requestIdRef.current = requestId
        setIsValidating(true)
        const result = await Action.resolveSubreportTemplates(
            currentFile.workspace,
            currentFile.path,
            state.template,
            draft,
            openReportTemplates,
        )
        if (requestId !== requestIdRef.current) return

        setIsValidating(false)
        if (!result.valid) {
            setValidationError(result.message ?? ui.templateUnavailable)
            return
        }

        setValidationError(null)
        onResolvedSubreportTemplates(result.templates)
        Action.updateElement(dispatch, element.id, bandId, { templateExpression: draft })
    }

    return (
        <div className={styles.field} data-help="subreport.templateExpression">
            <label className={styles.label}>{ui.templateExpression}</label>
            <input
                className={inputClassName}
                type="text"
                value={draft}
                onFocus={() => Action.beginTextInput(dispatch)}
                onChange={(e) => {
                    setDraft(e.target.value)
                    setValidationError(null)
                }}
                onBlur={() => { void handleBlur() }}
            />
            {isValidating && <div className={styles.validationError}>{ui.templateChecking}</div>}
            {!isValidating && error !== null && <div className={styles.validationError}>{error}</div>}
        </div>
    )
}

// =====================================
// Page settings panel (when nothing is selected)
// =====================================
function renderPageSettings(state: State, dispatch: React.Dispatch<ActionType>, jsonFiles: JsonFileInfo[]) {
    const ps = state.template.pageSettings
    const tmpl = state.template
    const summaryBand = tmpl.bands.find(function (band) { return band.type === 'summary' })
    const unit = state.displayUnit
    const unitLabel = UnitUtils.getUnitLabel(unit)
    const pageSizeNames = Object.keys(PAGE_SIZES)
    const isCustom = ps.size === 'custom'

    function handleSizeChange(size: string) {
        if (size === 'custom') {
            Action.updatePageSettings(dispatch, { size: 'custom' })
        } else {
            const s = PAGE_SIZES[size]
            if (s) {
                if (ps.orientation === 'landscape') {
                    Action.updatePageSettings(dispatch, { size, width: s.height, height: s.width })
                } else {
                    Action.updatePageSettings(dispatch, { size, width: s.width, height: s.height })
                }
            }
        }
    }

    function handleOrientationChange(orientation: 'portrait' | 'landscape') {
        if (orientation === ps.orientation) return
        // Swap width and height
        Action.updatePageSettings(dispatch, {
            orientation,
            width: ps.height,
            height: ps.width
        })
    }

    return (
        <>
            <div className={styles.section}>
                <div className={styles.sectionHeader}>ページ設定</div>
                <div className={styles.field} data-help="page.templateName">
                    <label className={styles.label}>テンプレート名</label>
                    <input
                        className={styles.input}
                        type="text"
                        value={tmpl.name}
                        onFocus={() => Action.beginTextInput(dispatch)}
                        onChange={(e) => Action.updateReportSettings(dispatch, { name: e.target.value })}
                        onBlur={() => Action.endTextInput(dispatch)}
                    />
                </div>

                <div className={styles.field} data-help="page.size">
                    <label className={styles.label}>用紙サイズ</label>
                    <SelectDropdown
                        className={styles.select}
                        value={ps.size}
                        onChange={(e) => handleSizeChange(e.target.value)}
                    >
                        {pageSizeNames.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                        <option value="custom">カスタム</option>
                    </SelectDropdown>
                </div>

                <div className={styles.row}>
                    <div className={styles.field} data-help="page.width">
                        <label className={styles.label}>幅 ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.width, unit), 3)}
                            disabled={!isCustom}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { width: UnitUtils.displayToPt(v, unit) }) }}
                        />
                    </div>
                    <div className={styles.field} data-help="page.height">
                        <label className={styles.label}>高さ ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.height, unit), 3)}
                            disabled={!isCustom}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { height: UnitUtils.displayToPt(v, unit) }) }}
                        />
                    </div>
                </div>

                <div className={styles.field} data-help="page.orientation">
                    <label className={styles.label}>向き</label>
                    <SelectDropdown
                        className={styles.select}
                        value={ps.orientation}
                        onChange={(e) => handleOrientationChange(e.target.value as 'portrait' | 'landscape')}
                    >
                        <option value="portrait">縦 (Portrait)</option>
                        <option value="landscape">横 (Landscape)</option>
                    </SelectDropdown>
                </div>

                <div className={styles.subHeader}>余白</div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="page.marginTop">
                        <label className={styles.label}>上 ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.marginTop, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { marginTop: UnitUtils.displayToPt(v, unit) }) }}
                        />
                    </div>
                    <div className={styles.field} data-help="page.marginBottom">
                        <label className={styles.label}>下 ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.marginBottom, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { marginBottom: UnitUtils.displayToPt(v, unit) }) }}
                        />
                    </div>
                </div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="page.marginLeft">
                        <label className={styles.label}>左 ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.marginLeft, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { marginLeft: UnitUtils.displayToPt(v, unit) }) }}
                        />
                    </div>
                    <div className={styles.field} data-help="page.marginRight">
                        <label className={styles.label}>右 ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.marginRight, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { marginRight: UnitUtils.displayToPt(v, unit) }) }}
                        />
                    </div>
                </div>

                <div className={styles.subHeader}>段組み</div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="page.columnCount">
                        <label className={styles.label}>列数</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(ps.columnCount)}
                            onBlur={(e) => Action.updatePageSettings(dispatch, { columnCount: NumberUtils.parseNumber(e.target.value) })}
                        />
                    </div>
                    <div className={styles.field} data-help="page.columnWidth">
                        <label className={styles.label}>列幅 ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.columnWidth, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { columnWidth: UnitUtils.displayToPt(v, unit) }) }}
                        />
                    </div>
                </div>
                <div className={styles.field} data-help="page.columnSpacing">
                    <label className={styles.label}>列間隔 ({unitLabel})</label>
                    <CmnInputText className={styles.input}
                        value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(ps.columnSpacing, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updatePageSettings(dispatch, { columnSpacing: UnitUtils.displayToPt(v, unit) }) }}
                    />
                </div>
                <div className={styles.field} data-help="page.columnPrintOrder">
                    <label className={styles.label}>印刷順序</label>
                    <SelectDropdown
                        className={styles.select}
                        value={ps.columnPrintOrder}
                        onChange={(e) => Action.updatePageSettings(dispatch, { columnPrintOrder: e.target.value as 'vertical' | 'horizontal' })}
                    >
                        <option value="vertical">縦方向 (Vertical)</option>
                        <option value="horizontal">横方向 (Horizontal)</option>
                    </SelectDropdown>
                </div>
            </div>

            <div className={styles.section}>
                <div className={styles.sectionHeader}>レポート設定</div>
                <label className={styles.checkbox} data-help="report.summaryWithPageHeaderAndFooter">
                    <input type="checkbox" checked={tmpl.summaryWithPageHeaderAndFooter} disabled={!summaryBand?.startNewPage}
                        onChange={(e) => Action.updateReportSettings(dispatch, { summaryWithPageHeaderAndFooter: e.target.checked })} />
                    サマリーページにヘッダー/フッター表示
                </label>
            </div>

            <div className={styles.section}>
                <div className={styles.sectionHeader}>グループ (コントロールブレーク)</div>
                {tmpl.groups.map(function (g) {
                    return (
                        <div key={g.name} className={styles.field}>
                            <button
                                type="button"
                                className={styles.miniButton}
                                onClick={function () {
                                    const headerBand = tmpl.bands.find(function (b) { return b.type === 'groupHeader' && b.groupName === g.name })
                                    if (headerBand !== undefined) Action.selectBand(dispatch, headerBand.id)
                                }}
                            >
                                {g.name}{g.expression !== '' ? ' — ' + g.expression : ''}
                            </button>
                        </div>
                    )
                })}
                <button
                    type="button"
                    className={styles.addButton}
                    data-help="group.add"
                    onClick={function () {
                        let n = 1
                        while (tmpl.groups.some(function (g) { return g.name === 'Group' + n })) n++
                        Action.addGroup(dispatch, {
                            name: 'Group' + n,
                            expression: '',
                            startNewPage: false,
                            startNewColumn: false,
                            reprintHeaderOnEachPage: false,
                            resetPageNumber: false,
                            keepTogether: false,
                            minHeightToStartNewPage: 0,
                            footerPosition: 'normal',
                        })
                    }}
                >
                    ＋ グループを追加
                </button>
            </div>

            <div className={styles.section}>
                <div className={styles.sectionHeader}>テストデータ</div>
                <div className={styles.field} data-help="report.testDataPath">
                    <label className={styles.label}>データファイル</label>
                    <SelectDropdown className={styles.select} value={tmpl.testDataPath}
                        onChange={(e) => Action.updateReportSettings(dispatch, { testDataPath: e.target.value })}>
                        <option value="">なし</option>
                        {jsonFiles.map(f => <option key={f.path} value={f.path}>{f.path}</option>)}
                    </SelectDropdown>
                </div>
            </div>
        </>
    )
}

// =====================================
// Band property panel
// =====================================
function renderBandProperties(bandId: string, state: State, dispatch: React.Dispatch<ActionType>, ui: UiMessages) {
    const band = state.template.bands.find(b => b.id === bandId)
    if (band === undefined) return null

    const unit = state.displayUnit
    const unitLabel = UnitUtils.getUnitLabel(unit)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>バンド: {getLocalizedBandDisplayLabel(band, ui)}</div>
            <div className={styles.field} data-help="band.enabled">
                <label className={styles.label}>
                    <input
                        type="checkbox"
                        checked={band.enabled}
                        onChange={() => Action.toggleBandEnabled(dispatch, bandId)}
                    />
                    {' '}有効
                </label>
            </div>

            <div className={styles.field} data-help="band.height">
                <label className={styles.label}>高さ ({unitLabel})</label>
                <CmnInputText className={styles.input}
                    value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(band.height, unit), 3)}
                    onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updateBandHeight(dispatch, bandId, UnitUtils.displayToPt(v, unit)) }}
                />
            </div>

            <label className={styles.checkbox} data-help="band.startNewPage">
                <input
                    type="checkbox"
                    checked={band.startNewPage}
                    onChange={(e) => Action.updateBandStartNewPage(dispatch, bandId, e.target.checked)}
                />
                新しいページから開始
            </label>

            <div className={styles.field} data-help="band.splitType">
                <label className={styles.label}>分割制御 (splitType)</label>
                <SelectDropdown className={styles.select} value={band.splitType}
                    onChange={(e) => Action.updateBandSplitType(dispatch, bandId, e.target.value as Band['splitType'])}
                >
                    <option value="Stretch">Stretch</option>
                    <option value="Prevent">Prevent</option>
                    <option value="Immediate">Immediate</option>
                </SelectDropdown>
            </div>

            {renderExpressionInput({
                helpKey: 'band.printWhenExpression',
                label: '表示条件式',
                value: band.printWhenExpression,
                placeholder: '(条件式)',
                onFocus: () => Action.beginTextInput(dispatch),
                onBlur: () => Action.endTextInput(dispatch),
                onChange: (value) => Action.updateBandPrintWhenExpression(dispatch, bandId, value)
            })}
            {(band.type === 'groupHeader' || band.type === 'groupFooter') && band.groupName !== undefined
                && renderGroupProperties(band.groupName, state, dispatch)}
        </div>
    )
}

// =====================================
// Group (control break) properties
// =====================================
function renderGroupProperties(groupName: string, state: State, dispatch: React.Dispatch<ActionType>) {
    const group = state.template.groups.find(function (g) { return g.name === groupName })
    if (group === undefined) return null
    const unit = state.displayUnit
    const unitLabel = UnitUtils.getUnitLabel(unit)

    return (
        <>
            <div className={styles.sectionHeader}>グループ: {group.name}</div>
            <div className={styles.field} data-help="group.name">
                <label className={styles.label}>グループ名</label>
                <CmnInputText className={styles.input}
                    value={group.name}
                    onFocus={() => Action.beginTextInput(dispatch)}
                    onBlur={(e) => {
                        Action.endTextInput(dispatch)
                        const v = e.target.value.trim()
                        if (v !== '' && v !== group.name) Action.updateGroup(dispatch, group.name, { name: v })
                    }}
                />
            </div>
            {renderExpressionInput({
                helpKey: 'group.expression',
                label: 'グループ式 (ブレーク条件)',
                value: group.expression,
                placeholder: 'field.category',
                onFocus: () => Action.beginTextInput(dispatch),
                onBlur: () => Action.endTextInput(dispatch),
                onChange: (value) => Action.updateGroup(dispatch, group.name, { expression: value })
            })}
            <label className={styles.checkbox} data-help="group.startNewPage">
                <input
                    type="checkbox"
                    checked={group.startNewPage}
                    onChange={(e) => Action.updateGroup(dispatch, group.name, { startNewPage: e.target.checked })}
                />
                グループごとに改ページ
            </label>
            <label className={styles.checkbox} data-help="group.startNewColumn">
                <input
                    type="checkbox"
                    checked={group.startNewColumn}
                    onChange={(e) => Action.updateGroup(dispatch, group.name, { startNewColumn: e.target.checked })}
                />
                グループごとに改カラム
            </label>
            <label className={styles.checkbox} data-help="group.reprintHeaderOnEachPage">
                <input
                    type="checkbox"
                    checked={group.reprintHeaderOnEachPage}
                    onChange={(e) => Action.updateGroup(dispatch, group.name, { reprintHeaderOnEachPage: e.target.checked })}
                />
                改ページ後にヘッダーを再印字
            </label>
            <label className={styles.checkbox} data-help="group.resetPageNumber">
                <input
                    type="checkbox"
                    checked={group.resetPageNumber}
                    onChange={(e) => Action.updateGroup(dispatch, group.name, { resetPageNumber: e.target.checked })}
                />
                ページ番号をリセット
            </label>
            <label className={styles.checkbox} data-help="group.keepTogether">
                <input
                    type="checkbox"
                    checked={group.keepTogether}
                    onChange={(e) => Action.updateGroup(dispatch, group.name, { keepTogether: e.target.checked })}
                />
                グループを同一ページに保持 (keepTogether)
            </label>
            <div className={styles.field} data-help="group.minHeightToStartNewPage">
                <label className={styles.label}>改ページ判定の最低残余高さ ({unitLabel})</label>
                <CmnInputText className={styles.input}
                    value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(group.minHeightToStartNewPage, unit), 3)}
                    onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) Action.updateGroup(dispatch, group.name, { minHeightToStartNewPage: UnitUtils.displayToPt(v, unit) }) }}
                />
            </div>
            <div className={styles.field} data-help="group.footerPosition">
                <label className={styles.label}>フッター位置 (footerPosition)</label>
                <SelectDropdown className={styles.select} value={group.footerPosition}
                    onChange={(e) => Action.updateGroup(dispatch, group.name, { footerPosition: e.target.value as ReportGroup['footerPosition'] })}
                >
                    <option value="normal">normal</option>
                    <option value="stackAtBottom">stackAtBottom</option>
                    <option value="forceAtBottom">forceAtBottom</option>
                    <option value="collateAtBottom">collateAtBottom</option>
                </SelectDropdown>
            </div>
            <button
                type="button"
                className={styles.dangerButton}
                onClick={() => Action.removeGroup(dispatch, group.name)}
            >
                グループを削除
            </button>
        </>
    )
}

// =====================================
// Element property panel
// =====================================
function ElementProperties(props: {
    elementId: string,
    bandId: string,
    state: State,
    dispatch: React.Dispatch<ActionType>,
    fontList: FontEntry[],
    currentFile: EditorCurrentFile | null,
    openReportTemplates: OpenReportTemplate[],
    onResolvedSubreportTemplates: (templates: OpenReportTemplate[]) => void
}) {
    const ui = useUiMessages()
    const { elementId, bandId, state, dispatch, fontList, currentFile, openReportTemplates, onResolvedSubreportTemplates } = props
    const element = getSelectedElement(state)
    if (element === undefined) return null

    const style = element.style
    const unit = state.displayUnit
    const unitLabel = UnitUtils.getUnitLabel(unit)

    const [borderOpen, setBorderOpen] = useState(false)
    const [paddingOpen, setPaddingOpen] = useState(false)
    const [hyperlinkOpen, setHyperlinkOpen] = useState(false)

    if (hasLockedPdfSource(element)) {
        return localizeUiNode((
            <div className={styles.section}>
                <div className={styles.sectionHeader}>{ui.importedPdfVector} [{element.id}]</div>
                <div className={styles.field}>
                    <span className={styles.label}>元PDFの共有構造を保持するため編集ロックされています。</span>
                </div>
                <button
                    type="button"
                    className={styles.addButton}
                    onClick={function () { Action.unlockPdfSourceElements(dispatch, [elementId], bandId) }}
                >
                    明示的にロック解除して編集可能にする
                </button>
            </div>
        ), ui)
    }

    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)
    const updateStyle = (s: Partial<ElementStyle>) => Action.updateElementStyle(dispatch, elementId, bandId, s)

    const isText = element.kind === 'staticText' || element.kind === 'textField'
    const supportsStyleBorder = element.kind !== 'line' && element.kind !== 'rectangle' && element.kind !== 'ellipse'
    // Hide the parent table's basic properties while a table-internal selection is active
    const hideParentProps = element.kind === 'table' && state.tableSelection !== null

    return localizeUiNode((
        <>
            {/* ===== Basic section ===== */}
            {!hideParentProps && <div className={styles.section}>
                <div className={styles.sectionHeader}>要素: {getLocalizedElementKindLabel(element.kind, ui)} [{element.id}]</div>
                <div className={styles.subHeader}>位置・サイズ</div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="element.x">
                        <label className={styles.label}>X ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.x, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ x: UnitUtils.displayToPt(v, unit) }) }} />
                    </div>
                    <div className={styles.field} data-help="element.y">
                        <label className={styles.label}>Y ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.y, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ y: UnitUtils.displayToPt(v, unit) }) }} />
                    </div>
                </div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="element.width">
                        <label className={styles.label}>幅 ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.width, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ width: UnitUtils.displayToPt(v, unit) }) }} />
                    </div>
                    <div className={styles.field} data-help="element.height">
                        <label className={styles.label}>高さ ({unitLabel})</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.height, unit), 3)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ height: UnitUtils.displayToPt(v, unit) }) }} />
                    </div>
                </div>

                {(function () {
                    // Fit-to-parent: only shown for children of frame / tableColumn / tableCell
                    const band = state.template.bands.find(function (b) { return b.id === bandId })
                    if (band === undefined) return null
                    const parent = findParentElement(band.elements, element.id)
                    if (parent === undefined) return null
                    if (parent.kind !== 'frame' && parent.kind !== 'tableColumn' && parent.kind !== 'tableCell') return null
                    return (
                        <>
                            <div className={styles.subHeader}>親フィット</div>
                            <label className={styles.checkbox} data-help="element.fitParentHorizontal">
                                <input type="checkbox" checked={element.fitParentHorizontal}
                                    onChange={(e) => updateProp({ fitParentHorizontal: e.target.checked })} />
                                親の幅にフィット（水平）
                            </label>
                            <label className={styles.checkbox} data-help="element.fitParentVertical">
                                <input type="checkbox" checked={element.fitParentVertical}
                                    onChange={(e) => updateProp({ fitParentVertical: e.target.checked })} />
                                親の高さにフィット（垂直）
                            </label>
                        </>
                    )
                })()}

                <div className={styles.subHeader}>配置制御</div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="element.positionType">
                        <label className={styles.label}>位置タイプ</label>
                        <SelectDropdown className={styles.select} value={element.positionType}
                            onChange={(e) => updateProp({ positionType: e.target.value as TemplateElement['positionType'] })}>
                            <option value="float">Float</option>
                            <option value="fixRelativeToTop">上端固定</option>
                            <option value="fixRelativeToBottom">下端固定</option>
                        </SelectDropdown>
                    </div>
                    <div className={styles.field} data-help="element.stretchType">
                        <label className={styles.label}>伸縮タイプ</label>
                        <SelectDropdown className={styles.select} value={element.stretchType}
                            onChange={(e) => updateProp({ stretchType: e.target.value as TemplateElement['stretchType'] })}>
                            <option value="noStretch">伸縮なし</option>
                            <option value="containerHeight">コンテナ高さ</option>
                            <option value="containerBottom">コンテナ下端</option>
                        </SelectDropdown>
                    </div>
                </div>

                <div className={styles.subHeader}>印刷制御</div>
                {renderExpressionInput({
                    helpKey: 'element.printWhenExpression',
                    label: '表示条件式',
                    value: element.printWhenExpression,
                    placeholder: '(条件式)',
                    onFocus: () => Action.beginTextInput(dispatch),
                    onBlur: () => Action.endTextInput(dispatch),
                    onChange: (value) => updateProp({ printWhenExpression: value })
                })}
                <label className={styles.checkbox} data-help="element.removeLineWhenBlank">
                    <input type="checkbox" checked={element.isRemoveLineWhenBlank}
                        onChange={(e) => updateProp({ isRemoveLineWhenBlank: e.target.checked })} />
                    空白時に行を削除
                </label>
                <label className={styles.checkbox} data-help="element.printRepeatedValues">
                    <input type="checkbox" checked={element.isPrintRepeatedValues}
                        onChange={(e) => updateProp({ isPrintRepeatedValues: e.target.checked })} />
                    繰り返し値を印刷
                </label>

                <div className={styles.subHeader}>表示</div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="element.mode">
                        <label className={styles.label}>描画モード</label>
                        <SelectDropdown className={styles.select} value={style.mode}
                            onChange={(e) => updateStyle({ mode: e.target.value as 'transparent' | 'opaque' })}>
                            <option value="transparent">透明</option>
                            <option value="opaque">不透明</option>
                        </SelectDropdown>
                    </div>
                    <div className={styles.field} data-help="element.opacity">
                        <label className={styles.label}>不透明度</label>
                        <CmnInputText className={styles.input}
                            value={NumberUtils.formatNumber(style.opacity, 1)}
                            onBlur={(e) => updateStyle({ opacity: NumberUtils.parseNumber(e.target.value) })} />
                    </div>
                </div>
                <div className={styles.row}>
                    <div className={styles.field} data-help="element.forecolor">
                        <label className={styles.label}>前景色</label>
                        <ColorInput value={style.forecolor} onChange={(color) => updateStyle({ forecolor: color })} />
                    </div>
                    {style.mode === 'opaque' && (
                        <div className={styles.field} data-help="element.backcolor">
                            <label className={styles.label}>背景色</label>
                            <ColorInput value={style.backcolor} onChange={(color) => updateStyle({ backcolor: color })} />
                        </div>
                    )}
                </div>
            </div>}

            {!hideParentProps && <>
                {/* ===== Border section ===== */}
                {supportsStyleBorder && (
                    <div className={styles.section}>
                        <CollapsibleHeader label="ボーダー" open={borderOpen} onToggle={() => setBorderOpen(!borderOpen)} />
                        {borderOpen && renderBorderSection(style, elementId, bandId, dispatch, unitLabel, unit)}
                    </div>
                )}

                {/* ===== Padding section ===== */}
                <div className={styles.section}>
                    <CollapsibleHeader label="パディング" open={paddingOpen} onToggle={() => setPaddingOpen(!paddingOpen)} />
                    {paddingOpen && renderPaddingSection(style, elementId, bandId, dispatch, unitLabel, unit)}
                </div>

                {/* ===== Element-specific sections ===== */}
                {isText && renderTextProperties(element, elementId, bandId, dispatch, unitLabel, unit, hyperlinkOpen, setHyperlinkOpen, fontList)}
                {element.kind === 'textField' && renderTextFieldProperties(element, elementId, bandId, dispatch)}
                {element.kind === 'line' && renderLineProperties(element, elementId, bandId, dispatch)}
                {(element.kind === 'rectangle' || element.kind === 'ellipse') && renderShapeProperties(element, elementId, bandId, dispatch)}
                {element.kind === 'path' && renderPathProperties(element, elementId, bandId, dispatch, state.pathEditing)}
                {element.kind === 'image' && renderImageProperties(element, elementId, bandId, dispatch, hyperlinkOpen, setHyperlinkOpen)}
                {element.kind === 'svg' && renderSvgProperties(element, elementId, bandId, dispatch)}
                {element.kind === 'barcode' && renderBarcodeProperties(element, elementId, bandId, dispatch)}
                {element.kind === 'math' && renderMathProperties(element, elementId, bandId, dispatch)}
                {element.kind === 'formField' && renderFormFieldProperties(element, elementId, bandId, dispatch)}
                {element.kind === 'break' && renderBreakProperties(element, elementId, bandId, dispatch)}
                {element.kind === 'subreport' && renderSubreportProperties(
                    element,
                    elementId,
                    bandId,
                    state,
                    dispatch,
                    currentFile,
                    openReportTemplates,
                    onResolvedSubreportTemplates,
                )}
                {element.kind === 'crosstab' && renderCrosstabProperties(element, elementId, bandId, state, dispatch)}
            </>}
            {element.kind === 'table' && renderTableProperties(element, elementId, bandId, state, dispatch, fontList)}
        </>
    ), ui)
}

// =====================================
// Border section
// =====================================
function renderBorderSection(
    style: ElementStyle, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>, unitLabel: string, unit: DisplayUnit
) {
    const updateStyle = (s: Partial<ElementStyle>) => Action.updateElementStyle(dispatch, elementId, bandId, s)
    const border = style.border

    // For bulk-set: use the first found side's value as the default
    const firstSide = border.top ?? border.bottom ?? border.left ?? border.right
    const allWidth = firstSide?.width ?? 1
    const allColor = firstSide?.color ?? '#000000'
    const allStyle = firstSide?.style ?? 'solid'

    function setAllBorders(width: number, color: string, lineStyle: 'solid' | 'dashed' | 'dotted') {
        const side = { width, color, style: lineStyle }
        updateStyle({ border: { top: side, bottom: side, left: side, right: side } })
    }

    function updateSide(sideKey: 'top' | 'bottom' | 'left' | 'right', prop: Partial<{ width: number, color: string, style: 'solid' | 'dashed' | 'dotted' }>) {
        const current = border[sideKey] ?? { width: 0, color: '#000000', style: 'solid' as const }
        updateStyle({ border: { ...border, [sideKey]: { ...current, ...prop } } })
    }

    function clearSide(sideKey: 'top' | 'bottom' | 'left' | 'right') {
        updateStyle({ border: { ...border, [sideKey]: null } })
    }

    return (
        <>
            <div className={styles.subHeader}>一括設定</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="border.allWidth">
                    <label className={styles.label}>幅 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(allWidth, 1)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) setAllBorders(v, allColor, allStyle) }} />
                </div>
                <div className={styles.field} data-help="border.allColor">
                    <label className={styles.label}>色</label>
                    <ColorInput value={allColor} onChange={(color) => setAllBorders(allWidth, color, allStyle)} />
                </div>
                <div className={styles.field} data-help="border.allStyle">
                    <label className={styles.label}>スタイル</label>
                    <SelectDropdown className={styles.select} value={allStyle}
                        onChange={(e) => setAllBorders(allWidth, allColor, e.target.value as 'solid' | 'dashed' | 'dotted')}>
                        <option value="solid">実線</option>
                        <option value="dashed">破線</option>
                        <option value="dotted">点線</option>
                    </SelectDropdown>
                </div>
            </div>

            {(['top', 'bottom', 'left', 'right'] as const).map(sideKey => {
                const side = border[sideKey]
                const label = sideKey === 'top' ? '上' : sideKey === 'bottom' ? '下' : sideKey === 'left' ? '左' : '右'
                return (
                    <div key={sideKey}>
                        <div className={styles.subHeader}>{label}辺</div>
                        <label className={styles.checkbox} data-help="border.sideEnabled">
                            <input type="checkbox" checked={side !== null}
                                onChange={(e) => e.target.checked ? updateSide(sideKey, {}) : clearSide(sideKey)} />
                            有効
                        </label>
                        {side !== null && (
                            <div className={styles.row}>
                                <div className={styles.field} data-help="border.sideWidth">
                                    <label className={styles.label}>幅 (pt)</label>
                                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(side.width, 1)}
                                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateSide(sideKey, { width: v }) }} />
                                </div>
                                <div className={styles.field} data-help="border.sideColor">
                                    <label className={styles.label}>色</label>
                                    <ColorInput value={side.color} onChange={(color) => updateSide(sideKey, { color: color })} />
                                </div>
                                <div className={styles.field} data-help="border.sideStyle">
                                    <label className={styles.label}>スタイル</label>
                                    <SelectDropdown className={styles.select} value={side.style}
                                        onChange={(e) => updateSide(sideKey, { style: e.target.value as 'solid' | 'dashed' | 'dotted' })}>
                                        <option value="solid">実線</option>
                                        <option value="dashed">破線</option>
                                        <option value="dotted">点線</option>
                                    </SelectDropdown>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
        </>
    )
}

// =====================================
// Padding section
// =====================================
function renderPaddingSection(
    style: ElementStyle, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>, unitLabel: string, unit: DisplayUnit
) {
    const updateStyle = (s: Partial<ElementStyle>) => Action.updateElementStyle(dispatch, elementId, bandId, s)

    return (
        <>
            <div className={styles.row}>
                <div className={styles.field} data-help="padding.top">
                    <label className={styles.label}>上 ({unitLabel})</label>
                    <CmnInputText className={styles.input}
                        value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(style.padding.top, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateStyle({ padding: { ...style.padding, top: UnitUtils.displayToPt(v, unit) } }) }} />
                </div>
                <div className={styles.field} data-help="padding.bottom">
                    <label className={styles.label}>下 ({unitLabel})</label>
                    <CmnInputText className={styles.input}
                        value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(style.padding.bottom, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateStyle({ padding: { ...style.padding, bottom: UnitUtils.displayToPt(v, unit) } }) }} />
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="padding.left">
                    <label className={styles.label}>左 ({unitLabel})</label>
                    <CmnInputText className={styles.input}
                        value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(style.padding.left, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateStyle({ padding: { ...style.padding, left: UnitUtils.displayToPt(v, unit) } }) }} />
                </div>
                <div className={styles.field} data-help="padding.right">
                    <label className={styles.label}>右 ({unitLabel})</label>
                    <CmnInputText className={styles.input}
                        value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(style.padding.right, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateStyle({ padding: { ...style.padding, right: UnitUtils.displayToPt(v, unit) } }) }} />
                </div>
            </div>
        </>
    )
}

// =====================================
// Common text properties (staticText/textField)
// =====================================
function renderTextProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>, unitLabel: string, unit: string,
    hyperlinkOpen: boolean, setHyperlinkOpen: (v: boolean) => void,
    fontList: FontEntry[]
) {
    const style = element.style
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)
    const updateStyle = (s: Partial<ElementStyle>) => Action.updateElementStyle(dispatch, elementId, bandId, s)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>テキスト設定</div>

            {/* Text content */}
            {element.kind === 'staticText' && (
                <div className={styles.field} data-help="text.text">
                    <label className={styles.label}>テキスト</label>
                    <textarea className={styles.textarea} value={element.text} rows={3}
                        onFocus={() => Action.beginTextInput(dispatch)}
                        onChange={(e) => updateProp({ text: e.target.value })}
                        onBlur={() => Action.endTextInput(dispatch)} />
                </div>
            )}
            {element.kind === 'textField' && renderExpressionInput({
                helpKey: 'text.expression',
                label: '式',
                value: element.expression,
                onFocus: () => Action.beginTextInput(dispatch),
                onBlur: () => Action.endTextInput(dispatch),
                onChange: (value) => updateProp({ expression: value })
            })}

            {/* Font */}
            <div className={styles.subHeader}>フォント</div>
            <div className={styles.field} data-help="text.fontFamily">
                <label className={styles.label}>フォント</label>
                {fontList.length > 0 ? (
                    <SelectDropdown className={styles.select} value={style.fontFamily}
                        onChange={(e) => updateStyle({ fontFamily: e.target.value })}>
                        {fontList.map(f => (
                            <option key={f.path} value={f.name}>{f.name}</option>
                        ))}
                        {fontList.every(f => f.name !== style.fontFamily) && (
                            <option value={style.fontFamily}>{style.fontFamily}</option>
                        )}
                    </SelectDropdown>
                ) : (
                    <input className={styles.input} type="text" value={style.fontFamily}
                        onFocus={() => Action.beginTextInput(dispatch)}
                        onChange={(e) => updateStyle({ fontFamily: e.target.value })}
                        onBlur={() => Action.endTextInput(dispatch)} />
                )}
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.fontSize">
                    <label className={styles.label}>サイズ (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(style.fontSize)}
                        onBlur={(e) => updateStyle({ fontSize: NumberUtils.parseNumber(e.target.value) })} />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>装飾</label>
                    <div className={styles.toggleRow}>
                        <button className={`${styles.toggleButton} ${style.bold ? styles.toggleActive : ''}`}
                            onClick={() => updateStyle({ bold: !style.bold })} title="太字"><b>B</b></button>
                        <button className={`${styles.toggleButton} ${style.italic ? styles.toggleActive : ''}`}
                            onClick={() => updateStyle({ italic: !style.italic })} title="斜体"><i>I</i></button>
                        <button className={`${styles.toggleButton} ${style.underline ? styles.toggleActive : ''}`}
                            onClick={() => updateStyle({ underline: !style.underline })} title="下線"><u>U</u></button>
                        <button className={`${styles.toggleButton} ${style.strikethrough ? styles.toggleActive : ''}`}
                            onClick={() => updateStyle({ strikethrough: !style.strikethrough })} title="取消線"><s>S</s></button>
                    </div>
                </div>
            </div>

            {/* Alignment */}
            <div className={styles.subHeader}>配置</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.hAlign">
                    <label className={styles.label}>水平</label>
                    <SelectDropdown className={styles.select} value={style.hAlign}
                        onChange={(e) => updateStyle({ hAlign: e.target.value as HAlign })}>
                        <option value="left">左</option>
                        <option value="center">中央</option>
                        <option value="right">右</option>
                        <option value="justified">均等</option>
                    </SelectDropdown>
                </div>
                <div className={styles.field} data-help="text.vAlign">
                    <label className={styles.label}>垂直</label>
                    <SelectDropdown className={styles.select} value={style.vAlign}
                        onChange={(e) => updateStyle({ vAlign: e.target.value as VAlign })}>
                        <option value="top">上</option>
                        <option value="middle">中央</option>
                        <option value="bottom">下</option>
                    </SelectDropdown>
                </div>
            </div>
            <div className={styles.field} data-help="text.rotation">
                <label className={styles.label}>回転</label>
                <SelectDropdown className={styles.select} value={style.rotation}
                    onChange={(e) => updateStyle({ rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })}>
                    <option value={0}>0°</option>
                    <option value={90}>90°</option>
                    <option value={180}>180°</option>
                    <option value={270}>270°</option>
                </SelectDropdown>
            </div>

            {/* Paragraph settings */}
            <div className={styles.subHeader}>段落</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.markup">
                    <label className={styles.label}>マークアップ</label>
                    <SelectDropdown className={styles.select} value={element.markup}
                        onChange={(e) => updateProp({ markup: e.target.value as 'none' | 'styled' | 'html' })}>
                        <option value="none">なし</option>
                        <option value="styled">Styled</option>
                        <option value="html">HTML</option>
                    </SelectDropdown>
                </div>
                <div className={styles.field} data-help="text.direction">
                    <label className={styles.label}>テキスト方向</label>
                    <SelectDropdown className={styles.select} value={element.direction}
                        onChange={(e) => updateProp({ direction: e.target.value as TemplateElement['direction'] })}>
                        <option value="ltr">LTR</option>
                        <option value="rtl">RTL</option>
                        <option value="auto">自動</option>
                    </SelectDropdown>
                </div>
            </div>
            <div className={styles.field} data-help="text.writingMode">
                <label className={styles.label}>書字方向</label>
                <SelectDropdown className={styles.select} value={element.writingMode}
                    onChange={(e) => updateProp({ writingMode: e.target.value as TemplateElement['writingMode'] })}>
                    <option value="horizontal-tb">横書き</option>
                    <option value="vertical-rl">縦書き（右→左）</option>
                    <option value="vertical-lr">縦書き（左→右）</option>
                </SelectDropdown>
            </div>

            {/* Line spacing */}
            <div className={styles.subHeader}>行間</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.lineSpacingType">
                    <label className={styles.label}>タイプ</label>
                    <SelectDropdown className={styles.select} value={element.lineSpacingType}
                        onChange={(e) => updateProp({ lineSpacingType: e.target.value as TemplateElement['lineSpacingType'] })}>
                        <option value="single">1行</option>
                        <option value="1.5">1.5行</option>
                        <option value="double">2行</option>
                        <option value="proportional">比率指定</option>
                        <option value="fixed">固定</option>
                        <option value="minimum">最小</option>
                    </SelectDropdown>
                </div>
                <div className={styles.field} data-help="text.lineSpacingValue">
                    <label className={styles.label}>値</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.lineSpacingValue, 1)}
                        onBlur={(e) => updateProp({ lineSpacingValue: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>

            {/* Spacing / indent */}
            <div className={styles.subHeader}>間隔・インデント</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.letterSpacing">
                    <label className={styles.label}>字間 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.letterSpacing, 1)}
                        onBlur={(e) => updateProp({ letterSpacing: NumberUtils.parseNumber(e.target.value) })} />
                </div>
                <div className={styles.field} data-help="text.wordSpacing">
                    <label className={styles.label}>語間 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.wordSpacing, 1)}
                        onBlur={(e) => updateProp({ wordSpacing: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.firstLineIndent">
                    <label className={styles.label}>先頭行字下げ (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.firstLineIndent)}
                        onBlur={(e) => updateProp({ firstLineIndent: NumberUtils.parseNumber(e.target.value) })} />
                </div>
                <div className={styles.field} data-help="text.tabStopWidth">
                    <label className={styles.label}>タブ幅 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.tabStopWidth)}
                        onBlur={(e) => updateProp({ tabStopWidth: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.leftIndent">
                    <label className={styles.label}>左インデント (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.leftIndent)}
                        onBlur={(e) => updateProp({ leftIndent: NumberUtils.parseNumber(e.target.value) })} />
                </div>
                <div className={styles.field} data-help="text.rightIndent">
                    <label className={styles.label}>右インデント (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.rightIndent)}
                        onBlur={(e) => updateProp({ rightIndent: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>

            {/* Text control */}
            <div className={styles.subHeader}>テキスト制御</div>
            <label className={styles.checkbox} data-help="text.wrap">
                <input type="checkbox" checked={element.wrap !== false}
                    onChange={(e) => updateProp({ wrap: e.target.checked })} />
                折り返し
            </label>
            <label className={styles.checkbox} data-help="text.shrinkToFit">
                <input type="checkbox" checked={element.shrinkToFit}
                    onChange={(e) => updateProp({ shrinkToFit: e.target.checked })} />
                縮小して収める
            </label>
            {element.shrinkToFit && (
                <div className={styles.field} data-help="text.minFontSize">
                    <label className={styles.label}>最小フォントサイズ (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.minFontSize)}
                        onBlur={(e) => updateProp({ minFontSize: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            )}
            <label className={styles.checkbox} data-help="text.fitWidth">
                <input type="checkbox" checked={element.fitWidth}
                    onChange={(e) => updateProp({ fitWidth: e.target.checked })} />
                幅に合わせる
            </label>
            <div className={styles.field} data-help="text.outlineText">
                <label className={styles.label}>PDF文字出力</label>
                <SelectDropdown className={styles.select} value={element.pdfTextMode}
                    onChange={(e) => updateProp({ pdfTextMode: e.target.value as TemplateElement['pdfTextMode'], outlineText: false })}>
                    <option value="embedded">フォントを埋め込む</option>
                    <option value="outline">アウトライン化</option>
                    <option value="system">システムフォントを参照</option>
                </SelectDropdown>
            </div>

            {/* Bookmark */}
            <div className={styles.subHeader}>ブックマーク</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="text.anchorName">
                    <label className={styles.label}>アンカー名</label>
                    <input className={styles.input} type="text" value={element.anchorName}
                        onFocus={() => Action.beginTextInput(dispatch)}
                        onChange={(e) => updateProp({ anchorName: e.target.value })}
                        onBlur={() => Action.endTextInput(dispatch)} />
                </div>
                <div className={styles.field} data-help="text.bookmarkLevel">
                    <label className={styles.label}>レベル</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.bookmarkLevel)}
                        onBlur={(e) => updateProp({ bookmarkLevel: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>

            {/* Hyperlink */}
            <CollapsibleHeader label="ハイパーリンク" open={hyperlinkOpen} onToggle={() => setHyperlinkOpen(!hyperlinkOpen)} />
            {hyperlinkOpen && renderHyperlinkSection(element, elementId, bandId, dispatch)}
        </div>
    )
}

// =====================================
// Hyperlink section
// =====================================
function renderHyperlinkSection(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <>
            <div className={styles.field} data-help="hyperlink.type">
                <label className={styles.label}>リンクタイプ</label>
                <SelectDropdown className={styles.select} value={element.hyperlinkType}
                    onChange={(e) => updateProp({ hyperlinkType: e.target.value as TemplateElement['hyperlinkType'] })}>
                    <option value="">なし</option>
                    <option value="reference">参照</option>
                    <option value="localAnchor">ローカルアンカー</option>
                    <option value="localPage">ローカルページ</option>
                    <option value="remoteAnchor">リモートアンカー</option>
                    <option value="remotePage">リモートページ</option>
                </SelectDropdown>
            </div>
            {element.hyperlinkType !== '' && (
                <>
                    <div className={styles.field} data-help="hyperlink.target">
                        <label className={styles.label}>リンク先</label>
                        <input className={styles.input} type="text" value={element.hyperlinkTarget}
                            onFocus={() => Action.beginTextInput(dispatch)}
                            onChange={(e) => updateProp({ hyperlinkTarget: e.target.value })}
                            onBlur={() => Action.endTextInput(dispatch)} />
                    </div>
                    {(element.hyperlinkType === 'remoteAnchor' || element.hyperlinkType === 'remotePage') && (
                        <div className={styles.field} data-help="hyperlink.remoteDocument">
                            <label className={styles.label}>リモートドキュメント</label>
                            <input className={styles.input} type="text" value={element.hyperlinkRemoteDocument}
                                onFocus={() => Action.beginTextInput(dispatch)}
                                onChange={(e) => updateProp({ hyperlinkRemoteDocument: e.target.value })}
                                onBlur={() => Action.endTextInput(dispatch)} />
                        </div>
                    )}
                </>
            )}
        </>
    )
}

// =====================================
// textField-specific properties
// =====================================
function renderTextFieldProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>テキストフィールド設定</div>
            <div className={styles.field} data-help="textField.pattern">
                <label className={styles.label}>パターン</label>
                <input className={styles.input} type="text" value={element.pattern} placeholder="例: #,##0.00"
                    onFocus={() => Action.beginTextInput(dispatch)}
                    onChange={(e) => updateProp({ pattern: e.target.value })}
                    onBlur={() => Action.endTextInput(dispatch)} />
            </div>
            <label className={styles.checkbox} data-help="textField.blankWhenNull">
                <input type="checkbox" checked={element.blankWhenNull}
                    onChange={(e) => updateProp({ blankWhenNull: e.target.checked })} />
                Null時空白
            </label>
            <label className={styles.checkbox} data-help="textField.stretchWithOverflow">
                <input type="checkbox" checked={element.stretchWithOverflow}
                    onChange={(e) => updateProp({ stretchWithOverflow: e.target.checked })} />
                オーバーフロー時伸縮
            </label>
            <div className={styles.row}>
                <div className={styles.field} data-help="textField.evaluationTime">
                    <label className={styles.label}>評価タイミング</label>
                    <SelectDropdown className={styles.select} value={element.evaluationTime}
                        onChange={(e) => updateProp({ evaluationTime: e.target.value as TemplateElement['evaluationTime'] })}>
                        <option value="now">Now</option>
                        <option value="band">Band</option>
                        <option value="column">Column</option>
                        <option value="page">Page</option>
                        <option value="group">Group</option>
                        <option value="report">Report</option>
                        <option value="auto">Auto</option>
                    </SelectDropdown>
                </div>
                {element.evaluationTime === 'group' && (
                    <div className={styles.field} data-help="textField.evaluationGroup">
                        <label className={styles.label}>評価グループ</label>
                        <input className={styles.input} type="text" value={element.evaluationGroup}
                            onFocus={() => Action.beginTextInput(dispatch)}
                            onChange={(e) => updateProp({ evaluationGroup: e.target.value })}
                            onBlur={() => Action.endTextInput(dispatch)} />
                    </div>
                )}
            </div>
            <div className={styles.field} data-help="textField.textTruncate">
                <label className={styles.label}>テキスト切り詰め</label>
                <SelectDropdown className={styles.select} value={element.textTruncate}
                    onChange={(e) => updateProp({ textTruncate: e.target.value as TemplateElement['textTruncate'] })}>
                    <option value="none">なし</option>
                    <option value="truncate">切り詰め</option>
                    <option value="ellipsisChar">省略記号（文字）</option>
                    <option value="ellipsisWord">省略記号（単語）</option>
                </SelectDropdown>
            </div>
        </div>
    )
}

// =====================================
// line-specific properties
// =====================================
function renderLineProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>線設定</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="line.lineWidth">
                    <label className={styles.label}>線幅 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.lineWidth, 1)}
                        onBlur={(e) => updateProp({ lineWidth: NumberUtils.parseNumber(e.target.value) })} />
                </div>
                <div className={styles.field} data-help="line.lineStyle">
                    <label className={styles.label}>線種</label>
                    <SelectDropdown className={styles.select} value={element.lineStyle}
                        onChange={(e) => updateProp({ lineStyle: e.target.value as TemplateElement['lineStyle'] })}>
                        <option value="solid">実線</option>
                        <option value="dashed">破線</option>
                        <option value="dotted">点線</option>
                    </SelectDropdown>
                </div>
            </div>
            <div className={styles.field} data-help="line.lineColor">
                <label className={styles.label}>線色</label>
                <ColorInput value={element.lineColor} onChange={(color) => updateProp({ lineColor: color })} />
            </div>
        </div>
    )
}

// =====================================
// rectangle/ellipse-specific properties
// =====================================
function renderShapeProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)
    const setUniformRadius = (radius: number) => {
        updateProp({
            radius,
            topLeftRadius: radius,
            topRightRadius: radius,
            bottomRightRadius: radius,
            bottomLeftRadius: radius,
        })
    }
    const updateCornerRadius = (
        key: 'topLeftRadius' | 'topRightRadius' | 'bottomRightRadius' | 'bottomLeftRadius',
        radius: number,
    ) => {
        const nextTopLeftRadius = key === 'topLeftRadius' ? radius : element.topLeftRadius
        const nextTopRightRadius = key === 'topRightRadius' ? radius : element.topRightRadius
        const nextBottomRightRadius = key === 'bottomRightRadius' ? radius : element.bottomRightRadius
        const nextBottomLeftRadius = key === 'bottomLeftRadius' ? radius : element.bottomLeftRadius
        const nextRadius = nextTopLeftRadius === nextTopRightRadius
            && nextTopLeftRadius === nextBottomRightRadius
            && nextTopLeftRadius === nextBottomLeftRadius
            ? nextTopLeftRadius
            : 0
        updateProp({
            [key]: radius,
            radius: nextRadius,
        } as Partial<TemplateElement>)
    }
    const label = element.kind === 'rectangle' ? '矩形設定' : '楕円設定'
    const angle = Math.atan2(element.shapeGradient.y2 - element.shapeGradient.y1, element.shapeGradient.x2 - element.shapeGradient.x1) * 180 / Math.PI

    function updateShapeGradient(patch: Partial<TemplateElement['shapeGradient']>) {
        updateProp({ shapeGradient: { ...element.shapeGradient, ...patch, pdfShading: undefined } })
    }

    function updateLinearAngle(degrees: number) {
        const radians = degrees * Math.PI / 180
        const dx = Math.cos(radians) * 0.5
        const dy = Math.sin(radians) * 0.5
        updateShapeGradient({
            x1: clamp01(0.5 - dx),
            y1: clamp01(0.5 - dy),
            x2: clamp01(0.5 + dx),
            y2: clamp01(0.5 + dy),
        })
    }

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>{label}</div>
            {element.kind === 'rectangle' && (
                <>
                    <div className={styles.field} data-help="shape.radius">
                        <label className={styles.label}>角丸半径（一括） (pt)</label>
                        <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.radius)}
                            onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) setUniformRadius(v) }} />
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="shape.topLeftRadius">
                            <label className={styles.label}>左上</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.topLeftRadius)}
                                onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateCornerRadius('topLeftRadius', v) }} />
                        </div>
                        <div className={styles.field} data-help="shape.topRightRadius">
                            <label className={styles.label}>右上</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.topRightRadius)}
                                onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateCornerRadius('topRightRadius', v) }} />
                        </div>
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="shape.bottomRightRadius">
                            <label className={styles.label}>右下</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.bottomRightRadius)}
                                onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateCornerRadius('bottomRightRadius', v) }} />
                        </div>
                        <div className={styles.field} data-help="shape.bottomLeftRadius">
                            <label className={styles.label}>左下</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.bottomLeftRadius)}
                                onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateCornerRadius('bottomLeftRadius', v) }} />
                        </div>
                    </div>
                </>
            )}
            <div className={styles.subHeader}>塗り</div>
            <div className={styles.field} data-help="shape.fillType">
                <label className={styles.label}>種類</label>
                <SelectDropdown className={styles.select} value={element.shapeFillType}
                    onChange={(e) => updateProp({ shapeFillType: e.target.value as TemplateElement['shapeFillType'] })}>
                    <option value="none">なし</option>
                    <option value="solid">単色</option>
                    <option value="linear">線形グラデーション</option>
                    <option value="radial">放射グラデーション</option>
                </SelectDropdown>
            </div>
            {element.shapeFillType === 'solid' && (
                <div className={styles.field} data-help="shape.fill">
                    <label className={styles.label}>塗り色</label>
                    <ColorInput value={element.shapeFillColor} onChange={(color) => updateProp({ shapeFillColor: color, fill: color })} />
                </div>
            )}
            {element.shapeFillType === 'linear' && (
                <>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="shape.linearAngle">
                            <label className={styles.label}>角度</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(angle, 1)}
                                onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateLinearAngle(v) }} />
                        </div>
                        <div className={styles.field} data-help="shape.linearX1">
                            <label className={styles.label}>開始X (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.shapeGradient.x1)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateShapeGradient({ x1: v }) }} />
                        </div>
                        <div className={styles.field} data-help="shape.linearY1">
                            <label className={styles.label}>開始Y (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.shapeGradient.y1)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateShapeGradient({ y1: v }) }} />
                        </div>
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="shape.linearX2">
                            <label className={styles.label}>終了X (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.shapeGradient.x2)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateShapeGradient({ x2: v }) }} />
                        </div>
                        <div className={styles.field} data-help="shape.linearY2">
                            <label className={styles.label}>終了Y (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.shapeGradient.y2)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateShapeGradient({ y2: v }) }} />
                        </div>
                    </div>
                    {renderGradientStopsEditor(element.shapeGradient.stops, function (stops) { updateShapeGradient({ stops }) }, 'shape.gradientStops')}
                </>
            )}
            {element.shapeFillType === 'radial' && (
                <>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="shape.radialCx">
                            <label className={styles.label}>中心X (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.shapeGradient.cx)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateShapeGradient({ cx: v }) }} />
                        </div>
                        <div className={styles.field} data-help="shape.radialCy">
                            <label className={styles.label}>中心Y (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.shapeGradient.cy)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateShapeGradient({ cy: v }) }} />
                        </div>
                        <div className={styles.field} data-help="shape.radialR">
                            <label className={styles.label}>半径 (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.shapeGradient.r)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateShapeGradient({ r: v }) }} />
                        </div>
                    </div>
                    {renderGradientStopsEditor(element.shapeGradient.stops, function (stops) { updateShapeGradient({ stops }) }, 'shape.gradientStops')}
                </>
            )}
            <div className={styles.subHeader}>線</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="shape.stroke">
                    <label className={styles.label}>枠線色</label>
                    <ColorInput value={element.stroke} onChange={(color) => updateProp({ stroke: color })} />
                </div>
            </div>
            <div className={styles.field} data-help="shape.strokeWidth">
                <label className={styles.label}>枠線幅 (pt)</label>
                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.strokeWidth, 1)}
                    onBlur={(e) => updateProp({ strokeWidth: NumberUtils.parseNumber(e.target.value) })} />
            </div>
        </div>
    )
}

function renderGradientStopsEditor(
    stops: PathGradientStop[],
    onChange: (stops: PathGradientStop[]) => void,
    helpKey: string
) {
    const sorted = stops.slice().sort(function (a, b) { return a.offset - b.offset })
    const preview = sorted.length === 0
        ? '#ffffff'
        : `linear-gradient(to right, ${sorted.map(function (stop) { return `${stop.color} ${formatPercent(stop.offset)}%` }).join(', ')})`

    function updateStop(index: number, patch: Partial<PathGradientStop>) {
        const next = sorted.map(function (stop, i) {
            if (i !== index) return stop
            return { ...stop, ...patch, offset: patch.offset !== undefined ? clamp01(patch.offset) : stop.offset }
        })
        onChange(next.sort(function (a, b) { return a.offset - b.offset }))
    }

    function addStop() {
        const offset = sorted.length === 0 ? 0.5 : 0.5
        onChange(sorted.concat([{ offset, color: interpolateStopColor(sorted, offset) }]).sort(function (a, b) { return a.offset - b.offset }))
    }

    function removeStop(index: number) {
        if (sorted.length <= 2) return
        onChange(sorted.filter(function (_, i) { return i !== index }))
    }

    return (
        <div className={styles.gradientStopsEditor} data-help={helpKey}>
            <div className={styles.gradientPreview} style={{ background: preview }}>
                {sorted.map(function (stop, index) {
                    return (
                        <span
                            key={`${index}_${stop.offset}_${stop.color}`}
                            className={styles.gradientStopMarker}
                            style={{ left: `${stop.offset * 100}%`, backgroundColor: displayHexOf(stop.color) }}
                        />
                    )
                })}
            </div>
            {sorted.map(function (stop, index) {
                return (
                    <div key={index} className={styles.gradientStopRow}>
                        <ColorInput value={stop.color}
                            onChange={(color) => updateStop(index, { color })} />
                        <input
                            className={styles.gradientRange}
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={Math.round(stop.offset * 100)}
                            onChange={(e) => updateStop(index, { offset: Number(e.target.value) / 100 })}
                        />
                        <CmnInputText
                            className={styles.stopOffsetInput}
                            value={formatPercent(stop.offset)}
                            onBlur={(e) => {
                                const v = parseUnitIntervalPercent(e.target.value)
                                if (v !== undefined) updateStop(index, { offset: v })
                            }}
                        />
                        <CmnInputText
                            className={styles.stopOpacityInput}
                            value={NumberUtils.formatNumber((stop.opacity ?? 1) * 100, 1)}
                            onBlur={(e) => {
                                const v = parseUnitIntervalPercent(e.target.value)
                                if (v !== undefined) updateStop(index, { opacity: v })
                            }}
                        />
                        <button
                            type="button"
                            className={styles.miniButton}
                            disabled={sorted.length <= 2}
                            onClick={() => removeStop(index)}
                        >
                            削除
                        </button>
                    </div>
                )
            })}
            <button type="button" className={styles.addButton} onClick={addStop}>停止点を追加</button>
        </div>
    )
}

function renderPathProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>,
    pathEditing: State['pathEditing'],
) {
    const isPathEditing = pathEditing !== null && pathEditing.elementId === elementId
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)
    const anchorCount = element.pathSubpaths.reduce(function (sum, subpath) { return sum + subpath.anchors.length }, 0)
    const allClosed = element.pathSubpaths.length > 0 && element.pathSubpaths.every(function (subpath) { return subpath.closed })
    const angle = Math.atan2(element.pathGradient.y2 - element.pathGradient.y1, element.pathGradient.x2 - element.pathGradient.x1) * 180 / Math.PI

    function updateGradient(patch: Partial<TemplateElement['pathGradient']>) {
        updateProp({ pathGradient: { ...element.pathGradient, ...patch, pdfShading: undefined } })
    }

    function updateLinearAngle(degrees: number) {
        const radians = degrees * Math.PI / 180
        const dx = Math.cos(radians) * 0.5
        const dy = Math.sin(radians) * 0.5
        updateGradient({
            x1: clamp01(0.5 - dx),
            y1: clamp01(0.5 - dy),
            x2: clamp01(0.5 + dx),
            y2: clamp01(0.5 + dy),
        })
    }

    function updateClosed(closed: boolean) {
        updateProp({
            pathSubpaths: element.pathSubpaths.map(function (subpath) {
                return { ...subpath, closed: subpath.anchors.length > 1 ? closed : false }
            }),
        })
    }

    function setDashPreset(value: string) {
        if (value === 'solid') updateProp({ pathStrokeDash: [] })
        if (value === 'dash') updateProp({ pathStrokeDash: [6, 3] })
        if (value === 'dot') updateProp({ pathStrokeDash: [1, 3] })
        if (value === 'dashdot') updateProp({ pathStrokeDash: [6, 3, 1, 3] })
    }

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>パス設定</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="path.anchorCount">
                    <label className={styles.label}>アンカー数</label>
                    <input className={styles.input} type="text" value={anchorCount} readOnly />
                </div>
                <div className={styles.field} data-help="path.edit">
                    <label className={styles.label}>編集</label>
                    <button
                        type="button"
                        className={styles.pathEditButton + (isPathEditing ? ' ' + styles.pathEditButtonActive : '')}
                        onClick={() => Action.setPathEdit(dispatch, isPathEditing ? null : { elementId, bandId, anchor: null })}
                    >
                        {isPathEditing ? '編集を終了' : 'パスを編集'}
                    </button>
                </div>
            </div>
            <label className={styles.checkbox} data-help="path.closed">
                <input type="checkbox" checked={allClosed} onChange={(e) => updateClosed(e.target.checked)} />
                閉じたパス
            </label>

            <div className={styles.subHeader}>塗り</div>
            <div className={styles.field} data-help="path.fillType">
                <label className={styles.label}>種類</label>
                <SelectDropdown className={styles.select} value={element.pathFillType}
                    onChange={(e) => updateProp({ pathFillType: e.target.value as TemplateElement['pathFillType'] })}>
                    <option value="none">なし</option>
                    <option value="solid">単色</option>
                    <option value="linear">線形グラデーション</option>
                    <option value="radial">放射グラデーション</option>
                    {element.pathFillType === 'mesh' && <option value="mesh">メッシュグラデーション（取込み）</option>}
                    {element.pathFillType === 'pattern' && <option value="pattern">タイリングパターン（取込み）</option>}
                </SelectDropdown>
            </div>
            {element.pathFillType === 'solid' && (
                <div className={styles.field} data-help="path.fillColor">
                    <label className={styles.label}>塗り色</label>
                    <ColorInput value={element.pathFillColor} onChange={(color) => updateProp({ pathFillColor: color })} />
                </div>
            )}
            {element.pathFillType === 'linear' && (
                <>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="path.linearAngle">
                            <label className={styles.label}>角度</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(angle, 1)}
                                onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateLinearAngle(v) }} />
                        </div>
                        <div className={styles.field} data-help="path.linearX1">
                            <label className={styles.label}>開始X (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.pathGradient.x1)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateGradient({ x1: v }) }} />
                        </div>
                        <div className={styles.field} data-help="path.linearY1">
                            <label className={styles.label}>開始Y (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.pathGradient.y1)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateGradient({ y1: v }) }} />
                        </div>
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="path.linearX2">
                            <label className={styles.label}>終了X (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.pathGradient.x2)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateGradient({ x2: v }) }} />
                        </div>
                        <div className={styles.field} data-help="path.linearY2">
                            <label className={styles.label}>終了Y (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.pathGradient.y2)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateGradient({ y2: v }) }} />
                        </div>
                    </div>
                    {renderGradientStopsEditor(element.pathGradient.stops, function (stops) { updateGradient({ stops }) }, 'path.gradientStops')}
                </>
            )}
            {element.pathFillType === 'radial' && (
                <>
                    <div className={styles.row}>
                        <div className={styles.field} data-help="path.radialCx">
                            <label className={styles.label}>中心X (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.pathGradient.cx)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateGradient({ cx: v }) }} />
                        </div>
                        <div className={styles.field} data-help="path.radialCy">
                            <label className={styles.label}>中心Y (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.pathGradient.cy)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateGradient({ cy: v }) }} />
                        </div>
                        <div className={styles.field} data-help="path.radialR">
                            <label className={styles.label}>半径 (%)</label>
                            <CmnInputText className={styles.input} value={formatPercent(element.pathGradient.r)}
                                onBlur={(e) => { const v = parseUnitIntervalPercent(e.target.value); if (v !== undefined) updateGradient({ r: v }) }} />
                        </div>
                    </div>
                    {renderGradientStopsEditor(element.pathGradient.stops, function (stops) { updateGradient({ stops }) }, 'path.gradientStops')}
                </>
            )}

            <div className={styles.subHeader}>線</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="path.stroke">
                    <label className={styles.label}>線色</label>
                    <ColorInput value={element.stroke} onChange={(color) => updateProp({ stroke: color })} />
                </div>
                <div className={styles.field} data-help="path.strokeWidth">
                    <label className={styles.label}>線幅 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.strokeWidth, 1)}
                        onBlur={(e) => updateProp({ strokeWidth: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="path.strokeCap">
                    <label className={styles.label}>端</label>
                    <SelectDropdown className={styles.select} value={element.pathStrokeCap}
                        onChange={(e) => updateProp({ pathStrokeCap: e.target.value as TemplateElement['pathStrokeCap'] })}>
                        <option value="butt">フラット</option>
                        <option value="round">丸</option>
                        <option value="square">四角</option>
                    </SelectDropdown>
                </div>
                <div className={styles.field} data-help="path.strokeJoin">
                    <label className={styles.label}>角</label>
                    <SelectDropdown className={styles.select} value={element.pathStrokeJoin}
                        onChange={(e) => updateProp({ pathStrokeJoin: e.target.value as TemplateElement['pathStrokeJoin'] })}>
                        <option value="miter">マイター</option>
                        <option value="round">丸</option>
                        <option value="bevel">ベベル</option>
                    </SelectDropdown>
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="path.strokeDashPreset">
                    <label className={styles.label}>破線プリセット</label>
                    <SelectDropdown className={styles.select} value="custom" onChange={(e) => setDashPreset(e.target.value)}>
                        <option value="custom">カスタム</option>
                        <option value="solid">実線</option>
                        <option value="dash">破線</option>
                        <option value="dot">点線</option>
                        <option value="dashdot">一点鎖線</option>
                    </SelectDropdown>
                </div>
                <div className={styles.field} data-help="path.strokeDash">
                    <label className={styles.label}>破線配列</label>
                    <CmnInputText className={styles.input} value={element.pathStrokeDash.join(' ')}
                        onBlur={(e) => updateProp({ pathStrokeDash: parseDashArray(e.target.value) })} />
                </div>
            </div>
        </div>
    )
}

// =====================================
// image-specific properties
// =====================================
function renderImageProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>,
    hyperlinkOpen: boolean, setHyperlinkOpen: (v: boolean) => void
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>画像設定</div>
            <div className={styles.field} data-help="image.source">
                <label className={styles.label}>ソース</label>
                <input className={styles.input} type="text" value={element.source}
                    onFocus={() => Action.beginTextInput(dispatch)}
                    onChange={(e) => updateProp({ source: e.target.value })}
                    onBlur={() => Action.endTextInput(dispatch)} />
            </div>
            {renderExpressionInput({
                helpKey: 'image.sourceExpression',
                label: 'ソース式',
                value: element.sourceExpression,
                onFocus: () => Action.beginTextInput(dispatch),
                onBlur: () => Action.endTextInput(dispatch),
                onChange: (value) => updateProp({ sourceExpression: value })
            })}
            <div className={styles.field} data-help="image.scaleMode">
                <label className={styles.label}>スケールモード</label>
                <SelectDropdown className={styles.select} value={element.scaleMode}
                    onChange={(e) => updateProp({ scaleMode: e.target.value as TemplateElement['scaleMode'] })}>
                    <option value="clip">クリップ</option>
                    <option value="fillFrame">フレームに合わせる</option>
                    <option value="retainShape">比率を維持</option>
                    <option value="realSize">実寸</option>
                </SelectDropdown>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="image.hAlign">
                    <label className={styles.label}>水平配置</label>
                    <SelectDropdown className={styles.select} value={element.imageHAlign}
                        onChange={(e) => updateProp({ imageHAlign: e.target.value as TemplateElement['imageHAlign'] })}>
                        <option value="left">左</option>
                        <option value="center">中央</option>
                        <option value="right">右</option>
                    </SelectDropdown>
                </div>
                <div className={styles.field} data-help="image.vAlign">
                    <label className={styles.label}>垂直配置</label>
                    <SelectDropdown className={styles.select} value={element.imageVAlign}
                        onChange={(e) => updateProp({ imageVAlign: e.target.value as TemplateElement['imageVAlign'] })}>
                        <option value="top">上</option>
                        <option value="middle">中央</option>
                        <option value="bottom">下</option>
                    </SelectDropdown>
                </div>
            </div>
            <div className={styles.field} data-help="image.onError">
                <label className={styles.label}>エラー時</label>
                <SelectDropdown className={styles.select} value={element.onError}
                    onChange={(e) => updateProp({ onError: e.target.value as TemplateElement['onError'] })}>
                    <option value="error">エラー</option>
                    <option value="blank">空白</option>
                    <option value="icon">アイコン</option>
                </SelectDropdown>
            </div>
            <label className={styles.checkbox} data-help="image.lazy">
                <input type="checkbox" checked={element.lazy}
                    onChange={(e) => updateProp({ lazy: e.target.checked })} />
                遅延読み込み
            </label>
            <label className={styles.checkbox} data-help="image.lockAspectRatio">
                <input type="checkbox" checked={element.lockAspectRatio}
                    onChange={(e) => updateProp({ lockAspectRatio: e.target.checked })} />
                アスペクト比を維持
            </label>

            <CollapsibleHeader label="ハイパーリンク" open={hyperlinkOpen} onToggle={() => setHyperlinkOpen(!hyperlinkOpen)} />
            {hyperlinkOpen && renderHyperlinkSection(element, elementId, bandId, dispatch)}
        </div>
    )
}

// =====================================
// svg-specific properties
// =====================================
function renderSvgProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>SVG設定</div>
            <div className={styles.field} data-help="svg.svgContent">
                <label className={styles.label}>SVGコンテンツ</label>
                <textarea className={styles.textarea} value={element.svgContent} rows={5}
                    onFocus={() => Action.beginTextInput(dispatch)}
                    onChange={(e) => updateProp({ svgContent: e.target.value })}
                    onBlur={() => Action.endTextInput(dispatch)} />
            </div>
        </div>
    )
}

// =====================================
// barcode-specific properties
// =====================================
function renderBarcodeProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>バーコード設定</div>
            <div className={styles.field} data-help="barcode.barcodeType">
                <label className={styles.label}>バーコードタイプ</label>
                <SelectDropdown className={styles.select} value={element.barcodeType}
                    onChange={(e) => updateProp({ barcodeType: e.target.value })}>
                    <option value="code39">Code 39</option>
                    <option value="code93">Code 93</option>
                    <option value="code128">Code 128</option>
                    <option value="ean8">EAN-8</option>
                    <option value="ean13">EAN-13</option>
                    <option value="upca">UPC-A</option>
                    <option value="upce">UPC-E</option>
                    <option value="itf">ITF</option>
                    <option value="codabar">Codabar</option>
                    <option value="msi">MSI</option>
                    <option value="qr">QRコード</option>
                    <option value="datamatrix">Data Matrix</option>
                    <option value="pdf417">PDF417</option>
                </SelectDropdown>
            </div>
            {renderExpressionInput({
                helpKey: 'barcode.expression',
                label: 'データ式',
                value: element.expression,
                onFocus: () => Action.beginTextInput(dispatch),
                onBlur: () => Action.endTextInput(dispatch),
                onChange: (value) => updateProp({ expression: value })
            })}
            <label className={styles.checkbox} data-help="barcode.showText">
                <input type="checkbox" checked={element.showText}
                    onChange={(e) => updateProp({ showText: e.target.checked })} />
                テキスト表示
            </label>
            {element.barcodeType === 'qr' && (
                <div className={styles.field} data-help="barcode.errorCorrectionLevel">
                    <label className={styles.label}>誤り訂正レベル</label>
                    <SelectDropdown className={styles.select} value={element.errorCorrectionLevel}
                        onChange={(e) => updateProp({ errorCorrectionLevel: e.target.value as TemplateElement['errorCorrectionLevel'] })}>
                        <option value="L">L (7%)</option>
                        <option value="M">M (15%)</option>
                        <option value="Q">Q (25%)</option>
                        <option value="H">H (30%)</option>
                    </SelectDropdown>
                </div>
            )}
        </div>
    )
}

// =====================================
// Math property.

// =====================================
function renderFormFieldProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)
    const ft = element.formFieldType
    const isText = ft === 'text'
    const isToggle = ft === 'checkbox' || ft === 'radio'
    const isChoice = ft === 'dropdown' || ft === 'listbox'
    const options = element.formFieldOptions

    const updateOption = (index: number, patch: Partial<{ value: string, label: string }>) => {
        const next = options.map((o, i) => i === index ? { ...o, ...patch } : o)
        updateProp({ formFieldOptions: next })
    }
    const addOption = () => updateProp({ formFieldOptions: [...options, { value: '', label: '' }] })
    const removeOption = (index: number) => updateProp({ formFieldOptions: options.filter((_, i) => i !== index) })

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>フォーム入力設定</div>
            <div className={styles.row}>
                <div className={styles.field} data-help="formField.type">
                    <label className={styles.label}>種類</label>
                    <SelectDropdown
                        className={styles.select}
                        value={element.formFieldType}
                        onChange={(e) => updateProp({ formFieldType: e.target.value as TemplateElement['formFieldType'] })}
                    >
                        <option value="text">テキスト入力</option>
                        <option value="checkbox">チェックボックス</option>
                        <option value="radio">ラジオボタン</option>
                        <option value="dropdown">ドロップダウン</option>
                        <option value="listbox">リストボックス</option>
                        <option value="pushbutton">プッシュボタン</option>
                        <option value="signature">署名</option>
                    </SelectDropdown>
                </div>
                <div className={styles.field} data-help="formField.name">
                    <label className={styles.label}>フィールド名{ft === 'radio' ? <> ({'グループ'})</> : null}</label>
                    <input className={styles.input} type="text" value={element.formFieldName}
                        onFocus={() => Action.beginTextInput(dispatch)}
                        onChange={(e) => updateProp({ formFieldName: e.target.value })}
                        onBlur={() => Action.endTextInput(dispatch)} />
                </div>
            </div>
            {(isText || isChoice) && (
                <div className={styles.field} data-help="formField.value">
                    <label className={styles.label}>初期値 (式)</label>
                    <input className={styles.input} type="text" value={element.formFieldValue}
                        onFocus={() => Action.beginTextInput(dispatch)}
                        onChange={(e) => updateProp({ formFieldValue: e.target.value })}
                        onBlur={() => Action.endTextInput(dispatch)} />
                </div>
            )}
            {isToggle && (
                <div className={styles.row}>
                    <div className={styles.field} data-help="formField.checked">
                        <label className={styles.label}>初期チェック (式)</label>
                        <input className={styles.input} type="text" value={element.formFieldChecked}
                            onFocus={() => Action.beginTextInput(dispatch)}
                            onChange={(e) => updateProp({ formFieldChecked: e.target.value })}
                            onBlur={() => Action.endTextInput(dispatch)} />
                    </div>
                    <div className={styles.field} data-help="formField.exportValue">
                        <label className={styles.label}>{ft === 'radio' ? '選択値' : 'オン値'}</label>
                        <input className={styles.input} type="text" value={element.formFieldExportValue}
                            placeholder="Yes"
                            onFocus={() => Action.beginTextInput(dispatch)}
                            onChange={(e) => updateProp({ formFieldExportValue: e.target.value })}
                            onBlur={() => Action.endTextInput(dispatch)} />
                    </div>
                </div>
            )}
            {ft === 'pushbutton' && (
                <div className={styles.row}>
                    <div className={styles.field} data-help="formField.caption">
                        <label className={styles.label}>キャプション</label>
                        <input className={styles.input} type="text" value={element.formFieldCaption}
                            onFocus={() => Action.beginTextInput(dispatch)}
                            onChange={(e) => updateProp({ formFieldCaption: e.target.value })}
                            onBlur={() => Action.endTextInput(dispatch)} />
                    </div>
                    <div className={styles.field} data-help="formField.action">
                        <label className={styles.label}>URL アクション</label>
                        <input className={styles.input} type="text" value={element.formFieldAction}
                            onFocus={() => Action.beginTextInput(dispatch)}
                            onChange={(e) => updateProp({ formFieldAction: e.target.value })}
                            onBlur={() => Action.endTextInput(dispatch)} />
                    </div>
                </div>
            )}
            {isChoice && (
                <div className={styles.field} data-help="formField.options">
                    <label className={styles.label}>選択肢</label>
                    {options.map((option, index) => (
                        <div key={index} className={styles.row}>
                            <input className={styles.input} type="text" value={option.value} placeholder="値"
                                onFocus={() => Action.beginTextInput(dispatch)}
                                onChange={(e) => updateOption(index, { value: e.target.value })}
                                onBlur={() => Action.endTextInput(dispatch)} />
                            <input className={styles.input} type="text" value={option.label} placeholder="表示ラベル"
                                onFocus={() => Action.beginTextInput(dispatch)}
                                onChange={(e) => updateOption(index, { label: e.target.value })}
                                onBlur={() => Action.endTextInput(dispatch)} />
                            <button type="button" className={styles.optionRemove} onClick={() => removeOption(index)} title="削除">×</button>
                        </div>
                    ))}
                    <button type="button" className={styles.addButton} onClick={addOption}>＋ 選択肢を追加</button>
                </div>
            )}
            {ft === 'dropdown' && (
                <div className={styles.field} data-help="formField.editable">
                    <label className={styles.label}>
                        <input type="checkbox" checked={element.formFieldEditable}
                            onChange={(e) => updateProp({ formFieldEditable: e.target.checked })} />
                        自由入力を許可（コンボボックス）
                    </label>
                </div>
            )}
            {ft === 'listbox' && (
                <div className={styles.field} data-help="formField.multiSelect">
                    <label className={styles.label}>
                        <input type="checkbox" checked={element.formFieldMultiSelect}
                            onChange={(e) => updateProp({ formFieldMultiSelect: e.target.checked })} />
                        複数選択を許可
                    </label>
                </div>
            )}
            {isText && (
                <div className={styles.row}>
                    <div className={styles.field} data-help="formField.multiline">
                        <label className={styles.label}>
                            <input type="checkbox" checked={element.formFieldMultiline}
                                onChange={(e) => updateProp({ formFieldMultiline: e.target.checked })} />
                            複数行
                        </label>
                    </div>
                    <div className={styles.field} data-help="formField.maxLength">
                        <label className={styles.label}>最大文字数 (0=無制限)</label>
                        <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.formFieldMaxLength)}
                            onBlur={(e) => updateProp({ formFieldMaxLength: NumberUtils.parseNumber(e.target.value) })} />
                    </div>
                </div>
            )}
            <div className={styles.row}>
                <div className={styles.field} data-help="formField.readOnly">
                    <label className={styles.label}>
                        <input type="checkbox" checked={element.formFieldReadOnly}
                            onChange={(e) => updateProp({ formFieldReadOnly: e.target.checked })} />
                        読み取り専用
                    </label>
                </div>
                <div className={styles.field} data-help="formField.required">
                    <label className={styles.label}>
                        <input type="checkbox" checked={element.formFieldRequired}
                            onChange={(e) => updateProp({ formFieldRequired: e.target.checked })} />
                        必須
                    </label>
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="formField.borderColor">
                    <label className={styles.label}>枠線色</label>
                    <ColorInput value={element.formFieldBorderColor} onChange={(color) => updateProp({ formFieldBorderColor: color })} />
                </div>
                <div className={styles.field} data-help="formField.backgroundColor">
                    <label className={styles.label}>背景色</label>
                    <ColorInput value={element.formFieldBackgroundColor} onChange={(color) => updateProp({ formFieldBackgroundColor: color })} />
                </div>
            </div>
        </div>
    )
}

function renderMathProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>数式設定</div>
            <div className={styles.field} data-help="math.formula">
                <label className={styles.label}>数式 (LaTeX)</label>
                <textarea className={styles.textarea} value={element.formula} rows={3}
                    onFocus={() => Action.beginTextInput(dispatch)}
                    onChange={(e) => updateProp({ formula: e.target.value })}
                    onBlur={() => Action.endTextInput(dispatch)} />
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="math.fontFamily">
                    <label className={styles.label}>フォント</label>
                    <input className={styles.input} type="text" value={element.mathFontFamily}
                        onFocus={() => Action.beginTextInput(dispatch)}
                        onChange={(e) => updateProp({ mathFontFamily: e.target.value })}
                        onBlur={() => Action.endTextInput(dispatch)} />
                </div>
                <div className={styles.field} data-help="math.fontSize">
                    <label className={styles.label}>サイズ (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.mathFontSize)}
                        onBlur={(e) => updateProp({ mathFontSize: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>
            <div className={styles.field} data-help="math.color">
                <label className={styles.label}>色</label>
                <ColorInput value={element.mathColor} onChange={(color) => updateProp({ mathColor: color })} />
            </div>
        </div>
    )
}

// =====================================
// Break property.

// =====================================
function renderBreakProperties(
    element: TemplateElement, elementId: string, bandId: string,
    dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>ブレーク設定</div>
            <div className={styles.field} data-help="break.breakType">
                <label className={styles.label}>ブレークタイプ</label>
                <SelectDropdown className={styles.select} value={element.breakType}
                    onChange={(e) => updateProp({ breakType: e.target.value as 'page' | 'column' })}>
                    <option value="page">改ページ</option>
                    <option value="column">改段</option>
                </SelectDropdown>
            </div>
        </div>
    )
}

// =====================================
// Subreport property.

// =====================================
function renderSubreportProperties(
    element: TemplateElement, elementId: string, bandId: string,
    state: State,
    dispatch: React.Dispatch<ActionType>,
    currentFile: EditorCurrentFile | null,
    openReportTemplates: OpenReportTemplate[],
    onResolvedSubreportTemplates: (templates: OpenReportTemplate[]) => void
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>サブレポート設定</div>
            <SubreportTemplateExpressionField
                state={state}
                dispatch={dispatch}
                bandId={bandId}
                element={element}
                currentFile={currentFile}
                openReportTemplates={openReportTemplates}
                onResolvedSubreportTemplates={onResolvedSubreportTemplates}
            />
            {renderExpressionInput({
                helpKey: 'subreport.dataSourceExpression',
                label: 'データソース式',
                value: element.dataSourceExpression,
                onFocus: () => Action.beginTextInput(dispatch),
                onBlur: () => Action.endTextInput(dispatch),
                onChange: (value) => updateProp({ dataSourceExpression: value })
            })}
        </div>
    )
}

function renderTableProperties(element: TemplateElement, elementId: string, bandId: string, state: State, dispatch: React.Dispatch<ActionType>, fontList: FontEntry[]) {
    return <TablePropertiesPanel element={element} elementId={elementId} bandId={bandId} state={state} dispatch={dispatch} fontList={fontList} />
}

// =====================================
// Table.

// =====================================
type TableSectionKey = 'header' | 'detail' | 'footer'

type TableOrigin = {
    row: number,
    col: number,
    cell: TableCell
}


function getTableSectionLabel(section: TableSectionKey, ui: UiMessages): string {
    if (section === 'header') return ui.header
    if (section === 'detail') return ui.detailSection
    return ui.footer
}

function renderTableBorderAllAndSides(
    border: { top: BorderSide | null, bottom: BorderSide | null, left: BorderSide | null, right: BorderSide | null },
    onUpdateAll: (border: { top: BorderSide | null, bottom: BorderSide | null, left: BorderSide | null, right: BorderSide | null }) => void
) {
    const firstSide = border.top ?? border.bottom ?? border.left ?? border.right
    const allWidth = firstSide?.width ?? 1
    const allColor = firstSide?.color ?? '#000000'
    const allStyle = firstSide?.style ?? 'solid'

    function setAllBorders(width: number, color: string, lineStyle: BorderSide['style']) {
        const s: BorderSide = { width, color, style: lineStyle }
        onUpdateAll({ top: s, bottom: { ...s }, left: { ...s }, right: { ...s } })
    }

    function updateSide(sideKey: TableBorderSideKey, value: BorderSide | null) {
        onUpdateAll({ ...border, [sideKey]: value })
    }

    return (
        <>
            <div className={styles.subHeader}>一括設定</div>
            <div className={styles.row}>
                <div className={styles.field}>
                    <label className={styles.label}>幅 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(allWidth, 1)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) setAllBorders(v, allColor, allStyle) }} />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>色</label>
                    <ColorInput value={allColor} onChange={(color) => setAllBorders(allWidth, color, allStyle)} />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>スタイル</label>
                    <SelectDropdown className={styles.select} value={allStyle}
                        onChange={(e) => setAllBorders(allWidth, allColor, e.target.value as BorderSide['style'])}>
                        <option value="solid">実線</option>
                        <option value="dashed">破線</option>
                        <option value="dotted">点線</option>
                    </SelectDropdown>
                </div>
            </div>
            {(['top', 'bottom', 'left', 'right'] as const).map(function (sideKey) {
                const side = border[sideKey]
                const label = sideKey === 'top' ? '上' : sideKey === 'bottom' ? '下' : sideKey === 'left' ? '左' : '右'
                return (
                    <div key={sideKey}>
                        <div className={styles.subHeader}>{label}辺</div>
                        <label className={styles.checkbox}>
                            <input type="checkbox" checked={side !== null}
                                onChange={(e) => updateSide(sideKey, e.target.checked ? { width: 1, color: '#000000', style: 'solid' } : null)} />
                            有効
                        </label>
                        {side !== null && (
                            <div className={styles.row}>
                                <div className={styles.field}>
                                    <label className={styles.label}>幅 (pt)</label>
                                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(side.width, 1)}
                                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateSide(sideKey, { ...side, width: v }) }} />
                                </div>
                                <div className={styles.field}>
                                    <label className={styles.label}>色</label>
                                    <ColorInput value={side.color} onChange={(color) => updateSide(sideKey, { ...side, color: color })} />
                                </div>
                                <div className={styles.field}>
                                    <label className={styles.label}>スタイル</label>
                                    <SelectDropdown className={styles.select} value={side.style}
                                        onChange={(e) => updateSide(sideKey, { ...side, style: e.target.value as BorderSide['style'] })}>
                                        <option value="solid">実線</option>
                                        <option value="dashed">破線</option>
                                        <option value="dotted">点線</option>
                                    </SelectDropdown>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
        </>
    )
}

function TablePropertiesPanel(props: {
    element: TemplateElement,
    elementId: string,
    bandId: string,
    state: State,
    dispatch: React.Dispatch<ActionType>,
    fontList: FontEntry[]
}) {
    const ui = useUiMessages()
    const { element, elementId, bandId, state, dispatch, fontList } = props
    const tableSelection = state.tableSelection
    const unit = state.displayUnit
    const unitLabel = UnitUtils.getUnitLabel(unit)
    const [colBorderOpen, setColBorderOpen] = useState(false)
    const [cellBorderOpen, setCellBorderOpen] = useState(false)
    const [colLineSpacingOpen, setColLineSpacingOpen] = useState(false)
    const [cellLineSpacingOpen, setCellLineSpacingOpen] = useState(false)
    const [colSpacingOpen, setColSpacingOpen] = useState(false)
    const [cellSpacingOpen, setCellSpacingOpen] = useState(false)

    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)

    const tableColumns = getTableColumns(element)
    const columnCount = tableColumns.length

    // Selectioncellinformation.
    
    const selectedPlacement = tableSelection !== null && tableSelection.type === 'cell'
        ? findTablePlacement(
            buildTablePlacements(getTableSectionRows(element, tableSelection.section), columnCount),
            tableSelection.row,
            tableSelection.col
        )
        : null

    // Selectioncolumninformation.
    
    const selectedColumnIndex = tableSelection !== null && tableSelection.type === 'column' ? tableSelection.col : -1
    const selectedColumn = selectedColumnIndex >= 0 && selectedColumnIndex < columnCount ? tableColumns[selectedColumnIndex] : null

    // Selectionrowinformation.
    
    const selectedRowInfo = tableSelection !== null && tableSelection.type === 'row'
        ? { section: tableSelection.section, row: tableSelection.row, data: getTableSectionRows(element, tableSelection.section)[tableSelection.row] }
        : null

    function updateCellProp(section: TableSectionKey, row: number, col: number, props: Partial<TableCell>) {
        const sectionRows = getTableSectionRows(element, section)
        updateProp(setTableSectionRows(element, section, updateTableCell(sectionRows, columnCount, row, col, props)))
    }

    function updateCellStyleProp(section: TableSectionKey, row: number, col: number, style: Partial<TableCell['style']>) {
        const sectionRows = getTableSectionRows(element, section)
        updateProp(setTableSectionRows(element, section, updateTableCellStyle(sectionRows, columnCount, row, col, style)))
    }


    return localizeUiNode((
        <>
            {}
            {selectedColumn !== null && (<>
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>{'列'} C{selectedColumnIndex + 1}</div>
                    <div className={styles.field}>
                        <label className={styles.label}>列幅 (比率)</label>
                        <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.width, 1)}
                            onBlur={(e) => {
                                const v = NumberUtils.parseNumber(e.target.value)
                                if (v !== undefined) {
                                    const next = tableColumns.map(function (c) { return { width: c.width, style: { ...c.style, border: { ...c.style.border } } } })
                                    next[selectedColumnIndex] = { ...next[selectedColumnIndex]!, width: v }
                                    updateProp(setTableColumns(element, next))
                                }
                            }} />
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>背景色</label>
                            <ColorInput value={selectedColumn.style.backcolor} onChange={(color) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { backcolor: color })))} />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>文字色</label>
                            <ColorInput value={selectedColumn.style.forecolor} onChange={(color) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { forecolor: color })))} />
                        </div>
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>不透明度</label>
                            <CmnInputText className={styles.input}
                                value={NumberUtils.formatNumber(selectedColumn.style.opacity, 1)}
                                onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { opacity: NumberUtils.parseNumber(e.target.value) })))} />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>パディング ({unitLabel})</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(selectedColumn.style.padding, unit), 3)}
                                onBlur={(e) => {
                                    const v = NumberUtils.parseNumber(e.target.value)
                                    if (v !== undefined) updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { padding: Math.max(0, UnitUtils.displayToPt(v, unit)) })))
                                }} />
                        </div>
                    </div>
                </div>

                {}
                <div className={styles.section}>
                    <CollapsibleHeader label="ボーダー" open={colBorderOpen} onToggle={() => setColBorderOpen(!colBorderOpen)} />
                    {colBorderOpen && renderTableBorderAllAndSides(
                        selectedColumn.style.border,
                        (newBorder) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { border: newBorder })))
                    )}
                </div>

                <div className={styles.section}>
                    {}
                    <div className={styles.subHeader}>フォント</div>
                    <div className={styles.field}>
                        <label className={styles.label}>フォント</label>
                        {fontList.length > 0 ? (
                            <SelectDropdown className={styles.select} value={selectedColumn.style.fontFamily}
                                onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { fontFamily: e.target.value })))}>
                                {fontList.map(f => (
                                    <option key={f.path} value={f.name}>{f.name}</option>
                                ))}
                                {fontList.every(f => f.name !== selectedColumn.style.fontFamily) && (
                                    <option value={selectedColumn.style.fontFamily}>{selectedColumn.style.fontFamily}</option>
                                )}
                            </SelectDropdown>
                        ) : (
                            <input className={styles.input} type="text" value={selectedColumn.style.fontFamily}
                                onFocus={() => Action.beginTextInput(dispatch)}
                                onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { fontFamily: e.target.value })))}
                                onBlur={() => Action.endTextInput(dispatch)} />
                        )}
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>サイズ (pt)</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.fontSize, 0)}
                                onBlur={(e) => {
                                    const v = NumberUtils.parseNumber(e.target.value)
                                    if (v !== undefined) updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { fontSize: Math.max(1, v) })))
                                }} />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>装飾</label>
                            <div className={styles.toggleRow}>
                                <button className={`${styles.toggleButton} ${selectedColumn.style.bold ? styles.toggleActive : ''}`}
                                    onClick={() => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { bold: !selectedColumn.style.bold })))}><b>B</b></button>
                                <button className={`${styles.toggleButton} ${selectedColumn.style.italic ? styles.toggleActive : ''}`}
                                    onClick={() => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { italic: !selectedColumn.style.italic })))}><i>I</i></button>
                                <button className={`${styles.toggleButton} ${selectedColumn.style.underline ? styles.toggleActive : ''}`}
                                    onClick={() => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { underline: !selectedColumn.style.underline })))}><u>U</u></button>
                                <button className={`${styles.toggleButton} ${selectedColumn.style.strikethrough ? styles.toggleActive : ''}`}
                                    onClick={() => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { strikethrough: !selectedColumn.style.strikethrough })))}><s>S</s></button>
                            </div>
                        </div>
                    </div>

                    {}
                    <div className={styles.subHeader}>配置</div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>水平</label>
                            <SelectDropdown className={styles.select} value={selectedColumn.style.hAlign}
                                onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { hAlign: e.target.value as TableCellStyle['hAlign'] })))}>
                                <option value="left">左</option>
                                <option value="center">中央</option>
                                <option value="right">右</option>
                            </SelectDropdown>
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>垂直</label>
                            <SelectDropdown className={styles.select} value={selectedColumn.style.vAlign}
                                onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { vAlign: e.target.value as VAlign })))}>
                                <option value="top">上</option>
                                <option value="middle">中央</option>
                                <option value="bottom">下</option>
                            </SelectDropdown>
                        </div>
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label}>回転</label>
                        <SelectDropdown className={styles.select} value={selectedColumn.style.rotation}
                            onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })))}>
                            <option value={0}>0°</option>
                            <option value={90}>90°</option>
                            <option value={180}>180°</option>
                            <option value={270}>270°</option>
                        </SelectDropdown>
                    </div>
                </div>

                {}
                <div className={styles.section}>
                    <CollapsibleHeader label="行間" open={colLineSpacingOpen} onToggle={() => setColLineSpacingOpen(!colLineSpacingOpen)} />
                    {colLineSpacingOpen && <>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>タイプ</label>
                                <SelectDropdown className={styles.select} value={selectedColumn.style.lineSpacingType}
                                    onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { lineSpacingType: e.target.value as TableCellStyle['lineSpacingType'] })))}>
                                    <option value="single">1行</option>
                                    <option value="1.5">1.5行</option>
                                    <option value="double">2行</option>
                                    <option value="proportional">比率指定</option>
                                    <option value="fixed">固定</option>
                                    <option value="minimum">最小</option>
                                </SelectDropdown>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>値</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.lineSpacingValue, 1)}
                                    onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { lineSpacingValue: NumberUtils.parseNumber(e.target.value) })))} />
                            </div>
                        </div>
                    </>}
                </div>

                {}
                <div className={styles.section}>
                    <CollapsibleHeader label="間隔・インデント" open={colSpacingOpen} onToggle={() => setColSpacingOpen(!colSpacingOpen)} />
                    {colSpacingOpen && <>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>字間 (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.letterSpacing, 1)}
                                    onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { letterSpacing: NumberUtils.parseNumber(e.target.value) })))} />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>語間 (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.wordSpacing, 1)}
                                    onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { wordSpacing: NumberUtils.parseNumber(e.target.value) })))} />
                            </div>
                        </div>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>先頭行字下げ (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.firstLineIndent)}
                                    onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { firstLineIndent: NumberUtils.parseNumber(e.target.value) })))} />
                            </div>
                        </div>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>左インデント (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.leftIndent)}
                                    onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { leftIndent: NumberUtils.parseNumber(e.target.value) })))} />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>右インデント (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.rightIndent)}
                                    onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { rightIndent: NumberUtils.parseNumber(e.target.value) })))} />
                            </div>
                        </div>
                    </>}
                </div>

                <div className={styles.section}>
                    {}
                    <div className={styles.subHeader}>テキスト制御</div>
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedColumn.style.wrap !== false}
                            onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { wrap: e.target.checked })))} />
                        折り返し
                    </label>
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedColumn.style.shrinkToFit}
                            onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { shrinkToFit: e.target.checked })))} />
                        縮小して収める
                    </label>
                    {selectedColumn.style.shrinkToFit && (
                        <div className={styles.field}>
                            <label className={styles.label}>最小フォントサイズ (pt)</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedColumn.style.minFontSize)}
                                onBlur={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { minFontSize: NumberUtils.parseNumber(e.target.value) })))} />
                        </div>
                    )}
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedColumn.style.fitWidth}
                            onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { fitWidth: e.target.checked })))} />
                        幅に合わせる
                    </label>
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedColumn.style.outlineText}
                            onChange={(e) => updateProp(setTableColumns(element, updateTableColumnStyle(tableColumns, selectedColumnIndex, { outlineText: e.target.checked })))} />
                        テキストをアウトライン化
                    </label>
                </div>
            </>)}

            {}
            {selectedRowInfo !== null && selectedRowInfo.data !== undefined && (
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>{getTableSectionLabel(selectedRowInfo.section, ui)} {'行'} {selectedRowInfo.row + 1}</div>
                    <div className={styles.field}>
                        <label className={styles.label}>行高さ ({unitLabel})</label>
                        <CmnInputText className={styles.input} value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(selectedRowInfo.data.height, unit), 3)}
                            onBlur={(e) => {
                                const raw = NumberUtils.parseNumber(e.target.value)
                                if (raw === undefined) return
                                const v = UnitUtils.displayToPt(raw, unit)
                                const sectionRows = getTableSectionRows(element, selectedRowInfo.section)
                                const nextRows = sectionRows.map(function (r, i) {
                                    if (i !== selectedRowInfo.row) return { height: r.height, cells: r.cells.map(function (c) { return { ...c, style: { ...c.style, border: { ...c.style.border } } } }) }
                                    return { height: Math.max(1, v), cells: r.cells.map(function (c) { return { ...c, style: { ...c.style, border: { ...c.style.border } } } }) }
                                })
                                let totalHeight = 0
                                for (let si = 0; si < 3; si++) {
                                    const key: TableSectionKey = si === 0 ? 'header' : si === 1 ? 'detail' : 'footer'
                                    const rows = key === selectedRowInfo.section ? nextRows : getTableSectionRows(element, key)
                                    for (let ri = 0; ri < rows.length; ri++) totalHeight += rows[ri]!.height
                                }
                                updateProp({ ...setTableSectionRows(element, selectedRowInfo.section, nextRows), height: totalHeight })
                            }} />
                    </div>
                </div>
            )}

            {}
            {selectedPlacement !== null && tableSelection !== null && tableSelection.type === 'cell' && (<>
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>{getTableSectionLabel(tableSelection.section, ui)} {'セル'} R{selectedPlacement.row + 1} C{selectedPlacement.col + 1}</div>
                    {renderExpressionInput({
                        helpKey: 'table.cell.expression',
                        label: '式',
                        value: selectedPlacement.cell.expression,
                        onFocus: () => Action.beginTextInput(dispatch),
                        onBlur: () => Action.endTextInput(dispatch),
                        onChange: (value) => updateCellProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { expression: value })
                    })}
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>colspan</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.colSpan, 0)}
                                onBlur={(e) => {
                                    const v = NumberUtils.parseNumber(e.target.value)
                                    if (v === undefined) return
                                    const sectionRows = getTableSectionRows(element, tableSelection.section)
                                    updateProp(setTableSectionRows(element, tableSelection.section, updateTableCellSpan(sectionRows, columnCount, selectedPlacement.row, selectedPlacement.col, selectedPlacement.cell.rowSpan, Math.max(1, Math.floor(v)))))
                                }} />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>rowspan</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.rowSpan, 0)}
                                onBlur={(e) => {
                                    const v = NumberUtils.parseNumber(e.target.value)
                                    if (v === undefined) return
                                    const sectionRows = getTableSectionRows(element, tableSelection.section)
                                    updateProp(setTableSectionRows(element, tableSelection.section, updateTableCellSpan(sectionRows, columnCount, selectedPlacement.row, selectedPlacement.col, Math.max(1, Math.floor(v)), selectedPlacement.cell.colSpan)))
                                }} />
                        </div>
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>背景色</label>
                            <ColorInput value={selectedPlacement.cell.style.backcolor} onChange={(color) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { backcolor: color })} />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>文字色</label>
                            <ColorInput value={selectedPlacement.cell.style.forecolor} onChange={(color) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { forecolor: color })} />
                        </div>
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>不透明度</label>
                            <CmnInputText className={styles.input}
                                value={NumberUtils.formatNumber(selectedPlacement.cell.style.opacity, 1)}
                                onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { opacity: NumberUtils.parseNumber(e.target.value) })} />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>パディング ({unitLabel})</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(selectedPlacement.cell.style.padding, unit), 3)}
                                onBlur={(e) => {
                                    const v = NumberUtils.parseNumber(e.target.value)
                                    if (v !== undefined) updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { padding: Math.max(0, UnitUtils.displayToPt(v, unit)) })
                                }} />
                        </div>
                    </div>
                </div>

                {}
                <div className={styles.section}>
                    <CollapsibleHeader label="ボーダー" open={cellBorderOpen} onToggle={() => setCellBorderOpen(!cellBorderOpen)} />
                    {cellBorderOpen && renderTableBorderAllAndSides(
                        selectedPlacement.cell.style.border,
                        (newBorder) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { border: newBorder })
                    )}
                </div>

                <div className={styles.section}>
                    {}
                    <div className={styles.subHeader}>フォント</div>
                    <div className={styles.field}>
                        <label className={styles.label}>フォント</label>
                        {fontList.length > 0 ? (
                            <SelectDropdown className={styles.select} value={selectedPlacement.cell.style.fontFamily}
                                onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { fontFamily: e.target.value })}>
                                {fontList.map(f => (
                                    <option key={f.path} value={f.name}>{f.name}</option>
                                ))}
                                {fontList.every(f => f.name !== selectedPlacement.cell.style.fontFamily) && (
                                    <option value={selectedPlacement.cell.style.fontFamily}>{selectedPlacement.cell.style.fontFamily}</option>
                                )}
                            </SelectDropdown>
                        ) : (
                            <input className={styles.input} type="text" value={selectedPlacement.cell.style.fontFamily}
                                onFocus={() => Action.beginTextInput(dispatch)}
                                onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { fontFamily: e.target.value })}
                                onBlur={() => Action.endTextInput(dispatch)} />
                        )}
                    </div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>サイズ (pt)</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.fontSize, 0)}
                                onBlur={(e) => {
                                    const v = NumberUtils.parseNumber(e.target.value)
                                    if (v !== undefined) updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { fontSize: Math.max(1, v) })
                                }} />
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>装飾</label>
                            <div className={styles.toggleRow}>
                                <button className={`${styles.toggleButton} ${selectedPlacement.cell.style.bold ? styles.toggleActive : ''}`}
                                    onClick={() => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { bold: !selectedPlacement.cell.style.bold })}><b>B</b></button>
                                <button className={`${styles.toggleButton} ${selectedPlacement.cell.style.italic ? styles.toggleActive : ''}`}
                                    onClick={() => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { italic: !selectedPlacement.cell.style.italic })}><i>I</i></button>
                                <button className={`${styles.toggleButton} ${selectedPlacement.cell.style.underline ? styles.toggleActive : ''}`}
                                    onClick={() => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { underline: !selectedPlacement.cell.style.underline })}><u>U</u></button>
                                <button className={`${styles.toggleButton} ${selectedPlacement.cell.style.strikethrough ? styles.toggleActive : ''}`}
                                    onClick={() => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { strikethrough: !selectedPlacement.cell.style.strikethrough })}><s>S</s></button>
                            </div>
                        </div>
                    </div>

                    {}
                    <div className={styles.subHeader}>配置</div>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label className={styles.label}>水平</label>
                            <SelectDropdown className={styles.select} value={selectedPlacement.cell.style.hAlign}
                                onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { hAlign: e.target.value as TableCellStyle['hAlign'] })}>
                                <option value="left">左</option>
                                <option value="center">中央</option>
                                <option value="right">右</option>
                            </SelectDropdown>
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label}>垂直</label>
                            <SelectDropdown className={styles.select} value={selectedPlacement.cell.style.vAlign}
                                onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { vAlign: e.target.value as VAlign })}>
                                <option value="top">上</option>
                                <option value="middle">中央</option>
                                <option value="bottom">下</option>
                            </SelectDropdown>
                        </div>
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label}>回転</label>
                        <SelectDropdown className={styles.select} value={selectedPlacement.cell.style.rotation}
                            onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })}>
                            <option value={0}>0°</option>
                            <option value={90}>90°</option>
                            <option value={180}>180°</option>
                            <option value={270}>270°</option>
                        </SelectDropdown>
                    </div>
                </div>

                {}
                <div className={styles.section}>
                    <CollapsibleHeader label="行間" open={cellLineSpacingOpen} onToggle={() => setCellLineSpacingOpen(!cellLineSpacingOpen)} />
                    {cellLineSpacingOpen && <>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>タイプ</label>
                                <SelectDropdown className={styles.select} value={selectedPlacement.cell.style.lineSpacingType}
                                    onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { lineSpacingType: e.target.value as TableCellStyle['lineSpacingType'] })}>
                                    <option value="single">1行</option>
                                    <option value="1.5">1.5行</option>
                                    <option value="double">2行</option>
                                    <option value="proportional">比率指定</option>
                                    <option value="fixed">固定</option>
                                    <option value="minimum">最小</option>
                                </SelectDropdown>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>値</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.lineSpacingValue, 1)}
                                    onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { lineSpacingValue: NumberUtils.parseNumber(e.target.value) })} />
                            </div>
                        </div>
                    </>}
                </div>

                {}
                <div className={styles.section}>
                    <CollapsibleHeader label="間隔・インデント" open={cellSpacingOpen} onToggle={() => setCellSpacingOpen(!cellSpacingOpen)} />
                    {cellSpacingOpen && <>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>字間 (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.letterSpacing, 1)}
                                    onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { letterSpacing: NumberUtils.parseNumber(e.target.value) })} />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>語間 (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.wordSpacing, 1)}
                                    onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { wordSpacing: NumberUtils.parseNumber(e.target.value) })} />
                            </div>
                        </div>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>先頭行字下げ (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.firstLineIndent)}
                                    onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { firstLineIndent: NumberUtils.parseNumber(e.target.value) })} />
                            </div>
                        </div>
                        <div className={styles.row}>
                            <div className={styles.field}>
                                <label className={styles.label}>左インデント (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.leftIndent)}
                                    onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { leftIndent: NumberUtils.parseNumber(e.target.value) })} />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>右インデント (pt)</label>
                                <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.rightIndent)}
                                    onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { rightIndent: NumberUtils.parseNumber(e.target.value) })} />
                            </div>
                        </div>
                    </>}
                </div>

                <div className={styles.section}>
                    {}
                    <div className={styles.subHeader}>テキスト制御</div>
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedPlacement.cell.style.wrap !== false}
                            onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { wrap: e.target.checked })} />
                        折り返し
                    </label>
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedPlacement.cell.style.shrinkToFit}
                            onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { shrinkToFit: e.target.checked })} />
                        縮小して収める
                    </label>
                    {selectedPlacement.cell.style.shrinkToFit && (
                        <div className={styles.field}>
                            <label className={styles.label}>最小フォントサイズ (pt)</label>
                            <CmnInputText className={styles.input} value={NumberUtils.formatNumber(selectedPlacement.cell.style.minFontSize)}
                                onBlur={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { minFontSize: NumberUtils.parseNumber(e.target.value) })} />
                        </div>
                    )}
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedPlacement.cell.style.fitWidth}
                            onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { fitWidth: e.target.checked })} />
                        幅に合わせる
                    </label>
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={selectedPlacement.cell.style.outlineText}
                            onChange={(e) => updateCellStyleProp(tableSelection.section, selectedPlacement.row, selectedPlacement.col, { outlineText: e.target.checked })} />
                        テキストをアウトライン化
                    </label>
                </div>
            </>)}

        </>
    ), ui)
}

function renderCrosstabProperties(
    element: TemplateElement, elementId: string, bandId: string,
    state: State, dispatch: React.Dispatch<ActionType>
) {
    const updateProp = (p: Partial<TemplateElement>) => Action.updateElement(dispatch, elementId, bandId, p)
    const unit = state.displayUnit
    const unitLabel = UnitUtils.getUnitLabel(unit)

    return (
        <div className={styles.section}>
            <div className={styles.sectionHeader}>クロス集計設定</div>

            <div className={styles.subHeader}>行グループ</div>
            {element.crosstabRowGroups.map(function (g, i) {
                return (
                    <div key={i} className={styles.row}>
                        <div className={styles.field} data-help="crosstab.rowGroupField">
                            <CmnInputText className={styles.input} value={g.field} placeholder="フィールド名"
                                onFocus={() => Action.beginTextInput(dispatch)}
                                onBlur={(e) => {
                                    Action.endTextInput(dispatch)
                                    const next = element.crosstabRowGroups.slice()
                                    next[i] = { field: e.target.value }
                                    updateProp({ crosstabRowGroups: next })
                                }} />
                        </div>
                        <button type="button" className={styles.miniButton}
                            onClick={() => updateProp({ crosstabRowGroups: element.crosstabRowGroups.filter(function (_, j) { return j !== i }) })}>
                            削除
                        </button>
                    </div>
                )
            })}
            <button type="button" className={styles.addButton}
                onClick={() => updateProp({ crosstabRowGroups: [...element.crosstabRowGroups, { field: '' }] })}>
                ＋ 行グループを追加
            </button>

            <div className={styles.subHeader}>列グループ</div>
            {element.crosstabColumnGroups.map(function (g, i) {
                return (
                    <div key={i} className={styles.row}>
                        <div className={styles.field} data-help="crosstab.columnGroupField">
                            <CmnInputText className={styles.input} value={g.field} placeholder="フィールド名"
                                onFocus={() => Action.beginTextInput(dispatch)}
                                onBlur={(e) => {
                                    Action.endTextInput(dispatch)
                                    const next = element.crosstabColumnGroups.slice()
                                    next[i] = { field: e.target.value }
                                    updateProp({ crosstabColumnGroups: next })
                                }} />
                        </div>
                        <button type="button" className={styles.miniButton}
                            onClick={() => updateProp({ crosstabColumnGroups: element.crosstabColumnGroups.filter(function (_, j) { return j !== i }) })}>
                            削除
                        </button>
                    </div>
                )
            })}
            <button type="button" className={styles.addButton}
                onClick={() => updateProp({ crosstabColumnGroups: [...element.crosstabColumnGroups, { field: '' }] })}>
                ＋ 列グループを追加
            </button>

            <div className={styles.subHeader}>メジャー (集計)</div>
            {element.crosstabMeasures.map(function (m, i) {
                return (
                    <div key={i}>
                        <div className={styles.row}>
                            <div className={styles.field} data-help="crosstab.measureField">
                                <CmnInputText className={styles.input} value={m.field} placeholder="フィールド名"
                                    onFocus={() => Action.beginTextInput(dispatch)}
                                    onBlur={(e) => {
                                        Action.endTextInput(dispatch)
                                        const next = element.crosstabMeasures.slice()
                                        next[i] = { ...next[i], field: e.target.value }
                                        updateProp({ crosstabMeasures: next })
                                    }} />
                            </div>
                            <div className={styles.field} data-help="crosstab.measureCalculation">
                                <SelectDropdown className={styles.select} value={m.calculation}
                                    onChange={(e) => {
                                        const next = element.crosstabMeasures.slice()
                                        next[i] = { ...next[i], calculation: e.target.value as CrosstabMeasure['calculation'] }
                                        updateProp({ crosstabMeasures: next })
                                    }}>
                                    <option value="sum">sum</option>
                                    <option value="count">count</option>
                                    <option value="average">average</option>
                                    <option value="min">min</option>
                                    <option value="max">max</option>
                                </SelectDropdown>
                            </div>
                        </div>
                        <div className={styles.row}>
                            <div className={styles.field} data-help="crosstab.measureFormat">
                                <CmnInputText className={styles.input} value={m.format} placeholder="表示パターン (例: #,##0)"
                                    onFocus={() => Action.beginTextInput(dispatch)}
                                    onBlur={(e) => {
                                        Action.endTextInput(dispatch)
                                        const next = element.crosstabMeasures.slice()
                                        next[i] = { ...next[i], format: e.target.value }
                                        updateProp({ crosstabMeasures: next })
                                    }} />
                            </div>
                            <button type="button" className={styles.miniButton}
                                onClick={() => updateProp({ crosstabMeasures: element.crosstabMeasures.filter(function (_, j) { return j !== i }) })}>
                                削除
                            </button>
                        </div>
                    </div>
                )
            })}
            <button type="button" className={styles.addButton}
                onClick={() => updateProp({ crosstabMeasures: [...element.crosstabMeasures, { field: '', calculation: 'sum', format: '' }] })}>
                ＋ メジャーを追加
            </button>

            <div className={styles.row}>
                <div className={styles.field} data-help="crosstab.rowHeaderWidth">
                    <label className={styles.label}>行ヘッダー幅 ({unitLabel})</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.rowHeaderWidth, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ rowHeaderWidth: UnitUtils.displayToPt(v, unit) }) }} />
                </div>
                <div className={styles.field} data-help="crosstab.columnHeaderHeight">
                    <label className={styles.label}>列ヘッダー高さ ({unitLabel})</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.columnHeaderHeight, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ columnHeaderHeight: UnitUtils.displayToPt(v, unit) }) }} />
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="crosstab.cellWidth">
                    <label className={styles.label}>セル幅 ({unitLabel})</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.cellWidth, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ cellWidth: UnitUtils.displayToPt(v, unit) }) }} />
                </div>
                <div className={styles.field} data-help="crosstab.cellHeight">
                    <label className={styles.label}>セル高さ ({unitLabel})</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(element.cellHeight, unit), 3)}
                        onBlur={(e) => { const v = NumberUtils.parseNumber(e.target.value); if (v !== undefined) updateProp({ cellHeight: UnitUtils.displayToPt(v, unit) }) }} />
                </div>
            </div>
            <div className={styles.row}>
                <div className={styles.field} data-help="crosstab.borderColor">
                    <label className={styles.label}>枠線色</label>
                    <ColorInput value={element.crosstabBorderColor} onChange={(color) => updateProp({ crosstabBorderColor: color })} />
                </div>
                <div className={styles.field} data-help="crosstab.borderWidth">
                    <label className={styles.label}>枠線幅 (pt)</label>
                    <CmnInputText className={styles.input} value={NumberUtils.formatNumber(element.crosstabBorderWidth, 1)}
                        onBlur={(e) => updateProp({ crosstabBorderWidth: NumberUtils.parseNumber(e.target.value) })} />
                </div>
            </div>
            <label className={styles.checkbox} data-help="crosstab.showSubtotals">
                <input type="checkbox" checked={element.showSubtotals}
                    onChange={(e) => updateProp({ showSubtotals: e.target.checked })} />
                小計表示
            </label>
            <label className={styles.checkbox} data-help="crosstab.showGrandTotal">
                <input type="checkbox" checked={element.showGrandTotal}
                    onChange={(e) => updateProp({ showGrandTotal: e.target.checked })} />
                総計表示
            </label>
            {renderExpressionInput({
                helpKey: 'crosstab.dataSourceExpression',
                label: 'データソース式',
                value: element.crosstabDataSourceExpression,
                onFocus: () => Action.beginTextInput(dispatch),
                onBlur: () => Action.endTextInput(dispatch),
                onChange: (value) => updateProp({ crosstabDataSourceExpression: value })
            })}
        </div>
    )
}

// =====================================
// Main component
// =====================================
export default function PropertyPanel(props: Props) {
    const ui = useUiMessages()
    const { state, dispatch, fontList } = props
    const { selectedElementIds, selectedBandId } = state

    const panelRef = useRef<HTMLDivElement>(null)
    const [helpState, setHelpState] = useState<{ key: string, rect: DOMRect } | null>(null)

    useEffect(function () {
        const panel = panelRef.current
        if (panel === null) return

        function handleFocusIn(e: FocusEvent) {
            let el = e.target as HTMLElement | null
            while (el !== null && el !== panel) {
                const helpKey = el.getAttribute('data-help')
                if (helpKey !== null) {
                    setHelpState({ key: helpKey, rect: el.getBoundingClientRect() })
                    return
                }
                el = el.parentElement
            }
            setHelpState(null)
        }

        function handleFocusOut(e: FocusEvent) {
            const related = e.relatedTarget as HTMLElement | null
            if (related === null || !panel!.contains(related)) {
                setHelpState(null)
            }
        }

        panel.addEventListener('focusin', handleFocusIn)
        panel.addEventListener('focusout', handleFocusOut)
        return function () {
            panel.removeEventListener('focusin', handleFocusIn)
            panel.removeEventListener('focusout', handleFocusOut)
        }
    }, [])

    return localizeUiNode((
        <div ref={panelRef} className={styles.panel}>
            <div className={styles.panelHeader}>プロパティ</div>

            {}
            {selectedElementIds.length === 1 && selectedBandId !== null && (
                <>
                    {renderBandProperties(selectedBandId, state, dispatch, ui)}
                    <ElementProperties
                        elementId={selectedElementIds[0]}
                        bandId={selectedBandId}
                        state={state}
                        dispatch={dispatch}
                        fontList={fontList}
                        currentFile={props.currentFile}
                        openReportTemplates={props.openReportTemplates}
                        onResolvedSubreportTemplates={props.onResolvedSubreportTemplates}
                    />
                </>
            )}

            {}
            {selectedElementIds.length > 1 && selectedBandId !== null && (
                <>
                    {renderBandProperties(selectedBandId, state, dispatch, ui)}
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}>選択</div>
                        <div className={styles.field}>
                            <span className={styles.label}>{selectedElementIds.length}個の要素を選択中</span>
                        </div>
                    </div>
                </>
            )}

            {}
            {selectedElementIds.length === 0 && selectedBandId !== null && (
                renderBandProperties(selectedBandId, state, dispatch, ui)
            )}

            {}
            {selectedBandId === null && (
                renderPageSettings(state, dispatch, props.jsonFiles)
            )}

            {helpState !== null && (
                <FieldHelpTooltip
                    helpKey={helpState.key}
                    anchorRect={helpState.rect}
                    panelRef={panelRef}
                />
            )}
        </div>
    ), ui)
}
