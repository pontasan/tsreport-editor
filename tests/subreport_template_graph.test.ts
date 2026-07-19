import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolveSubreportTemplateGraph } from '../src/lib/server/logic/subreport_template_graph'

const WORKSPACE = 'vitest-subreport-graph'
const ROOT_DIR = '/var/nfs/workspaces/' + WORKSPACE + '/reports'

function createReportTemplate(name: string, templateExpression: string = ''): Record<string, unknown> {
    return {
        name,
        pageSettings: {
            size: 'custom',
            width: 200,
            height: 200,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            orientation: 'portrait',
            columnCount: 1,
            columnWidth: 200,
            columnSpacing: 0,
            columnPrintOrder: 'vertical',
        },
        bands: [{
            type: 'detail',
            height: 40,
            startNewPage: false,
            splitType: 'Stretch',
            printWhenExpression: '',
            enabled: true,
            elements: templateExpression === '' ? [] : [{
                id: 'sub_1',
                kind: 'subreport',
                x: 0,
                y: 0,
                width: 100,
                height: 40,
                text: '',
                expression: '',
                style: {
                    fontFamily: 'NotoSansJP',
                    fontSize: 10,
                    bold: false,
                    italic: false,
                    underline: false,
                    strikethrough: false,
                    forecolor: '#000000',
                    backcolor: '#FFFFFF',
                    mode: 'transparent',
                    hAlign: 'left',
                    vAlign: 'middle',
                    rotation: 0,
                    border: { top: null, bottom: null, left: null, right: null },
                    padding: { top: 0, bottom: 0, left: 0, right: 0 },
                    opacity: 1,
                },
                styleName: '',
                positionType: 'float',
                stretchType: 'noStretch',
                printWhenExpression: '',
                isRemoveLineWhenBlank: false,
                isPrintRepeatedValues: true,
                markup: 'none',
                direction: 'ltr',
                writingMode: 'horizontal-tb',
                lineSpacingType: 'single',
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
                hyperlinkType: '',
                hyperlinkTarget: '',
                hyperlinkRemoteDocument: '',
                pattern: '',
                blankWhenNull: false,
                stretchWithOverflow: false,
                evaluationTime: 'now',
                evaluationGroup: '',
                textTruncate: 'none',
                lineWidth: 1,
                lineStyle: 'solid',
                lineColor: '#000000',
                radius: 0,
                topLeftRadius: 0,
                topRightRadius: 0,
                bottomRightRadius: 0,
                bottomLeftRadius: 0,
                fill: '',
                stroke: '#000000',
                strokeWidth: 1,
                source: '',
                sourceExpression: '',
                scaleMode: 'clip',
                imageHAlign: 'left',
                imageVAlign: 'top',
                onError: 'error',
                lazy: false,
                svgContent: '',
                barcodeType: 'code128',
                showText: true,
                errorCorrectionLevel: 'M',
                formula: '',
                mathFontFamily: 'STIXTwoMath',
                mathFontSize: 12,
                mathColor: '#000000',
                breakType: 'page',
                templateExpression,
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
            }],
        }],
        titleNewPage: false,
        summaryNewPage: false,
        summaryWithPageHeaderAndFooter: false,
        testDataPath: '',
    }
}

async function writeTemplate(path: string, template: Record<string, unknown>): Promise<void> {
    await writeFile(ROOT_DIR + '/' + path, JSON.stringify(template), 'utf-8')
}

afterEach(async function () {
    await rm('/var/nfs/workspaces/' + WORKSPACE, { recursive: true, force: true })
})

// Server-side resolution of the full subreport dependency graph from workspace files
describe('resolveSubreportTemplateGraph', function () {
    // Verify transitively referenced templates are all collected from the workspace
    test('loads nested subreport templates from workspace', async function () {
        await mkdir(ROOT_DIR, { recursive: true })
        await writeTemplate('child.report', createReportTemplate('child', "'nested.report'"))
        await writeTemplate('nested.report', createReportTemplate('nested'))

        const result = await resolveSubreportTemplateGraph({
            workspace: WORKSPACE,
            rootPath: 'reports/root.report',
            rootTemplate: createReportTemplate('root'),
            templateExpression: "'child.report'",
            openReportTemplates: [],
        })

        expect(result.valid).toBe(true)
        expect(result.templates.map(function (entry) { return entry.path }).sort()).toEqual([
            'reports/child.report',
            'reports/nested.report',
        ])
    })

    // Verify a cycle in the template graph is detected and reported with the involved path
    test('rejects circular references through nested templates', async function () {
        await mkdir(ROOT_DIR, { recursive: true })
        await writeTemplate('cycle-a.report', createReportTemplate('cycle-a', "'cycle-b.report'"))
        await writeTemplate('cycle-b.report', createReportTemplate('cycle-b', "'cycle-a.report'"))

        const result = await resolveSubreportTemplateGraph({
            workspace: WORKSPACE,
            rootPath: 'reports/root.report',
            rootTemplate: createReportTemplate('root'),
            templateExpression: "'cycle-a.report'",
            openReportTemplates: [],
        })

        expect(result.valid).toBe(false)
        expect(result.message).toContain('循環')
        expect(result.message).toContain('reports/root.report')
    })

    // Verify dynamic template expressions inside nested templates invalidate the graph
    test('rejects nested dynamic subreport expressions', async function () {
        await mkdir(ROOT_DIR, { recursive: true })
        await writeTemplate('dynamic.report', createReportTemplate('dynamic', 'param.childReportPath'))

        const result = await resolveSubreportTemplateGraph({
            workspace: WORKSPACE,
            rootPath: 'reports/root.report',
            rootTemplate: createReportTemplate('root'),
            templateExpression: "'dynamic.report'",
            openReportTemplates: [],
        })

        expect(result.valid).toBe(false)
        expect(result.message).toContain('設計時に確定する文字列式')
    })

    // Security: a child template outside the caller's grant must not be read.
    // A folder-scoped user resolving reports/root.report cannot pull in a
    // template under a sibling folder via a subreport reference.
    test('does not load child templates the caller is not authorized to read', async function () {
        await mkdir(ROOT_DIR, { recursive: true })
        await mkdir('/var/nfs/workspaces/' + WORKSPACE + '/secret', { recursive: true })
        await writeTemplate('child.report', createReportTemplate('child', "'../secret/hidden.report'"))
        await writeFile(
            '/var/nfs/workspaces/' + WORKSPACE + '/secret/hidden.report',
            JSON.stringify(createReportTemplate('hidden')),
        )

        const result = await resolveSubreportTemplateGraph({
            workspace: WORKSPACE,
            rootPath: 'reports/root.report',
            rootTemplate: createReportTemplate('root'),
            templateExpression: "'child.report'",
            openReportTemplates: [],
            // Grant covers only reports/, not secret/.
            authorizePath: function (path: string): boolean { return path.startsWith('reports/') },
        })

        // The unauthorized child is treated as missing, and its contents never
        // appear in the returned templates.
        expect(result.templates.some(function (entry) { return entry.path.startsWith('secret/') })).toBe(false)
        if (result.valid) {
            expect(result.templates.map(function (entry) { return entry.path })).not.toContain('secret/hidden.report')
        } else {
            expect(result.message).toContain('secret/hidden.report')
        }
    })
})

// Security regression for the workspace access rules.
describe('WorkspaceAccessLogic path normalization', function () {
    const OWN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const OWNER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

    test('own-workspace access does not authorize traversal out of the workspace', async function () {
        const { WorkspaceAccessLogic } = await import('../src/lib/server/logic/workspace_access_logic')
        const access = { ownWorkspaceKey: OWN, shares: [] }
        // In-bounds paths are readable.
        expect(WorkspaceAccessLogic.resolveAccess(access, OWN, 'designs/a.report').read).toBe(true)
        // A "../otherWorkspace/..." path normalizes outside the root → denied
        // (this was the upload-escape bug).
        expect(WorkspaceAccessLogic.resolveAccess(access, OWN, '../other/x.report').read).toBe(false)
        expect(WorkspaceAccessLogic.resolveAccess(access, OWN, 'a/../../b').read).toBe(false)
    })

    test('a shared folder is confined after normalization', async function () {
        const { WorkspaceAccessLogic } = await import('../src/lib/server/logic/workspace_access_logic')
        const access = { ownWorkspaceKey: OWN, shares: [{ ownerWorkspaceKey: OWNER, path: 'designs', canRead: true, canWrite: true }] }
        expect(WorkspaceAccessLogic.resolveAccess(access, OWNER, 'designs/sub/a.report').read).toBe(true)
        // Normalizes back into designs → still readable.
        expect(WorkspaceAccessLogic.resolveAccess(access, OWNER, 'designs/x/../a.report').read).toBe(true)
        // Escapes the shared folder → not readable.
        expect(WorkspaceAccessLogic.resolveAccess(access, OWNER, 'designs/../other/a.report').read).toBe(false)
    })
})
