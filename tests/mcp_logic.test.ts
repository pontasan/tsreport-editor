import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientBase } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { AuthenticationException } from '../src/lib/common/exception/authentication_exception'
import { ForbiddenException } from '../src/lib/common/exception/forbidden_exception'
import { McpLogic, type JsonRpcResponse, type McpAccess, type McpContext } from '../src/lib/server/logic/mcp_logic'
import type { WorkspaceAccess, IncomingShare } from '../src/lib/server/logic/workspace_access_logic'
import type { UserAccount } from '../src/lib/server/entity/user_account'

// Fixed workspace keys for the fixtures (must be well-formed UUIDs).
const OWN_KEY = '11111111-1111-1111-1111-111111111111'
const OTHER_KEY = '22222222-2222-2222-2222-222222222222'
const GRANTEE_KEY = '33333333-3333-3333-3333-333333333333'

// Access to the account's own workspace (full read/write on OWN_KEY).
function ownerAccess(): McpAccess {
    const user = createUser(1, 'admin', true, OWN_KEY)
    const workspaceAccess: WorkspaceAccess = { ownWorkspaceKey: OWN_KEY, shares: [] }
    return { user, workspaceAccess }
}

// Access whose own workspace is empty but that holds the given shares.
function sharedAccess(shares: IncomingShare[]): McpAccess {
    const user = createUser(2, 'test', false, GRANTEE_KEY)
    const workspaceAccess: WorkspaceAccess = { ownWorkspaceKey: GRANTEE_KEY, shares }
    return { user, workspaceAccess }
}

function createUser(id: number, userId: string, adminFlag: boolean, workspaceKey: string): UserAccount.Type {
    return {
        id,
        displayName: userId,
        userId,
        pw: 'pass',
        provider: 'local',
        externalId: '',
        email: '',
        workspaceKey,
        adminFlag,
        mcpEnabled: true,
        mcpKey: userId + '-mcp-key',
        version: 0,
    }
}

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

function createBaseElement() {
    return {
        id: 'el_1',
        kind: 'staticText' as string,
        x: 10,
        y: 12,
        width: 100,
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

function createStaticTextElement(text: string) {
    return { ...createBaseElement(), id: 'text_1', kind: 'staticText', text }
}

function createTextFieldElement(expression: string) {
    return { ...createBaseElement(), id: 'field_1', kind: 'textField', expression }
}

function createTemplate(name: string, elements: unknown[]) {
    return {
        name,
        pageSettings: {
            size: 'custom',
            width: 200,
            height: 120,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            orientation: 'portrait' as const,
            columnCount: 1,
            columnWidth: 200,
            columnSpacing: 0,
            columnPrintOrder: 'vertical' as const,
        },
        bands: [{
            id: 'band_detail',
            type: 'detail',
            height: 100,
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

async function callMethod(context: McpContext, method: string, params?: unknown, id: string | number = 1): Promise<JsonRpcResponse | null> {
    const message: Record<string, unknown> = { jsonrpc: '2.0', id, method }
    if (params !== undefined) {
        message.params = params
    }
    return await McpLogic.handleMessage(message, context)
}

async function callTool(context: McpContext, name: string, args: Record<string, unknown>): Promise<JsonRpcResponse | null> {
    return await callMethod(context, 'tools/call', { name, arguments: args })
}

function getToolResult(response: JsonRpcResponse | null): { content: Record<string, unknown>[], isError?: boolean } {
    expect(response).not.toBeNull()
    expect(response!.error).toBeUndefined()
    return response!.result as { content: Record<string, unknown>[], isError?: boolean }
}

function parseTextContent(response: JsonRpcResponse | null): Record<string, unknown> {
    const result = getToolResult(response)
    expect(result.isError).toBeUndefined()
    expect(result.content[0].type).toBe('text')
    return JSON.parse(result.content[0].text as string)
}

function expectToolError(response: JsonRpcResponse | null): string {
    const result = getToolResult(response)
    expect(result.isError).toBe(true)
    expect(result.content[0].type).toBe('text')
    return result.content[0].text as string
}

// JSON-RPC protocol handling of the MCP endpoint logic
describe('McpLogic.handleMessage protocol', function () {
    const context: McpContext = { access: ownerAccess() }

    test('initialize returns protocol version, capabilities and server info', async function () {
        const response = await callMethod(context, 'initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
        })
        expect(response).not.toBeNull()
        const result = response!.result as Record<string, unknown>
        expect(result.protocolVersion).toBe('2025-03-26')
        expect((result.capabilities as Record<string, unknown>).tools).toBeDefined()
        expect((result.serverInfo as Record<string, unknown>).name).toBe('tsreport-editor')
    })

    test('initialize with unsupported protocol version returns the latest supported version', async function () {
        const response = await callMethod(context, 'initialize', { protocolVersion: '1999-01-01' })
        const result = response!.result as Record<string, unknown>
        expect(result.protocolVersion).toBe('2025-06-18')
    })

    test('notifications/initialized is accepted without a response', async function () {
        const response = await McpLogic.handleMessage(
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            context
        )
        expect(response).toBeNull()
    })

    test('ping returns an empty result', async function () {
        const response = await callMethod(context, 'ping')
        expect(response!.result).toEqual({})
    })

    test('unknown method returns -32601', async function () {
        const response = await callMethod(context, 'resources/list')
        expect(response!.error!.code).toBe(-32601)
        expect(response!.id).toBe(1)
    })

    test('batch requests are rejected with -32600', async function () {
        const response = await McpLogic.handleMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }], context)
        expect(response!.error!.code).toBe(-32600)
    })

    test('non JSON-RPC messages are rejected with -32600', async function () {
        const response = await McpLogic.handleMessage({ hello: 'world' }, context)
        expect(response!.error!.code).toBe(-32600)
    })

    test('tools/list returns the tool catalog', async function () {
        const response = await callMethod(context, 'tools/list')
        const tools = (response!.result as Record<string, unknown>).tools as Record<string, unknown>[]
        const names: string[] = []
        for (let i = 0; i < tools.length; i++) {
            expect(typeof tools[i].description).toBe('string')
            expect((tools[i].inputSchema as Record<string, unknown>).type).toBe('object')
            names.push(tools[i].name as string)
        }
        expect(names.sort()).toEqual([
            'compare_reports',
            'delete_workspace_file',
            'get_started',
            'get_template',
            'get_template_schema',
            'import_pdf',
            'layout_report',
            'list_fonts',
            'list_templates',
            'list_workspace_files',
            'list_workspaces',
            'move_workspace_file',
            'render_report',
            'save_template',
            'save_workspace_file',
            'update_template_elements',
            'validate_template',
        ])
    })

    test('unknown tool name returns -32602', async function () {
        const response = await callTool(context, 'delete_everything', {})
        expect(response!.error!.code).toBe(-32602)
    })
})

// Workspace tools operating against the account's own workspace (OWN_KEY).
describe('McpLogic tools/call', function () {
    let workspacesRoot = ''
    const context: McpContext = { access: ownerAccess() }
    const invoiceTemplate = createTemplate('invoice', [createStaticTextElement('請求書'), createTextFieldElement('row.name')])

    beforeAll(async function () {
        workspacesRoot = await mkdtemp(join(tmpdir(), 'mcp-logic-test-'))
        process.env.WORKSPACES_ROOT = workspacesRoot
        await mkdir(join(workspacesRoot, OWN_KEY, 'reports'), { recursive: true })
        await writeFile(join(workspacesRoot, OWN_KEY, 'reports', 'invoice.report'), JSON.stringify(invoiceTemplate, null, 2))
        await writeFile(join(workspacesRoot, OWN_KEY, 'data.json'), '{"rows":[]}')
    })

    afterAll(async function () {
        delete process.env.WORKSPACES_ROOT
        await rm(workspacesRoot, { recursive: true, force: true })
    })

    test('list_workspaces returns the own workspace', async function () {
        const value = await parseTextContent(await callTool(context, 'list_workspaces', {}))
        const workspaces = value.workspaces as Array<{ workspace: string, kind: string }>
        expect(workspaces).toEqual([{ workspace: OWN_KEY, kind: 'own', path: '', canRead: true, canWrite: true }])
    })

    test('list_templates returns .report files recursively', async function () {
        const value = await parseTextContent(await callTool(context, 'list_templates', { workspace: OWN_KEY }))
        expect(value.templates).toEqual([{ path: 'reports/invoice.report', name: 'invoice.report' }])
    })

    test('list_templates rejects an invalid workspace key', async function () {
        const text = expectToolError(await callTool(context, 'list_templates', { workspace: '../ws1' }))
        expect(text.length).toBeGreaterThan(0)
    })

    test('get_template returns the template JSON text', async function () {
        const response = await callTool(context, 'get_template', { workspace: OWN_KEY, path: 'reports/invoice.report' })
        const result = getToolResult(response)
        expect(result.isError).toBeUndefined()
        expect(JSON.parse(result.content[0].text as string)).toEqual(invoiceTemplate)
    })

    test('get_template reports a missing file as a tool error', async function () {
        const text = expectToolError(await callTool(context, 'get_template', { workspace: OWN_KEY, path: 'reports/none.report' }))
        expect(text.length).toBeGreaterThan(0)
    })

    test('get_template rejects path traversal', async function () {
        expectToolError(await callTool(context, 'get_template', { workspace: OWN_KEY, path: '../stray.txt' }))
    })

    test('save_template validates and writes the template, creating parent directories', async function () {
        const template = createTemplate('estimate', [createStaticTextElement('見積書')])
        const value = await parseTextContent(await callTool(context, 'save_template', {
            workspace: OWN_KEY,
            path: 'drafts/estimate.report',
            template,
        }))
        expect(value.saved).toBe('drafts/estimate.report')
        const saved = JSON.parse(await readFile(join(workspacesRoot, OWN_KEY, 'drafts', 'estimate.report'), 'utf-8'))
        expect(saved).toEqual(template)
    })

    test('save_template rejects a template with an invalid expression', async function () {
        const template = createTemplate('broken', [createTextFieldElement('1 +')])
        const text = expectToolError(await callTool(context, 'save_template', {
            workspace: OWN_KEY,
            path: 'broken.report',
            template,
        }))
        expect(text).toContain('expression')
    })

    test('get_template summary returns the structural map, elementIds returns just those elements', async function () {
        const template = createTemplate('partial', [createStaticTextElement('タイトル')])
        await callTool(context, 'save_template', { workspace: OWN_KEY, path: 'partial.report', template })
        const summary = await parseTextContent(await callTool(context, 'get_template', {
            workspace: OWN_KEY, path: 'partial.report', summary: true,
        }))
        const bands = summary.bands as Record<string, unknown>[]
        expect(bands.length).toBeGreaterThan(0)
        const detail = bands.find(b => (b.elements as unknown[]).length > 0)!
        const first = (detail.elements as Record<string, unknown>[])[0]
        expect(typeof first.id).toBe('string')
        expect(first.kind).toBe('staticText')
        expect(first.text).toBe('タイトル')
        // The summary must not include the full element JSON
        expect(first.style).toBeUndefined()

        const picked = await parseTextContent(await callTool(context, 'get_template', {
            workspace: OWN_KEY, path: 'partial.report', elementIds: [first.id, 'no_such_id'],
        }))
        expect((picked.elements as Record<string, unknown>[])[0].id).toBe(first.id)
        expect((picked.elements as Record<string, unknown>[])[0].style).toBeDefined()
        expect(picked.missing).toEqual(['no_such_id'])
    })

    test('update_template_elements patches a saved template element-wise', async function () {
        const template = createTemplate('patchable', [createStaticTextElement('旧テキスト')])
        await callTool(context, 'save_template', { workspace: OWN_KEY, path: 'patchable.report', template })
        const summary = await parseTextContent(await callTool(context, 'get_template', {
            workspace: OWN_KEY, path: 'patchable.report', summary: true,
        }))
        const band = (summary.bands as Record<string, unknown>[]).find(b => (b.elements as unknown[]).length > 0)!
        const elementId = ((band.elements as Record<string, unknown>[])[0]).id as string
        const picked = await parseTextContent(await callTool(context, 'get_template', {
            workspace: OWN_KEY, path: 'patchable.report', elementIds: [elementId],
        }))
        const element = (picked.elements as Record<string, unknown>[])[0]
        element.text = '新テキスト'

        const result = await parseTextContent(await callTool(context, 'update_template_elements', {
            workspace: OWN_KEY, path: 'patchable.report',
            set: [element],
            setBands: [{ id: band.id, height: 123 }],
        }))
        expect(result.replaced).toBe(1)
        expect(result.bandsPatched).toBe(1)

        const saved = JSON.parse(await readFile(join(workspacesRoot, OWN_KEY, 'patchable.report'), 'utf-8')) as Record<string, unknown>
        const savedBand = (saved.bands as Record<string, unknown>[]).find(b => b.id === band.id)!
        expect(savedBand.height).toBe(123)
        const savedElement = (savedBand.elements as Record<string, unknown>[]).find(e => e.id === elementId)!
        expect(savedElement.text).toBe('新テキスト')
    })

    test('update_template_elements rejects unknown element ids without saving', async function () {
        const template = createTemplate('strict', [createStaticTextElement('本文')])
        await callTool(context, 'save_template', { workspace: OWN_KEY, path: 'strict.report', template })
        const text = expectToolError(await callTool(context, 'update_template_elements', {
            workspace: OWN_KEY, path: 'strict.report',
            remove: ['ghost_element'],
        }))
        expect(text).toContain('ghost_element')
    })

    test('save_template rejects a path without the .report extension', async function () {
        expectToolError(await callTool(context, 'save_template', {
            workspace: OWN_KEY,
            path: 'drafts/estimate.json',
            template: createTemplate('x', []),
        }))
    })

    test('validate_template accepts a valid template', async function () {
        const value = await parseTextContent(await callTool(context, 'validate_template', {
            template: createTemplate('ok', [createStaticTextElement('OK')]),
        }))
        expect(value.valid).toBe(true)
        expect(value.errors).toEqual([])
    })

    test('validate_template reports expression syntax errors without saving', async function () {
        const value = await parseTextContent(await callTool(context, 'validate_template', {
            template: createTemplate('ng', [createTextFieldElement('1 +')]),
        }))
        expect(value.valid).toBe(false)
        expect((value.errors as string[]).length).toBeGreaterThan(0)
    })

    test('render_report renders a template with a data source to a base64 PDF', async function () {
        const response = await callTool(context, 'render_report', {
            workspace: OWN_KEY,
            templatePath: 'reports/invoice.report',
            template: invoiceTemplate,
            dataSource: { rows: [{ name: '商品A' }], parameters: {} },
            format: 'pdf',
        })
        const result = getToolResult(response)
        expect(result.isError).toBeUndefined()
        const resource = result.content[0].resource as Record<string, unknown>
        expect(result.content[0].type).toBe('resource')
        expect(resource.mimeType).toBe('application/pdf')
        const pdfBytes = Buffer.from(resource.blob as string, 'base64')
        expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    })

    test('import_pdf converts a rendered PDF back into editor template content', async function () {
        // Round trip: render our own template to a PDF, store it as the
        // "design original", then import it back
        const rendered = await callTool(context, 'render_report', {
            workspace: OWN_KEY,
            templatePath: 'reports/invoice.report',
            template: createTemplate('design', [createStaticTextElement('請求書'), createTextFieldElement('field.name')]),
            dataSource: { rows: [{ name: '商品A' }], parameters: {} },
            format: 'pdf',
        })
        const resource = getToolResult(rendered).content[0].resource as Record<string, unknown>
        await writeFile(join(workspacesRoot, OWN_KEY, 'design.pdf'), Buffer.from(resource.blob as string, 'base64'))

        const value = parseTextContent(await callTool(context, 'import_pdf', {
            workspace: OWN_KEY,
            pdfPath: 'design.pdf',
            templatePath: 'reports/reproduced.report',
        }))
        expect(value.pageCount).toBe(1)
        const pageSettings = value.pageSettings as Record<string, unknown>
        expect(pageSettings.width).toBe(200)
        expect(pageSettings.height).toBe(120)
        const elements = value.elements as { kind: string, text?: string }[]
        expect(elements.length).toBeGreaterThan(0)
        // The original texts survive as editable staticText elements
        const texts = elements.filter(function (el) { return el.kind === 'staticText' }).map(function (el) { return el.text })
        expect(texts).toContain('請求書')
        expect(texts).toContain('商品A')
    })

    test('import_pdf distributes the elements into the given band regions', async function () {
        const value = parseTextContent(await callTool(context, 'import_pdf', {
            workspace: OWN_KEY,
            pdfPath: 'design.pdf',
            templatePath: 'reports/reproduced.report',
            bandRegions: [{ type: 'pageHeader', height: 40 }, { type: 'detail', height: 80 }],
        }))
        const bands = value.bands as { type: string, height: number, elements: unknown[] }[]
        expect(bands.map(function (b) { return b.type })).toEqual(['pageHeader', 'detail'])
        expect(bands[0].height + bands[1].height).toBeCloseTo(120, 6)
        const total = bands[0].elements.length + bands[1].elements.length
        expect(total).toBeGreaterThan(0)
    })

    test('import_pdf rejects an out-of-range page index', async function () {
        const text = expectToolError(await callTool(context, 'import_pdf', {
            workspace: OWN_KEY,
            pdfPath: 'design.pdf',
            templatePath: 'reports/reproduced.report',
            page: 9,
        }))
        expect(text).toContain('page')
    })

    test('render_report rejects an unknown format', async function () {
        const text = expectToolError(await callTool(context, 'render_report', {
            workspace: OWN_KEY,
            templatePath: 'reports/invoice.report',
            template: invoiceTemplate,
            dataSource: { rows: [] },
            format: 'jpg',
        }))
        expect(text).toContain('png')
    })

    test('get_template_schema returns the full template reference', async function () {
        const value = await parseTextContent(await callTool(context, 'get_template_schema', {}))
        const element = value.element as Record<string, unknown>
        const common = element.common as Record<string, unknown>
        expect(String(common.kind)).toContain('staticText')
        const expressions = value.expressionLanguage as Record<string, unknown>
        expect(Object.keys(expressions.roots as Record<string, unknown>)).toContain('field.*')
        const example = value.minimalExample as Record<string, unknown>
        expect(Array.isArray(example.bands)).toBe(true)
    })

    test('list_workspace_files lists every file with its size', async function () {
        const value = await parseTextContent(await callTool(context, 'list_workspace_files', { workspace: OWN_KEY }))
        const files = value.files as Array<{ path: string, size: number }>
        const paths = files.map(function (file) { return file.path })
        expect(paths).toContain('data.json')
        expect(paths).toContain('reports/invoice.report')
        for (let i = 0; i < files.length; i++) {
            expect(files[i].size).toBeGreaterThan(0)
        }
    })

    test('list_fonts returns account ids while reserved built-in ids stay separate', async function () {
        const value = await parseTextContent(await callTool(context, 'list_fonts', {}))
        const fonts = value.fonts as string[]
        expect(fonts).not.toContain('builtin:NotoSansJP')
        expect(fonts).not.toContain('builtin:STIXTwoMath')
        expect(value.fallbackFont).toBe('builtin:NotoSansJP')
        expect(value.mathFont).toBe('builtin:STIXTwoMath')
    })

    test('layout_report returns absolute geometry for every rendered item', async function () {
        const value = await parseTextContent(await callTool(context, 'layout_report', {
            workspace: OWN_KEY,
            templatePath: 'reports/invoice.report',
            template: invoiceTemplate,
            dataSource: { rows: [{ name: '商品A' }], parameters: {} },
        }))
        expect(value.pageCount).toBe(1)
        expect(value.warnings).toEqual([])
        const pages = value.pages as Array<{ width: number, height: number, items: Array<Record<string, unknown>> }>
        expect(pages.length).toBe(1)
        const textItems = pages[0].items.filter(function (item) { return item.type === 'text' })
        const staticText = textItems.find(function (item) { return item.text === '請求書' })
        expect(staticText).toBeDefined()
        expect(staticText!.fontId).toBe('NotoSansJP')
    })

    test('layout_report publishes validated inline report and test-data drafts without saving them', async function () {
        const drafts: Array<{ path: string, kind: 'report' | 'json', content: string }> = []
        const draftContext: McpContext = {
            access: ownerAccess(),
            onDraftEvent: async function (_workspace, path, kind, content) {
                drafts.push({ path, kind, content })
            }
        }
        const template = { ...invoiceTemplate, testDataPath: 'reports/quotation-data.json' }
        const dataSource = { rows: [{ name: 'Consulting' }], parameters: { currency: 'USD' } }
        await callTool(draftContext, 'layout_report', {
            workspace: OWN_KEY,
            templatePath: 'reports/quotation.report',
            template,
            dataSource,
        })
        expect(drafts).toEqual([
            { path: 'reports/quotation.report', kind: 'report', content: JSON.stringify(template) },
            { path: 'reports/quotation-data.json', kind: 'json', content: JSON.stringify(dataSource, null, 2) },
        ])
    })

    test('save_workspace_file writes binary content and delete_workspace_file removes it', async function () {
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
        const saved = await parseTextContent(await callTool(context, 'save_workspace_file', {
            workspace: OWN_KEY,
            path: 'assets/uploaded.png',
            contentBase64: pngBytes.toString('base64'),
        }))
        expect(saved.saved).toBe('assets/uploaded.png')
        expect(saved.size).toBe(pngBytes.length)
        const written = await readFile(join(workspacesRoot, OWN_KEY, 'assets', 'uploaded.png'))
        expect(Buffer.compare(written, pngBytes)).toBe(0)

        const deleted = await parseTextContent(await callTool(context, 'delete_workspace_file', {
            workspace: OWN_KEY,
            path: 'assets/uploaded.png',
        }))
        expect(deleted.deleted).toBe('assets/uploaded.png')
    })

    test('move_workspace_file moves files and publishes the destination', async function () {
        const moves: Array<{ previousPath: string, path: string, isDirectory: boolean }> = []
        const moveContext: McpContext = {
            access: ownerAccess(),
            onFileMove: async function (_workspace, previousPath, path, isDirectory) {
                moves.push({ previousPath, path, isDirectory })
            }
        }
        await writeFile(join(workspacesRoot, OWN_KEY, 'move-source.json'), '{"ready":true}')
        const moved = await parseTextContent(await callTool(moveContext, 'move_workspace_file', {
            workspace: OWN_KEY,
            fromPath: 'move-source.json',
            toPath: 'promotion/move-target.json',
        }))
        expect(moved).toEqual({
            moved: { from: 'move-source.json', to: 'promotion/move-target.json' },
            isDirectory: false,
        })
        expect(await readFile(join(workspacesRoot, OWN_KEY, 'promotion', 'move-target.json'), 'utf8')).toBe('{"ready":true}')
        expect(moves).toEqual([{ previousPath: 'move-source.json', path: 'promotion/move-target.json', isDirectory: false }])
    })

    test('save_workspace_file rejects .report paths and path traversal', async function () {
        expect(expectToolError(await callTool(context, 'save_workspace_file', {
            workspace: OWN_KEY, path: 'x.report', content: '{}',
        }))).toContain('save_template')
        expect(expectToolError(await callTool(context, 'save_workspace_file', {
            workspace: OWN_KEY, path: '../escape.txt', content: 'x',
        })).length).toBeGreaterThan(0)
    })

    test('layout_report without template and templatePath is a tool error', async function () {
        expect(expectToolError(await callTool(context, 'layout_report', {
            workspace: OWN_KEY,
            dataSource: { rows: [] },
        }))).toContain('templatePath')
    })
})

// Account+key verification separated from the HTTP route so it can run against a stub DB client
describe('McpLogic.checkMcpAccess', function () {
    type StubRows = {
        mcpEnabledProperty?: Record<string, unknown>
        user?: Record<string, unknown>
        // FolderShare rows shared with the account (joined with owner).
        shares: Record<string, unknown>[]
    }

    function createStubDbClient(rows: StubRows): ClientBase {
        const stub = {
            query: async function (config: unknown): Promise<{ rowCount: number, rows: Record<string, unknown>[] }> {
                const text = (config as { text: string }).text
                if (text.includes('SystemProperty')) {
                    const row = rows.mcpEnabledProperty
                    return { rowCount: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] }
                }
                if (text.includes('FolderShare')) {
                    return { rowCount: rows.shares.length, rows: rows.shares }
                }
                const row = rows.user
                return { rowCount: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] }
            },
        }
        return stub as unknown as ClientBase
    }

    function createUserRow(overrides: Record<string, unknown>): Record<string, unknown> {
        return {
            id: 2,
            displayName: 'テストユーザ',
            userId: 'test',
            pw: 'pass',
            provider: 'local',
            externalId: '',
            email: '',
            workspaceKey: GRANTEE_KEY,
            adminFlag: false,
            mcpEnabled: true,
            mcpKey: 'test-mcp-key',
            version: 0,
            ...overrides,
        }
    }

    function credentials(account: string, key: string, authorization = ''): McpLogic.McpCredentials {
        return { authorization, account, key }
    }

    test('missing credentials yield an unauthenticated (guide-only) access', async function () {
        const client = createStubDbClient({ user: createUserRow({}), shares: [] })
        const access = await McpLogic.checkMcpAccess(client, credentials('', ''))
        expect(access.user).toBeNull()
        expect(access.workspaceAccess).toBeNull()
    })

    test('rejects an unknown account or a wrong key as an authentication error', async function () {
        const unknownAccount = createStubDbClient({ user: undefined, shares: [] })
        await expect(McpLogic.checkMcpAccess(unknownAccount, credentials('nobody', 'key'))).rejects.toThrow(AuthenticationException)
        const wrongKey = createStubDbClient({ user: createUserRow({}), shares: [] })
        await expect(McpLogic.checkMcpAccess(wrongKey, credentials('test', 'wrong-key'))).rejects.toThrow(AuthenticationException)
    })

    test('rejects an account with MCP disabled as forbidden', async function () {
        const client = createStubDbClient({ user: createUserRow({ mcpEnabled: false }), shares: [] })
        await expect(McpLogic.checkMcpAccess(client, credentials('test', 'test-mcp-key'))).rejects.toThrow(ForbiddenException)
    })

    test('rejects every request while MCP is globally disabled', async function () {
        const client = createStubDbClient({
            mcpEnabledProperty: { id: 1, key: 'mcp.enabled', value: 'false', version: 0 },
            user: createUserRow({}),
            shares: [],
        })
        await expect(McpLogic.checkMcpAccess(client, credentials('test', 'test-mcp-key'))).rejects.toThrow(ForbiddenException)
        await expect(McpLogic.checkMcpAccess(client, credentials('', ''))).rejects.toThrow(ForbiddenException)
    })

    test('authenticates x-mcp-account / x-mcp-key and loads the account access (own + shares)', async function () {
        const shares = [{ ownerWorkspaceKey: OWN_KEY, path: 'designs', canRead: true, canWrite: false }]
        const client = createStubDbClient({ user: createUserRow({}), shares })
        const access = await McpLogic.checkMcpAccess(client, credentials('test', 'test-mcp-key'))
        expect(access.user!.userId).toBe('test')
        expect(access.workspaceAccess!.ownWorkspaceKey).toBe(GRANTEE_KEY)
        expect(access.workspaceAccess!.shares).toEqual(shares)
    })

    test('accepts Authorization: Bearer account:key', async function () {
        const client = createStubDbClient({ user: createUserRow({ adminFlag: true }), shares: [] })
        const access = await McpLogic.checkMcpAccess(client, credentials('', '', 'Bearer test:test-mcp-key'))
        expect(access.user!.userId).toBe('test')
        // Administrators are not special-cased: only their own workspace.
        expect(access.workspaceAccess!.ownWorkspaceKey).toBe(GRANTEE_KEY)
        expect(access.workspaceAccess!.shares).toEqual([])
    })

    test('rejects a Bearer token without the account:key separator', async function () {
        const client = createStubDbClient({ user: createUserRow({}), shares: [] })
        await expect(McpLogic.checkMcpAccess(client, credentials('', '', 'Bearer opaque-token'))).rejects.toThrow(AuthenticationException)
    })
})

// Unauthenticated gate and cross-account folder sharing on tool calls
describe('McpLogic tool authorization', function () {
    let workspacesRoot = ''
    const template = createTemplate('t', [createStaticTextElement('A')])

    beforeAll(async function () {
        workspacesRoot = await mkdtemp(join(tmpdir(), 'mcp-authz-test-'))
        process.env.WORKSPACES_ROOT = workspacesRoot
        await mkdir(join(workspacesRoot, OWN_KEY, 'designs'), { recursive: true })
        await mkdir(join(workspacesRoot, OTHER_KEY), { recursive: true })
        await mkdir(join(workspacesRoot, GRANTEE_KEY), { recursive: true })
        await writeFile(join(workspacesRoot, OWN_KEY, 'designs', 'a.report'), JSON.stringify(template))
        await writeFile(join(workspacesRoot, OWN_KEY, 'designs', 'inner.report'), JSON.stringify(template))
        await writeFile(join(workspacesRoot, OWN_KEY, 'root.report'), JSON.stringify(template))
        await writeFile(join(workspacesRoot, OTHER_KEY, 'hidden.report'), JSON.stringify(template))
    })

    afterAll(async function () {
        delete process.env.WORKSPACES_ROOT
        await rm(workspacesRoot, { recursive: true, force: true })
    })

    // Grantee has read-only access to OWN_KEY/designs.
    function granteeContext(): McpContext {
        return { access: sharedAccess([{ ownerWorkspaceKey: OWN_KEY, path: 'designs', canRead: true, canWrite: false }]) }
    }

    test('get_started works without authentication', async function () {
        const context: McpContext = { access: { user: null, workspaceAccess: null } }
        const result = getToolResult(await callTool(context, 'get_started', {}))
        expect(result.isError).toBeUndefined()
        expect(result.content[0].text as string).toContain('x-mcp-account')
    })

    test('other tools answer unauthenticated calls with setup guidance', async function () {
        const context: McpContext = { access: { user: null, workspaceAccess: null } }
        const text = expectToolError(await callTool(context, 'list_workspaces', {}))
        expect(text).toContain('x-mcp-account')
        expect(text).toContain('get_started')
    })

    test('list_workspaces lists the own workspace and shared folders', async function () {
        const value = parseTextContent(await callTool(granteeContext(), 'list_workspaces', {}))
        const workspaces = value.workspaces as Array<{ workspace: string, kind: string, path: string }>
        expect(workspaces).toEqual([
            { workspace: GRANTEE_KEY, kind: 'own', path: '', canRead: true, canWrite: true },
            { workspace: OWN_KEY, kind: 'shared', path: 'designs', canRead: true, canWrite: false },
        ])
    })

    test('list_templates on a shared workspace shows only the shared subtree', async function () {
        const value = parseTextContent(await callTool(granteeContext(), 'list_templates', { workspace: OWN_KEY }))
        const paths = (value.templates as { path: string }[]).map(function (t) { return t.path })
        expect(paths).toEqual(['designs/a.report', 'designs/inner.report'])
    })

    test('reads outside the shared folder and other workspaces are denied', async function () {
        const context = granteeContext()
        expectToolError(await callTool(context, 'get_template', { workspace: OWN_KEY, path: 'root.report' }))
        expectToolError(await callTool(context, 'get_template', { workspace: OTHER_KEY, path: 'hidden.report' }))
    })

    test('a read-only share cannot write', async function () {
        const context = granteeContext()
        expectToolError(await callTool(context, 'save_template', { workspace: OWN_KEY, path: 'designs/b.report', template }))
        expectToolError(await callTool(context, 'delete_workspace_file', { workspace: OWN_KEY, path: 'designs/a.report' }))
    })

    test('a readable shared template can be read and rendered', async function () {
        const context = granteeContext()
        const read = getToolResult(await callTool(context, 'get_template', { workspace: OWN_KEY, path: 'designs/a.report' }))
        expect(read.isError).toBeUndefined()
        const layout = parseTextContent(await callTool(context, 'layout_report', {
            workspace: OWN_KEY, templatePath: 'designs/a.report', dataSource: { rows: [{}] },
        }))
        expect(layout.pageCount).toBe(1)
    })

    test('write access on the own workspace allows the full loop', async function () {
        const context: McpContext = { access: sharedAccess([]) }
        const saved = parseTextContent(await callTool(context, 'save_template', { workspace: GRANTEE_KEY, path: 'mine.report', template }))
        expect(saved.saved).toBe('mine.report')
    })

    // Regression: a caller holding only a read share on "designs" must not be
    // able to render a template (readable, inside the subtree) that references an
    // asset outside the shared subtree via "../". The template read check alone
    // is not enough — every referenced asset is authorized per-asset.
    test('render on a shared subtree cannot pull in a subreport outside that subtree', async function () {
        const context = granteeContext()
        const escaping = createTemplate('escape', [
            { ...createBaseElement(), id: 'sub_1', kind: 'subreport', templateExpression: "'../root.report'" },
        ])
        expectToolError(await callTool(context, 'layout_report', {
            workspace: OWN_KEY, templatePath: 'designs/a.report', template: escaping, dataSource: { rows: [{}] },
        }))
    })

    // Control: a subreport reference that stays inside the shared subtree renders.
    test('a subreport reference inside the shared subtree is allowed', async function () {
        const context = granteeContext()
        const withInner = createTemplate('outer', [
            { ...createBaseElement(), id: 'sub_2', kind: 'subreport', templateExpression: "'inner.report'" },
        ])
        const layout = parseTextContent(await callTool(context, 'layout_report', {
            workspace: OWN_KEY, templatePath: 'designs/a.report', template: withInner, dataSource: { rows: [{}] },
        }))
        expect(layout.pageCount).toBe(1)
    })
})
