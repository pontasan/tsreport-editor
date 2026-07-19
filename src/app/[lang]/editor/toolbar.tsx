'use client'

import { CmnInputText } from '@/lib/client/components/input/cmn-input-text'
import { useSystem } from '@/lib/client/components/system/hooks'
import { DisplayUnit, UnitUtils } from '@/lib/common/utils/unit_utils'
import { NumberUtils } from '@/lib/common/utils/number_utils'
import { localizePathname, SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/common/i18n/languages'
import type { UiMessageId } from '@/lib/common/i18n/ui_messages'
import { APP_VERSION } from '@/lib/common/version'
import { usePathname } from 'next/navigation'
import { useRef, useState } from 'react'
import { ELEMENT_TOOL_ICONS } from './element_tool_icons'
import { createPortal } from 'react-dom'
import { Action } from './action'
import { ActionType, State, ToolType } from './reducer'
import SelectDropdown from './select_dropdown'
import styles from './toolbar.module.css'
import { EDITOR_ZOOM_LEVELS, stepEditorZoom } from './editor_zoom'

type Props = {
    state: State,
    dispatch: (action: ActionType) => void,
    onPreview: () => void,
    isTemplateLoaded: boolean,
    onPromptNeeded: () => void,
    activeTabType: 'report' | 'json' | null,
    onSave: () => void,
    onUndo: () => void,
    onRedo: () => void,
    isAdmin: boolean,
    isExternalAccount: boolean,
    onOpenFontManagement: () => void,
    onOpenAccountSettings: () => void,
    onOpenOAuthSettings: () => void,
    onOpenApiClients: () => void,
    onOpenPrintHistory: () => void,
    onOpenExportData: () => void,
    onOpenImportData: () => void,
    onOpenPdfImport: () => void,
    onOpenPasswordChange: () => void,
    onOpenUserManagement: () => void,
    onOpenMcpSettings: () => void,
    onFactoryReset: () => void,
    onLogout: () => void
}

// Tool definitions.
// Element tools. Icons for staticText..break come from ELEMENT_TOOL_ICONS
// (purpose-built SVGs); only 'select' falls back to a PrimeIcon class.
const ELEMENT_TOOLS: { tool: ToolType, messageId: UiMessageId, icon: string }[] = [
    { tool: 'select', messageId: 'select', icon: 'pi pi-arrow-up-right' },
    { tool: 'staticText', messageId: 'staticText', icon: '' },
    { tool: 'textField', messageId: 'textField', icon: '' },
    { tool: 'line', messageId: 'line', icon: '' },
    { tool: 'rectangle', messageId: 'rectangle', icon: '' },
    { tool: 'ellipse', messageId: 'ellipse', icon: '' },
    { tool: 'path', messageId: 'pen', icon: '' },
    { tool: 'image', messageId: 'image', icon: '' },
    { tool: 'svg', messageId: 'svg', icon: '' },
    { tool: 'frame', messageId: 'frame', icon: '' },
    { tool: 'table', messageId: 'table', icon: '' },
    { tool: 'subreport', messageId: 'subreport', icon: '' },
    { tool: 'barcode', messageId: 'barcode', icon: '' },
    { tool: 'math', messageId: 'math', icon: '' },
    { tool: 'formField', messageId: 'formField', icon: '' },
    { tool: 'break', messageId: 'break', icon: '' }
]

const GAP = 6

function ToolbarTooltip(props: { label: string, anchorRect: DOMRect }) {
    const tooltipRef = useRef<HTMLDivElement>(null)
    const left = props.anchorRect.left + props.anchorRect.width / 2
    const top = props.anchorRect.bottom + GAP

    return createPortal(
        <div ref={tooltipRef} className={styles.tooltip} style={{ left, top }}>
            {props.label}
        </div>,
        document.body
    )
}

export default function Toolbar(props: Props) {
    const { state, dispatch, onPreview, isTemplateLoaded, onPromptNeeded, activeTabType, onSave, onUndo, onRedo, isAdmin, onOpenApiClients, onOpenPrintHistory, onOpenExportData, onOpenImportData, onOpenPdfImport, onOpenPasswordChange, onOpenUserManagement, onOpenMcpSettings, onOpenFontManagement, onFactoryReset, onLogout, isExternalAccount, onOpenAccountSettings, onOpenOAuthSettings } = props
    const isJson = activeTabType === 'json'
    const [hover, setHover] = useState<{ label: string, rect: DOMRect } | null>(null)
    const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
    // Whether the admin-only submenu is expanded inside the system menu.
    const [adminExpanded, setAdminExpanded] = useState(false)
    const [system] = useSystem()
    const ui = system.dictionary.ui
    const pathname = usePathname()
    const langCode = system.lang

    function changeLanguage(code: LanguageCode) {
        if (code !== langCode) {
            window.location.href = localizePathname(pathname, code) + window.location.search + window.location.hash
        }
    }

    function guard(handler: () => void): () => void {
        if (isTemplateLoaded) return handler
        return onPromptNeeded
    }

    function tip(label: string) {
        return {
            onMouseEnter: function (e: React.MouseEvent) {
                setHover({ label, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
            },
            onMouseLeave: function () { setHover(null) },
        }
    }

    return (
        <div className={styles.toolbar}>
            {/* File operations. */}
            <div className={styles.group}>
                <button className={styles.button} {...tip(ui.save)} onClick={onSave}>
                    <i className="pi pi-save"></i>
                </button>
            </div>

            <div className={styles.separator}></div>

            {/* Undo and redo. */}
            <div className={styles.group}>
                <button
                    className={styles.button}
                    {...tip(ui.undo)}
                    disabled={!isJson && isTemplateLoaded && state.history.past.length === 0}
                    onClick={isJson ? onUndo : guard(function () { Action.undo(dispatch) })}
                >
                    <i className="pi pi-undo"></i>
                </button>
                <button
                    className={styles.button}
                    {...tip(ui.redo)}
                    disabled={!isJson && isTemplateLoaded && state.history.future.length === 0}
                    onClick={isJson ? onRedo : guard(function () { Action.redo(dispatch) })}
                >
                    <i className="pi pi-refresh"></i>
                </button>
            </div>

            {!isJson && (
                <>
                    <div className={styles.separator}></div>

                    {/* Element tools. */}
                    <div className={styles.group}>
                        {ELEMENT_TOOLS.map(function (t) {
                            return (
                                <button
                                    key={t.tool}
                                    className={`${styles.button} ${isTemplateLoaded && state.activeTool === t.tool ? styles.active : ''}`}
                                    {...tip(ui[t.messageId])}
                                    onClick={guard(function () { Action.setActiveTool(dispatch, t.tool) })}
                                >
                                    {(function renderToolIcon() {
                                        const Icon = ELEMENT_TOOL_ICONS[t.tool]
                                        return Icon !== undefined ? <Icon /> : <i className={t.icon}></i>
                                    })()}
                                </button>
                            )
                        })}
                    </div>

                    <div className={styles.separator}></div>

                    {}
                    <div className={styles.group}>
                        <button
                            className={styles.button}
                            {...tip(ui.deleteSelected)}
                            disabled={isTemplateLoaded && state.selectedElementIds.length === 0}
                            onClick={guard(function () {
                                if (state.selectedElementIds.length > 0 && state.selectedBandId !== null) {
                                    if (state.selectedElementIds.length === 1) {
                                        Action.deleteElement(dispatch, state.selectedElementIds[0], state.selectedBandId)
                                    } else {
                                        Action.deleteElements(dispatch, state.selectedElementIds, state.selectedBandId)
                                    }
                                }
                            })}
                        >
                            <i className="pi pi-trash"></i>
                        </button>
                    </div>

                    <div className={styles.separator}></div>

                    {}
                    <div className={styles.group}>
                        <button
                            className={styles.button}
                            {...tip(ui.zoomOut)}
                            disabled={state.zoom <= EDITOR_ZOOM_LEVELS[0]}
                            onClick={guard(function () {
                                Action.setZoom(dispatch, stepEditorZoom(state.zoom, -1))
                            })}
                        >
                            <i className="pi pi-minus"></i>
                        </button>
                        <SelectDropdown
                            className={styles.zoomSelect}
                            value={state.zoom}
                            onChange={function (e) {
                                if (!isTemplateLoaded) { onPromptNeeded(); return }
                                Action.setZoom(dispatch, Number(e.target.value))
                            }}
                        >
                            {EDITOR_ZOOM_LEVELS.map(function (z) {
                                return <option key={z} value={z}>{Math.round(z * 100)}%</option>
                            })}
                        </SelectDropdown>
                        <button
                            className={styles.button}
                            {...tip(ui.zoomIn)}
                            disabled={state.zoom >= EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1]}
                            onClick={guard(function () {
                                Action.setZoom(dispatch, stepEditorZoom(state.zoom, 1))
                            })}
                        >
                            <i className="pi pi-plus"></i>
                        </button>
                    </div>

                    <div className={styles.separator}></div>

                    {}
                    <div className={styles.group}>
                        <SelectDropdown
                            className={styles.zoomSelect}
                            value={state.displayUnit}
                            onChange={function (e) {
                                if (!isTemplateLoaded) { onPromptNeeded(); return }
                                Action.setDisplayUnit(dispatch, e.target.value as DisplayUnit)
                            }}
                        >
                            <option value="mm">mm</option>
                            <option value="inch">inch</option>
                        </SelectDropdown>
                    </div>
                </>
            )}

            {}
            <div className={styles.spacer}></div>

            {!isJson && (
                <>
                    {}
                    <div className={styles.group}>
                        <button
                            className={`${styles.button} ${state.isGridEnabled ? styles.active : ''}`}
                            {...tip(ui.grid)}
                            onClick={function () { Action.toggleGrid(dispatch) }}
                        >
                            <i className="pi pi-th-large"></i>
                        </button>
                        <span {...tip(ui.gridSpacing)}>
                            <CmnInputText
                                className={styles.gridSizeInput}
                                disabled={!state.isGridEnabled}
                                value={NumberUtils.formatNumber(UnitUtils.ptToDisplayRounded(state.gridSizePt, state.displayUnit), 3)}
                                onBlur={function (e) {
                                    const v = NumberUtils.parseNumber(e.target.value)
                                    if (v !== undefined && v > 0) Action.setGridSize(dispatch, UnitUtils.displayToPt(v, state.displayUnit))
                                }}
                            />
                        </span>
                        <span className={`${styles.gridSizeUnit} ${state.isGridEnabled ? '' : styles.gridSizeUnitDisabled}`}>{UnitUtils.getUnitLabel(state.displayUnit)}</span>
                    </div>

                    <div className={styles.separator}></div>

                    {}
                    <div className={styles.group}>
                        <button
                            className={`${styles.button} ${state.isLayerPanelVisible ? styles.active : ''}`}
                            {...tip(ui.layerPanel)}
                            onClick={function () { Action.toggleLayerPanel(dispatch) }}
                        >
                            <i className="pi pi-list"></i>
                        </button>
                        <button
                            className={`${styles.button} ${state.isPropertyPanelVisible ? styles.active : ''}`}
                            {...tip(ui.propertyPanel)}
                            onClick={function () { Action.togglePropertyPanel(dispatch) }}
                        >
                            <i className="pi pi-sliders-h"></i>
                        </button>
                    </div>

                    <div className={styles.separator}></div>

                    {}
                    <div className={styles.group}>
                        <button className={styles.button} {...tip(ui.pdfImport)} onClick={guard(onOpenPdfImport)}>
                            <i className="pi pi-file-import"></i>
                        </button>
                        <button className={styles.button} {...tip(ui.preview)} onClick={guard(onPreview)}>
                            <i className="pi pi-eye"></i>
                        </button>
                    </div>

                    <div className={styles.separator}></div>
                </>
            )}

            {/* System menu (user management, password, factory reset, logout). */}
            <div className={styles.group}>
                <button
                    className={styles.button}
                    {...tip(ui.menu)}
                    onClick={function (e) {
                        setAdminExpanded(false)
                        setMenuAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())
                    }}
                >
                    <i className="pi pi-bars"></i>
                </button>
            </div>

            {menuAnchor !== null && createPortal(
                <>
                    <div className={styles.menuOverlay} onClick={function () { setMenuAnchor(null) }}></div>
                    <div className={styles.menu} style={{ top: menuAnchor.bottom + GAP, right: Math.max(GAP, window.innerWidth - menuAnchor.right) }}>
                        <button className={styles.menuItem} onClick={function () { setMenuAnchor(null); onOpenFontManagement() }}>
                            <i className="pi pi-language"></i>{ui.fontManagement}
                        </button>
                        <button className={styles.menuItem} onClick={function () { setMenuAnchor(null); onOpenApiClients() }}>
                            <i className="pi pi-key"></i>{ui.apiClients}
                        </button>
                        <button className={styles.menuItem} onClick={function () { setMenuAnchor(null); onOpenPrintHistory() }}>
                            <i className="pi pi-history"></i>{ui.printHistory}
                        </button>
                        {isAdmin && (
                            <button
                                className={styles.menuItem}
                                onClick={function (e) { e.stopPropagation(); setAdminExpanded(function (v) { return !v }) }}
                            >
                                <i className="pi pi-shield"></i>{ui.administrator}
                                <i className={`pi ${adminExpanded ? 'pi-angle-down' : 'pi-angle-right'} ${styles.menuGroupChevron}`}></i>
                            </button>
                        )}
                        {isAdmin && adminExpanded && (
                            <>
                                <button className={`${styles.menuItem} ${styles.menuSubItem}`} onClick={function () { setMenuAnchor(null); onOpenExportData() }}>
                                    <i className="pi pi-download"></i>{ui.dataExport}
                                </button>
                                <button className={`${styles.menuItem} ${styles.menuSubItem}`} onClick={function () { setMenuAnchor(null); onOpenImportData() }}>
                                    <i className="pi pi-upload"></i>{ui.dataImport}
                                </button>
                                <button className={`${styles.menuItem} ${styles.menuSubItem}`} onClick={function () { setMenuAnchor(null); onOpenUserManagement() }}>
                                    <i className="pi pi-users"></i>{ui.userManagement}
                                </button>
                                <button className={`${styles.menuItem} ${styles.menuSubItem}`} onClick={function () { setMenuAnchor(null); onOpenOAuthSettings() }}>
                                    <i className="pi pi-sign-in"></i>{ui.externalAuthSettings}
                                </button>
                                <button className={`${styles.menuItem} ${styles.menuSubItem} ${styles.menuItemDanger}`} onClick={function () { setMenuAnchor(null); onFactoryReset() }}>
                                    <i className="pi pi-exclamation-triangle"></i>{ui.factoryReset}
                                </button>
                            </>
                        )}
                        {isAdmin && <div className={styles.menuSeparator}></div>}
                        <button className={styles.menuItem} onClick={function () { setMenuAnchor(null); onOpenMcpSettings() }}>
                            <i className="pi pi-share-alt"></i>{ui.mcpSettings}
                        </button>
                        <button className={styles.menuItem} onClick={function () { setMenuAnchor(null); onOpenAccountSettings() }}>
                            <i className="pi pi-user-edit"></i>{ui.accountSettings}
                        </button>
                        {!isExternalAccount && (
                            <button className={styles.menuItem} onClick={function () { setMenuAnchor(null); onOpenPasswordChange() }}>
                                <i className="pi pi-lock"></i>{ui.passwordChange}
                            </button>
                        )}
                        <div className={styles.menuSeparator}></div>
                        <div className={styles.menuItem} style={{ cursor: 'default' }} onClick={function (e) { e.stopPropagation() }}>
                            <i className="pi pi-globe"></i>
                            <SelectDropdown
                                className={styles.menuLangSelect}
                                value={langCode}
                                onChange={function (e) { changeLanguage(e.target.value as LanguageCode) }}
                            >
                                {SUPPORTED_LANGUAGES.map(function (l) {
                                    return <option key={l.code} value={l.code}>{l.label}</option>
                                })}
                            </SelectDropdown>
                        </div>
                        <button className={styles.menuItem} onClick={function () { setMenuAnchor(null); onLogout() }}>
                            <i className="pi pi-sign-out"></i>{ui.logout}
                        </button>
                        <div className={styles.menuSeparator}></div>
                        <div className={styles.menuVersion}>tsreport v{APP_VERSION}</div>
                    </div>
                </>,
                document.body
            )}

            {hover !== null && <ToolbarTooltip label={hover.label} anchorRect={hover.rect} />}
        </div>
    )
}
