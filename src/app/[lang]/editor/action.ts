// Report editor actions.

import React from 'react'
import { fetchProxy } from '@/lib/client/utils/fetch_proxy'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { MAX_FONT_FILE_BYTES } from '@/lib/common/font_files'
import { UserAccountVO } from '@/lib/common/vo/entity/user_account'
import { DisplayUnit } from '@/lib/common/utils/unit_utils'
import { parseTemplateJson, stringifyTemplateJson } from '@/lib/common/utils/template_json'
import type { LanguageCode } from '@/lib/common/i18n/languages'
import {
    ActionType,
    Band,
    createDefaultElement,
    createDefaultTemplate,
    ElementKind,
    ElementStyle,
    PageSettings,
    PathEditing,
    ReportGroup,
    ReportTemplate,
    TableSelection,
    TemplateElement,
    ToolType
} from './reducer'
import type { PathSubpath } from './path_model'
import type { OpenReportTemplate } from './subreport_support'

export type JsonFileInfo = {
    path: string
    name: string
}

export type ResolveSubreportTemplatesResult = {
    valid: boolean
    message?: string
    templates: OpenReportTemplate[]
}

export type TemplateTagInfo = {
    tag: string
    description: string
    endpoint: string
    creation?: string
    modification?: string
}

export type TemplateTagDetailInfo = TemplateTagInfo & {
    template: ReportTemplate
}

export type OAuthClientInfo = {
    id: number
    clientId: string
    clientSecret: string
    scopes: string
    deleteFlag: boolean
    creation?: string
    modification?: string
    version: number
}

export type TemplateAccessGrantInfo = {
    id: number
    fkOAuthClient: number
    workspace: string
    path: string
    version: number
}

// A folder shared with the current account (appears in its workspace tree).
export type SharedInNode = {
    id: number
    ownerWorkspaceKey: string
    ownerLabel: string
    path: string
    canRead: boolean
    canWrite: boolean
}

export type WorkspaceTree = {
    own: { workspaceKey: string, label: string }
    sharedIn: SharedInNode[]
    // Paths in the own workspace that the account has shared out (badge display).
    sharedOutPaths: string[]
}

// A share the current account has granted on one of its folders.
export type FolderShareRow = {
    id: number
    path: string
    canRead: boolean
    canWrite: boolean
    granteeWorkspaceKey: string
    granteeDisplayName: string
    version: number
}

// One row of the account's print history.
export type PrintHistoryItem = {
    key: string
    via: string
    workspace: string
    templatePath: string
    format: string
    status: string
    errorReason: string
    clientId: string
    creation: string
    downloadable: boolean
}

export type PrintHistoryPage = {
    items: PrintHistoryItem[]
    total: number
}

export namespace Action {

    // =====================================
    // Selection operations.
    // =====================================

    // Select element.
    export function selectElement(dispatch: React.Dispatch<ActionType>, elementId: string, bandId: string) {
        dispatch({ type: 'SELECT_ELEMENT', payload: { elementId, bandId } })
    }

    // Select band.
    export function selectBand(dispatch: React.Dispatch<ActionType>, bandId: string) {
        dispatch({ type: 'SELECT_BAND', payload: { bandId } })
    }

    // Clear selection.
    export function deselectAll(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'DESELECT_ALL' })
    }

    // Toggle element selection with Shift-click.
    export function toggleElementSelection(dispatch: React.Dispatch<ActionType>, elementId: string, bandId: string) {
        dispatch({ type: 'TOGGLE_ELEMENT_SELECTION', payload: { elementId, bandId } })
    }

    // Select multiple elements with marquee selection.
    export function selectElements(dispatch: React.Dispatch<ActionType>, elementIds: string[], bandId: string) {
        dispatch({ type: 'SELECT_ELEMENTS', payload: { elementIds, bandId } })
    }

    // =====================================
    // Tool operations.
    // =====================================

    // Switch tool.
    export function setActiveTool(dispatch: React.Dispatch<ActionType>, tool: ToolType) {
        dispatch({ type: 'SET_ACTIVE_TOOL', payload: { tool } })
    }

    // =====================================
    // Element operations.
    // =====================================

    // Add element.
    export function addElement(
        dispatch: React.Dispatch<ActionType>,
        bandId: string,
        kind: ElementKind,
        x: number,
        y: number,
        width: number,
        height: number,
        elementIdCounter: number
    ) {
        const element = createDefaultElement(`el_${elementIdCounter}`, kind, x, y, width, height)
        dispatch({ type: 'ADD_ELEMENT', payload: { bandId, element } })
    }

    // Update element properties.
    
    export function updateElement(
        dispatch: React.Dispatch<ActionType>,
        elementId: string,
        bandId: string,
        props: Partial<TemplateElement>
    ) {
        dispatch({ type: 'UPDATE_ELEMENT', payload: { elementId, bandId, props } })
    }

    // Update element style.
    
    export function updateElementStyle(
        dispatch: React.Dispatch<ActionType>,
        elementId: string,
        bandId: string,
        style: Partial<ElementStyle>
    ) {
        dispatch({ type: 'UPDATE_ELEMENT_STYLE', payload: { elementId, bandId, style } })
    }

    // Delete element.
    
    export function deleteElement(dispatch: React.Dispatch<ActionType>, elementId: string, bandId: string) {
        dispatch({ type: 'DELETE_ELEMENT', payload: { elementId, bandId } })
    }

    // Delete multiple elements.
    
    export function deleteElements(dispatch: React.Dispatch<ActionType>, elementIds: string[], bandId: string) {
        dispatch({ type: 'DELETE_ELEMENTS', payload: { elementIds, bandId } })
    }

    // Paste element.
    
    export function pasteElements(dispatch: React.Dispatch<ActionType>, bandId: string, elements: TemplateElement[]) {
        dispatch({ type: 'PASTE_ELEMENTS', payload: { bandId, elements } })
    }

    // Move element.
    
    export function moveElement(
        dispatch: React.Dispatch<ActionType>,
        elementId: string,
        bandId: string,
        x: number,
        y: number
    ) {
        dispatch({ type: 'MOVE_ELEMENT', payload: { elementId, bandId, x, y } })
    }

    // Move multiple elements.
    
    export function moveElements(
        dispatch: React.Dispatch<ActionType>,
        deltas: Array<{ elementId: string, bandId: string, x: number, y: number }>
    ) {
        dispatch({ type: 'MOVE_ELEMENTS', payload: { deltas } })
    }

    // Resize element; used during dragging and excluded from auto-commit.
    
    export function resizeElement(
        dispatch: React.Dispatch<ActionType>,
        elementId: string,
        bandId: string,
        x: number,
        y: number,
        width: number,
        height: number
    ) {
        dispatch({ type: 'RESIZE_ELEMENT', payload: { elementId, bandId, x, y, width, height } })
    }

    // Reparent element by changing its parent.
    
    export function reparentElement(
        dispatch: React.Dispatch<ActionType>,
        elementId: string,
        bandId: string,
        targetParentId: string,
        x: number,
        y: number,
        index?: number
    ) {
        dispatch({ type: 'REPARENT_ELEMENT', payload: { elementId, bandId, targetParentId, x, y, index } })
    }

    // Move element between bands.
    
    export function moveElementToBand(
        dispatch: React.Dispatch<ActionType>,
        elementId: string,
        sourceBandId: string,
        targetBandId: string,
        x: number,
        y: number
    ) {
        dispatch({ type: 'MOVE_ELEMENT_TO_BAND', payload: { elementId, sourceBandId, targetBandId, x, y } })
    }

    // Add child element to parent element.
    
    export function addElementToParent(
        dispatch: React.Dispatch<ActionType>,
        bandId: string,
        parentId: string,
        kind: ElementKind,
        x: number,
        y: number,
        width: number,
        height: number,
        elementIdCounter: number
    ) {
        const element = createDefaultElement(`el_${elementIdCounter}`, kind, x, y, width, height)
        dispatch({ type: 'ADD_ELEMENT_TO_PARENT', payload: { bandId, parentId, element } })
    }

    // =====================================
    // Band operations.
    
    // =====================================

    // Change band height.
    
    export function updateBandHeight(dispatch: React.Dispatch<ActionType>, bandId: string, height: number) {
        dispatch({ type: 'UPDATE_BAND_HEIGHT', payload: { bandId, height } })
    }

    
    export function updateBandStartNewPage(dispatch: React.Dispatch<ActionType>, bandId: string, startNewPage: boolean) {
        dispatch({ type: 'UPDATE_BAND_START_NEW_PAGE', payload: { bandId, startNewPage } })
    }

    
    export function updateBandSplitType(dispatch: React.Dispatch<ActionType>, bandId: string, splitType: Band['splitType']) {
        dispatch({ type: 'UPDATE_BAND_SPLIT_TYPE', payload: { bandId, splitType } })
    }

    
    export function updateBandPrintWhenExpression(dispatch: React.Dispatch<ActionType>, bandId: string, printWhenExpression: string) {
        dispatch({ type: 'UPDATE_BAND_PRINT_WHEN_EXPRESSION', payload: { bandId, printWhenExpression } })
    }

    // Set whether the band starts on a new page.
    
    export function toggleBandEnabled(dispatch: React.Dispatch<ActionType>, bandId: string) {
        dispatch({ type: 'TOGGLE_BAND_ENABLED', payload: { bandId } })
    }

    // Change band split control.
    // =====================================
    
    // =====================================

    
    export function addGroup(dispatch: React.Dispatch<ActionType>, group: ReportGroup) {
        dispatch({ type: 'ADD_GROUP', payload: { group } })
    }

    // Change the band print-when expression.
    
    export function updateGroup(dispatch: React.Dispatch<ActionType>, name: string, props: Partial<ReportGroup>) {
        dispatch({ type: 'UPDATE_GROUP', payload: { name, props } })
    }

    // Toggle band enabled state.
    
    export function removeGroup(dispatch: React.Dispatch<ActionType>, name: string) {
        dispatch({ type: 'REMOVE_GROUP', payload: { name } })
    }

    // =====================================
    // Viewport operations.
    
    // =====================================

    // Set zoom.
    
    export function setZoom(dispatch: React.Dispatch<ActionType>, zoom: number) {
        dispatch({ type: 'SET_ZOOM', payload: { zoom } })
    }

    // =====================================
    // Panel visibility control.
    
    // =====================================

    // Toggle property panel visibility.
    
    export function togglePropertyPanel(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'TOGGLE_PROPERTY_PANEL' })
    }

    // Toggle layer panel visibility.
    
    export function toggleLayerPanel(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'TOGGLE_LAYER_PANEL' })
    }

    // Toggle grid visibility.
    
    export function toggleGrid(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'TOGGLE_GRID' })
    }

    export function setGridSize(dispatch: React.Dispatch<ActionType>, sizePt: number) {
        dispatch({ type: 'SET_GRID_SIZE', payload: { sizePt } })
    }

    // =====================================
    // Template operations.
    
    // =====================================

    // Update page settings.
    
    export function updatePageSettings(dispatch: React.Dispatch<ActionType>, settings: Partial<PageSettings>) {
        dispatch({ type: 'UPDATE_PAGE_SETTINGS', payload: { settings } })
    }

    // Update report settings.
    
    export function updateReportSettings(
        dispatch: React.Dispatch<ActionType>,
        settings: Partial<Pick<ReportTemplate, 'name' | 'titleNewPage' | 'summaryNewPage' | 'summaryWithPageHeaderAndFooter' | 'testDataPath'>>
    ) {
        dispatch({ type: 'UPDATE_REPORT_SETTINGS', payload: { settings } })
    }

    // Load template.
    
    export function loadTemplate(dispatch: React.Dispatch<ActionType>, template: ReportTemplate) {
        dispatch({ type: 'LOAD_TEMPLATE', payload: { template } })
    }

    // =====================================
    // Display unit.
    
    // =====================================

    // Set display unit.
    
    export function setDisplayUnit(dispatch: React.Dispatch<ActionType>, unit: DisplayUnit) {
        dispatch({ type: 'SET_DISPLAY_UNIT', payload: { unit } })
    }

    // =====================================
    // Inline editing.
    
    // =====================================

    // Start editing.
    
    export function startEditing(dispatch: React.Dispatch<ActionType>, elementId: string) {
        dispatch({ type: 'START_EDITING', payload: { elementId } })
    }

    // End editing.
    
    export function stopEditing(dispatch: React.Dispatch<ActionType>, text: string) {
        dispatch({ type: 'STOP_EDITING', payload: { text } })
    }

    // =====================================
    // Text input transaction.
    
    // =====================================

    // Start text input and suppress automatic history commit.
    
    export function beginTextInput(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'BEGIN_TEXT_INPUT' })
    }

    // Commit text input and history.
    
    export function endTextInput(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'END_TEXT_INPUT' })
    }

    // =====================================
    // Undo/Redo
    // =====================================

    // Undo.
    
    export function undo(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'UNDO' })
    }

    // Redo.
    
    export function redo(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'REDO' })
    }

    // Commit history; called after dragging completes.
    
    export function commitHistory(dispatch: React.Dispatch<ActionType>) {
        dispatch({ type: 'COMMIT_HISTORY' })
    }

    // Selection inside table.
    
    export function setTableSelection(dispatch: React.Dispatch<ActionType>, selection: TableSelection | null) {
        dispatch({ type: 'SET_TABLE_SELECTION', payload: { selection } })
    }

    // Selection inside path.

    export function setPathEdit(dispatch: React.Dispatch<ActionType>, editing: PathEditing | null) {
        dispatch({ type: 'SET_PATH_EDIT', payload: { editing } })
    }

    export function updatePathGeometry(
        dispatch: React.Dispatch<ActionType>,
        elementId: string,
        bandId: string,
        pathSubpaths: PathSubpath[],
        bounds?: { x: number, y: number, width: number, height: number }
    ) {
        dispatch({
            type: 'UPDATE_PATH_GEOMETRY',
            payload: {
                elementId,
                bandId,
                pathSubpaths,
                ...(bounds !== undefined ? bounds : {}),
            },
        })
    }

    export function unlockPdfSourceElements(
        dispatch: React.Dispatch<ActionType>,
        elementIds: string[],
        bandId: string,
    ) {
        dispatch({ type: 'UNLOCK_PDF_SOURCE_ELEMENTS', payload: { elementIds, bandId } })
    }

    // =====================================
    // Report template operations.
    
    // =====================================

    // Save report template as JSON.
    
    export async function saveTemplateAsNew(
        workspace: string, path: string, fileName: string, template: ReportTemplate
    ): Promise<void> {
        const json = stringifyTemplateJson(template, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const file = new File([blob], fileName, { type: 'application/json' })
        await uploadFile(workspace, path, file)
    }

    // Creates a new report file inside `folder` with the given content. The
    // server assigns a collision-free name (guaranteed atomically) and returns
    // the file name it used, so the caller never has to check for duplicates.
    export async function createSubreportFile(
        workspace: string, folder: string, content: string
    ): Promise<string> {
        const res = await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/new-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder, content }),
        })
        const data: { fileName: string } = await res.json()
        return data.fileName
    }

    // Load report template from workspace.
    
    export async function loadTemplateFromFile(
        workspace: string, filePath: string
    ): Promise<ReportTemplate> {
        const res = await fetchProxy(
            '/api/workspace/' + encodeURIComponent(workspace)
            + '/files/' + encodeURIComponent(filePath)
        )
        return parseTemplateJson(await res.text()) as ReportTemplate
    }

    export async function resolveSubreportTemplates(
        workspace: string,
        rootPath: string,
        rootTemplate: ReportTemplate,
        templateExpression: string,
        openReportTemplates: OpenReportTemplate[],
    ): Promise<ResolveSubreportTemplatesResult> {
        const res = await fetchProxy(
            '/api/workspace/' + encodeURIComponent(workspace) + '/subreport-templates',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rootPath,
                    rootTemplate,
                    templateExpression,
                    openReportTemplates,
                }),
            }
        )
        return await res.json()
    }

    // =====================================
    // Workspace operations.
    
    // =====================================

    export type WorkspaceFileEntry = {
        name: string
        isDirectory: boolean
        size: number
    }

    // Fetch the workspace overview: own workspace, folders shared with the
    // account, and which own folders have been shared out.
    export async function getWorkspaceTree(): Promise<WorkspaceTree> {
        const res = await fetchProxy('/api/workspace')
        return await res.json()
    }

    // Fetch file and directory list.
    export async function exportEditorData(): Promise<Blob> {
        const res = await fetchProxy('/api/editor-data/export')
        return await res.blob()
    }

    export async function importEditorData(file: File): Promise<void> {
        const formData = new FormData()
        formData.append('file', file)
        await fetchProxy('/api/editor-data/import', {
            method: 'POST',
            body: formData,
        })
    }

    
    export async function getEntries(workspace: string, subPath: string): Promise<WorkspaceFileEntry[]> {
        const query = subPath === '' ? '' : '?path=' + encodeURIComponent(subPath)
        const res = await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/files' + query)
        const data: { entries: WorkspaceFileEntry[] } = await res.json()
        return data.entries
    }

    export function getWorkspaceDownloadUrl(workspace: string, entryPath: string): string {
        return '/api/workspace/' + encodeURIComponent(workspace)
            + '/download?path=' + encodeURIComponent(entryPath)
    }

    // Create directory.
    
    export async function createDirectory(workspace: string, path: string): Promise<void> {
        await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/dirs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        })
    }

    // Upload file.
    
    export async function uploadFile(workspace: string, path: string, file: File): Promise<void> {
        const formData = new FormData()
        formData.append('file', file)
        if (path !== '') formData.append('path', path)
        await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/files', {
            method: 'POST',
            body: formData,
        })
    }

    // Delete file or directory.
    
    export async function deleteEntry(workspace: string, entryPath: string): Promise<void> {
        await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/files/' + encodeURIComponent(entryPath), {
            method: 'DELETE',
        })
    }

    // Rename file or directory.
    
    export async function renameEntry(workspace: string, entryPath: string, newName: string): Promise<void> {
        await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/files/' + encodeURIComponent(entryPath), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName }),
        })
    }

    // Load JSON file.
    
    export async function loadJsonFile(workspace: string, filePath: string): Promise<string> {
        const res = await fetchProxy(
            '/api/workspace/' + encodeURIComponent(workspace)
            + '/files/' + encodeURIComponent(filePath)
        )
        return await res.text()
    }

    // Save JSON file.
    
    export async function saveJsonFile(workspace: string, filePath: string, content: string): Promise<void> {
        const fileName = filePath.indexOf('/') !== -1
            ? filePath.substring(filePath.lastIndexOf('/') + 1)
            : filePath
        const parentPath = filePath.indexOf('/') !== -1
            ? filePath.substring(0, filePath.lastIndexOf('/'))
            : ''
        const blob = new Blob([content], { type: 'application/json' })
        const file = new File([blob], fileName, { type: 'application/json' })
        await uploadFile(workspace, parentPath, file)
    }

    // Fetch JSON file list.
    
    export async function getJsonFiles(workspace: string): Promise<JsonFileInfo[]> {
        const res = await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/json-files')
        const data: { jsonFiles: JsonFileInfo[] } = await res.json()
        return data.jsonFiles
    }

    
    export async function getTemplateTags(workspace: string, templatePath: string): Promise<TemplateTagInfo[]> {
        const res = await fetchProxy(
            '/api/workspace/' + encodeURIComponent(workspace)
            + '/template-tags?path=' + encodeURIComponent(templatePath)
        )
        const data: { tags: TemplateTagInfo[] } = await res.json()
        return data.tags
    }

    
    export async function createTemplateTag(
        workspace: string,
        templatePath: string,
        tag: string,
        description: string,
        template: ReportTemplate
    ): Promise<TemplateTagInfo> {
        const res = await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/template-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templatePath, tag, description, templateJson: stringifyTemplateJson(template, 2) }),
        })
        const data: { tag: TemplateTagInfo } = await res.json()
        return data.tag
    }

    export async function loadTemplateTag(workspace: string, templatePath: string, tag: string): Promise<TemplateTagDetailInfo> {
        const res = await fetchProxy(
            '/api/workspace/' + encodeURIComponent(workspace)
            + '/template-tags/' + encodeURIComponent(tag)
            + '?path=' + encodeURIComponent(templatePath)
        )
        const data: { tag: TemplateTagInfo & { templateJson: string } } = await res.json()
        return {
            tag: data.tag.tag,
            description: data.tag.description,
            endpoint: data.tag.endpoint,
            creation: data.tag.creation,
            modification: data.tag.modification,
            template: parseTemplateJson(data.tag.templateJson) as ReportTemplate
        }
    }

    export async function saveTemplateTag(
        workspace: string,
        templatePath: string,
        tag: string,
        template: ReportTemplate
    ): Promise<TemplateTagInfo> {
        const res = await fetchProxy(
            '/api/workspace/' + encodeURIComponent(workspace)
            + '/template-tags/' + encodeURIComponent(tag),
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templatePath, templateJson: stringifyTemplateJson(template, 2) }),
            }
        )
        const data: { tag: TemplateTagInfo } = await res.json()
        return data.tag
    }

    export async function deleteTemplateTag(workspace: string, templatePath: string, tag: string): Promise<void> {
        await fetchProxy(
            '/api/workspace/' + encodeURIComponent(workspace)
            + '/template-tags/' + encodeURIComponent(tag)
            + '?path=' + encodeURIComponent(templatePath),
            { method: 'DELETE' }
        )
    }

    export async function getOAuthClients(): Promise<OAuthClientInfo[]> {
        const res = await fetchProxy('/api/oauth/clients')
        const data: { clients: OAuthClientInfo[] } = await res.json()
        return data.clients
    }

    // ── Self-service account settings ──

    export async function updateOwnDisplayName(displayName: string): Promise<void> {
        await fetchProxy('/api/users/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName }),
        })
    }

    export async function updateOwnDefaultColorMode(defaultColorMode: 'rgb' | 'cmyk'): Promise<void> {
        await fetchProxy('/api/users/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultColorMode }),
        })
    }

    export async function deleteOwnAccount(): Promise<void> {
        await fetchProxy('/api/users/me', { method: 'DELETE' })
    }

    // ── External sign-in configuration (administrator) ──

    export type OAuthProviderConfig = { enabled: boolean, clientId: string, clientSecret: string, callbackUrl: string }
    export type OAuthSettings = { google: OAuthProviderConfig, microsoft: OAuthProviderConfig }

    export async function getOAuthSettings(): Promise<OAuthSettings> {
        const res = await fetchProxy('/api/oauth-settings')
        return await res.json()
    }

    export async function updateOAuthSettings(
        provider: 'google' | 'microsoft',
        enabled: boolean,
        clientId: string,
        clientSecret: string
    ): Promise<void> {
        await fetchProxy('/api/oauth-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, enabled, clientId, clientSecret }),
        })
    }

    // ── Per-account font management ──

    export type AccountFont = { name: string, path: string, extension: string, size: number, version: string, familyName?: string, postScriptName?: string, fullName?: string }
    export type GoogleFontCandidate = { fontId: string, family: string, url: string }
    export type GoogleFontProposal = { languages: LanguageCode[], candidates: GoogleFontCandidate[], installed: string[] }

    export async function getAccountFonts(): Promise<AccountFont[]> {
        const res = await fetchProxy('/api/fonts')
        const data: { fonts: AccountFont[] } = await res.json()
        return data.fonts
    }

    export async function uploadAccountFont(file: File): Promise<void> {
        if (file.size > MAX_FONT_FILE_BYTES) {
            throw new BusinessException('フォントファイルが大きすぎます。')
        }
        const form = new FormData()
        form.set('file', file)
        await fetchProxy('/api/fonts', { method: 'POST', body: form })
    }

    export async function deleteAccountFont(fileName: string): Promise<void> {
        await fetchProxy('/api/fonts/' + encodeURIComponent(fileName), { method: 'DELETE' })
    }

    export async function proposeGoogleFonts(language: string): Promise<GoogleFontProposal> {
        const res = await fetchProxy('/api/fonts/google?language=' + encodeURIComponent(language))
        return await res.json()
    }

    export async function downloadGoogleFonts(fontIds: string[]): Promise<AccountFont[]> {
        const res = await fetchProxy('/api/fonts/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fontIds }),
        })
        const data: { fonts: { fontId: string, fileName: string, extension: string, size: number, version: string }[] } = await res.json()
        return data.fonts.map(function (f) { return { name: f.fontId, path: f.fileName, extension: f.extension, size: f.size, version: f.version } })
    }

    export async function createOAuthClient(clientId: string, scopes: string): Promise<OAuthClientInfo> {
        const res = await fetchProxy('/api/oauth/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, scopes }),
        })
        const data: { client: OAuthClientInfo } = await res.json()
        return data.client
    }

    export async function updateOAuthClient(id: number, scopes: string, deleteFlag: boolean): Promise<OAuthClientInfo> {
        const res = await fetchProxy('/api/oauth/clients/' + encodeURIComponent(String(id)), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scopes, deleteFlag }),
        })
        const data: { client: OAuthClientInfo } = await res.json()
        return data.client
    }

    export async function rotateOAuthClientSecret(id: number): Promise<OAuthClientInfo> {
        const res = await fetchProxy('/api/oauth/clients/' + encodeURIComponent(String(id)) + '/secret', {
            method: 'POST',
        })
        const data: { client: OAuthClientInfo } = await res.json()
        return data.client
    }

    export async function getTemplateAccessGrants(clientId: number): Promise<TemplateAccessGrantInfo[]> {
        const res = await fetchProxy('/api/oauth/clients/' + encodeURIComponent(String(clientId)) + '/access-grants')
        const data: { grants: TemplateAccessGrantInfo[] } = await res.json()
        return data.grants
    }

    export async function createTemplateAccessGrant(
        clientId: number,
        workspace: string,
        path: string
    ): Promise<TemplateAccessGrantInfo> {
        const res = await fetchProxy('/api/oauth/clients/' + encodeURIComponent(String(clientId)) + '/access-grants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace, path }),
        })
        const data: { grant: TemplateAccessGrantInfo } = await res.json()
        return data.grant
    }

    export async function deleteTemplateAccessGrant(id: number): Promise<void> {
        await fetchProxy('/api/oauth/access-grants/' + encodeURIComponent(String(id)), { method: 'DELETE' })
    }

    // Fetch file type.
    
    export type FileTypeInfo = {
        category: 'image' | 'video' | 'audio' | 'other'
        mimeType: string
    }

    export async function getFileType(workspace: string, entryPath: string): Promise<FileTypeInfo> {
        const res = await fetchProxy('/api/workspace/' + encodeURIComponent(workspace) + '/files/' + encodeURIComponent(entryPath) + '?info=true')
        return await res.json()
    }

    // User management (administrator only).

    export async function listUsers(): Promise<UserAccountVO.Type[]> {
        const res = await fetchProxy('/api/users')
        const data: { users: UserAccountVO.Type[] } = await res.json()
        return data.users
    }

    export async function createUser(displayName: string, userId: string, pw: string, adminFlag: boolean): Promise<void> {
        await fetchProxy('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, userId, pw, adminFlag }),
        })
    }

    export async function updateUser(
        id: number,
        displayName: string,
        userId: string,
        adminFlag: boolean,
        mcpEnabled: boolean,
        pw: string,
        version: number
    ): Promise<void> {
        await fetchProxy('/api/users/' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, userId, adminFlag, mcpEnabled, pw, version }),
        })
    }

    // Own MCP settings (available to every account) and the administrator-only
    // global MCP switch.

    export type McpSettingsInfo = {
        userId: string
        mcpEnabled: boolean
        mcpKey: string
        global?: { enabled: boolean, port: number }
    }

    export async function getMcpSettings(): Promise<McpSettingsInfo> {
        const res = await fetchProxy('/api/mcp-settings', { method: 'GET' })
        return await res.json()
    }

    export async function updateOwnMcpEnabled(mcpEnabled: boolean): Promise<void> {
        await fetchProxy('/api/mcp-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mcpEnabled }),
        })
    }

    export async function regenerateMcpKey(): Promise<string> {
        const res = await fetchProxy('/api/mcp-settings/key', { method: 'POST' })
        const data: { mcpKey: string } = await res.json()
        return data.mcpKey
    }

    export async function updateMcpGlobalSettings(enabled: boolean, port: number): Promise<void> {
        await fetchProxy('/api/mcp-settings/global', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, port }),
        })
    }

    export async function deleteUser(id: number): Promise<void> {
        await fetchProxy('/api/users/' + encodeURIComponent(id), { method: 'DELETE' })
    }

    // Own password change (available to every account).

    export async function changeOwnPassword(currentPw: string, newPw: string): Promise<void> {
        await fetchProxy('/api/users/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPw, newPw }),
        })
    }

    // The current account's own workspaceKey (the share id handed to others).
    export async function getMyWorkspaceKey(): Promise<string> {
        const res = await fetchProxy('/api/users/me')
        const data: { user: { workspaceKey: string } } = await res.json()
        return data.user.workspaceKey
    }

    // Folder sharing (owner side).

    export async function listFolderShares(path: string): Promise<FolderShareRow[]> {
        const res = await fetchProxy('/api/folder-shares?path=' + encodeURIComponent(path))
        const data: { shares: FolderShareRow[] } = await res.json()
        return data.shares
    }

    // Returns { ok:false } when the grantee key does not resolve (existence is
    // never disclosed), { ok:true } on success.
    export async function createFolderShareByKey(path: string, granteeWorkspaceKey: string, canRead: boolean, canWrite: boolean): Promise<{ ok: boolean }> {
        const res = await fetchProxy('/api/folder-shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, granteeWorkspaceKey, canRead, canWrite }),
        })
        return await res.json()
    }

    export async function updateFolderShare(id: number, canRead: boolean, canWrite: boolean, version: number): Promise<void> {
        await fetchProxy('/api/folder-shares/' + encodeURIComponent(String(id)), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ canRead, canWrite, version }),
        })
    }

    export async function deleteFolderShare(id: number): Promise<void> {
        await fetchProxy('/api/folder-shares/' + encodeURIComponent(String(id)), { method: 'DELETE' })
    }

    // Grantee-side: decline a folder shared with the current account, removing it
    // from the account's workspace view.
    export async function rejectIncomingShare(id: number): Promise<void> {
        await fetchProxy('/api/folder-shares/incoming/' + encodeURIComponent(String(id)), { method: 'DELETE' })
    }

    // Print history (account-scoped, paginated).

    export async function getPrintHistory(offset: number, limit: number): Promise<PrintHistoryPage> {
        const res = await fetchProxy('/api/print-history?offset=' + offset + '&limit=' + limit)
        return await res.json()
    }

    // Records an editor print by uploading the generated PDF and its metadata.
    export async function recordEditorPrint(pdf: Blob, workspace: string, templatePath: string, format: string): Promise<void> {
        const form = new FormData()
        form.set('file', pdf, 'print.pdf')
        form.set('workspace', workspace)
        form.set('templatePath', templatePath)
        form.set('format', format)
        await fetchProxy('/api/print-history', { method: 'POST', body: form })
    }

    export function printHistoryDownloadUrl(key: string): string {
        return '/api/print-history/' + encodeURIComponent(key) + '/download'
    }

    // Factory reset (administrator only).

    export async function factoryReset(): Promise<void> {
        await fetchProxy('/api/system/factory-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        })
    }

}
