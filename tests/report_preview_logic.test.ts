import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientBase } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BusinessException } from '../src/lib/common/exception/business_exception'
import { NotFoundException } from '../src/lib/common/exception/not_found_exception'
import { ForbiddenException } from '../src/lib/common/exception/forbidden_exception'
import { ReportApiLogic } from '../src/lib/server/logic/report_api_logic'
import { ReportPreviewLogic } from '../src/lib/server/logic/report_preview_logic'

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

function createStaticTextElement(id: string, text: string, fontFamily: string) {
    return { ...createBaseElement(), id, kind: 'staticText', text, style: { ...createBaseStyle(), fontFamily } }
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

// The test workspace is addressed by the owning account's workspaceKey.
const WS1_KEY = '00000000-0000-0000-0000-000000000001'

// The account that owns the OAuth client (its own workspace is WS1_KEY, so it can
// read everything under WS1_KEY).
const OWNER_USER_ROW = {
    id: 5, displayName: 'owner', userId: 'owner', pw: '', provider: 'local', externalId: '', email: '',
    workspaceKey: WS1_KEY, adminFlag: false, mcpEnabled: true, mcpKey: 'k', version: 0,
}
const OAUTH_CLIENT_ROW = { id: 2, fkUserAccount: 5, clientId: 'c', clientSecret: 's', scopes: '', deleteFlag: false, version: 0 }

// Stub DB client. token/grant/tag are configurable per test; the owner-account
// resolution used by checkClientTemplateAccess (OAuthClient → UserAccount →
// FolderShare) always answers so the account-scope check can run.
type StubRows = {
    token?: Record<string, unknown>
    grant?: Record<string, unknown>
    tag?: Record<string, unknown>
}

function createStubDbClient(rows: StubRows): ClientBase {
    const stub = {
        query: async function (config: unknown): Promise<{ rowCount: number, rows: Record<string, unknown>[] }> {
            const text = (config as { text: string }).text
            let row: Record<string, unknown> | undefined
            if (text.includes('NEXTVAL')) {
                row = { id: 1 }
            } else if (text.includes('tokenHash')) {
                row = rows.token
            } else if (text.includes('TemplateAccessGrant')) {
                row = rows.grant
            } else if (text.includes('FolderShare')) {
                // The owner reads its own workspace, so it needs no incoming shares.
                return { rowCount: 0, rows: [] }
            } else if (text.includes('UserAccount.workspaceKey')) {
                row = OWNER_USER_ROW
            } else if (text.includes('OAuthClient')) {
                // getById (checkClientTemplateAccess) resolves the owning client;
                // the create-flow duplicate check (by clientId) must find nothing.
                row = text.includes('.id =') ? OAUTH_CLIENT_ROW : undefined
            } else if (text.includes('TemplateTag')) {
                row = rows.tag
            }
            return { rowCount: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] }
        },
    }
    return stub as unknown as ClientBase
}

const GRANT_ROW = { id: 10 }

let workspacesRoot = ''
let fontDir = ''

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02, 0x03])

beforeAll(async function () {
    workspacesRoot = await mkdtemp(join(tmpdir(), 'preview-logic-ws-'))
    process.env.WORKSPACES_ROOT = workspacesRoot
    fontDir = await mkdtemp(join(tmpdir(), 'preview-logic-fonts-'))

    await mkdir(join(workspacesRoot, WS1_KEY, 'reports'), { recursive: true })
    await mkdir(join(workspacesRoot, WS1_KEY, 'images'), { recursive: true })
    const subTemplate = createTemplate('sub', [createStaticTextElement('sub_1', '明細', 'NestedFont')])
    await writeFile(join(workspacesRoot, WS1_KEY, 'reports', 'sub.report'), JSON.stringify(subTemplate, null, 2))
    await writeFile(join(workspacesRoot, WS1_KEY, 'images', 'pic.png'), PNG_BYTES)
    await writeFile(join(workspacesRoot, WS1_KEY, 'data.txt'), 'hello')
    await writeFile(join(workspacesRoot, 'outside.txt'), 'outside')

    await mkdir(join(fontDir, 'nested'), { recursive: true })
    await writeFile(join(fontDir, 'PreviewTestFont.ttf'), 'dummy-font-a')
    await writeFile(join(fontDir, 'nested', 'NestedFont.otf'), 'dummy-font-b')
    await writeFile(join(fontDir, 'notes.txt'), 'not a font')
})

afterAll(async function () {
    delete process.env.WORKSPACES_ROOT
    await rm(workspacesRoot, { recursive: true, force: true })
    await rm(fontDir, { recursive: true, force: true })
})

// The preview endpoints require the report:preview scope through the shared bearer check
describe('report:preview scope', function () {
    const tokenRow = { id: 1, fkOAuthClient: 2, tokenHash: 'hash', scopes: 'report:print report:preview', version: 0 }

    test('accepts a token that carries the preview scope', async function () {
        const client = createStubDbClient({ token: tokenRow })
        const token = await ReportApiLogic.checkBearerToken(client, 'Bearer valid-token', 'report:preview')
        expect(token.fkOAuthClient).toBe(2)
    })

    test('rejects a token without the preview scope', async function () {
        const client = createStubDbClient({ token: { ...tokenRow, scopes: 'report:print report:status report:download' } })
        await expect(ReportApiLogic.checkBearerToken(client, 'Bearer valid-token', 'report:preview')).rejects.toThrow(ForbiddenException)
    })

    test('report:preview is an assignable client scope', async function () {
        const client = createStubDbClient({})
        const created = await ReportApiLogic.createOAuthClient(client, 'preview-client', 'report:preview', undefined)
        expect(created.scopes).toBe('report:preview')
    })
})

describe('getPublishedTemplate', function () {
    const mainTemplate = createTemplate('invoice', [
        createStaticTextElement('t1', '請求書', 'PreviewTestFont'),
        createStaticTextElement('t2', '備考', 'MissingFont'),
    ])
    const tagRow = { id: 20, workspace: WS1_KEY, templatePath: 'reports/main.report', tag: 'v1', templateJson: JSON.stringify(mainTemplate), version: 0 }

    test('returns the snapshot converted to core format with print-parity font ids', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW, tag: tagRow })
        const payload = await ReportPreviewLogic.getPublishedTemplate(client, 2, WS1_KEY, 'reports/main.report', 'v1', fontDir)
        // Core format: page settings object and a band set keyed by band type (editor format has pageSettings + bands array)
        expect(payload.template.page).toBeDefined()
        expect(Array.isArray(payload.template.bands)).toBe(false)
        expect((payload.template as unknown as Record<string, unknown>).pageSettings).toBeUndefined()
        expect(JSON.stringify(payload.template)).toContain('請求書')
        // Default and math fonts always included; referenced fonts only when a font file resolves
        expect(payload.fontIds).toEqual(['builtin:NotoSansJP', 'builtin:STIXTwoMath', 'PreviewTestFont', 'STIXTwoMath'])
    })

    test('rejects a client without a template access grant', async function () {
        const client = createStubDbClient({ tag: tagRow })
        await expect(
            ReportPreviewLogic.getPublishedTemplate(client, 2, WS1_KEY, 'reports/main.report', 'v1', fontDir)
        ).rejects.toThrow(ForbiddenException)
    })

    test('reports a missing tag as not found', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        await expect(
            ReportPreviewLogic.getPublishedTemplate(client, 2, WS1_KEY, 'reports/main.report', 'v1', fontDir)
        ).rejects.toThrow(NotFoundException)
    })

    test('rejects a reserved tag name', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW, tag: tagRow })
        await expect(
            ReportPreviewLogic.getPublishedTemplate(client, 2, WS1_KEY, 'reports/main.report', 'latest', fontDir)
        ).rejects.toThrow(BusinessException)
    })
})

describe('getSubreportTemplate', function () {
    test('converts the current workspace file to core format with its font ids', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        const payload = await ReportPreviewLogic.getSubreportTemplate(client, 2, WS1_KEY, ['reports', 'sub.report'], fontDir)
        expect(payload.template.page).toBeDefined()
        expect(JSON.stringify(payload.template)).toContain('明細')
        expect(payload.fontIds).toEqual(['builtin:NotoSansJP', 'builtin:STIXTwoMath', 'NestedFont', 'STIXTwoMath'])
    })

    test('rejects a client without any grant on the workspace', async function () {
        const client = createStubDbClient({})
        await expect(
            ReportPreviewLogic.getSubreportTemplate(client, 2, WS1_KEY, ['reports', 'sub.report'], fontDir)
        ).rejects.toThrow(ForbiddenException)
    })

    test('rejects path traversal', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        await expect(
            ReportPreviewLogic.getSubreportTemplate(client, 2, WS1_KEY, ['..', 'outside.txt'], fontDir)
        ).rejects.toThrow(ForbiddenException)
    })

    test('reports a missing file as not found', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        await expect(
            ReportPreviewLogic.getSubreportTemplate(client, 2, WS1_KEY, ['reports', 'none.report'], fontDir)
        ).rejects.toThrow(NotFoundException)
    })
})

describe('getWorkspaceFile', function () {
    test('returns raw bytes with a detected content type', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        const file = await ReportPreviewLogic.getWorkspaceFile(client, 2, WS1_KEY, ['images', 'pic.png'])
        expect(file.contentType).toBe('image/png')
        expect(Buffer.compare(file.data, PNG_BYTES)).toBe(0)
    })

    test('falls back to application/octet-stream for unknown content', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        const file = await ReportPreviewLogic.getWorkspaceFile(client, 2, WS1_KEY, ['data.txt'])
        expect(file.contentType).toBe('application/octet-stream')
        expect(file.data.toString('utf-8')).toBe('hello')
    })

    test('rejects a client without any grant on the workspace', async function () {
        const client = createStubDbClient({})
        await expect(
            ReportPreviewLogic.getWorkspaceFile(client, 2, WS1_KEY, ['data.txt'])
        ).rejects.toThrow(ForbiddenException)
    })

    test('rejects path traversal in path segments and workspace names', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        await expect(
            ReportPreviewLogic.getWorkspaceFile(client, 2, WS1_KEY, ['..', 'outside.txt'])
        ).rejects.toThrow(ForbiddenException)
        await expect(
            ReportPreviewLogic.getWorkspaceFile(client, 2, '..', ['outside.txt'])
        ).rejects.toThrow(ForbiddenException)
    })

    test('reports a missing file as not found', async function () {
        const client = createStubDbClient({ grant: GRANT_ROW })
        await expect(
            ReportPreviewLogic.getWorkspaceFile(client, 2, WS1_KEY, ['images', 'none.png'])
        ).rejects.toThrow(NotFoundException)
    })
})

describe('font catalog and delivery', function () {
    test('listFonts returns bundled fonts plus the recursive font directory index', function () {
        const fonts = ReportPreviewLogic.listFonts(fontDir)
        expect(fonts).toEqual([
            { id: 'builtin:NotoSansJP', fileName: 'NotoSansJP-VariableFont_wght.ttf' },
            { id: 'builtin:STIXTwoMath', fileName: 'STIXTwoMath.otf' },
            { id: 'NestedFont', fileName: 'NestedFont.otf' },
            { id: 'NotoSansJP', fileName: 'NotoSansJP-VariableFont_wght.ttf' },
            { id: 'PreviewTestFont', fileName: 'PreviewTestFont.ttf' },
            { id: 'STIXTwoMath', fileName: 'STIXTwoMath.otf' },
        ])
    })

    test('getFontBinary returns the bytes with a stable entity tag', async function () {
        const first = await ReportPreviewLogic.getFontBinary(fontDir, 'PreviewTestFont', null)
        expect(first.data!.toString('utf-8')).toBe('dummy-font-a')
        expect(first.contentType).toBe('font/ttf')
        expect(first.etag.startsWith('"')).toBe(true)
        const second = await ReportPreviewLogic.getFontBinary(fontDir, 'PreviewTestFont', null)
        expect(second.etag).toBe(first.etag)
    })

    test('getFontBinary answers a matching If-None-Match without the body', async function () {
        const first = await ReportPreviewLogic.getFontBinary(fontDir, 'NestedFont', null)
        const cached = await ReportPreviewLogic.getFontBinary(fontDir, 'NestedFont', first.etag)
        expect(cached.data).toBeNull()
        expect(cached.etag).toBe(first.etag)
    })

    test('getFontBinary serves the bundled default font', async function () {
        const font = await ReportPreviewLogic.getFontBinary(fontDir, 'builtin:NotoSansJP', null)
        expect(font.contentType).toBe('font/ttf')
        expect(font.data!.length).toBeGreaterThan(0)
    })

    test('getFontBinary reports an unknown font id as not found', async function () {
        await expect(ReportPreviewLogic.getFontBinary(fontDir, 'NoSuchFont', null)).rejects.toThrow(NotFoundException)
    })
})
