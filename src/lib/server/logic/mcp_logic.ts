// MCP (Model Context Protocol) server logic.
// Implements the protocol side of the Streamable HTTP transport as JSON-RPC 2.0
// messages carried over HTTP POST. Each request yields a single JSON response;
// SSE streaming and JSON-RPC batch messages are not supported.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { ClientBase } from 'pg'
import { normalizeTemplate, type BandType, type ReportTemplate as EditorTemplate, type TemplateElement } from '../../../app/[lang]/editor/reducer'
import { convertEditorTemplateToCore } from '../../../app/[lang]/editor/template_converter'
import {
    convertImportedPageToEditorElements, createPdfImportPageSettings, fitTextElementsToAssignedFonts,
    splitElementsIntoBandRegions, type PdfFontAssignments, type PdfImportBandRegion,
} from '../../../app/[lang]/editor/pdf_import_converter'
import { matchFontName } from '../../../app/[lang]/editor/font_name_matcher'
import { AuthenticationException } from '@/lib/common/exception/authentication_exception'
import { BusinessException } from '@/lib/common/exception/business_exception'
import { SystemPropertyDao } from '@/lib/server/dao/SystemProperty'
import { UserAccountDao } from '@/lib/server/dao/user_account'
import { secretEquals } from '@/lib/server/utils/secret_compare'
import { UserAccount } from '@/lib/server/entity/user_account'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { PdfImporter, render, SvgBackend, type FontMap, type RenderNode } from 'tsreport-core'
import { TemplateValidationLogic } from './template_validation_logic'
import { TEMPLATE_SCHEMA } from './mcp_template_schema'
import { DEFAULT_FONT_ID, MATH_FONT_ID, ReportBatchLogic } from './report_batch_logic'
import { ensureFont, fontDirForAccount, listAccountFontIds } from './font_resolver'
import { WorkspaceAccess, WorkspaceAccessLogic } from './workspace_access_logic'
import { WorkspacePaths } from './workspace_paths'
import { UserAdminLogic } from './user_admin_logic'
import { parseTemplateJson, stringifyTemplateJson } from '@/lib/common/utils/template_json'

// Reference key for the constant-time comparison on an unknown account. Built
// from the real key generator so its length always tracks the mcpKey format;
// it can never equal a real key, so the compare simply fails uniformly instead
// of short-circuiting on a length mismatch and leaking account existence.
const DUMMY_MCP_KEY = UserAdminLogic.generateMcpKey()

// Result of the per-request MCP authentication.
// user === null means no credentials were presented: only get_started (and the
// protocol handshake) is available so an AI can learn the setup procedure.
export type McpAccess = {
    user: UserAccount.Type | null
    // The account's workspace access (own workspace + shared folders); null only
    // when unauthenticated (user === null).
    workspaceAccess: WorkspaceAccess | null
}

export type McpContext = {
    access: McpAccess
    // Transport-provided hook invoked after a tool wrote or deleted a workspace
    // file (used to broadcast MCP activity to open editors, and to follow folder
    // shares when a directory is deleted). `workspace` is the owning account's
    // workspaceKey; `isDirectory` is true when the affected path was a folder.
    onFileEvent?: (workspace: string, path: string, action: 'save' | 'delete', isDirectory: boolean) => Promise<void>
    // Transport-provided hook for a workspace entry move or rename.
    onFileMove?: (workspace: string, previousPath: string, path: string, isDirectory: boolean) => Promise<void>
    // Transport-provided hook for an inline report/data draft verified by a
    // layout or render call but not yet persisted to the workspace.
    onDraftEvent?: (workspace: string, path: string, draftKind: 'report' | 'json', content: string) => Promise<void>
    // Transport-provided hook invoked after a render produced a downloadable PDF,
    // to record it in the account's print history. Kept out of the tool logic so
    // the tools stay database-free (and unit-testable).
    recordPrint?: (workspace: string, templatePath: string, format: string, pdfBytes: Uint8Array) => Promise<void>
}

export type JsonRpcResponse = {
    jsonrpc: '2.0'
    id: string | number | null
    result?: Record<string, unknown>
    error?: { code: number, message: string }
}

type ToolContent = Record<string, unknown>

type ToolResult = {
    content: ToolContent[]
    isError?: boolean
}

type TemplateFileInfo = {
    path: string
    name: string
}

const SERVER_NAME = 'tsreport-editor'
const SERVER_VERSION = '0.1.0'
const LATEST_PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-03-26', '2025-06-18'])

const SERVER_INSTRUCTIONS = 'Report design tools. Authentication: every tool except get_started requires the '
    + 'x-mcp-account / x-mcp-key HTTP headers (editor account id and its MCP key). If you do not have them, '
    + 'call get_started and ask the human operator for the values. '
    + 'Recommended loop for reproducing a design original: '
    + '1) get_template_schema for the full template format, 2) list_fonts / list_workspace_files to discover '
    + 'usable font ids and image paths, 3) build the template JSON and validate_template, 4) layout_report '
    + 'to check page count and the absolute geometry of every rendered item numerically, 5) render_report '
    + '(format "png", the default) to compare page images against the design visually, 6) save_template. '
    + 'Use render_report with format "pdf" only for the final artifact. '
    + 'Upload design assets (PNG/SVG images) with save_workspace_file and reference them from image elements '
    + 'by workspace-relative path; move or rename entries with move_workspace_file and remove obsolete files '
    + 'with delete_workspace_file. To refine an existing '
    + 'report, read it with get_template, save changes with save_template, and pass just templatePath '
    + '(without an inline template) to layout_report / render_report to check the saved state. '
    + 'For LARGE templates, work element-wise instead of round-tripping the full JSON: get_template '
    + 'summary=true for the structure, get_template elementIds for the elements to change, '
    + 'update_template_elements to patch them, layout_report pageIndex/bbox and render_report '
    + 'pageIndex/region to verify just the affected area, and compare_reports (before/after) to prove '
    + 'nothing else moved.'

const TEMPLATE_FORMAT_NOTE = 'Template JSON format (editor template): { "name": string, "pageSettings": '
    + '{ "size", "width", "height", "marginTop", "marginBottom", "marginLeft", "marginRight", "orientation", ... }, '
    + '"bands": [{ "id", "type": "title"|"pageHeader"|"columnHeader"|"groupHeader"|"detail"|"groupFooter"|"columnFooter"|"pageFooter"|"lastPageFooter"|"summary"|"background"|"noData", '
    + '"height", "elements": [...] }], "groups": [...] }. Elements have "kind" ("staticText", "textField", '
    + '"line", "rectangle", "ellipse", "image", "svg", "frame", "table", "crosstab", "subreport", "barcode", "math", "break"), '
    + '"x"/"y"/"width"/"height" in points, a nested "style" object (fontFamily, fontSize, forecolor, backcolor, hAlign, vAlign, border, padding, ...), '
    + '"text" for staticText and "expression" (roots: "field.*", "vars.*", "param.*", e.g. "field.customerName") for textField. '
    + 'Call get_template_schema for the complete reference with defaults and per-kind properties.'

// Setup guide returned by get_started (the only tool available without
// authentication) and by GET on the MCP endpoint.
const GETTING_STARTED_TEXT = [
    '# tsreport MCP — READ THIS FIRST',
    '',
    'This server designs and renders print reports. All tools except get_started require authentication.',
    '',
    '## Authentication (per user account)',
    '- Send these HTTP headers on every MCP request:',
    '  - `x-mcp-account`: the editor login id of the user you are working for',
    '  - `x-mcp-key`: that user\'s MCP key',
    '- Alternatively `Authorization: Bearer <account>:<key>` is accepted.',
    '- You cannot look these values up yourself: ASK THE HUMAN OPERATOR for them.',
    '  The operator finds both in the editor under menu > "MCP設定" (MCP settings),',
    '  where the key can also be regenerated and MCP access toggled per account.',
    '',
    '## Permission model',
    '- Tools operate within the account\'s own workspace plus any folders other accounts have shared',
    '  with it (read and/or write). There is no administrator override.',
    '- layout_report / render_report read the template and every asset (images, subreport templates)',
    '  it references; each referenced file must itself be readable by the account, so a template in a',
    '  shared subtree may only reference assets inside that same shared subtree.',
    '',
    '## Recommended design loop',
    '1) get_template_schema for the full template format',
    '2) list_fonts / list_workspace_files to discover usable font ids and image paths',
    '3) build the template JSON and validate_template',
    '4) layout_report to check page count and absolute geometry numerically',
    '5) render_report (format "png") to compare page images against the design visually',
    '6) save_template; upload assets with save_workspace_file, move them with move_workspace_file, and remove obsolete files with delete_workspace_file',
    '',
    '## Reproducing a design original (PDF)',
    'When the user has the design as a PDF, DO NOT rebuild it by eye from rendered images.',
    '1) save_workspace_file the PDF (contentBase64), then import_pdf: it converts a page 1:1 into',
    '   editor elements (editable text with matched fonts, vector art as paths, extracted images)',
    '   and reports the exact page size.',
    '2) Static one-page form: put every element into the "background" band (it prints on every page)',
    '   or pass bandRegions to import_pdf to split them into pageHeader/detail/pageFooter etc.',
    '3) Repeating-detail form: import with bandRegions, then replace the static texts inside the',
    '   detail band with textField expressions bound to your data fields.',
    '4) Verify with layout_report / render_report against the original; only then save_template.',
    '',
    '## Editing existing (large) templates',
    '- Do NOT round-trip a large template as one JSON blob. Use the element-wise tools:',
    '  1) get_template summary=true — structural map (bands, element ids/kinds/geometry, text snippets)',
    '  2) get_template elementIds=[...] — full JSON of just the elements to change',
    '  3) update_template_elements — set (replace by id) / remove / add / setBands, validated like save_template',
    '  4) layout_report pageIndex/bbox and render_report pageIndex/region — verify only the affected area',
    '  5) compare_reports with the before/after versions — proves pixel-exactly that nothing else moved',
    '',
    '## Repeating-detail reports and test data',
    '- The detail band renders once per entry of dataSource.rows; bind cells with textField',
    '  expressions like "field.itemName". Page headers/footers repeat on every page.',
    '- Author realistic test data with MULTIPLE rows (enough to overflow one page at least once),',
    '  save it as a JSON file (e.g. "data/invoice_test.json" with { "rows": [...], "parameters": {...} })',
    '  via save_workspace_file, and set template.testDataPath to that path so the editor preview of',
    '  the human operator uses the same data.',
    '- Pass the same JSON as dataSource to layout_report / render_report and check both the first',
    '  page and the last page: row repetition, page breaks, and totals (groups / summary band).',
].join('\n')

const TOOLS: ToolContent[] = [
    {
        name: 'get_started',
        description: 'READ THIS FIRST. Explains how to authenticate (account + MCP key), the permission '
            + 'model, and the recommended report design loop. This is the only tool that works without '
            + 'authentication — call it before anything else and ask the human operator for the credentials '
            + 'it describes.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'list_workspaces',
        description: 'List the report workspaces available on this server.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    },
    {
        name: 'list_templates',
        description: 'List the report template files (*.report) of a workspace recursively. '
            + 'Returns workspace-relative paths usable with get_template / save_template.',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name from list_workspaces' }
            },
            required: ['workspace'],
            additionalProperties: false
        }
    },
    {
        name: 'get_template',
        description: 'Read a report template file from a workspace. Default: the full JSON text. '
            + 'For LARGE templates (e.g. import_pdf results) do not read the full JSON: pass summary=true '
            + 'to get a structural map (bands with element ids/kinds/geometry and text snippets), then pass '
            + 'elementIds to fetch just the elements you need, and edit them with update_template_elements. '
            + TEMPLATE_FORMAT_NOTE,
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name' },
                path: { type: 'string', description: 'Workspace-relative template path, e.g. "reports/invoice.report"' },
                summary: { type: 'boolean', description: 'Return a structural map instead of the full JSON (element ids, kinds, geometry, text snippets)' },
                elementIds: { type: 'array', items: { type: 'string' }, description: 'Return only these elements (full JSON each); missing ids are reported' }
            },
            required: ['workspace', 'path'],
            additionalProperties: false
        }
    },
    {
        name: 'update_template_elements',
        description: 'Partially edit a SAVED template without round-tripping its full JSON: replace elements '
            + 'by id (set), delete elements (remove), append new elements to a band or container element (add), '
            + 'and patch band height/enabled (setBands). The patched template is validated like save_template '
            + 'and rejected as a whole on any error. Look ids up with get_template summary=true first. '
            + 'Prefer this over save_template when changing a few elements of a large template.',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name' },
                path: { type: 'string', description: 'Workspace-relative path of the saved template' },
                set: { type: 'array', items: { type: 'object' }, description: 'Full element objects replacing the existing element with the same id (fetch with get_template elementIds, modify, send back)' },
                remove: { type: 'array', items: { type: 'string' }, description: 'Element ids to delete' },
                add: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            bandId: { type: 'string', description: 'Target band id' },
                            parentId: { type: 'string', description: 'Optional container element id (frame etc.); elements land in its children' },
                            elements: { type: 'array', items: { type: 'object' }, description: 'New elements; ids must be unique in the template' }
                        },
                        required: ['bandId', 'elements']
                    },
                    description: 'New elements to append'
                },
                setBands: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            height: { type: 'number' },
                            enabled: { type: 'boolean' }
                        },
                        required: ['id']
                    },
                    description: 'Band property patches (height in pt, enabled)'
                }
            },
            required: ['workspace', 'path'],
            additionalProperties: false
        }
    },
    {
        name: 'save_template',
        description: 'Validate a report template JSON and save it into a workspace. The path must end with '
            + '".report"; parent directories are created automatically. Saving is rejected when validation '
            + 'reports errors. ' + TEMPLATE_FORMAT_NOTE,
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name' },
                path: { type: 'string', description: 'Workspace-relative save path ending with ".report"' },
                template: { type: 'object', description: 'Template JSON object (editor template format)' }
            },
            required: ['workspace', 'path', 'template'],
            additionalProperties: false
        }
    },
    {
        name: 'validate_template',
        description: 'Validate a report template JSON without saving it. Checks the template structure, '
            + 'converts it with the same converter used for rendering, and verifies the syntax of every '
            + 'expression. Returns { "valid": boolean, "errors": string[] }. ' + TEMPLATE_FORMAT_NOTE,
        inputSchema: {
            type: 'object',
            properties: {
                template: { type: 'object', description: 'Template JSON object (editor template format)' }
            },
            required: ['template'],
            additionalProperties: false
        }
    },
    {
        name: 'get_template_schema',
        description: 'Complete reference of the editor template JSON format: every property with its type and '
            + 'default, per-kind element properties, the expression language, and a minimal working example. '
            + 'Call this before authoring a template.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'list_workspace_files',
        description: 'List every file of a workspace recursively (path and size in bytes). Use it to discover '
            + 'images (for image elements), data JSON files and existing templates.',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name from list_workspaces' }
            },
            required: ['workspace']
        }
    },
    {
        name: 'list_fonts',
        description: 'List every font id usable as style.fontFamily on this server, plus the default and math font ids.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'save_workspace_file',
        description: 'Write a file into a workspace (parent directories are created). Use it to upload design '
            + 'assets such as PNG/SVG images or data JSON, then reference them from templates by their '
            + 'workspace-relative path. Provide binary content as contentBase64 or text content as content. '
            + 'Templates (.report) must be saved with save_template instead (it validates them).',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name' },
                path: { type: 'string', description: 'Workspace-relative file path, e.g. "assets/logo.png"' },
                contentBase64: { type: 'string', description: 'Base64-encoded binary content (images etc.)' },
                content: { type: 'string', description: 'Text content (JSON, SVG markup etc.)' }
            },
            required: ['workspace', 'path']
        }
    },
    {
        name: 'delete_workspace_file',
        description: 'Delete a file or a directory (recursively) from a workspace. Use it to remove assets or '
            + 'templates that are no longer needed.',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name' },
                path: { type: 'string', description: 'Workspace-relative path to delete' }
            },
            required: ['workspace', 'path']
        }
    },
    {
        name: 'move_workspace_file',
        description: 'Rename or move a file or directory inside a workspace. Parent directories are created '
            + 'automatically. The destination must not already exist.',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name' },
                fromPath: { type: 'string', description: 'Current workspace-relative path' },
                toPath: { type: 'string', description: 'New workspace-relative path' }
            },
            required: ['workspace', 'fromPath', 'toPath'],
            additionalProperties: false
        }
    },
    {
        name: 'layout_report',
        description: 'Lay out a report template with a data source JSON and return the resulting geometry '
            + 'as JSON: per page, the absolute position (pt) of every rendered item (text with content, lines, '
            + 'rects, ellipses, images), plus template warnings (elements outside the band or page bounds). '
            + 'Compare these numbers against the design original before rendering images. Pass the template '
            + 'inline, or omit it to lay out the saved template at templatePath. ' + TEMPLATE_FORMAT_NOTE,
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name used to resolve fonts, images and subreports' },
                templatePath: { type: 'string', description: 'Workspace-relative template path; its directory becomes the base for relative references. When template is omitted, the saved file at this path is used' },
                template: { type: 'object', description: 'Template JSON object (editor template format). Optional when templatePath points at a saved template' },
                dataSource: { type: 'object', description: 'Data source JSON: { "rows": [...], "parameters": {...} }' },
                pageIndex: { type: 'number', description: 'Return only this page (0-based). pageCount still reports the total. Use it to keep responses small on multi-page reports' },
                bbox: { type: 'object', description: 'Only items intersecting this page rectangle { x, y, width, height } (pt). Combine with pageIndex to inspect one area' }
            },
            required: ['workspace', 'dataSource']
        }
    },
    {
        name: 'render_report',
        description: 'Render a report template JSON with a data source JSON. Default format "png" returns one '
            + 'image per page for visual comparison against the design original; format "pdf" returns the final '
            + 'PDF artifact as a base64 resource. Both formats come from the same layout result, and PNG text is '
            + 'rasterized from the exact glyph outlines the PDF embeds. Fonts, relative image references and '
            + 'subreport templates resolve against the workspace, relative to templatePath. Data source format: '
            + '{ "rows": [ {...}, ... ], "parameters": { ... } }. Pass the template inline, or omit it to '
            + 'render the saved template at templatePath. ' + TEMPLATE_FORMAT_NOTE,
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name used to resolve fonts, images and subreports' },
                templatePath: { type: 'string', description: 'Workspace-relative template path; its directory becomes the base for relative references. When template is omitted, the saved file at this path is used' },
                template: { type: 'object', description: 'Template JSON object (editor template format). Optional when templatePath points at a saved template' },
                dataSource: { type: 'object', description: 'Data source JSON: { "rows": [...], "parameters": {...} }' },
                format: { type: 'string', enum: ['png', 'pdf'], description: 'Output format (default "png")' },
                scale: { type: 'number', description: 'PNG only: raster scale, 1 = 72dpi (default 2 = 144dpi, max 4)' },
                pageIndex: { type: 'number', description: 'PNG only: render just this page (0-based)' },
                region: { type: 'object', description: 'PNG only: crop to this page rectangle { x, y, width, height } (pt) — cheap close-up checks of one area (e.g. a compare_reports diffBounds)' }
            },
            required: ['workspace', 'dataSource'],
            additionalProperties: false
        }
    },
    {
        name: 'import_pdf',
        description: 'Convert one page of a PDF design original (previously uploaded with save_workspace_file) '
            + 'into editor template content with high fidelity — use this instead of rebuilding a PDF design '
            + 'by eye. Text becomes editable staticText (fonts auto-matched against the account fonts, low '
            + 'scores flagged), vector art becomes path elements, raster images are extracted and saved under '
            + '"<report name>_assets/pdf_<timestamp>/" next to templatePath with sources already rewritten to '
            + 'relative paths. Returns the exact pageSettings for the PDF page and either "elements" '
            + '(absolute page coordinates, y measured from the page top) or, when bandRegions is given, '
            + '"bands" with the elements distributed into those bands (each element lands in the band with '
            + 'the largest overlap; band heights are grown to fit their content so the page still fits). '
            + 'Element ids start at el_1 — renumber them if you merge the result into an existing template. '
            + 'Typical flow: import_pdf -> assemble the template (disable unused bands with enabled=false) '
            + '-> replace detail texts with textField expressions -> layout_report / render_report to verify '
            + 'against the original.',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name holding the PDF' },
                pdfPath: { type: 'string', description: 'Workspace-relative path of the uploaded PDF' },
                templatePath: {
                    type: 'string',
                    description: 'Workspace-relative ".report" path the import is destined for; extracted '
                        + 'images are saved next to it and referenced relative to it'
                },
                page: { type: 'number', description: '0-based page index (default 0); the result reports pageCount' },
                bandRegions: {
                    type: 'array',
                    description: 'Optional top-to-bottom band split of the page. Heights are pt and should sum '
                        + 'to the page height. Example: [{"type":"pageHeader","height":80},{"type":"detail","height":680},'
                        + '{"type":"pageFooter","height":82}]',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['title', 'pageHeader', 'columnHeader', 'detail', 'columnFooter', 'pageFooter', 'summary'] },
                            height: { type: 'number' }
                        },
                        required: ['type', 'height'],
                        additionalProperties: false
                    }
                }
            },
            required: ['workspace', 'pdfPath', 'templatePath'],
            additionalProperties: false
        }
    },
    {
        name: 'compare_reports',
        description: 'Render two template versions (inline template or saved templatePath per side) with the '
            + 'same data source and compare the page rasters pixel by pixel. Returns per page: identical, the '
            + 'differing-pixel ratio and diffBounds { x, y, width, height } (pt) — pass diffBounds straight to '
            + 'render_report region for a visual close-up. Use it after editing to prove nothing else moved '
            + '(far more reliable than comparing two images by eye).',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', description: 'Workspace name' },
                templateA: { type: 'object', description: 'Side A template JSON (or use templatePathA)' },
                templatePathA: { type: 'string', description: 'Side A saved template path (also the base for relative references)' },
                templateB: { type: 'object', description: 'Side B template JSON (or use templatePathB)' },
                templatePathB: { type: 'string', description: 'Side B saved template path' },
                dataSource: { type: 'object', description: 'Data source JSON used for both sides' }
            },
            required: ['workspace', 'dataSource'],
            additionalProperties: false
        }
    }
]

export namespace McpLogic {

    // JSON-RPC 2.0 error codes used by the transport route.
    export const PARSE_ERROR = -32700
    export const INVALID_REQUEST = -32600
    export const METHOD_NOT_FOUND = -32601
    export const INVALID_PARAMS = -32602
    export const INTERNAL_ERROR = -32603

    // Reads the administrator-controlled global MCP switch. The seed default is
    // 'true'; an absent property also means enabled (default 有効).
    export async function isMcpGloballyEnabled(client: ClientBase): Promise<boolean> {
        const property = await SystemPropertyDao.findByKey(client, 'mcp.enabled')
        return property === undefined || property.value !== 'false'
    }

    export type McpCredentials = {
        authorization: string
        account: string
        key: string
    }

    // Authenticates an MCP request with an editor account and its MCP key
    // (x-mcp-account / x-mcp-key headers, or Authorization: Bearer account:key).
    // Missing credentials yield an unauthenticated access (get_started only).
    // Wrong credentials raise AuthenticationException (401); a disabled global
    // switch or a per-account MCP disable raises ForbiddenException (403).
    export async function checkMcpAccess(client: ClientBase, credentials: McpCredentials): Promise<McpAccess> {
        if (!await isMcpGloballyEnabled(client)) {
            throw new ForbiddenException()
        }

        let account = credentials.account
        let key = credentials.key
        const prefix = 'Bearer '
        if (account === '' && key === '' && credentials.authorization.startsWith(prefix)) {
            const token = credentials.authorization.substring(prefix.length)
            const separator = token.indexOf(':')
            if (separator === -1) {
                throw new AuthenticationException()
            }
            account = token.substring(0, separator)
            key = token.substring(separator + 1)
        }
        if (account === '' && key === '') {
            return { user: null, workspaceAccess: null }
        }

        const user = await UserAccountDao.getByUserId(client, account)
        // Always run a constant-time comparison, even for an unknown account, so
        // response timing never reveals whether a login id exists.
        const referenceKey = user !== undefined ? user.mcpKey : DUMMY_MCP_KEY
        const keyMatches = key !== '' && secretEquals(referenceKey, key)
        if (user === undefined || !keyMatches) {
            throw new AuthenticationException()
        }
        if (!user.mcpEnabled) {
            throw new ForbiddenException()
        }
        const workspaceAccess = await WorkspaceAccessLogic.loadAccess(client, user)
        return { user, workspaceAccess }
    }

    export function gettingStartedText(): string {
        return GETTING_STARTED_TEXT
    }

    export function buildErrorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
        return { jsonrpc: '2.0', id, error: { code, message } }
    }

    // Extracts the request id for error reporting on messages that failed before dispatch.
    export function extractRequestId(message: unknown): string | number | null {
        if (isRecord(message) && (typeof message.id === 'string' || typeof message.id === 'number')) {
            return message.id
        }
        return null
    }

    // Processes a single JSON-RPC message. Returns null for notifications, which
    // the transport acknowledges with HTTP 202 and an empty body.
    export async function handleMessage(message: unknown, context: McpContext): Promise<JsonRpcResponse | null> {
        if (Array.isArray(message)) {
            return buildErrorResponse(null, INVALID_REQUEST, 'Batch requests are not supported')
        }
        if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
            return buildErrorResponse(extractRequestId(message), INVALID_REQUEST, 'Invalid Request')
        }
        if (!('id' in message)) {
            // Notification (e.g. notifications/initialized): no response body.
            return null
        }
        const id = message.id
        if (typeof id !== 'string' && typeof id !== 'number') {
            return buildErrorResponse(null, INVALID_REQUEST, 'Invalid Request: id must be a string or a number')
        }
        const params = isRecord(message.params) ? message.params : {}
        switch (message.method) {
            case 'initialize':
                return buildResultResponse(id, buildInitializeResult(params))
            case 'ping':
                return buildResultResponse(id, {})
            case 'tools/list':
                return buildResultResponse(id, { tools: TOOLS })
            case 'tools/call':
                return await handleToolsCall(id, params, context)
            default:
                return buildErrorResponse(id, METHOD_NOT_FOUND, 'Method not found: ' + message.method)
        }
    }

    // Validates an editor template object. Returns validation error messages;
    // an empty array means the template is valid.
    export function validateTemplateObject(template: Record<string, unknown>): string[] {
        if (!Array.isArray(template.bands)) {
            return ['テンプレートに bands 配列がありません。エディタテンプレート形式のJSONを指定してください。']
        }
        const errors = TemplateValidationLogic.validateTemplateExpressions(template)
        try {
            convertEditorTemplateToCore(normalizeTemplate(template as unknown as EditorTemplate))
        } catch (e) {
            errors.push('テンプレート変換エラー: ' + toErrorText(e))
        }
        return errors
    }

}

function buildResultResponse(id: string | number, result: Record<string, unknown>): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result }
}

function buildInitializeResult(params: Record<string, unknown>): Record<string, unknown> {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
    return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS
    }
}

async function handleToolsCall(
    id: string | number,
    params: Record<string, unknown>,
    context: McpContext
): Promise<JsonRpcResponse> {
    const name = params.name
    if (typeof name !== 'string' || name === '') {
        return McpLogic.buildErrorResponse(id, McpLogic.INVALID_PARAMS, 'Tool name is required')
    }
    if (!isKnownTool(name)) {
        return McpLogic.buildErrorResponse(id, McpLogic.INVALID_PARAMS, 'Unknown tool: ' + name)
    }
    if (context.access.user === null && name !== 'get_started') {
        // Unauthenticated: answer with the setup procedure instead of a bare
        // failure so the calling model knows to ask the operator for credentials.
        return buildResultResponse(id, {
            content: [{
                type: 'text',
                text: '認証されていません。x-mcp-account / x-mcp-key ヘッダーにアカウントIDとMCP認証キーを指定してください。'
                    + '値が不明な場合は get_started を読み、利用者（人間のオペレーター）に確認してください。'
            }],
            isError: true
        })
    }
    const args = isRecord(params.arguments) ? params.arguments : {}
    let result: ToolResult
    try {
        result = await callTool(name, args, context)
    } catch (e) {
        // Tool execution failures are reported inside the tool result (isError)
        // so the calling model can observe and correct them, per the MCP spec.
        console.log(e)
        result = { content: [{ type: 'text', text: toErrorText(e) }], isError: true }
    }
    return buildResultResponse(id, result)
}

function isKnownTool(name: string): boolean {
    for (let i = 0; i < TOOLS.length; i++) {
        if (TOOLS[i].name === name) {
            return true
        }
    }
    return false
}

async function callTool(name: string, args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    switch (name) {
        case 'get_started':
            return { content: [{ type: 'text', text: GETTING_STARTED_TEXT }] }
        case 'list_workspaces':
            return await listWorkspaces(context)
        case 'list_templates':
            return await listTemplates(args, context)
        case 'get_template':
            return await getTemplate(args, context)
        case 'save_template':
            return await saveTemplate(args, context)
        case 'update_template_elements':
            return await updateTemplateElements(args, context)
        case 'validate_template':
            return validateTemplate(args)
        case 'get_template_schema':
            return getTemplateSchema()
        case 'list_workspace_files':
            return await listWorkspaceFiles(args, context)
        case 'save_workspace_file':
            return await saveWorkspaceFile(args, context)
        case 'delete_workspace_file':
            return await deleteWorkspaceFile(args, context)
        case 'move_workspace_file':
            return await moveWorkspaceFile(args, context)
        case 'list_fonts':
            return listFonts(context)
        case 'layout_report':
            return await layoutReport(args, context)
        case 'render_report':
            return await renderReport(args, context)
        case 'import_pdf':
            return await importPdf(args, context)
        case 'compare_reports':
            return await compareReports(args, context)
        default:
            throw new BusinessException('Unknown tool: ' + name)
    }
}

// ============================================================================
// Tool implementations. File system behavior mirrors the workspace API routes
// (/api/workspace and /api/workspace/[name]/...): same path validation, same
// listing rules, same JSON serialization as the editor save action.
// ============================================================================

// The workspaces the account can address: its own, plus every folder shared
// with it (each addressed by the owner's workspaceKey and the shared path).
function listWorkspaces(context: McpContext): ToolResult {
    const access = requireAccess(context)
    const own = { workspace: access.ownWorkspaceKey, kind: 'own', path: '', canRead: true, canWrite: true }
    const shared = []
    for (let i = 0; i < access.shares.length; i++) {
        const share = access.shares[i]
        shared.push({ workspace: share.ownerWorkspaceKey, kind: 'shared', path: share.path, canRead: share.canRead, canWrite: share.canWrite })
    }
    return textResult({ workspaces: [own].concat(shared) })
}

async function listTemplates(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const wsRoot = resolveWorkspaceRoot(context, workspace)
    if (!WorkspaceAccessLogic.mayTraverse(access, workspace, '')) {
        throw new ForbiddenException()
    }
    const collected: TemplateFileInfo[] = []
    await collectTemplateFiles(wsRoot, '', access, workspace, collected)
    collected.sort(function (a, b) { return a.path.localeCompare(b.path) })
    return textResult({ templates: collected })
}

// Recursively collects readable *.report files. Descends only into directories
// that may contain readable content (own workspace: everything; shared: the
// shared subtree and the ancestors leading to it).
async function collectTemplateFiles(dir: string, prefix: string, access: WorkspaceAccess, workspace: string, result: TemplateFileInfo[]): Promise<void> {
    let items: string[]
    try {
        items = await readdir(dir)
    } catch {
        return
    }
    for (let i = 0; i < items.length; i++) {
        const name = items[i]
        const fullPath = join(dir, name)
        const s = await stat(fullPath).catch(() => null)
        if (s === null) continue
        const relativePath = prefix === '' ? name : prefix + '/' + name
        if (s.isDirectory()) {
            if (!WorkspaceAccessLogic.mayTraverse(access, workspace, relativePath)) continue
            await collectTemplateFiles(fullPath, relativePath, access, workspace, result)
        } else if (name.endsWith('.report')) {
            if (!WorkspaceAccessLogic.isReadable(access, workspace, relativePath)) continue
            result.push({ path: relativePath, name })
        }
    }
}

async function getTemplate(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const path = stringArg(args, 'path')
    WorkspaceAccessLogic.checkRead(access, workspace, path)
    const filePath = resolveWorkspaceFilePath(context, workspace, path)
    const s = await stat(filePath).catch(() => null)
    if (s === null || !s.isFile()) {
        throw new BusinessException('対象が見つかりません')
    }
    const text = await readFile(filePath, 'utf-8')
    const summary = args.summary === true
    const elementIds = Array.isArray(args.elementIds) ? (args.elementIds as unknown[]).map(String) : null
    if (!summary && elementIds === null) {
        return { content: [{ type: 'text', text }] }
    }
    const template = JSON.parse(text) as Record<string, unknown>
    if (elementIds !== null) {
        const found: Record<string, unknown>[] = []
        const missing: string[] = []
        for (const id of elementIds) {
            const hit = findElementById(template, id)
            if (hit === null) missing.push(id)
            else found.push(hit)
        }
        return textResult({ elements: found, missing })
    }
    return textResult(buildTemplateSummary(template))
}

// Recursively finds an element by id across every band and container child.
function findElementById(template: Record<string, unknown>, id: string): Record<string, unknown> | null {
    const bands = Array.isArray(template.bands) ? template.bands as Record<string, unknown>[] : []
    for (const band of bands) {
        const hit = findInElements(band.elements, id)
        if (hit !== null) return hit
    }
    return null
}

function findInElements(elements: unknown, id: string): Record<string, unknown> | null {
    if (!Array.isArray(elements)) return null
    for (const el of elements as Record<string, unknown>[]) {
        if (el.id === id) return el
        const hit = findInElements(el.children, id)
        if (hit !== null) return hit
    }
    return null
}

/**
 * Structural map of a template without the full content: enough for an AI to
 * locate elements by id, then read/patch just those (get_template elementIds /
 * update_template_elements) instead of round-tripping the whole JSON.
 */
function buildTemplateSummary(template: Record<string, unknown>): Record<string, unknown> {
    const page = (template.pageSettings ?? {}) as Record<string, unknown>
    const bands = Array.isArray(template.bands) ? template.bands as Record<string, unknown>[] : []
    return {
        name: template.name,
        pageSettings: {
            size: page.size, width: page.width, height: page.height, orientation: page.orientation,
            marginTop: page.marginTop, marginBottom: page.marginBottom,
            marginLeft: page.marginLeft, marginRight: page.marginRight,
            columnCount: page.columnCount,
        },
        groupCount: Array.isArray(template.groups) ? (template.groups as unknown[]).length : 0,
        testDataPath: template.testDataPath,
        bands: bands.map(function (band) {
            return {
                id: band.id,
                type: band.type,
                height: band.height,
                enabled: band.enabled,
                elements: summarizeElements(band.elements),
            }
        }),
    }
}

function summarizeElements(elements: unknown): Record<string, unknown>[] {
    if (!Array.isArray(elements)) return []
    return (elements as Record<string, unknown>[]).map(function (el) {
        const item: Record<string, unknown> = {
            id: el.id, kind: el.kind,
            x: el.x, y: el.y, width: el.width, height: el.height,
        }
        if (typeof el.text === 'string' && el.text !== '') item.text = truncateForSummary(el.text)
        if (typeof el.expression === 'string' && el.expression !== '') item.expression = truncateForSummary(el.expression)
        const children = summarizeElements(el.children)
        if (children.length > 0) item.children = children
        return item
    })
}

function truncateForSummary(value: string): string {
    return value.length <= 40 ? value : value.slice(0, 40) + '…'
}

async function saveTemplate(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const workspace = stringArg(args, 'workspace')
    const path = stringArg(args, 'path')
    if (!path.endsWith('.report')) {
        throw new BusinessException('テンプレートの保存パスは.reportで終わる必要があります。')
    }
    const template = recordArg(args, 'template')
    const errors = McpLogic.validateTemplateObject(template)
    if (errors.length > 0) {
        throw new BusinessException('テンプレート検証エラーのため保存しませんでした:\n' + errors.join('\n'))
    }
    WorkspaceAccessLogic.checkWrite(requireAccess(context), workspace, path)
    const filePath = resolveWorkspaceFilePath(context, workspace, path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, stringifyTemplateJson(template, 2))
    if (context.onFileEvent) {
        await context.onFileEvent(workspace, path, 'save', false)
    }
    return textResult({ saved: path })
}

/**
 * Partial edit of a saved template: replaces/removes/adds elements by id and
 * patches band height/enabled without round-tripping the full JSON through
 * the client. The patched result is validated exactly like save_template.
 */
async function updateTemplateElements(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const path = stringArg(args, 'path')
    WorkspaceAccessLogic.checkWrite(access, workspace, path)
    const filePath = resolveWorkspaceFilePath(context, workspace, path)
    const st = await stat(filePath).catch(() => null)
    if (st === null || !st.isFile()) {
        throw new BusinessException('対象が見つかりません')
    }
    const template = parseTemplateJson(await readFile(filePath, 'utf-8')) as Record<string, unknown>
    const bands = Array.isArray(template.bands) ? template.bands as Record<string, unknown>[] : []

    let replaced = 0
    let removed = 0
    let added = 0
    let bandsPatched = 0

    if (args.set !== undefined) {
        if (!Array.isArray(args.set)) throw new BusinessException('set は要素オブジェクトの配列で指定してください。')
        for (const el of args.set as Record<string, unknown>[]) {
            if (typeof el.id !== 'string' || el.id === '') throw new BusinessException('set の各要素には id が必要です。')
            if (!replaceElementById(bands, el.id, el)) {
                throw new BusinessException(`set: 要素 ${el.id} が見つかりません。get_template の summary で id を確認してください。`)
            }
            replaced++
        }
    }
    if (args.remove !== undefined) {
        if (!Array.isArray(args.remove)) throw new BusinessException('remove は要素idの配列で指定してください。')
        for (const idValue of args.remove as unknown[]) {
            const id = String(idValue)
            if (!removeElementById(bands, id)) {
                throw new BusinessException(`remove: 要素 ${id} が見つかりません。`)
            }
            removed++
        }
    }
    if (args.add !== undefined) {
        if (!Array.isArray(args.add)) throw new BusinessException('add は { bandId, parentId?, elements } の配列で指定してください。')
        for (const entry of args.add as Record<string, unknown>[]) {
            const bandId = typeof entry.bandId === 'string' ? entry.bandId : ''
            const elements = Array.isArray(entry.elements) ? entry.elements as Record<string, unknown>[] : null
            if (bandId === '' || elements === null) throw new BusinessException('add の各エントリには bandId と elements が必要です。')
            const band = bands.find(function (b) { return b.id === bandId })
            if (band === undefined) throw new BusinessException(`add: バンド ${bandId} が見つかりません。`)
            if (!Array.isArray(band.elements)) band.elements = []
            let target = band.elements as Record<string, unknown>[]
            if (typeof entry.parentId === 'string' && entry.parentId !== '') {
                const parent = findInElements(band.elements, entry.parentId)
                if (parent === null) throw new BusinessException(`add: 親要素 ${entry.parentId} が見つかりません。`)
                if (!Array.isArray(parent.children)) parent.children = []
                target = parent.children as Record<string, unknown>[]
            }
            for (const el of elements) {
                if (typeof el.id !== 'string' || el.id === '') throw new BusinessException('add する各要素には一意な id が必要です。')
                if (findElementById(template, el.id) !== null) {
                    throw new BusinessException(`add: 要素id ${el.id} は既に存在します。別のidを使用してください。`)
                }
                target.push(el)
                added++
            }
        }
    }
    if (args.setBands !== undefined) {
        if (!Array.isArray(args.setBands)) throw new BusinessException('setBands は { id, height?, enabled? } の配列で指定してください。')
        for (const patch of args.setBands as Record<string, unknown>[]) {
            const band = bands.find(function (b) { return b.id === patch.id })
            if (band === undefined) throw new BusinessException(`setBands: バンド ${String(patch.id)} が見つかりません。`)
            if (patch.height !== undefined) {
                if (typeof patch.height !== 'number' || patch.height < 0) throw new BusinessException('setBands: height は0以上の数値で指定してください。')
                band.height = patch.height
            }
            if (patch.enabled !== undefined) {
                if (typeof patch.enabled !== 'boolean') throw new BusinessException('setBands: enabled は boolean で指定してください。')
                band.enabled = patch.enabled
            }
            bandsPatched++
        }
    }
    if (replaced + removed + added + bandsPatched === 0) {
        throw new BusinessException('set / remove / add / setBands のいずれかを指定してください。')
    }

    const errors = McpLogic.validateTemplateObject(template)
    if (errors.length > 0) {
        throw new BusinessException('パッチ適用後のテンプレートが検証エラーのため保存しませんでした:\n' + errors.join('\n'))
    }
    await writeFile(filePath, stringifyTemplateJson(template, 2))
    if (context.onFileEvent) {
        await context.onFileEvent(workspace, path, 'save', false)
    }
    return textResult({ saved: path, replaced, removed, added, bandsPatched })
}

function replaceElementById(bands: Record<string, unknown>[], id: string, replacement: Record<string, unknown>): boolean {
    for (const band of bands) {
        if (replaceInElements(band.elements, id, replacement)) return true
    }
    return false
}

function replaceInElements(elements: unknown, id: string, replacement: Record<string, unknown>): boolean {
    if (!Array.isArray(elements)) return false
    const list = elements as Record<string, unknown>[]
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) {
            list[i] = replacement
            return true
        }
        if (replaceInElements(list[i].children, id, replacement)) return true
    }
    return false
}

function removeElementById(bands: Record<string, unknown>[], id: string): boolean {
    for (const band of bands) {
        if (removeFromElements(band, 'elements', id)) return true
    }
    return false
}

function removeFromElements(container: Record<string, unknown>, key: string, id: string): boolean {
    const elements = container[key]
    if (!Array.isArray(elements)) return false
    const list = elements as Record<string, unknown>[]
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) {
            list.splice(i, 1)
            return true
        }
        if (removeFromElements(list[i], 'children', id)) return true
    }
    return false
}

function validateTemplate(args: Record<string, unknown>): ToolResult {
    const template = recordArg(args, 'template')
    const errors = McpLogic.validateTemplateObject(template)
    return textResult({ valid: errors.length === 0, errors })
}

function getTemplateSchema(): ToolResult {
    return textResult(TEMPLATE_SCHEMA)
}

type WorkspaceFileInfo = {
    path: string
    size: number
}

async function listWorkspaceFiles(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const wsRoot = resolveWorkspaceRoot(context, workspace)
    if (!WorkspaceAccessLogic.mayTraverse(access, workspace, '')) {
        throw new ForbiddenException()
    }
    const collected: WorkspaceFileInfo[] = []
    await collectWorkspaceFiles(wsRoot, '', access, workspace, collected)
    collected.sort(function (a, b) { return a.path.localeCompare(b.path) })
    return textResult({ files: collected })
}

async function collectWorkspaceFiles(dir: string, prefix: string, access: WorkspaceAccess, workspace: string, result: WorkspaceFileInfo[]): Promise<void> {
    let items: string[]
    try {
        items = await readdir(dir)
    } catch {
        return
    }
    for (let i = 0; i < items.length; i++) {
        const name = items[i]
        const fullPath = join(dir, name)
        const s = await stat(fullPath).catch(() => null)
        if (s === null) continue
        const relativePath = prefix === '' ? name : prefix + '/' + name
        if (s.isDirectory()) {
            if (!WorkspaceAccessLogic.mayTraverse(access, workspace, relativePath)) continue
            await collectWorkspaceFiles(fullPath, relativePath, access, workspace, result)
        } else {
            if (!WorkspaceAccessLogic.isReadable(access, workspace, relativePath)) continue
            result.push({ path: relativePath, size: s.size })
        }
    }
}

async function saveWorkspaceFile(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const workspace = stringArg(args, 'workspace')
    const path = stringArg(args, 'path')
    if (path.endsWith('.report')) {
        throw new BusinessException('テンプレート（.report）は save_template で保存してください（バリデーションが行われます）。')
    }
    const contentBase64 = optionalStringArg(args, 'contentBase64')
    const contentText = optionalStringArg(args, 'content')
    if (contentBase64 === '' && contentText === '') {
        throw new BusinessException('contentBase64 または content を指定してください。')
    }
    if (contentBase64 !== '' && contentText !== '') {
        throw new BusinessException('contentBase64 と content は同時に指定できません。')
    }
    WorkspaceAccessLogic.checkWrite(requireAccess(context), workspace, path)
    const filePath = resolveWorkspaceFilePath(context, workspace, path)
    await mkdir(dirname(filePath), { recursive: true })
    if (contentBase64 !== '') {
        await writeFile(filePath, Buffer.from(contentBase64, 'base64'))
    } else {
        await writeFile(filePath, contentText)
    }
    const s = await stat(filePath)
    if (context.onFileEvent) {
        await context.onFileEvent(workspace, path, 'save', false)
    }
    return textResult({ saved: path, size: s.size })
}

async function deleteWorkspaceFile(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const workspace = stringArg(args, 'workspace')
    const path = stringArg(args, 'path')
    WorkspaceAccessLogic.checkWrite(requireAccess(context), workspace, path)
    // Delete must target a concrete entry, never the workspace root (a path that
    // normalizes to '' would otherwise remove the whole workspace).
    const filePath = WorkspacePaths.resolveEntryInside(workspace, path)
    const s = await stat(filePath).catch(() => null)
    if (s === null) {
        throw new BusinessException('対象が見つかりません')
    }
    // Drop the owner's folder shares (and broadcast the event) BEFORE removing the
    // directory: the share follow is a committed DB write, so if it fails nothing
    // is deleted, and if the rm then fails the shares are already gone rather than
    // left to re-attach to a later same-named folder.
    if (context.onFileEvent) {
        await context.onFileEvent(workspace, path, 'delete', s.isDirectory())
    }
    await rm(filePath, { recursive: s.isDirectory() })
    return textResult({ deleted: path })
}

async function moveWorkspaceFile(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const workspace = stringArg(args, 'workspace')
    const fromPath = stringArg(args, 'fromPath')
    const toPath = stringArg(args, 'toPath')
    const access = requireAccess(context)
    WorkspaceAccessLogic.checkWrite(access, workspace, fromPath)
    WorkspaceAccessLogic.checkWrite(access, workspace, toPath)
    const fromFile = WorkspacePaths.resolveEntryInside(workspace, fromPath)
    const toFile = WorkspacePaths.resolveEntryInside(workspace, toPath)
    const source = await stat(fromFile)
    await mkdir(dirname(toFile), { recursive: true })
    const destinationEntries = await readdir(dirname(toFile))
    if (destinationEntries.includes(basename(toFile))) {
        throw new BusinessException('移動先には既にファイルまたはディレクトリが存在します')
    }
    await rename(fromFile, toFile)
    if (context.onFileMove) {
        await context.onFileMove(workspace, fromPath, toPath, source.isDirectory())
    }
    return textResult({ moved: { from: fromPath, to: toPath }, isDirectory: source.isDirectory() })
}

// Resolves the template JSON for layout/render: inline object if given,
// otherwise the saved template file at templatePath.
async function resolveTemplateJson(
    args: Record<string, unknown>,
    context: McpContext,
    workspace: string,
    templatePath: string
): Promise<string> {
    const inline = args.template
    if (inline !== undefined) {
        if (!isRecord(inline)) {
            throw new BusinessException('引数 template にはオブジェクトを指定してください。')
        }
        return JSON.stringify(inline)
    }
    if (templatePath === '') {
        throw new BusinessException('template または templatePath を指定してください。')
    }
    const filePath = resolveWorkspaceFilePath(context, workspace, templatePath)
    const s = await stat(filePath).catch(() => null)
    if (s === null || !s.isFile()) {
        throw new BusinessException('対象が見つかりません')
    }
    return await readFile(filePath, 'utf-8')
}

async function publishInlineDrafts(
    args: Record<string, unknown>,
    context: McpContext,
    workspace: string,
    templatePath: string,
    templateJson: string,
    dataSource: Record<string, unknown>
): Promise<void> {
    if (args.template === undefined || templatePath === '' || context.onDraftEvent === undefined) return
    await context.onDraftEvent(workspace, templatePath, 'report', templateJson)
    const template = parseTemplateJson(templateJson) as Record<string, unknown>
    if (typeof template.testDataPath === 'string' && template.testDataPath !== '') {
        await context.onDraftEvent(workspace, template.testDataPath, 'json', JSON.stringify(dataSource, null, 2))
    }
}

// The account's usable fonts. Reserved internal drawing fonts
// are reported only as the fallback/math ids, not as selectable fonts, so the
// AI never picks a font the account does not actually have.
function listFonts(context: McpContext): ToolResult {
    const fonts = listAccountFontIds(accountFontDir(context))
    return textResult({
        fonts,
        note: fonts.length === 0
            ? 'このアカウントには利用可能なフォントがまだありません。エディタのフォント管理から Google フォント等を追加してください。追加するまでは fallbackFont のみで描画されます。'
            : 'style.fontFamily には上記 fonts のいずれかを指定してください。ここに無いフォントは描画時に fallbackFont へ置き換わります。',
        fallbackFont: DEFAULT_FONT_ID,
        mathFont: MATH_FONT_ID
    })
}

// Font directory of the MCP-authenticated account.
const IMPORT_REGION_BAND_TYPES = new Set<string>(['title', 'pageHeader', 'columnHeader', 'detail', 'columnFooter', 'pageFooter', 'summary'])

// Converts a PDF page into editor template content using the exact pipeline
// of the editor's PDF import dialog (converter, font matching, text fitting,
// band splitting), so an AI client reproduces a design original with the
// same fidelity a human gets in the editor.
async function importPdf(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const pdfPath = stringArg(args, 'pdfPath')
    const templatePath = stringArg(args, 'templatePath')
    if (pdfPath.startsWith('/') || pdfPath.includes('..') || templatePath.startsWith('/') || templatePath.includes('..')) {
        throw new BusinessException('パスが不正です')
    }
    if (!templatePath.endsWith('.report')) {
        throw new BusinessException('templatePath は ".report" で終わる必要があります')
    }
    WorkspaceAccessLogic.checkRead(access, workspace, pdfPath)
    const pageValue = args.page
    if (pageValue !== undefined && (typeof pageValue !== 'number' || !Number.isInteger(pageValue) || pageValue < 0)) {
        throw new BusinessException('page は 0 以上の整数で指定してください')
    }
    const pageIndex = pageValue === undefined ? 0 : pageValue
    const pdfBytes = await readFile(resolveWorkspaceFilePath(context, workspace, pdfPath))
    const importer = PdfImporter.open(new Uint8Array(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength))
    if (pageIndex >= importer.pageCount) {
        throw new BusinessException('page が範囲外です（0〜' + (importer.pageCount - 1) + '）')
    }
    const imported = importer.importPage(pageIndex)

    // Match the PDF fonts against the account fonts (same matcher as the editor)
    const fontDir = accountFontDir(context)
    const candidates = listAccountFontIds(fontDir).map(function (name) { return { name } })
    const assignments: PdfFontAssignments = {}
    const fonts = imported.fonts.map(function (info) {
        const match = matchFontName(info, candidates, DEFAULT_FONT_ID)
        assignments[info.familyName] = match.fontName
        assignments[info.baseFont] = match.fontName
        return { pdfFont: info.familyName, baseFont: info.baseFont, assigned: match.fontName, score: round2(match.score), warning: match.warning }
    })

    const conversion = convertImportedPageToEditorElements(imported, 1, assignments)

    // Substituted fonts can be wider than the PDF metrics; grow the text
    // boxes with the real metrics of the assigned fonts (editor parity)
    const fontMap: FontMap = new Map()
    ensureFont(fontMap, DEFAULT_FONT_ID, fontDir)
    for (let i = 0; i < fonts.length; i++) ensureFont(fontMap, fonts[i].assigned, fontDir)
    const fallbackMeasurer = fontMap.get(DEFAULT_FONT_ID)
    if (fallbackMeasurer === undefined) {
        throw new BusinessException('既定フォントが読み込めません')
    }
    fitTextElementsToAssignedFonts(conversion.elements, function (fontFamily, text, fontSize) {
        const measurer = fontMap.get(fontFamily) ?? fallbackMeasurer
        return measurer.measure(text, fontSize).width
    })

    // Save the extracted raster images next to the destination template and
    // rewrite the element sources to template-relative paths
    const imageKeys = Object.keys(imported.images)
    const savedImages: string[] = []
    let elements = conversion.elements
    if (imageKeys.length > 0) {
        const slash = templatePath.lastIndexOf('/')
        const templateDir = slash === -1 ? '' : templatePath.substring(0, slash)
        const reportName = templatePath.substring(slash + 1).replace(/\.report$/, '')
        const relativeDir = reportName + '_assets/pdf_' + importTimestamp(new Date())
        const sourceMap = new Map<string, string>()
        for (let i = 0; i < imageKeys.length; i++) {
            const key = imageKeys[i]
            const lower = key.toLowerCase()
            const extension = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'jpg' : 'png'
            const fileName = 'img_' + i + '.' + extension
            const workspaceRelative = (templateDir !== '' ? templateDir + '/' : '') + relativeDir + '/' + fileName
            WorkspaceAccessLogic.checkWrite(access, workspace, workspaceRelative)
            const absolute = resolveWorkspaceFilePath(context, workspace, workspaceRelative)
            await mkdir(dirname(absolute), { recursive: true })
            await writeFile(absolute, Buffer.from(imported.images[key]))
            if (context.onFileEvent) {
                await context.onFileEvent(workspace, workspaceRelative, 'save', false)
            }
            sourceMap.set(key, (templateDir !== '' ? './' : '') + relativeDir + '/' + fileName)
            savedImages.push(workspaceRelative)
        }
        elements = rewriteImportedImageSources(elements, sourceMap)
    }

    const pageSettings = createPdfImportPageSettings(imported.width, imported.height)
    const result: Record<string, unknown> = {
        pageCount: importer.pageCount,
        page: pageIndex,
        pageSettings,
        fonts,
        images: savedImages,
        nextElementIdCounter: conversion.nextElementIdCounter,
    }
    const bandRegionsValue = args.bandRegions
    if (bandRegionsValue !== undefined) {
        result.bands = splitImportedElements(elements, bandRegionsValue)
    } else {
        result.elements = elements
    }
    return textResult(result)
}

// Validates the bandRegions argument and splits the imported elements with
// the editor's area-score band assignment (band heights fitted to content).
function splitImportedElements(elements: TemplateElement[], bandRegionsValue: unknown): { type: BandType, height: number, elements: TemplateElement[] }[] {
    if (!Array.isArray(bandRegionsValue) || bandRegionsValue.length === 0) {
        throw new BusinessException('bandRegions は 1 件以上の配列で指定してください')
    }
    const regions: PdfImportBandRegion[] = []
    let top = 0
    for (let i = 0; i < bandRegionsValue.length; i++) {
        const entry = bandRegionsValue[i] as Record<string, unknown>
        if (!isRecord(entry) || typeof entry.type !== 'string' || !IMPORT_REGION_BAND_TYPES.has(entry.type)
            || typeof entry.height !== 'number' || !(entry.height > 0)) {
            throw new BusinessException('bandRegions の要素は { type: バンド種別, height: 正の数 } で指定してください')
        }
        regions.push({ type: entry.type as BandType, top, height: entry.height })
        top += entry.height
    }
    return splitElementsIntoBandRegions(elements, regions).map(function (content) {
        return { type: content.type, height: content.height, elements: content.elements }
    })
}

function rewriteImportedImageSources(elements: TemplateElement[], sourceMap: Map<string, string>): TemplateElement[] {
    return elements.map(function (element) {
        const nextSource = element.kind === 'image' ? sourceMap.get(element.source) : undefined
        const children = element.children.length > 0 ? rewriteImportedImageSources(element.children, sourceMap) : element.children
        if (nextSource !== undefined) return { ...element, source: nextSource, children }
        if (children !== element.children) return { ...element, children }
        return element
    })
}

function importTimestamp(date: Date): string {
    const pad = function (value: number): string { return value < 10 ? '0' + value : String(value) }
    return '' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
}

function accountFontDir(context: McpContext): string {
    if (context.access.user === null || context.access.user.id === undefined) {
        throw new BusinessException('アカウントが解決できません。')
    }
    return fontDirForAccount(context.access.user.id)
}

type LayoutItem = {
    type: string
    x: number
    y: number
    width?: number
    height?: number
    text?: string
    fontId?: string
    fontSize?: number
    imageId?: string
}

async function layoutReport(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const templatePath = optionalStringArg(args, 'templatePath')
    if (templatePath.startsWith('/') || templatePath.includes('..')) {
        throw new BusinessException('パスが不正です')
    }
    // The template (and, for a shared workspace, its referenced assets under the
    // shared subtree) must be readable by the account.
    WorkspaceAccessLogic.checkRead(access, workspace, templatePath)
    const templateJson = await resolveTemplateJson(args, context, workspace, templatePath)
    const dataSource = recordArg(args, 'dataSource')
    const wsRoot = resolveWorkspaceRoot(context, workspace)
    const { doc } = ReportBatchLogic.renderTemplateToDocument(
        wsRoot,
        templatePath,
        templateJson,
        JSON.stringify(dataSource),
        accountFontDir(context),
        WorkspaceAccessLogic.assetAuthorizer(access, workspace)
    )
    const pageIndex = typeof args.pageIndex === 'number' ? args.pageIndex : null
    if (pageIndex !== null && (pageIndex < 0 || pageIndex >= doc.pages.length)) {
        throw new BusinessException(`pageIndex が範囲外です（0〜${doc.pages.length - 1}）。`)
    }
    const bbox = parseBboxArg(args.bbox)
    const pages = doc.pages.map(function (page, index) {
        if (pageIndex !== null && index !== pageIndex) return null
        let items: LayoutItem[] = []
        collectLayoutItems(page.children, 0, 0, items)
        if (bbox !== null) {
            items = items.filter(function (item) {
                const w = item.width ?? 0
                const h = item.height ?? 0
                return item.x < bbox.x + bbox.width && item.x + w > bbox.x
                    && item.y < bbox.y + bbox.height && item.y + h > bbox.y
            })
        }
        return { pageIndex: index, width: round2(page.width), height: round2(page.height), items }
    }).filter(function (page) { return page !== null })
    await publishInlineDrafts(args, context, workspace, templatePath, templateJson, dataSource)
    return textResult({
        pageCount: doc.pages.length,
        warnings: collectTemplateGeometryWarnings(parseTemplateJson(templateJson) as Record<string, unknown>),
        pages
    })
}

// Flattens the render tree into absolutely positioned items (pt).
function collectLayoutItems(nodes: RenderNode[], offsetX: number, offsetY: number, result: LayoutItem[]): void {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        switch (node.type) {
            case 'group':
                collectLayoutItems(node.children, offsetX + node.x, offsetY + node.y, result)
                break
            case 'text':
                result.push({
                    type: 'text',
                    x: round2(offsetX + node.x), y: round2(offsetY + node.y),
                    width: node.width !== undefined ? round2(node.width) : undefined,
                    height: round2(node.fontSize),
                    text: node.text, fontId: node.fontId, fontSize: node.fontSize
                })
                break
            case 'line':
                result.push({
                    type: 'line',
                    x: round2(offsetX + node.x1), y: round2(offsetY + node.y1),
                    width: round2(node.x2 - node.x1), height: round2(node.y2 - node.y1)
                })
                break
            case 'rect':
                result.push({ type: 'rect', x: round2(offsetX + node.x), y: round2(offsetY + node.y), width: round2(node.width), height: round2(node.height) })
                break
            case 'ellipse':
                result.push({ type: 'ellipse', x: round2(offsetX + node.cx - node.rx), y: round2(offsetY + node.cy - node.ry), width: round2(node.rx * 2), height: round2(node.ry * 2) })
                break
            case 'image':
                result.push({ type: 'image', x: round2(offsetX + node.x), y: round2(offsetY + node.y), width: round2(node.width), height: round2(node.height), imageId: node.imageId })
                break
            case 'path':
                break
            case 'svg':
                result.push({ type: 'svg', x: round2(offsetX + node.x), y: round2(offsetY + node.y), width: round2(node.width), height: round2(node.height) })
                break
        }
    }
}

// Static geometry checks on the editor template: elements that leave the band
// or the page content area are almost always authoring mistakes.
function collectTemplateGeometryWarnings(template: Record<string, unknown>): string[] {
    const warnings: string[] = []
    const normalized = normalizeTemplate(template as unknown as EditorTemplate)
    const page = normalized.pageSettings
    const contentWidth = page.columnCount > 1 ? page.columnWidth : page.width - page.marginLeft - page.marginRight
    for (let bi = 0; bi < normalized.bands.length; bi++) {
        const band = normalized.bands[bi]
        for (let ei = 0; ei < band.elements.length; ei++) {
            const el = band.elements[ei]
            const label = 'band ' + band.id + ' (' + band.type + ') element ' + el.id + ' (' + el.kind + ')'
            if (el.x < 0 || el.y < 0) {
                warnings.push(label + ': negative position (x=' + el.x + ', y=' + el.y + ')')
            }
            if (el.x + el.width > contentWidth + 0.01) {
                warnings.push(label + ': exceeds the content width (x+width=' + round2(el.x + el.width) + ' > ' + round2(contentWidth) + ')')
            }
            if (el.y + el.height > band.height + 0.01 && el.kind !== 'break') {
                warnings.push(label + ': exceeds the band height (y+height=' + round2(el.y + el.height) + ' > ' + band.height + ')')
            }
        }
    }
    return warnings
}

function round2(value: number): number {
    return Math.round(value * 100) / 100
}

/** Parses an { x, y, width, height } filter/crop rectangle argument (pt). */
function parseBboxArg(value: unknown): { x: number, y: number, width: number, height: number } | null {
    if (value === undefined || value === null) return null
    const rect = value as Record<string, unknown>
    const x = rect.x
    const y = rect.y
    const width = rect.width
    const height = rect.height
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
        throw new BusinessException('矩形は { x, y, width, height }（pt、width/height > 0）で指定してください。')
    }
    return { x, y, width, height }
}

async function renderReport(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const templatePath = optionalStringArg(args, 'templatePath')
    if (templatePath.startsWith('/') || templatePath.includes('..')) {
        throw new BusinessException('パスが不正です')
    }
    // The template must be readable by the account (see layout_report).
    WorkspaceAccessLogic.checkRead(access, workspace, templatePath)
    const format = optionalStringArg(args, 'format') || 'png'
    if (format !== 'png' && format !== 'pdf') {
        throw new BusinessException('format には png または pdf を指定してください。')
    }
    const templateJson = await resolveTemplateJson(args, context, workspace, templatePath)
    const dataSource = recordArg(args, 'dataSource')
    const wsRoot = resolveWorkspaceRoot(context, workspace)
    const fontDir = accountFontDir(context)

    if (format === 'pdf') {
        const pdfBytes = ReportBatchLogic.renderTemplateToPdf(
            wsRoot,
            templatePath,
            templateJson,
            JSON.stringify(dataSource),
            fontDir,
            WorkspaceAccessLogic.assetAuthorizer(access, workspace)
        )
        await publishInlineDrafts(args, context, workspace, templatePath, templateJson, dataSource)
        // Record the print in the account's history (a downloadable PDF). The
        // transport provides the DB-backed recorder; absent in unit tests.
        if (context.recordPrint) {
            await context.recordPrint(workspace, templatePath, 'pdf', pdfBytes)
        }
        return {
            content: [{
                type: 'resource',
                resource: {
                    uri: 'tsreport://render/report.pdf',
                    mimeType: 'application/pdf',
                    blob: Buffer.from(pdfBytes).toString('base64')
                }
            }]
        }
    }

    const rawScale = args.scale
    const scale = typeof rawScale === 'number' && rawScale > 0 ? Math.min(rawScale, 4) : 2
    const { doc, fonts } = ReportBatchLogic.renderTemplateToDocument(
        wsRoot,
        templatePath,
        templateJson,
        JSON.stringify(dataSource),
        fontDir,
        WorkspaceAccessLogic.assetAuthorizer(access, workspace)
    )
    // Text is emitted as glyph-outline paths, so the rasterizer needs no font
    // environment and the PNG matches the PDF glyph for glyph.
    const backend = new SvgBackend({ fonts, images: doc.images })
    render(doc, backend)
    const svgPages = backend.getPages()

    const pageIndex = typeof args.pageIndex === 'number' ? args.pageIndex : null
    if (pageIndex !== null && (pageIndex < 0 || pageIndex >= svgPages.length)) {
        throw new BusinessException(`pageIndex が範囲外です（0〜${svgPages.length - 1}）。`)
    }
    const region = parseBboxArg(args.region)

    // sharp ships platform-specific binaries; load it lazily so importing this
    // module (e.g. unit tests on the host) does not require the native binding.
    const sharp = (await import('sharp')).default
    const content: ToolContent[] = []
    for (let i = 0; i < svgPages.length; i++) {
        if (pageIndex !== null && i !== pageIndex) continue
        let pipeline = sharp(Buffer.from(svgPages[i]), { density: 72 * scale })
        if (region !== null) {
            // pt -> raster px at the requested scale, clamped to the page
            const page = doc.pages[i]
            const left = Math.max(0, Math.round(region.x * scale))
            const top = Math.max(0, Math.round(region.y * scale))
            const width = Math.min(Math.round(region.width * scale), Math.round(page.width * scale) - left)
            const height = Math.min(Math.round(region.height * scale), Math.round(page.height * scale) - top)
            if (width <= 0 || height <= 0) {
                throw new BusinessException('region がページの範囲外です。')
            }
            pipeline = pipeline.extract({ left, top, width, height })
        }
        const png = await pipeline.png().toBuffer()
        content.push({
            type: 'image',
            data: png.toString('base64'),
            mimeType: 'image/png'
        })
    }
    content.push({ type: 'text', text: JSON.stringify({ pageCount: svgPages.length, scale, pageIndex, region }) })
    await publishInlineDrafts(args, context, workspace, templatePath, templateJson, dataSource)
    return { content }
}

/**
 * Renders two template versions with the same data source and compares the
 * page rasters pixel by pixel. Returns, per page, whether they are identical
 * and the bounding box (pt) of every differing pixel — an objective check for
 * "did anything else move" during iterative edits, far more reliable than
 * eyeballing two images.
 */
async function compareReports(args: Record<string, unknown>, context: McpContext): Promise<ToolResult> {
    const access = requireAccess(context)
    const workspace = stringArg(args, 'workspace')
    const dataSource = recordArg(args, 'dataSource')
    const wsRoot = resolveWorkspaceRoot(context, workspace)
    const fontDir = accountFontDir(context)
    const scale = 2

    const renderSide = async function (templateKey: string, pathKey: string): Promise<{ pages: Buffer[], widths: number[], heights: number[] }> {
        const sidePath = typeof args[pathKey] === 'string' ? args[pathKey] as string : ''
        if (sidePath.startsWith('/') || sidePath.includes('..')) {
            throw new BusinessException('パスが不正です')
        }
        WorkspaceAccessLogic.checkRead(access, workspace, sidePath)
        const sideArgs: Record<string, unknown> = { template: args[templateKey], templatePath: sidePath }
        const templateJson = await resolveTemplateJson(sideArgs, context, workspace, sidePath)
        const { doc, fonts } = ReportBatchLogic.renderTemplateToDocument(
            wsRoot, sidePath, templateJson, JSON.stringify(dataSource), fontDir,
            WorkspaceAccessLogic.assetAuthorizer(access, workspace)
        )
        const backend = new SvgBackend({ fonts, images: doc.images })
        render(doc, backend)
        const sharp = (await import('sharp')).default
        const pages: Buffer[] = []
        const widths: number[] = []
        const heights: number[] = []
        for (let i = 0; i < backend.getPages().length; i++) {
            const raw = await sharp(Buffer.from(backend.getPages()[i]), { density: 72 * scale }).ensureAlpha().raw().toBuffer()
            pages.push(raw)
            widths.push(Math.round(doc.pages[i].width * scale))
            heights.push(Math.round(doc.pages[i].height * scale))
        }
        return { pages, widths, heights }
    }

    const a = await renderSide('templateA', 'templatePathA')
    const b = await renderSide('templateB', 'templatePathB')

    const pageCount = Math.max(a.pages.length, b.pages.length)
    const pages: Record<string, unknown>[] = []
    for (let i = 0; i < pageCount; i++) {
        if (i >= a.pages.length || i >= b.pages.length) {
            pages.push({ pageIndex: i, identical: false, onlyIn: i >= a.pages.length ? 'B' : 'A' })
            continue
        }
        if (a.widths[i] !== b.widths[i] || a.heights[i] !== b.heights[i]) {
            pages.push({ pageIndex: i, identical: false, reason: 'page size differs' })
            continue
        }
        const diff = diffRasterPages(a.pages[i], b.pages[i], a.widths[i], a.heights[i])
        if (diff === null) {
            pages.push({ pageIndex: i, identical: true })
        } else {
            pages.push({
                pageIndex: i,
                identical: false,
                diffPixelRatio: diff.ratio,
                // Back to pt for direct use as a render_report region
                diffBounds: {
                    x: round2(diff.minX / scale), y: round2(diff.minY / scale),
                    width: round2((diff.maxX - diff.minX + 1) / scale),
                    height: round2((diff.maxY - diff.minY + 1) / scale),
                },
            })
        }
    }
    return textResult({
        identical: pages.every(function (page) { return page.identical === true }),
        pageCountA: a.pages.length,
        pageCountB: b.pages.length,
        pages,
    })
}

/** RGBA raster comparison: null when identical, else the differing pixel box. */
function diffRasterPages(a: Buffer, b: Buffer, width: number, height: number): { minX: number, minY: number, maxX: number, maxY: number, ratio: number } | null {
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let diffCount = 0
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width * 4
        for (let x = 0; x < width; x++) {
            const o = rowOffset + x * 4
            if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) {
                diffCount++
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }
    if (maxX < 0) return null
    return { minX, minY, maxX, maxY, ratio: Math.round(diffCount / (width * height) * 10000) / 10000 }
}

// ============================================================================
// Helpers
// ============================================================================

function textResult(value: unknown): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

// Requires an authenticated workspace access; tools are dispatched only for
// authenticated requests, so this never fails in practice.
function requireAccess(context: McpContext): WorkspaceAccess {
    if (context.access.workspaceAccess === null) {
        throw new BusinessException('認証されていません。')
    }
    return context.access.workspaceAccess
}

// The [name] segment is the owning account's workspaceKey.
function resolveWorkspaceRoot(context: McpContext, workspace: string): string {
    return WorkspacePaths.dirForWorkspaceKey(workspace)
}

// Same path validation as the workspace file API routes.
function resolveWorkspaceFilePath(context: McpContext, workspace: string, path: string): string {
    return WorkspacePaths.resolveInside(workspace, path)
}

function stringArg(args: Record<string, unknown>, key: string): string {
    const value = args[key]
    if (typeof value !== 'string' || value === '') {
        throw new BusinessException('引数 ' + key + ' には空でない文字列を指定してください。')
    }
    return value
}

function optionalStringArg(args: Record<string, unknown>, key: string): string {
    const value = args[key]
    if (value === undefined) {
        return ''
    }
    if (typeof value !== 'string') {
        throw new BusinessException('引数 ' + key + ' には文字列を指定してください。')
    }
    return value
}

function recordArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = args[key]
    if (!isRecord(value)) {
        throw new BusinessException('引数 ' + key + ' にはオブジェクトを指定してください。')
    }
    return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toErrorText(e: unknown): string {
    if (e instanceof ForbiddenException) {
        return 'アクセスが拒否されました'
    }
    if (e instanceof Error && e.message !== '') {
        return e.message
    }
    return String(e)
}
