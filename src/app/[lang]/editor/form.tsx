'use client'

import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { InputText } from 'primereact/inputtext'
import { Toast } from 'primereact/toast'
import React, { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { DataSource, Font } from 'tsreport-core'
import { validateExpressionSource } from 'tsreport-core'
import { SystemAction } from '@/lib/client/components/system/action'
import { useSystem } from '@/lib/client/components/system/hooks'
import { EDITOR_INSTANCE_ID } from '@/lib/client/utils/fetch_proxy'
import { useMount } from '@/lib/client/hooks/mount'
import { UnitUtils } from '@/lib/common/utils/unit_utils'
import { resolveSupportedLanguage, type LanguageCode } from '@/lib/common/i18n/languages'
import { workspaceActivityRevealPath, type WorkspaceActivityEvent } from '@/lib/common/workspace_activity_event'
import {
    DEFAULT_FONT_ID,
    MATH_FONT_ID,
} from '@/lib/common/font_ids'
import { Action, type JsonFileInfo, type TemplateTagInfo } from './action'
import ApiClientDialog from './api_client_dialog'
import PrintHistoryDialog from './print_history_dialog'
import FontManagementDialog from './font_management_dialog'
import AccountSettingsDialog from './account_settings_dialog'
import OAuthSettingsDialog from './oauth_settings_dialog'
import { useDropdownAutoClose } from './use_dropdown_auto_close'
import Canvas from './canvas'
import { evictFont, FontEntry, FontResource, loadFont } from './font_loader'
import styles from './form.module.css'
import ExportDataDialog from './export_data_dialog'
import ImportDataDialog from './import_data_dialog'
import JsonEditor from './json_editor'
import JsonTreePanel from './json_tree_panel'
import LayerPanel from './layer_panel'
import PasswordChangeDialog from './password_change_dialog'
import McpSettingsDialog from './mcp_settings_dialog'
import PdfImportDialog from './pdf_import_dialog'
import type { PdfEmbeddedFontSource } from './pdf_import_embedded_font'
import ImageSliceDialog, { type ImageSliceTarget } from './image_slice_dialog'
import { uploadPendingSliceImages } from './pending_slice_images'
import { isModalDialogOpen } from './modal_state'
import PreviewModal from './preview_modal'
import PropertyPanel from './property_panel'
import type { ActionType, TemplateElement } from './reducer'
import { computeElementIdCounter, createDefaultTemplate, defaultState, findElementInTree, getBandDisplayLabel, normalizeTemplate, reducerWithHistory, type ReportTemplate, type State } from './reducer'
import type { OpenReportTemplate } from './subreport_support'
import { dirnamePosix } from '@/lib/common/utils/workspace_path'
import Toolbar from './toolbar'
import UserManagementDialog from './user_management_dialog'
import WorkspacePanel from './workspace_panel'
import { getLocalizedBandDisplayLabel } from './localized_editor_labels'
import { createBuiltinFontRegistry, reconcileLegacyBuiltinAliases } from './font_registry'

const FONT_URL = '/fonts/NotoSansJP-VariableFont_wght.ttf'
const MATH_FONT_URL = '/fonts/STIXTwoMath.otf'
const WORKSPACE_ACTIVITY_WS_PORT = '52007'

function workspaceActivityWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    if (window.location.port === '52005') {
        return protocol + '//' + window.location.hostname + ':' + WORKSPACE_ACTIVITY_WS_PORT + '/'
    }
    return protocol + '//' + window.location.host + '/api/workspace-activity'
}

// Collect font families used by all elements in the template
function collectFontFamilies(elements: TemplateElement[], result: Set<string>): void {
    for (let i = 0; i < elements.length; i++) {
        result.add(elements[i].style.fontFamily)
        result.add(elements[i].mathFontFamily)
        if (elements[i].children.length > 0) {
            collectFontFamilies(elements[i].children, result)
        }
    }
}

function collectSubreportTemplateExpressions(elements: TemplateElement[], result: Set<string>): void {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]
        if (element.kind === 'subreport' && element.templateExpression.trim() !== '') {
            result.add(element.templateExpression)
        }
        if (element.children.length > 0) {
            collectSubreportTemplateExpressions(element.children, result)
        }
    }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Normalize test data JSON into a core DataSource.
// Only rows / parameters / resources fields are kept; others are dropped.
function normalizeDataSource(value: unknown): DataSource | null {
    if (Array.isArray(value)) {
        return { rows: value as Record<string, unknown>[] }
    }
    if (!isObjectRecord(value)) {
        return null
    }

    const rowsValue = value.rows
    const dataSource: DataSource = {
        rows: Array.isArray(rowsValue) ? rowsValue as Record<string, unknown>[] : [value]
    }

    if (isObjectRecord(value.parameters)) {
        dataSource.parameters = value.parameters
    }
    if (isObjectRecord(value.resources)) {
        dataSource.resources = value.resources as Record<string, Record<string, string>>
    }
    return dataSource
}

type TabEntry = {
    id: string
    type: 'report' | 'json'
    file: { workspace: string, path: string }
    label: string
}

type JsonTabState = {
    originalContent: string
    content: string
}

type TemplateVersionSelection =
    | { kind: 'current' }
    | { kind: 'tag', tag: string }

type TemplateVersionOption = {
    label: string
    value: string
    kind: 'current' | 'tag'
    date: string
}

function makeTabId(workspace: string, filePath: string): string {
    return workspace + '/' + filePath
}

// Return the offset in a JSON string corresponding to a path (e.g. "$/key1/0/key2")
function findJsonPathOffset(doc: string, path: string): number {
    // "$" is root → start of document
    if (path === '$') return 0
    const segments = path.substring(2).split('/') // strip "$/" then split
    let pos = 0
    const len = doc.length

    for (let s = 0; s < segments.length; s++) {
        const segment = segments[s]
        // find the start position of the next structure from the current position
        pos = skipWhitespace(doc, pos, len)
        if (pos >= len) return -1

        const ch = doc.charCodeAt(pos)
        if (ch === 0x7B) { // '{'
            // object → find the key
            pos++ // skip '{'
            const keyOffset = findObjectKey(doc, pos, len, segment)
            if (keyOffset === -1) return -1
            if (s === segments.length - 1) return keyOffset // last segment → return the key's position
            // advance to the value position: after the ':' following the key's closing quote
            pos = skipPastColon(doc, keyOffset, len)
            if (pos === -1) return -1
        } else if (ch === 0x5B) { // '['
            // array → find the index
            const index = parseInt(segment, 10)
            pos++ // skip '['
            const elemOffset = findArrayElement(doc, pos, len, index)
            if (elemOffset === -1) return -1
            if (s === segments.length - 1) return elemOffset
            pos = elemOffset
        } else {
            return -1
        }
    }
    return pos
}

function skipWhitespace(doc: string, pos: number, len: number): number {
    while (pos < len) {
        const ch = doc.charCodeAt(pos)
        if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0A && ch !== 0x0D) break
        pos++
    }
    return pos
}

// Return the '"' start position of the given key within an object
function findObjectKey(doc: string, pos: number, len: number, targetKey: string): number {
    while (pos < len) {
        pos = skipWhitespace(doc, pos, len)
        if (pos >= len) return -1
        if (doc.charCodeAt(pos) === 0x7D) return -1 // '}' → key not found

        if (doc.charCodeAt(pos) === 0x2C) { pos++; continue } // ','

        // read the key string
        if (doc.charCodeAt(pos) !== 0x22) return -1 // invalid if not '"'
        const keyStart = pos
        const key = readString(doc, pos, len)
        if (key === null) return -1
        pos = skipPastString(doc, pos, len)
        if (pos === -1) return -1

        if (key === targetKey) return keyStart

        // skip the ':' and move past the value
        pos = skipWhitespace(doc, pos, len)
        if (pos >= len || doc.charCodeAt(pos) !== 0x3A) return -1 // ':'
        pos++
        pos = skipValue(doc, pos, len)
        if (pos === -1) return -1
    }
    return -1
}

// Return the start position of the given index's element within an array
function findArrayElement(doc: string, pos: number, len: number, targetIndex: number): number {
    let index = 0
    while (pos < len) {
        pos = skipWhitespace(doc, pos, len)
        if (pos >= len) return -1
        if (doc.charCodeAt(pos) === 0x5D) return -1 // ']'
        if (doc.charCodeAt(pos) === 0x2C) { pos++; continue } // ','

        if (index === targetIndex) return pos

        pos = skipValue(doc, pos, len)
        if (pos === -1) return -1
        index++
    }
    return -1
}

// Skip over one JSON value and return its end position
function skipValue(doc: string, pos: number, len: number): number {
    pos = skipWhitespace(doc, pos, len)
    if (pos >= len) return -1
    const ch = doc.charCodeAt(pos)
    if (ch === 0x22) return skipPastString(doc, pos, len) // string
    if (ch === 0x7B) return skipPastBrace(doc, pos, len, 0x7B, 0x7D) // object
    if (ch === 0x5B) return skipPastBrace(doc, pos, len, 0x5B, 0x5D) // array
    // number, true, false, null → up to the delimiter
    while (pos < len) {
        const c = doc.charCodeAt(pos)
        if (c === 0x2C || c === 0x7D || c === 0x5D || c === 0x20 || c === 0x0A || c === 0x0D || c === 0x09) break
        pos++
    }
    return pos
}

// Read a string literal and return its content
function readString(doc: string, pos: number, len: number): string | null {
    if (pos >= len || doc.charCodeAt(pos) !== 0x22) return null
    pos++ // opening '"'
    let result = ''
    while (pos < len) {
        const ch = doc.charCodeAt(pos)
        if (ch === 0x22) return result // closing '"'
        if (ch === 0x5C) { // '\\'
            pos++
            if (pos >= len) return null
            result += doc.charAt(pos)
            pos++
        } else {
            result += doc.charAt(pos)
            pos++
        }
    }
    return null
}

// Return the end position of a string literal (right after the closing '"')
function skipPastString(doc: string, pos: number, len: number): number {
    if (pos >= len || doc.charCodeAt(pos) !== 0x22) return -1
    pos++ // opening '"'
    while (pos < len) {
        const ch = doc.charCodeAt(pos)
        if (ch === 0x22) return pos + 1
        if (ch === 0x5C) pos++ // escape
        pos++
    }
    return -1
}

// Skip to the matching closing bracket (accounting for nesting within strings)
function skipPastBrace(doc: string, pos: number, len: number, open: number, close: number): number {
    let depth = 0
    while (pos < len) {
        const ch = doc.charCodeAt(pos)
        if (ch === 0x22) {
            pos = skipPastString(doc, pos, len)
            if (pos === -1) return -1
            continue
        }
        if (ch === open) depth++
        else if (ch === close) { depth--; if (depth === 0) return pos + 1 }
        pos++
    }
    return -1
}

// Return the position after the ':' that follows the key's closing quote
function skipPastColon(doc: string, keyStart: number, len: number): number {
    let pos = skipPastString(doc, keyStart, len)
    if (pos === -1) return -1
    pos = skipWhitespace(doc, pos, len)
    if (pos >= len || doc.charCodeAt(pos) !== 0x3A) return -1
    pos++ // ':'
    pos = skipWhitespace(doc, pos, len)
    return pos
}

// Common extensions for creating a CodeMirror EditorState
function createJsonEditorExtensions(onContentChange: (content: string) => void): import('@codemirror/state').Extension[] {
    return [
        basicSetup,
        json(),
        linter(jsonParseLinter()),
        oneDark,
        EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto' }
        }),
        EditorView.updateListener.of(function (update) {
            if (update.docChanged) {
                onContentChange(update.state.doc.toString())
            }
        })
    ]
}

export default function Form() {
    // Session state (login user with admin flag for the system menu).
    const [sysState, sysDispatch] = useSystem()
    const ui = sysState.dictionary.ui

    useMount(function () {
        SystemAction.verifySession(sysDispatch)
    })

    // Multi-tab state management
    const [tabs, setTabs] = useState<TabEntry[]>([])
    const [activeTabId, setActiveTabId] = useState<string | null>(null)
    const [tabStates, setTabStates] = useState<Map<string, State>>(new Map())

    // Saved templates for report tabs (used for dirty detection)
    const [savedTemplates, setSavedTemplates] = useState<Map<string, ReportTemplate>>(new Map())
    const [templateVersionSelections, setTemplateVersionSelections] = useState<Map<string, TemplateVersionSelection>>(new Map())

    // JSON tab state management
    const [jsonTabStates, setJsonTabStates] = useState<Map<string, JsonTabState>>(new Map())
    const editorStatesRef = useRef<Map<string, EditorState>>(new Map())
    const jsonViewRef = useRef<EditorView | null>(null)
    const [subreportTemplateCache, setSubreportTemplateCache] = useState<Map<string, ReportTemplate>>(new Map())
    const [closeConfirmTabId, setCloseConfirmTabId] = useState<string | null>(null)
    // Signals the workspace panel to reveal + reload a folder (e.g. after a
    // subreport auto-created its report file there). seq forces the effect.
    const [workspaceReveal, setWorkspaceReveal] = useState<{ workspace: string, path: string, seq: number } | null>(null)
    const workspaceRevealSeqRef = useRef(0)
    const activityReloadSeqRef = useRef<Map<string, number>>(new Map())

    // Tabs recently written through MCP (tabId -> ISO time of the last MCP save).
    const [mcpTouchedTabs, setMcpTouchedTabs] = useState<Map<string, string>>(new Map())

    // Derive the active tab's state
    const activeState = activeTabId !== null ? tabStates.get(activeTabId) ?? null : null

    // Active tab entry
    const activeTab = activeTabId !== null
        ? tabs.find(function (t) { return t.id === activeTabId }) ?? null
        : null
    const activeTabType = activeTab !== null ? activeTab.type : null

    // Active JSON state
    const activeJsonState = activeTabId !== null ? jsonTabStates.get(activeTabId) ?? null : null
    const openReportTemplates = useMemo(function () {
        if (activeTab === null || activeTab.type !== 'report') return [] as Array<{ path: string, template: ReportTemplate }>
        const workspace = activeTab.file.workspace
        const result: Array<{ path: string, template: ReportTemplate }> = []
        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i]
            if (tab.type !== 'report' || tab.file.workspace !== workspace) continue
            if (tab.id === activeTab.id) continue
            const state = tabStates.get(tab.id)
            if (state === undefined) continue
            result.push({ path: tab.file.path, template: state.template })
        }
        return result
    }, [activeTab, tabs, tabStates])
    const availableReportTemplates = useMemo(function () {
        if (activeTab === null || activeTab.type !== 'report') return [] as OpenReportTemplate[]
        const workspace = activeTab.file.workspace
        const result = new Map<string, ReportTemplate>()
        subreportTemplateCache.forEach(function (template, key) {
            if (!key.startsWith(workspace + '/')) return
            const path = key.substring(workspace.length + 1)
            if (path !== activeTab.file.path) {
                result.set(path, template)
            }
        })
        for (let i = 0; i < openReportTemplates.length; i++) {
            result.set(openReportTemplates[i].path, openReportTemplates[i].template)
        }
        return Array.from(result.entries()).map(function (entry) {
            return { path: entry[0], template: entry[1] }
        })
    }, [activeTab, openReportTemplates, subreportTemplateCache])
    const subreportTemplateExpressions = useMemo(function () {
        if (activeTab === null || activeTab.type !== 'report' || activeState === null) return [] as string[]
        const result = new Set<string>()
        for (let i = 0; i < activeState.template.bands.length; i++) {
            collectSubreportTemplateExpressions(activeState.template.bands[i].elements, result)
        }
        return Array.from(result)
    }, [activeTab, activeState])
    const subreportTemplateSignature = useMemo(function () {
        return subreportTemplateExpressions.join('\u0000')
    }, [subreportTemplateExpressions])

    function cacheSubreportTemplates(workspace: string, templates: OpenReportTemplate[]): void {
        if (templates.length === 0) return
        setSubreportTemplateCache(function (prev) {
            const next = new Map(prev)
            for (let i = 0; i < templates.length; i++) {
                // Templates returned from the server are raw JSON, so normalize them to the editor type contract (band id / groups, etc.)
                next.set(workspace + '/' + templates[i].path, normalizeTemplate(templates[i].template))
            }
            return next
        })
    }

    useEffect(function () {
        if (activeTab === null || activeTab.type !== 'report' || activeState === null) return
        if (subreportTemplateExpressions.length === 0) return

        let cancelled = false
        Promise.all(subreportTemplateExpressions.map(function (templateExpression) {
            return Action.resolveSubreportTemplates(
                activeTab.file.workspace,
                activeTab.file.path,
                activeState.template,
                templateExpression,
                openReportTemplates,
            )
        })).then(function (results) {
            if (cancelled) return
            const resolvedTemplates: OpenReportTemplate[] = []
            for (let i = 0; i < results.length; i++) {
                if (!results[i].valid) continue
                for (let j = 0; j < results[i].templates.length; j++) {
                    resolvedTemplates.push(results[i].templates[j])
                }
            }
            cacheSubreportTemplates(activeTab.file.workspace, resolvedTemplates)
        })

        return function () {
            cancelled = true
        }
    }, [activeTab, activeState?.template.name, openReportTemplates, subreportTemplateSignature])

    // Custom dispatch (applies reducerWithHistory to the active tab's State)
    const activeTabIdRef = useRef(activeTabId)
    activeTabIdRef.current = activeTabId
    const tabsRef = useRef(tabs)
    tabsRef.current = tabs
    // Fresh-state mirrors so long-lived event handlers (the MCP activity
    // stream) can check dirtiness without capturing stale state.
    const savedTemplatesRef = useRef(savedTemplates)
    savedTemplatesRef.current = savedTemplates
    const tabStatesRef = useRef(tabStates)
    tabStatesRef.current = tabStates
    const jsonTabStatesRef = useRef(jsonTabStates)
    jsonTabStatesRef.current = jsonTabStates

    function findTabType(tabId: string): 'report' | 'json' | null {
        const currentTabs = tabsRef.current
        for (let i = 0; i < currentTabs.length; i++) {
            if (currentTabs[i].id === tabId) return currentTabs[i].type
        }
        return null
    }

    function captureCurrentJsonEditorState(): void {
        const currentTabId = activeTabIdRef.current
        if (currentTabId === null) return
        if (findTabType(currentTabId) !== 'json') return
        if (jsonViewRef.current === null) return
        editorStatesRef.current.set(currentTabId, jsonViewRef.current.state)
    }

    function persistCurrentJsonEditorState(nextTabId?: string): void {
        const currentTabId = activeTabIdRef.current
        if (currentTabId === null) return
        if (nextTabId !== undefined && currentTabId === nextTabId) return
        captureCurrentJsonEditorState()
        jsonViewRef.current = null
    }

    function activateTab(tabId: string): void {
        if (activeTabIdRef.current === tabId) return
        persistCurrentJsonEditorState(tabId)
        setActiveTabId(tabId)
    }

    function dispatch(action: ActionType) {
        const tabId = activeTabIdRef.current
        if (tabId === null) return
        setTabStates(function (prev) {
            const current = prev.get(tabId)
            if (current === undefined) return prev
            const next = new Map(prev)
            next.set(tabId, reducerWithHistory(current, action))
            return next
        })
    }

    // Tab operations
    function openTab(workspace: string, filePath: string, template: ReportTemplate) {
        const tabId = makeTabId(workspace, filePath)
        const fileName = filePath.indexOf('/') !== -1
            ? filePath.substring(filePath.lastIndexOf('/') + 1)
            : filePath

        // If already open, just activate it
        const currentTabs = tabsRef.current
        for (let i = 0; i < currentTabs.length; i++) {
            if (currentTabs[i].id === tabId) {
                activateTab(tabId)
                return
            }
        }

        const newState = defaultState()
        newState.template = normalizeTemplate(template)
        newState.elementIdCounter = computeElementIdCounter(newState.template)
        const entry: TabEntry = { id: tabId, type: 'report', file: { workspace: workspace, path: filePath }, label: fileName }

        setTabs(function (prev) { return prev.concat(entry) })
        setTabStates(function (prev) { return new Map(prev).set(tabId, newState) })
        setSavedTemplates(function (prev) { return new Map(prev).set(tabId, newState.template) })
        setTemplateVersionSelections(function (prev) { return new Map(prev).set(tabId, { kind: 'current' }) })
        activateTab(tabId)

        // Fetch the JSON file list if it hasn't been fetched yet
        if (!jsonFilesMap.has(workspace)) {
            Action.getJsonFiles(workspace).then(function (files) {
                updateJsonFiles(workspace, files)
            })
        }
    }

    function openJsonTab(workspace: string, filePath: string, content: string) {
        const tabId = makeTabId(workspace, filePath)
        const fileName = filePath.indexOf('/') !== -1
            ? filePath.substring(filePath.lastIndexOf('/') + 1)
            : filePath

        // If already open, just activate it
        const currentTabs = tabsRef.current
        for (let i = 0; i < currentTabs.length; i++) {
            if (currentTabs[i].id === tabId) {
                activateTab(tabId)
                return
            }
        }

        const jsonState: JsonTabState = { originalContent: content, content: content }
        const entry: TabEntry = { id: tabId, type: 'json', file: { workspace: workspace, path: filePath }, label: fileName }

        // Create the EditorState (updateListener is managed on the form side, so wire contentChange through a ref here)
        const editorState = EditorState.create({
            doc: content,
            extensions: createJsonEditorExtensions(function (newContent: string) {
                handleJsonContentChange(tabId, newContent)
            })
        })
        editorStatesRef.current.set(tabId, editorState)

        setTabs(function (prev) { return prev.concat(entry) })
        setJsonTabStates(function (prev) { return new Map(prev).set(tabId, jsonState) })
        activateTab(tabId)
    }

    function closeTab(tabId: string) {
        setTabs(function (prev) {
            const filtered = prev.filter(function (t) { return t.id !== tabId })
            // Decide which tab to switch to if the active tab was closed
            if (activeTabIdRef.current === tabId) {
                const idx = prev.findIndex(function (t) { return t.id === tabId })
                if (filtered.length === 0) {
                    setActiveTabId(null)
                } else if (idx >= filtered.length) {
                    setActiveTabId(filtered[filtered.length - 1].id)
                } else {
                    setActiveTabId(filtered[idx].id)
                }
            }
            return filtered
        })
        setTabStates(function (prev) {
            const next = new Map(prev)
            next.delete(tabId)
            return next
        })
        // Clean up JSON-related state
        setJsonTabStates(function (prev) {
            const next = new Map(prev)
            next.delete(tabId)
            return next
        })
        setSavedTemplates(function (prev) {
            const next = new Map(prev)
            next.delete(tabId)
            return next
        })
        setTemplateVersionSelections(function (prev) {
            const next = new Map(prev)
            next.delete(tabId)
            return next
        })
        editorStatesRef.current.delete(tabId)
    }

    function requestCloseTab(tabId: string) {
        const tab = tabs.find(function (t) { return t.id === tabId })
        if (tab !== undefined && isTabDirty(tab)) {
            setCloseConfirmTabId(tabId)
        } else {
            closeTab(tabId)
        }
    }

    function switchTab(tabId: string) {
        activateTab(tabId)
    }

    // Callback invoked when the JSON editor view is created
    function handleJsonViewCreated(view: EditorView) {
        jsonViewRef.current = view
    }

    // Handler for JSON editor content changes
    function handleJsonContentChange(tabId: string, content: string) {
        setJsonTabStates(function (prev) {
            const current = prev.get(tabId)
            if (current === undefined) return prev
            const next = new Map(prev)
            next.set(tabId, { originalContent: current.originalContent, content: content })
            return next
        })
    }

    // Open a JSON file
    function handleOpenJson(workspace: string, filePath: string) {
        const tabId = makeTabId(workspace, filePath)
        const currentTabs = tabsRef.current
        for (let i = 0; i < currentTabs.length; i++) {
            if (currentTabs[i].id === tabId) {
                activateTab(tabId)
                return
            }
        }
        Action.loadJsonFile(workspace, filePath).then(function (content) {
            openJsonTab(workspace, filePath, content)
        })
    }

    // Save handler
    function handleSave() {
        if (activeTab === null || activeTabId === null) return
        if (activeTab.type === 'report') {
            const state = tabStates.get(activeTabId)
            if (state === undefined) return
            const version = templateVersionSelections.get(activeTabId) ?? { kind: 'current' }
            const filePath = activeTab.file.path
            const fileName = filePath.indexOf('/') !== -1
                ? filePath.substring(filePath.lastIndexOf('/') + 1)
                : filePath
            const parentPath = filePath.indexOf('/') !== -1
                ? filePath.substring(0, filePath.lastIndexOf('/'))
                : ''
            const ws = activeTab.file.workspace
            const templateToSave = state.template
            const tabIdToSave = activeTabId
            // Provisional slice images (data URI sources) reach the workspace
            // only now: upload the referenced ones and save the template with
            // the rewritten paths. The in-memory template is swapped to the
            // same instance so reference-based dirty tracking stays clean;
            // when the user edited during the upload, their newer state wins
            // and the next save converts again.
            uploadPendingSliceImages(ws, filePath, templateToSave).then(function (prepared) {
                if (prepared !== templateToSave) {
                    setTabStates(function (prev) {
                        const current = prev.get(tabIdToSave)
                        if (current === undefined || current.template !== templateToSave) return prev
                        const next = new Map(prev)
                        next.set(tabIdToSave, { ...current, template: prepared })
                        return next
                    })
                }
                if (version.kind === 'current') {
                    Action.saveTemplateAsNew(ws, parentPath, fileName, prepared).then(function () {
                        Action.getJsonFiles(ws).then(function (files) { updateJsonFiles(ws, files) })
                        setSavedTemplates(function (prev) { return new Map(prev).set(tabIdToSave, prepared) })
                    })
                } else {
                    Action.saveTemplateTag(ws, filePath, version.tag, prepared).then(function () {
                        refreshTemplateTags(ws, filePath)
                        setSavedTemplates(function (prev) { return new Map(prev).set(tabIdToSave, prepared) })
                    })
                }
            })
        } else {
            const ws = activeTab.file.workspace
            const jsonState = jsonTabStates.get(activeTabId)
            if (jsonState === undefined) return
            captureCurrentJsonEditorState()
            let contentToSave = jsonState.content
            if (jsonViewRef.current !== null && activeTabIdRef.current === activeTabId) {
                const liveState = jsonViewRef.current.state
                editorStatesRef.current.set(activeTabId, liveState)
                contentToSave = liveState.doc.toString()
            }
            Action.saveJsonFile(ws, activeTab.file.path, contentToSave).then(function () {
                Action.getJsonFiles(ws).then(function (files) { updateJsonFiles(ws, files) })
                setJsonTabStates(function (prev) {
                    const current = prev.get(activeTabId!)
                    if (current === undefined) return prev
                    const next = new Map(prev)
                    next.set(activeTabId!, { originalContent: contentToSave, content: contentToSave })
                    return next
                })
            })
        }
    }

    // Undo/redo handlers (called from the toolbar)
    function handleToolbarUndo() {
        if (activeTabType === 'json') {
            const view = jsonViewRef.current
            if (view !== null) cmUndo(view)
        } else {
            Action.undo(dispatch)
        }
    }

    function handleToolbarRedo() {
        if (activeTabType === 'json') {
            const view = jsonViewRef.current
            if (view !== null) cmRedo(view)
        } else {
            Action.redo(dispatch)
        }
    }

    // JSON file map (workspace name → JSON file list)
    const [jsonFilesMap, setJsonFilesMap] = useState<Map<string, JsonFileInfo[]>>(new Map())
    // Data source used for the preview
    const [previewDataSource, setPreviewDataSource] = useState<DataSource | null>(null)

    function updateJsonFiles(workspace: string, jsonFiles: JsonFileInfo[]) {
        setJsonFilesMap(function (prev) { return new Map(prev).set(workspace, jsonFiles) })
    }

    function handleFileUploaded(workspace: string) {
        Action.getJsonFiles(workspace).then(function (files) { updateJsonFiles(workspace, files) })
    }

    // Shared resources
    const [fontRegistry, setFontRegistry] = useState<Map<string, FontResource>>(new Map())
    const [mathFontResource, setMathFontResource] = useState<FontResource | null>(null)
    const [fontList, setFontList] = useState<FontEntry[]>([])
    const fontListRef = useRef(fontList)
    fontListRef.current = fontList
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [isTemplateTagDialogOpen, setIsTemplateTagDialogOpen] = useState(false)
    const [isUserManagementDialogOpen, setIsUserManagementDialogOpen] = useState(false)
    const [isApiClientDialogOpen, setIsApiClientDialogOpen] = useState(false)
    const [isPrintHistoryDialogOpen, setIsPrintHistoryDialogOpen] = useState(false)
    const [isFontDialogOpen, setIsFontDialogOpen] = useState(false)
    const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false)
    const [isOAuthDialogOpen, setIsOAuthDialogOpen] = useState(false)
    const [isExportDataDialogOpen, setIsExportDataDialogOpen] = useState(false)
    const [isImportDataDialogOpen, setIsImportDataDialogOpen] = useState(false)
    const [isPdfImportDialogOpen, setIsPdfImportDialogOpen] = useState(false)
    const [imageSliceTarget, setImageSliceTarget] = useState<ImageSliceTarget | null>(null)
    const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
    const [isMcpSettingsDialogOpen, setIsMcpSettingsDialogOpen] = useState(false)
    const [isFactoryResetConfirmOpen, setIsFactoryResetConfirmOpen] = useState(false)
    const [factoryResetConfirmText, setFactoryResetConfirmText] = useState('')
    const [isFactoryResetRunning, setIsFactoryResetRunning] = useState(false)
    const [templateTags, setTemplateTags] = useState<TemplateTagInfo[]>([])
    const [templateTagName, setTemplateTagName] = useState('')
    const [templateTagDescription, setTemplateTagDescription] = useState('')
    const [deleteTagConfirmTarget, setDeleteTagConfirmTarget] = useState<string | null>(null)
    const [splitRatio, setSplitRatio] = useState(50)
    const [leftPanelWidth, setLeftPanelWidth] = useState(240)
    const leftPanelRef = useRef<HTMLDivElement>(null)
    const toastRef = useRef<Toast>(null)
    // Close (and blur) the version dropdown on an outside click, since the
    // canvas stops mousedown and PrimeReact's own outside-click never fires.
    const versionDropdownRef = useRef<Dropdown>(null)
    const versionDropdownAutoClose = useDropdownAutoClose(versionDropdownRef)

    function showActivityToast(severity: 'info' | 'warn', via: 'mcp' | 'editor', detail: string): void {
        if (toastRef.current !== null) {
            toastRef.current.show({ severity: severity, summary: via === 'mcp' ? ui.mcpEdit : ui.otherUserEdit, detail: detail, life: 6000 })
        }
    }

    function activityMessage(message: string, file: string, editor: string): string {
        return message.replace('{file}', file).replace('{editor}', editor)
    }

    // Live workspace activity channel: hot-reload open files saved elsewhere
    // (another user's editor or an MCP session) when no local changes would be
    // lost. MCP-touched tabs additionally get the MCP badge. Events carrying
    // this browser's own instance id are ignored (a self-triggered reload
    // would wipe the undo history).
    // The account-level default color mode drives the color form of newly
    // created elements (reducer ADD_ELEMENT/ADD_ELEMENT_TO_PARENT).
    useEffect(function () {
        if (sysState.loginUser.id === undefined) return
        dispatch({ type: 'SET_DEFAULT_COLOR_MODE', payload: { mode: sysState.loginUser.defaultColorMode } })
    }, [sysState.loginUser.id, sysState.loginUser.defaultColorMode])

    useEffect(function () {
        if (sysState.loginUser.id === undefined) return
        let closed = false
        let socket: WebSocket | null = null
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null
        function handleMessage(e: MessageEvent): void {
            const event = JSON.parse(e.data) as WorkspaceActivityEvent
            if (event.instance !== '' && event.instance === EDITOR_INSTANCE_ID) return
            const tabId = makeTabId(event.workspace, event.path)
            if (event.via === 'mcp') {
                setMcpTouchedTabs(function (prev) { return new Map(prev).set(tabId, event.at) })
            }
            if (event.action !== 'draft') {
                workspaceRevealSeqRef.current += 1
                setWorkspaceReveal({
                    workspace: event.workspace,
                    path: workspaceActivityRevealPath(event),
                    seq: workspaceRevealSeqRef.current
                })
                Action.getJsonFiles(event.workspace).then(function (files) {
                    updateJsonFiles(event.workspace, files)
                })
            }
            if (event.action === 'rename') {
                nextActivityReloadSequence(makeTabId(event.workspace, event.previousPath))
                handleRenameFile(event.workspace, event.previousPath, event.path)
                return
            }
            if (event.action === 'delete') {
                nextActivityReloadSequence(tabId)
                handleDeleteFile(event.workspace, event.path, event.isDirectory)
                return
            }
            const tab = tabsRef.current.find(function (t) { return t.id === tabId })
            if (tab === undefined) return
            const label = event.workspace + '/' + event.path
            const editor = event.via === 'mcp' ? 'MCP' : event.account
            const sequence = nextActivityReloadSequence(tabId)
            if (event.action === 'draft') {
                if (event.draftKind === 'report' && tab.type === 'report') {
                    applyReportDraftToTab(tabId, JSON.parse(event.content) as ReportTemplate)
                } else if (event.draftKind === 'json' && tab.type === 'json') {
                    resetJsonTabToContent(tabId, event.content, false)
                }
                showActivityToast('info', event.via, activityMessage(ui.updatedReloaded, label, editor))
                return
            }
            if (event.via !== 'mcp' && isTabDirty(tab)) {
                showActivityToast('warn', event.via, activityMessage(ui.updatedUnsavedNotReloaded, label, editor))
                return
            }
            if (tab.type === 'report') {
                Action.loadTemplateFromFile(event.workspace, event.path).then(function (template) {
                    if (activityReloadSeqRef.current.get(tabId) !== sequence) return
                    resetReportTabToTemplate(tabId, template, { kind: 'current' })
                    showActivityToast('info', event.via, activityMessage(ui.updatedReloaded, label, editor))
                })
            } else {
                Action.loadJsonFile(event.workspace, event.path).then(function (content) {
                    if (activityReloadSeqRef.current.get(tabId) !== sequence) return
                    resetJsonTabToContent(tabId, content, true)
                    showActivityToast('info', event.via, activityMessage(ui.updatedReloaded, label, editor))
                })
            }
        }
        function connect(): void {
            socket = new WebSocket(workspaceActivityWebSocketUrl())
            socket.onmessage = handleMessage
            socket.onclose = function () {
                if (closed) return
                reconnectTimer = setTimeout(connect, 1000)
            }
        }
        connect()
        return function () {
            closed = true
            if (reconnectTimer !== null) clearTimeout(reconnectTimer)
            if (socket !== null) socket.close()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sysState.loginUser.id])

    // Tracks fonts currently being loaded (prevents duplicate loads)
    const loadingFontsRef = useRef<Set<string>>(new Set())
    // References the latest fontRegistry value via a ref (avoids useEffect dependency)
    const fontRegistryRef = useRef(fontRegistry)
    fontRegistryRef.current = fontRegistry

    // Math font map (font family name → Font)
    const mathFonts: Record<string, Font> = useMemo(() => {
        const result: Record<string, Font> = {}
        fontRegistry.forEach(function (resource, fontId) { result[fontId] = resource.font })
        return result
    }, [fontRegistry])

    // Load the default font, math font, and font list
    useEffect(() => {
        Promise.all([
            loadFont(FONT_URL, DEFAULT_FONT_ID),
            loadFont(MATH_FONT_URL, MATH_FONT_ID),
            Action.getAccountFonts(),
        ]).then(function ([defaultResource, mathResource, fonts]) {
            const registry = createBuiltinFontRegistry(defaultResource, mathResource, fonts)
            setFontRegistry(registry)
            setMathFontResource(mathResource)
            setFontList(fonts)
            if (fonts.length === 0) setIsFontDialogOpen(true)
        })
    }, [])

    function reloadFontList() {
        Action.getAccountFonts().then(function (fonts) {
            const previousFonts = fontListRef.current
            setFontList(fonts)
            setFontRegistry(function (previous) {
                const next = new Map(previous)
                for (let i = 0; i < previousFonts.length; i++) {
                    const previousFontId = previousFonts[i]!.name
                    let remainsInstalled = false
                    for (let j = 0; j < fonts.length; j++) {
                        if (fonts[j]!.name === previousFontId) {
                            remainsInstalled = true
                            break
                        }
                    }
                    if (!remainsInstalled) {
                        evictFont(previousFontId)
                        next.delete(previousFontId)
                    }
                }
                reconcileLegacyBuiltinAliases(next, fonts)
                return next
            })
        })
    }

    function registerImportedPdfFonts(sources: PdfEmbeddedFontSource[]): void {
        setFontRegistry(function (previous) {
            const next = new Map(previous)
            for (let i = 0; i < sources.length; i++) next.set(sources[i]!.fontId, sources[i]!.resource)
            return next
        })
        setFontList(function (previous) {
            const next = previous.slice()
            const ids = new Set(previous.map(function (entry) { return entry.name }))
            for (let i = 0; i < sources.length; i++) {
                const source = sources[i]!
                if (ids.has(source.fontId)) continue
                ids.add(source.fontId)
                next.push({ name: source.fontId, path: source.fileName, extension: source.extension, version: source.fontId })
            }
            next.sort(function (a, b) { return a.name.localeCompare(b.name) })
            return next
        })
    }

    // The editor UI language (first path segment) is also the font-catalog code.
    function editorLanguage(): LanguageCode {
        const seg = window.location.pathname.split('/').filter(function (s) { return s !== '' })[0] ?? ''
        return resolveSupportedLanguage(seg)
    }

    useEffect(function () {
        if (activeTab === null || activeTab.type !== 'report') {
            setTemplateTags([])
            return
        }
        refreshTemplateTags(activeTab.file.workspace, activeTab.file.path)
    }, [activeTab?.id, activeTab?.type, activeTab?.file.workspace, activeTab?.file.path])

    // Dynamically load fonts referenced by elements in the template
    useEffect(() => {
        if (activeState === null) return
        const needed = new Set<string>()
        const bands = activeState.template.bands
        for (let i = 0; i < bands.length; i++) {
            collectFontFamilies(bands[i].elements, needed)
        }
        const reg = fontRegistryRef.current
        const loading = loadingFontsRef.current
        needed.forEach(function (name) {
            if (reg.has(name) || loading.has(name)) return
            const entry = fontList.find(function (f) { return f.name === name })
            if (entry !== undefined) {
                loading.add(name)
                loadFont('/api/fonts/' + entry.path + '?v=' + encodeURIComponent(entry.version), name).then(function (res) {
                    setFontRegistry(function (prev) { return new Map(prev).set(name, res) })
                })
            }
        })
    }, [activeState, fontList])

    // Keyboard shortcuts read state through refs to avoid re-registering listeners.
    const stateRef = useRef(activeState)
    stateRef.current = activeState
    const activeTabTypeRef = useRef(activeTabType)
    activeTabTypeRef.current = activeTabType
    const handleSaveRef = useRef(handleSave)
    handleSaveRef.current = handleSave
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const mod = e.metaKey || e.ctrlKey
            const key = e.key.toLowerCase()

            // A modal dialog owns the keyboard: no editor shortcut may fire
            // behind it. Only Ctrl+S is swallowed so the browser's own save
            // dialog does not appear.
            if (isModalDialogOpen()) {
                if (mod && key === 's') e.preventDefault()
                return
            }

            // Ctrl+S: save for all tab types.
            if (mod && key === 's') {
                e.preventDefault()
                handleSaveRef.current()
                return
            }

            // Skip JSON tabs because CodeMirror handles undo/redo itself.
            if (activeTabTypeRef.current === 'json') return

            const s = stateRef.current
            if (s === null) return

            // Disable editor shortcuts during inline editing.
            if (s.editingElementId !== null) return

            // Undo: Ctrl+Z / Cmd+Z
            if (mod && key === 'z' && !e.shiftKey) {
                e.preventDefault()
                Action.undo(dispatch)
                return
            }

            // Redo: Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y / Cmd+Y
            if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
                e.preventDefault()
                Action.redo(dispatch)
                return
            }

            // Ctrl+C: copy.
            if (mod && key === 'c') {
                if (s.selectedElementIds.length > 0 && s.selectedBandId !== null) {
                    const tag = (document.activeElement as HTMLElement)?.tagName
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
                    e.preventDefault()
                    const band = s.template.bands.find(function (b) { return b.id === s.selectedBandId })
                    if (band === undefined) return
                    const elements: TemplateElement[] = []
                    for (let i = 0; i < s.selectedElementIds.length; i++) {
                        const el = findElementInTree(band.elements, s.selectedElementIds[i])
                        if (el !== undefined) elements.push(el)
                    }
                    if (elements.length > 0) {
                        const data = JSON.stringify({ tsreportElements: elements, bandId: s.selectedBandId })
                        navigator.clipboard.writeText(data)
                    }
                }
                return
            }

            // Ctrl+X: cut.
            if (mod && key === 'x') {
                if (s.selectedElementIds.length > 0 && s.selectedBandId !== null) {
                    const tag = (document.activeElement as HTMLElement)?.tagName
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
                    e.preventDefault()
                    const band = s.template.bands.find(function (b) { return b.id === s.selectedBandId })
                    if (band === undefined) return
                    const elements: TemplateElement[] = []
                    for (let i = 0; i < s.selectedElementIds.length; i++) {
                        const el = findElementInTree(band.elements, s.selectedElementIds[i])
                        if (el !== undefined) elements.push(el)
                    }
                    if (elements.length > 0) {
                        const data = JSON.stringify({ tsreportElements: elements, bandId: s.selectedBandId })
                        navigator.clipboard.writeText(data)
                        if (s.selectedElementIds.length === 1) {
                            Action.deleteElement(dispatch, s.selectedElementIds[0], s.selectedBandId)
                        } else {
                            Action.deleteElements(dispatch, s.selectedElementIds, s.selectedBandId)
                        }
                    }
                }
                return
            }

            // Ctrl+V: paste.
            if (mod && key === 'v') {
                const tag = (document.activeElement as HTMLElement)?.tagName
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
                e.preventDefault()
                navigator.clipboard.readText().then(function (text) {
                    try {
                        const data = JSON.parse(text)
                        if (data.tsreportElements === undefined || !Array.isArray(data.tsreportElements)) return
                        const elements: TemplateElement[] = data.tsreportElements
                        // Paste target band: currently selected band, or the clipboard band when none is selected.
                        const targetBandId: string | undefined = s.selectedBandId ?? data.bandId
                        if (targetBandId === undefined) return
                        // Paste with a small offset to avoid overlap.
                        const offset = 10
                        const shifted = elements.map(function (el) {
                            return { ...el, x: el.x + offset, y: el.y + offset }
                        })
                        Action.pasteElements(dispatch, targetBandId, shifted)
                    } catch (_) {
                        // Ignore non-tsreport data.
                    }
                })
                return
            }

            // Escape clears table sub-selection.
            if (e.key === 'Escape') {
                if (s.pathEditing !== null) {
                    e.preventDefault()
                    Action.setPathEdit(dispatch, null)
                    return
                }
                if (s.tableSelection !== null) {
                    e.preventDefault()
                    Action.setTableSelection(dispatch, null)
                }
                return
            }

            // Delete or Backspace deletes selected elements or disables the selected band.
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const tag = (document.activeElement as HTMLElement)?.tagName
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
                if (s.pathEditing !== null) {
                    e.preventDefault()
                    return
                }
                if (s.selectedBandId !== null) {
                    e.preventDefault()
                    if (s.selectedElementIds.length === 0) {
                        Action.toggleBandEnabled(dispatch, s.selectedBandId)
                    } else if (s.selectedElementIds.length === 1) {
                        Action.deleteElement(dispatch, s.selectedElementIds[0], s.selectedBandId)
                    } else {
                        Action.deleteElements(dispatch, s.selectedElementIds, s.selectedBandId)
                    }
                }
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    // A newly placed subreport auto-creates its own report file in the host
    // report's folder. The server assigns a collision-free name (guaranteed
    // atomically), and the subreport is wired to reference that file. Errors
    // propagate to the global handler (no local catch), matching save/load.
    function handlePlaceSubreport(elementId: string, bandId: string): void {
        if (activeTab === null || activeTab.type !== 'report') return
        const file = activeTab.file
        const folder = dirnamePosix(file.path)
        const content = JSON.stringify(createDefaultTemplate(), null, 2)
        Action.createSubreportFile(file.workspace, folder, content).then(function (fileName) {
            Action.updateElement(dispatch, elementId, bandId, { templateExpression: "'" + fileName + "'" })
            Action.getJsonFiles(file.workspace).then(function (files) { updateJsonFiles(file.workspace, files) })
            // Reveal + reload the folder so the new report file is shown in the tree.
            workspaceRevealSeqRef.current += 1
            setWorkspaceReveal({ workspace: file.workspace, path: folder, seq: workspaceRevealSeqRef.current })
        })
    }

    function handleCreateReport(workspace: string, parentPath: string, fileName: string): Promise<void> {
        const fullName = fileName.endsWith('.report') ? fileName : fileName + '.report'
        const template = createDefaultTemplate()
        template.name = fullName.replace(/\.report$/, '')
        return Action.saveTemplateAsNew(workspace, parentPath, fullName, template).then(function () {
            Action.getJsonFiles(workspace).then(function (files) { updateJsonFiles(workspace, files) })
            const filePath = parentPath === '' ? fullName : parentPath + '/' + fullName
            openTab(workspace, filePath, template)
        })
    }

    function handleCreateJson(workspace: string, parentPath: string, fileName: string): Promise<void> {
        const fullName = fileName.endsWith('.json') ? fileName : fileName + '.json'
        const content = JSON.stringify({
            rows: [
                { id: 1, name: "商品A", price: 1000, quantity: 2, category: "電子機器" },
                { id: 2, name: "商品B", price: 2500, quantity: 1, category: "文房具" },
                { id: 3, name: "商品C", price: 800, quantity: 5, category: "電子機器" },
            ],
            parameters: {
                reportTitle: "サンプルレポート",
                printDate: "2025-01-01",
            },
        }, null, 2)
        const filePath = parentPath === '' ? fullName : parentPath + '/' + fullName
        return Action.saveJsonFile(workspace, filePath, content).then(function () {
            Action.getJsonFiles(workspace).then(function (files) { updateJsonFiles(workspace, files) })
            openJsonTab(workspace, filePath, content)
        })
    }

    function handleOpenReport(workspace: string, filePath: string) {
        // If already open, only switch tabs.
        const tabId = makeTabId(workspace, filePath)
        const currentTabs = tabsRef.current
        for (let i = 0; i < currentTabs.length; i++) {
            if (currentTabs[i].id === tabId) {
                activateTab(tabId)
                return
            }
        }
        Action.loadTemplateFromFile(workspace, filePath).then(function (template) {
            openTab(workspace, filePath, template)
        })
    }

    function resetReportTabToTemplate(tabId: string, template: ReportTemplate, version: TemplateVersionSelection): void {
        const normalizedTemplate = normalizeTemplate(template)
        setTabStates(function (prev) {
            const current = prev.get(tabId)
            if (current === undefined) return prev
            const next = new Map(prev)
            next.set(tabId, {
                ...current,
                template: normalizedTemplate,
                selectedElementIds: [],
                selectedBandId: null,
                editingElementId: null,
                elementIdCounter: computeElementIdCounter(normalizedTemplate),
                history: { ...current.history, past: [], future: [], baseSnapshot: null, textInputActive: false }
            })
            return next
        })
        setSavedTemplates(function (prev) { return new Map(prev).set(tabId, normalizedTemplate) })
        setTemplateVersionSelections(function (prev) { return new Map(prev).set(tabId, version) })
    }

    function applyReportDraftToTab(tabId: string, template: ReportTemplate): void {
        const normalizedTemplate = normalizeTemplate(template)
        setTabStates(function (prev) {
            const current = prev.get(tabId)
            if (current === undefined) return prev
            const next = new Map(prev)
            next.set(tabId, {
                ...current,
                template: normalizedTemplate,
                selectedElementIds: [],
                selectedBandId: null,
                editingElementId: null,
                elementIdCounter: computeElementIdCounter(normalizedTemplate),
                history: { ...current.history, past: [], future: [], baseSnapshot: null, textInputActive: false }
            })
            return next
        })
    }

    function resetJsonTabToContent(tabId: string, content: string, saved: boolean): void {
        const current = jsonTabStatesRef.current.get(tabId)
        if (current === undefined) return
        const editorState = EditorState.create({
            doc: content,
            extensions: createJsonEditorExtensions(function (newContent: string) {
                handleJsonContentChange(tabId, newContent)
            })
        })
        editorStatesRef.current.set(tabId, editorState)
        if (activeTabIdRef.current === tabId && jsonViewRef.current !== null) {
            jsonViewRef.current.setState(editorState)
        }
        setJsonTabStates(function (prev) {
            const state = prev.get(tabId)
            if (state === undefined) return prev
            const next = new Map(prev)
            next.set(tabId, {
                originalContent: saved ? content : state.originalContent,
                content
            })
            return next
        })
    }

    function nextActivityReloadSequence(tabId: string): number {
        const sequence = (activityReloadSeqRef.current.get(tabId) ?? 0) + 1
        activityReloadSeqRef.current.set(tabId, sequence)
        return sequence
    }

    function handleSelectCurrentVersion() {
        if (activeTab === null || activeTab.type !== 'report' || activeTabId === null) return
        if (activeTemplateVersion.kind === 'current') return
        const tabId = activeTabId
        Action.loadTemplateFromFile(activeTab.file.workspace, activeTab.file.path).then(function (template) {
            resetReportTabToTemplate(tabId, template, { kind: 'current' })
        })
    }

    function handleSelectTagVersion(tag: string) {
        if (activeTab === null || activeTab.type !== 'report' || activeTabId === null) return
        if (activeTemplateVersion.kind === 'tag' && activeTemplateVersion.tag === tag) return
        const tabId = activeTabId
        Action.loadTemplateTag(activeTab.file.workspace, activeTab.file.path, tag).then(function (result) {
            resetReportTabToTemplate(tabId, result.template, { kind: 'tag', tag: result.tag })
        })
    }

    // Update tabs when files are renamed.
    // For workspace renames, oldPath is empty, workspace is the old name, and newPath is the new name.
    // For entry renames, workspace is fixed and oldPath/newPath are file paths.
    function handleDeleteFile(workspace: string, filePath: string, isDirectory: boolean) {
        const prefix = makeTabId(workspace, filePath)
        // Collect target tab IDs.
        const idsToClose: string[] = []
        const currentTabs = tabsRef.current
        for (let i = 0; i < currentTabs.length; i++) {
            const tab = currentTabs[i]
            if (tab.file.workspace !== workspace) continue
            if (isDirectory) {
                if (tab.id === prefix || tab.id.startsWith(prefix + '/')) {
                    idsToClose.push(tab.id)
                }
            } else {
                if (tab.id === prefix) {
                    idsToClose.push(tab.id)
                }
            }
        }
        for (let i = 0; i < idsToClose.length; i++) {
            closeTab(idsToClose[i])
        }
    }

    function handleRenameFile(workspace: string, oldPath: string, newPath: string) {
        captureCurrentJsonEditorState()
        if (oldPath === '') {
            // Workspace rename: old workspace name is workspace and new workspace name is newPath.
            const oldWs = workspace
            const newWs = newPath
            setTabs(function (prev) {
                return prev.map(function (tab) {
                    if (tab.file.workspace === oldWs) {
                        const newTabId = makeTabId(newWs, tab.file.path)
                        return { id: newTabId, type: tab.type, file: { workspace: newWs, path: tab.file.path }, label: tab.label }
                    }
                    return tab
                })
            })
            setTabStates(function (prev) {
                const next = new Map<string, State>()
                prev.forEach(function (v, k) {
                    const matchPrefix = oldWs + '/'
                    if (k.startsWith(matchPrefix)) {
                        next.set(newWs + '/' + k.substring(matchPrefix.length), v)
                    } else {
                        next.set(k, v)
                    }
                })
                return next
            })
            setJsonTabStates(function (prev) {
                const next = new Map<string, JsonTabState>()
                prev.forEach(function (v, k) {
                    const matchPrefix = oldWs + '/'
                    if (k.startsWith(matchPrefix)) {
                        next.set(newWs + '/' + k.substring(matchPrefix.length), v)
                    } else {
                        next.set(k, v)
                    }
                })
                return next
            })
            setSavedTemplates(function (prev) {
                const next = new Map<string, ReportTemplate>()
                prev.forEach(function (v, k) {
                    const matchPrefix = oldWs + '/'
                    if (k.startsWith(matchPrefix)) {
                        next.set(newWs + '/' + k.substring(matchPrefix.length), v)
                    } else {
                        next.set(k, v)
                    }
                })
                return next
            })
            setTemplateVersionSelections(function (prev) {
                const next = new Map<string, TemplateVersionSelection>()
                prev.forEach(function (v, k) {
                    const matchPrefix = oldWs + '/'
                    if (k.startsWith(matchPrefix)) {
                        next.set(newWs + '/' + k.substring(matchPrefix.length), v)
                    } else {
                        next.set(k, v)
                    }
                })
                return next
            })
            // Update editorStatesRef as well.
            const oldEditorStates = new Map(editorStatesRef.current)
            editorStatesRef.current.clear()
            oldEditorStates.forEach(function (v, k) {
                const matchPrefix = oldWs + '/'
                if (k.startsWith(matchPrefix)) {
                    editorStatesRef.current.set(newWs + '/' + k.substring(matchPrefix.length), v)
                } else {
                    editorStatesRef.current.set(k, v)
                }
            })
            // Update activeTabId.
            if (activeTabIdRef.current !== null && activeTabIdRef.current.startsWith(oldWs + '/')) {
                setActiveTabId(newWs + '/' + activeTabIdRef.current.substring(oldWs.length + 1))
            }
        } else {
            // Entry rename: update direct matches and paths under renamed directories.
            const oldTabIdPrefix = makeTabId(workspace, oldPath)
            const newTabIdPrefix = makeTabId(workspace, newPath)
            setTabs(function (prev) {
                return prev.map(function (tab) {
                    if (tab.file.workspace !== workspace) return tab
                    if (tab.id === oldTabIdPrefix) {
                        // Direct match.
                        const newLabel = newPath.indexOf('/') !== -1
                            ? newPath.substring(newPath.lastIndexOf('/') + 1)
                            : newPath
                        return { id: newTabIdPrefix, type: tab.type, file: { workspace: workspace, path: newPath }, label: newLabel }
                    }
                    if (tab.id.startsWith(oldTabIdPrefix + '/')) {
                        // Under a directory.
                        const suffix = tab.id.substring(oldTabIdPrefix.length)
                        const newFilePath = newPath + suffix
                        const newLabel = newFilePath.indexOf('/') !== -1
                            ? newFilePath.substring(newFilePath.lastIndexOf('/') + 1)
                            : newFilePath
                        return { id: newTabIdPrefix + suffix, type: tab.type, file: { workspace: workspace, path: newFilePath }, label: newLabel }
                    }
                    return tab
                })
            })
            // Update keys in tabStates, jsonTabStates, and editorStatesRef.
            function remapKeys<T>(map: Map<string, T>): Map<string, T> {
                const next = new Map<string, T>()
                map.forEach(function (v, k) {
                    if (k === oldTabIdPrefix) {
                        next.set(newTabIdPrefix, v)
                    } else if (k.startsWith(oldTabIdPrefix + '/')) {
                        next.set(newTabIdPrefix + k.substring(oldTabIdPrefix.length), v)
                    } else {
                        next.set(k, v)
                    }
                })
                return next
            }
            setTabStates(function (prev) { return remapKeys(prev) })
            setJsonTabStates(function (prev) { return remapKeys(prev) })
            setSavedTemplates(function (prev) { return remapKeys(prev) })
            setTemplateVersionSelections(function (prev) { return remapKeys(prev) })
            editorStatesRef.current = remapKeys(editorStatesRef.current)
            // Update activeTabId.
            const currentActiveId = activeTabIdRef.current
            if (currentActiveId !== null) {
                if (currentActiveId === oldTabIdPrefix) {
                    setActiveTabId(newTabIdPrefix)
                } else if (currentActiveId.startsWith(oldTabIdPrefix + '/')) {
                    setActiveTabId(newTabIdPrefix + currentActiveId.substring(oldTabIdPrefix.length))
                }
            }
        }
    }

    function handlePromptNeeded() {
        if (toastRef.current !== null) {
            toastRef.current.show({
                severity: 'info',
                summary: ui.noReportLoaded,
                detail: ui.noReportGuidance,
                life: 3000
            })
        }
    }

    function handleLogout() {
        SystemAction.logout(sysDispatch)
    }

    function handlePasswordChanged() {
        setIsPasswordDialogOpen(false)
        if (toastRef.current !== null) {
            toastRef.current.show({
                severity: 'success',
                summary: ui.passwordChange,
                detail: ui.completed,
                life: 3000
            })
        }
    }

    function handleFactoryResetOpen() {
        setFactoryResetConfirmText('')
        setIsFactoryResetConfirmOpen(true)
    }

    async function executeFactoryReset() {
        setIsFactoryResetRunning(true)
        try {
            await Action.factoryReset()
        } finally {
            setIsFactoryResetRunning(false)
        }
        setIsFactoryResetConfirmOpen(false)
        // Every session (including this one) was wiped by the reset.
        SystemAction.logout(sysDispatch)
    }

    function handleSplitDragStart(e: ReactMouseEvent) {
        e.preventDefault()
        const panel = leftPanelRef.current
        if (panel === null) return
        const startY = e.clientY
        const panelRect = panel.getBoundingClientRect()
        const panelHeight = panelRect.height
        const startRatio = splitRatio
        function onMouseMove(ev: globalThis.MouseEvent) {
            const delta = ev.clientY - startY
            const newRatio = startRatio + (delta / panelHeight) * 100
            setSplitRatio(Math.max(10, Math.min(90, newRatio)))
        }
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
        }
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
    }

    function handleLeftPanelDragStart(e: ReactMouseEvent) {
        e.preventDefault()
        const startX = e.clientX
        const startWidth = leftPanelWidth
        function onMouseMove(ev: globalThis.MouseEvent) {
            const newWidth = startWidth + (ev.clientX - startX)
            setLeftPanelWidth(Math.max(120, Math.min(600, newWidth)))
        }
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
        }
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
    }

    function validateTemplateExpressions(template: ReportTemplate): string[] {
        const errors: string[] = []
        for (let i = 0; i < template.bands.length; i++) {
            const band = template.bands[i]
            validateExpression(band.printWhenExpression, getBandDisplayLabel(band) + '.printWhenExpression', errors)
            validateElementExpressions(band.elements, getBandDisplayLabel(band), errors)
        }
        return errors
    }

    function validateElementExpressions(elements: TemplateElement[], path: string, errors: string[]): void {
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i]
            const elPath = path + ' > ' + el.id
            validateExpression(el.expression, elPath + '.expression', errors)
            validateExpression(el.printWhenExpression, elPath + '.printWhenExpression', errors)
            validateExpression(el.templateExpression, elPath + '.templateExpression', errors)
            validateExpression(el.dataSourceExpression, elPath + '.dataSourceExpression', errors)
            validateExpression(el.sourceExpression, elPath + '.sourceExpression', errors)
            validateExpression(el.crosstabDataSourceExpression, elPath + '.crosstabDataSourceExpression', errors)
            if (el.children.length > 0) {
                validateElementExpressions(el.children, elPath, errors)
            }
        }
    }

    function validateExpression(value: string, path: string, errors: string[]): void {
        if (value === '') return
        const error = validateExpressionSource(value)
        if (error !== null) {
            errors.push(path + ': "' + value + '" — ' + error.message)
        }
    }

    function handlePreviewOpen() {
        if (activeTab === null || activeState === null) return

        // Validate all expression syntax before preview.
        const expressionErrors = validateTemplateExpressions(activeState.template)
        if (expressionErrors.length > 0) {
            if (toastRef.current !== null) {
                toastRef.current.show({
                    severity: 'error',
                    summary: ui.expressionSyntaxError,
                    detail: expressionErrors.join('\n'),
                    sticky: true,
                })
            }
            return
        }

        const testDataPath = activeState.template.testDataPath
        if (testDataPath !== '') {
            Action.loadJsonFile(activeTab.file.workspace, testDataPath).then(function (text) {
                let ds: DataSource | null = null
                try {
                    ds = normalizeDataSource(JSON.parse(text))
                } catch {
                    // Use empty data when parsing fails.
                }
                setPreviewDataSource(ds)
                setIsPreviewOpen(true)
            })
        } else {
            setPreviewDataSource(null)
            setIsPreviewOpen(true)
        }
    }
    function handlePreviewClose() {
        setIsPreviewOpen(false)
        setPreviewDataSource(null)
    }

    function handleTemplateTagsOpen() {
        if (activeTab === null || activeTab.type !== 'report') return
        refreshTemplateTags(activeTab.file.workspace, activeTab.file.path)
        setTemplateTagName('')
        setTemplateTagDescription('')
        setIsTemplateTagDialogOpen(true)
    }

    function handleTemplateTagsClose() {
        setIsTemplateTagDialogOpen(false)
        setTemplateTagName('')
        setTemplateTagDescription('')
    }

    function handleCreateTemplateTag() {
        if (activeTab === null || activeTab.type !== 'report' || activeState === null) return
        Action.createTemplateTag(
            activeTab.file.workspace,
            activeTab.file.path,
            templateTagName.trim(),
            templateTagDescription.trim(),
            activeState.template
        ).then(function (tag) {
            setTemplateTags(function (prev) { return [tag].concat(prev) })
            refreshTemplateTags(activeTab.file.workspace, activeTab.file.path)
            setTemplateTagName('')
            setTemplateTagDescription('')
            if (toastRef.current !== null) {
                toastRef.current.show({
                    severity: 'success',
                    summary: ui.apiTags,
                    detail: tag.tag + ': ' + ui.completed,
                    life: 3000
                })
            }
        })
    }

    function handleDeleteTemplateTag(tag: string) {
        if (activeTab === null || activeTab.type !== 'report') return
        setDeleteTagConfirmTarget(tag)
    }

    function executeDeleteTemplateTag() {
        const tag = deleteTagConfirmTarget
        setDeleteTagConfirmTarget(null)
        if (tag === null || activeTab === null || activeTab.type !== 'report') return
        Action.deleteTemplateTag(activeTab.file.workspace, activeTab.file.path, tag).then(function () {
            setTemplateTags(function (prev) { return prev.filter(function (item) { return item.tag !== tag }) })
            if (activeTemplateVersion.kind === 'tag' && activeTemplateVersion.tag === tag) {
                handleSelectCurrentVersion()
            }
        })
    }

    function refreshTemplateTags(workspace: string, templatePath: string): void {
        Action.getTemplateTags(workspace, templatePath).then(setTemplateTags)
    }

    const isTemplateLoaded = activeState !== null
    const currentFile = activeTab !== null ? activeTab.file : null
    const hasAnyTab = tabs.length > 0
    const activeTemplateVersion: TemplateVersionSelection = activeTabId !== null
        ? templateVersionSelections.get(activeTabId) ?? { kind: 'current' }
        : { kind: 'current' }

    // Get the JSON tab EditorState.
    const activeEditorState = activeTabId !== null ? editorStatesRef.current.get(activeTabId) ?? null : null

    // Check whether the JSON tab is dirty.
    const isJsonDirty = activeJsonState !== null && activeJsonState.content !== activeJsonState.originalContent

    // Scroll the editor to the clicked JSON tree node location.
    function handleJsonTreeNodeClick(path: string) {
        const view = jsonViewRef.current
        if (view === null) return
        const doc = view.state.doc.toString()
        const offset = findJsonPathOffset(doc, path)
        if (offset === -1) return
        view.dispatch({
            selection: { anchor: offset },
            effects: EditorView.scrollIntoView(offset, { y: 'center' })
        })
        view.focus()
    }

    // Check whether the tab is dirty. Reads through the fresh-state refs so
    // the check is also valid inside long-lived event handlers.
    function isTabDirty(tab: TabEntry): boolean {
        if (tab.type === 'report') {
            const saved = savedTemplatesRef.current.get(tab.id)
            const current = tabStatesRef.current.get(tab.id)
            if (saved === undefined || current === undefined) return false
            return current.template !== saved
        }
        const jsonState = jsonTabStatesRef.current.get(tab.id)
        if (jsonState === undefined) return false
        return jsonState.content !== jsonState.originalContent
    }

    // Render the tab bar shared by all layouts.
    function renderTabBar() {
        if (tabs.length === 0) return null
        return (
            <div className={styles.tabBar}>
                {tabs.map(function (tab) {
                    const dirty = isTabDirty(tab)
                    return (
                        <div key={tab.id}
                            className={styles.tab + (tab.id === activeTabId ? ' ' + styles.activeTab : '') + (dirty ? ' ' + styles.tabDirty : '')}
                            onClick={function () { switchTab(tab.id) }}
                        >
                            <span className={styles.tabIcon}>
                                <i className={tab.type === 'report' ? 'pi pi-file' : 'pi pi-code'}></i>
                            </span>
                            <span className={styles.tabLabel}>{tab.label}</span>
                            {mcpTouchedTabs.has(tab.id) &&
                                <span className={styles.tabMcpBadge} title={ui.mcpEditing + ' (' + mcpTouchedTabs.get(tab.id) + ')'}>MCP</span>
                            }
                            {dirty
                                ? <button className={styles.tabClose + ' ' + styles.tabDirtyDot}
                                    onClick={function (e) { e.stopPropagation(); requestCloseTab(tab.id) }}>
                                </button>
                                : <button className={styles.tabClose}
                                    onClick={function (e) { e.stopPropagation(); closeTab(tab.id) }}>
                                    <i className="pi pi-times"></i>
                                </button>
                            }
                        </div>
                    )
                })}
            </div>
        )
    }

    function renderVersionBar() {
        if (activeTabType !== 'report' || activeTab === null) return null
        const value = activeTemplateVersion.kind === 'current' ? 'current' : activeTemplateVersion.tag
        const versionOptions: TemplateVersionOption[] = [
            { label: ui.currentVersion, value: 'current', kind: 'current', date: '' }
        ]
        for (const tag of templateTags) {
            versionOptions.push({
                label: tag.tag,
                value: tag.tag,
                kind: 'tag',
                date: tag.creation !== undefined ? new Date(tag.creation).toLocaleString() : ''
            })
        }
        function renderVersionOption(option: TemplateVersionOption | undefined) {
            if (option === undefined) return null
            return (
                <div className={styles.versionOption}>
                    <span className={styles.versionOptionMain}>{option.kind === 'current' ? ui.currentVersion : option.label}</span>
                    <span className={styles.versionOptionMeta}>{option.kind === 'current' ? ui.currentVersion : ui.tag + (option.date !== '' ? ' / ' + option.date : '')}</span>
                </div>
            )
        }
        return (
            <div className={styles.versionBar}>
                <label className={styles.versionLabel}>{ui.version}</label>
                <Dropdown
                    ref={versionDropdownRef}
                    className={styles.versionDropdown}
                    panelClassName={styles.versionDropdownPanel}
                    value={value}
                    options={versionOptions}
                    optionLabel="label"
                    optionValue="value"
                    valueTemplate={renderVersionOption}
                    itemTemplate={renderVersionOption}
                    onShow={versionDropdownAutoClose.onShow}
                    onHide={versionDropdownAutoClose.onHide}
                    onChange={function (e) {
                        const nextValue = String(e.value)
                        if (nextValue === 'current') {
                            handleSelectCurrentVersion()
                        } else {
                            handleSelectTagVersion(nextValue)
                        }
                    }}
                />
                <button className={styles.versionTagButton} title={ui.apiTags} onClick={handleTemplateTagsOpen}>
                    <i className="pi pi-tags"></i>
                    <span>{ui.apiTags}</span>
                </button>
                {templateTags.length === 0 && <span className={styles.versionEmpty}>{ui.noTags}</span>}
            </div>
        )
    }

    // Control the left panel display while keeping one WorkspacePanel instance so folder expansion state is preserved.
    const showLeftPanel = activeTabType !== 'report' || (activeState !== null && activeState.isLayerPanelVisible)
    const hasBottomPanel = activeTabType === 'report' || activeTabType === 'json'
    const workspaceAreaHeight = hasBottomPanel ? splitRatio + '%' : '100%'

    function renderLeftPanel() {
        return (
            <>
                <div className={styles.leftPanel} ref={leftPanelRef} style={{ width: leftPanelWidth + 'px' }}>
                    <div className={styles.workspaceArea} style={{ height: workspaceAreaHeight }}>
                        <WorkspacePanel onCreateReport={handleCreateReport} onCreateJson={handleCreateJson} onOpenReport={handleOpenReport} onOpenJson={handleOpenJson} onRenameFile={handleRenameFile} onDeleteFile={handleDeleteFile} onFileUploaded={handleFileUploaded} revealRequest={workspaceReveal} currentFile={currentFile} />
                    </div>
                    {activeTabType === 'report' && activeState !== null && (
                        <>
                            <div className={styles.splitHandle} onMouseDown={handleSplitDragStart} />
                            <div className={styles.layerArea}>
                                <LayerPanel state={activeState} dispatch={dispatch} messages={ui} />
                            </div>
                        </>
                    )}
                    {activeTabType === 'json' && activeJsonState !== null && (
                        <>
                            <div className={styles.splitHandle} onMouseDown={handleSplitDragStart} />
                            <div className={styles.layerArea}>
                                <JsonTreePanel content={activeJsonState.content} onNodeClick={handleJsonTreeNodeClick} />
                            </div>
                        </>
                    )}
                </div>
                <div className={styles.leftPanelHandle} onMouseDown={handleLeftPanelDragStart} />
            </>
        )
    }

    function renderCenterPanel() {
        if (activeTabType === 'json' && activeEditorState !== null && activeJsonState !== null) {
            return (
                <div className={styles.centerArea}>
                    {renderTabBar()}
                    <div className={styles.jsonEditorArea}>
                        <JsonEditor
                            initialState={activeEditorState}
                            onViewCreated={handleJsonViewCreated}
                        />
                    </div>
                </div>
            )
        }
        if (activeTabType === 'report' && activeState !== null) {
            return (
                <>
                    <div className={styles.centerArea}>
                        {renderTabBar()}
                        {renderVersionBar()}
                        <div className={styles.canvas}>
                            <Canvas
                                messages={ui}
                                state={activeState}
                                dispatch={dispatch}
                                fontRegistry={fontRegistry}
                                defaultFontId={DEFAULT_FONT_ID}
                                mathFonts={mathFonts}
                                mathFontResource={mathFontResource}
                                currentFile={activeTab !== null ? activeTab.file : null}
                                openReportTemplates={availableReportTemplates}
                                suspended={isPdfImportDialogOpen}
                                onPlaceSubreport={handlePlaceSubreport}
                                onOpenImageSlice={function (elementId, bandId) { setImageSliceTarget({ bandId, elementId }) }}
                            />
                        </div>
                    </div>
                    {activeState.isPropertyPanelVisible && (
                        <div className={styles.propertyPanel}>
                            <PropertyPanel
                                state={activeState}
                                dispatch={dispatch}
                                fontList={fontList}
                                jsonFiles={activeTab !== null ? jsonFilesMap.get(activeTab.file.workspace) ?? [] : []}
                                currentFile={activeTab !== null ? activeTab.file : null}
                                openReportTemplates={availableReportTemplates}
                                onResolvedSubreportTemplates={(templates) => {
                                    if (activeTab !== null && activeTab.type === 'report') {
                                        cacheSubreportTemplates(activeTab.file.workspace, templates)
                                    }
                                }}
                            />
                        </div>
                    )}
                </>
            )
        }
        if (hasAnyTab) {
            return (
                <div className={styles.centerArea}>
                    {renderTabBar()}
                    <div className={styles.canvasPlaceholder}>
                        {ui.noReportGuidance}
                    </div>
                </div>
            )
        }
        return (
            <div className={styles.canvasPlaceholder}>
                {ui.noReportGuidance}
            </div>
        )
    }

    // Render the status bar.
    function renderStatusBar() {
        if (activeTabType === 'json' && activeTab !== null && activeJsonState !== null) {
            return (
                <>
                    <span className={styles.statusItem}>{activeTab.label}</span>
                    <span className={styles.statusSep}>|</span>
                    <span className={styles.statusItem}>JSON</span>
                    {isJsonDirty && (
                        <>
                            <span className={styles.statusSep}>|</span>
                            <span className={styles.statusItem}>{ui.unsaved}</span>
                        </>
                    )}
                </>
            )
        }
        if (isTemplateLoaded && activeState !== null) {
            return (
                <>
                    <span className={styles.statusItem}>
                        {activeState.template.name}
                    </span>
                    <span className={styles.statusSep}>|</span>
                    <span className={styles.statusItem}>
                        {activeTemplateVersion.kind === 'current' ? ui.currentVersion : ui.tag + ' / ' + activeTemplateVersion.tag}
                    </span>
                    <span className={styles.statusSep}>|</span>
                    <span className={styles.statusItem}>
                        {UnitUtils.ptToDisplayRounded(activeState.template.pageSettings.width, activeState.displayUnit)} x {UnitUtils.ptToDisplayRounded(activeState.template.pageSettings.height, activeState.displayUnit)} {UnitUtils.getUnitLabel(activeState.displayUnit)}
                        ({activeState.template.pageSettings.orientation === 'portrait' ? ui.portrait : ui.landscape})
                    </span>
                    <span className={styles.statusSep}>|</span>
                    <span className={styles.statusItem}>
                        {Math.round(activeState.zoom * 100)}%
                    </span>
                    {activeState.selectedBandId !== null && (
                        <>
                            <span className={styles.statusSep}>|</span>
                            <span className={styles.statusItem}>
                                {(function () {
                                    const selectedBand = activeState.template.bands.find(function (b) { return b.id === activeState.selectedBandId })
                                    return selectedBand !== undefined ? getLocalizedBandDisplayLabel(selectedBand, ui) : ''
                                })()}
                                {activeState.selectedElementIds.length === 1 ? ` > ${activeState.selectedElementIds[0]}` : ''}
                                {activeState.selectedElementIds.length > 1 ? ` (${activeState.selectedElementIds.length} ${ui.selectedElementCount})` : ''}
                            </span>
                        </>
                    )}
                </>
            )
        }
        return <span className={styles.statusItem}>{ui.noReportLoaded}</span>
    }

    return (
        <div className={styles.editor}>
            {/* Toolbar. */}
            <div className={styles.toolbar}>
                <Toolbar
                    state={activeState !== null ? activeState : defaultState()}
                    dispatch={dispatch}
                    onPreview={handlePreviewOpen}
                    isTemplateLoaded={isTemplateLoaded}
                    onPromptNeeded={handlePromptNeeded}
                    activeTabType={activeTabType}
                    onSave={handleSave}
                    onUndo={handleToolbarUndo}
                    onRedo={handleToolbarRedo}
                    isAdmin={sysState.loginUser.adminFlag}
                    isExternalAccount={sysState.loginUser.provider !== 'local'}
                    onOpenApiClients={function () { setIsApiClientDialogOpen(true) }}
                    onOpenPrintHistory={function () { setIsPrintHistoryDialogOpen(true) }}
                    onOpenFontManagement={function () { setIsFontDialogOpen(true) }}
                    onOpenAccountSettings={function () { setIsAccountDialogOpen(true) }}
                    onOpenOAuthSettings={function () { setIsOAuthDialogOpen(true) }}
                    onOpenExportData={function () { setIsExportDataDialogOpen(true) }}
                    onOpenImportData={function () { setIsImportDataDialogOpen(true) }}
                    onOpenPdfImport={function () { setIsPdfImportDialogOpen(true) }}
                    onOpenPasswordChange={function () { setIsPasswordDialogOpen(true) }}
                    onOpenUserManagement={function () { setIsUserManagementDialogOpen(true) }}
                    onOpenMcpSettings={function () { setIsMcpSettingsDialogOpen(true) }}
                    onFactoryReset={handleFactoryResetOpen}
                    onLogout={handleLogout}
                />
            </div>

            {/* Main body. */}
            <div className={styles.body}>
                {showLeftPanel && renderLeftPanel()}
                {renderCenterPanel()}
            </div>

            {/* Status bar. */}
            <div className={styles.statusBar}>
                {renderStatusBar()}
            </div>

            <Toast ref={toastRef} />

            {/* Preview modal. */}
            {isPreviewOpen && activeState !== null && (
                <PreviewModal
                    template={activeState.template}
                    openReportTemplates={availableReportTemplates}
                    fontRegistry={fontRegistry}
                    defaultFontId={DEFAULT_FONT_ID}
                    mathFontResource={mathFontResource}
                    currentFile={activeTab !== null ? activeTab.file : null}
                    dataSource={previewDataSource}
                    onClose={handlePreviewClose}
                />
            )}

            <Dialog
                header={ui.apiTags}
                visible={isTemplateTagDialogOpen}
                onHide={handleTemplateTagsClose}
                style={{ width: '42rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.close} severity="secondary" size="small" onClick={handleTemplateTagsClose} />
                    </div>
                }
            >
                <div className={styles.tagDialog}>
                    <div className={styles.tagCreateGrid}>
                        <label className={styles.tagLabel}>{ui.tag}</label>
                        <InputText className={styles.tagInput} value={templateTagName} onChange={function (e: React.ChangeEvent<HTMLInputElement>) { setTemplateTagName(e.target.value) }} />
                        <label className={styles.tagLabel}>{ui.description}</label>
                        <InputText className={styles.tagInput} value={templateTagDescription} onChange={function (e: React.ChangeEvent<HTMLInputElement>) { setTemplateTagDescription(e.target.value) }} />
                        <div></div>
                        <Button label={ui.create} icon="pi pi-tag" size="small" onClick={handleCreateTemplateTag} disabled={templateTagName.trim() === ''} />
                    </div>
                    <div className={styles.tagList}>
                        {templateTags.length === 0 ? (
                            <div className={styles.tagEmpty}>{ui.noApiTags}</div>
                        ) : templateTags.map(function (tag) {
                            return (
                                <div key={tag.tag} className={styles.tagItem}>
                                    <div className={styles.tagHeader}>
                                        <span className={styles.tagName}>{tag.tag}</span>
                                        <span className={styles.tagDate}>{tag.creation !== undefined ? new Date(tag.creation).toLocaleString() : ''}</span>
                                    </div>
                                    {tag.description !== '' && <div className={styles.tagDescription}>{tag.description}</div>}
                                    <div className={styles.tagEndpoint}>{tag.endpoint}</div>
                                    <div className={styles.tagActions}>
                                        <Button label={ui.edit} icon="pi pi-pencil" size="small" onClick={function () {
                                            handleSelectTagVersion(tag.tag)
                                            handleTemplateTagsClose()
                                        }} />
                                        <Button label={ui.delete} icon="pi pi-trash" size="small" severity="danger" onClick={function () { handleDeleteTemplateTag(tag.tag) }} />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </Dialog>

            {/* Close confirmation dialog for dirty tabs. */}
            <Dialog
                header={ui.confirm}
                visible={closeConfirmTabId !== null}
                onHide={function () { setCloseConfirmTabId(null) }}
                style={{ width: '24rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={function () { setCloseConfirmTabId(null) }} />
                        <Button label={ui.closeWithoutSaving} severity="danger" size="small" onClick={function () {
                            const tabId = closeConfirmTabId
                            setCloseConfirmTabId(null)
                            if (tabId !== null) closeTab(tabId)
                        }} />
                    </div>
                }
            >
                <p style={{ margin: 0 }}>{ui.unsavedCloseQuestion}</p>
            </Dialog>

            {/* Delete confirmation dialog for public tags. */}
            <Dialog
                header={ui.confirm}
                visible={deleteTagConfirmTarget !== null}
                onHide={function () { setDeleteTagConfirmTarget(null) }}
                style={{ width: '24rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={function () { setDeleteTagConfirmTarget(null) }} />
                        <Button label={ui.delete} severity="danger" size="small" onClick={executeDeleteTemplateTag} />
                    </div>
                }
            >
                <p style={{ margin: 0 }}>{ui.deleteTagQuestion + ' (' + (deleteTagConfirmTarget ?? '') + ')'}</p>
            </Dialog>

            {/* API client management dialog. */}
            <FontManagementDialog
                visible={isFontDialogOpen}
                onHide={function () { setIsFontDialogOpen(false) }}
                defaultLanguage={editorLanguage()}
                onFontsChanged={reloadFontList}
            />

            <AccountSettingsDialog
                visible={isAccountDialogOpen}
                onHide={function () { setIsAccountDialogOpen(false) }}
                currentDisplayName={sysState.loginUser.displayName}
                workspaceKey={sysState.loginUser.workspaceKey}
                currentDefaultColorMode={sysState.loginUser.defaultColorMode}
                onDisplayNameChanged={function (name) { SystemAction.verifySession(sysDispatch); void name }}
                onDefaultColorModeChanged={function () { SystemAction.verifySession(sysDispatch) }}
            />

            {sysState.loginUser.adminFlag && (
                <OAuthSettingsDialog
                    visible={isOAuthDialogOpen}
                    onHide={function () { setIsOAuthDialogOpen(false) }}
                />
            )}

            <ApiClientDialog
                visible={isApiClientDialogOpen}
                onHide={function () { setIsApiClientDialogOpen(false) }}
            />

            <PrintHistoryDialog
                visible={isPrintHistoryDialogOpen}
                onHide={function () { setIsPrintHistoryDialogOpen(false) }}
            />

            {/* Whole-environment export dialog. */}
            <ExportDataDialog
                visible={isExportDataDialogOpen}
                onHide={function () { setIsExportDataDialogOpen(false) }}
            />

            {/* Whole-environment import dialog. */}
            <ImportDataDialog
                visible={isImportDataDialogOpen}
                onHide={function () { setIsImportDataDialogOpen(false) }}
            />

            {activeState !== null && (
                <ImageSliceDialog
                    visible={imageSliceTarget !== null}
                    onHide={function () { setImageSliceTarget(null) }}
                    state={activeState}
                    dispatch={dispatch}
                    currentFile={activeTab !== null ? activeTab.file : null}
                    target={imageSliceTarget}
                />
            )}

            {activeState !== null && (
                <PdfImportDialog
                    visible={isPdfImportDialogOpen}
                    onHide={function () { setIsPdfImportDialogOpen(false) }}
                    state={activeState}
                    dispatch={dispatch}
                    fontList={fontList}
                    fontRegistry={fontRegistry}
                    defaultFontId={DEFAULT_FONT_ID}
                    currentFile={activeTab !== null ? activeTab.file : null}
                    onEmbeddedFontsImported={registerImportedPdfFonts}
                />
            )}

            {/* User management dialog (administrator only). */}
            <UserManagementDialog
                visible={isUserManagementDialogOpen}
                onHide={function () { setIsUserManagementDialogOpen(false) }}
                loginUserId={sysState.loginUser.id}
            />

            {/* Own password change dialog. */}
            <PasswordChangeDialog
                visible={isPasswordDialogOpen}
                onHide={function () { setIsPasswordDialogOpen(false) }}
                onChanged={handlePasswordChanged}
            />

            {/* MCP settings dialog (every account; global section for administrators). */}
            <McpSettingsDialog
                visible={isMcpSettingsDialogOpen}
                onHide={function () { setIsMcpSettingsDialogOpen(false) }}
                isAdmin={sysState.loginUser.adminFlag}
            />

            {/* Factory reset confirmation dialog (administrator only). */}
            <Dialog
                header={ui.factoryReset}
                visible={isFactoryResetConfirmOpen}
                onHide={function () { if (!isFactoryResetRunning) setIsFactoryResetConfirmOpen(false) }}
                style={{ width: '30rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.cancel} severity="secondary" size="small" disabled={isFactoryResetRunning} onClick={function () { setIsFactoryResetConfirmOpen(false) }} />
                        <Button
                            label={isFactoryResetRunning ? ui.initializing : ui.runInitialization}
                            severity="danger" size="small"
                            disabled={factoryResetConfirmText !== 'reset' || isFactoryResetRunning}
                            onClick={executeFactoryReset}
                        />
                    </div>
                }
            >
                <p style={{ margin: '0 0 0.5rem 0' }}>
                    {ui.factoryResetNote}
                </p>
                <p style={{ margin: '0 0 0.5rem 0' }}>{ui.resetInputNote}</p>
                <InputText
                    value={factoryResetConfirmText}
                    onChange={function (e) { setFactoryResetConfirmText(e.target.value) }}
                    style={{ width: '100%' }}
                />
            </Dialog>
        </div>
    )
}
