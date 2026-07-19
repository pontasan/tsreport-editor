import { dirnamePosix, hasUriScheme, resolveWorkspacePath } from '@/lib/common/utils/workspace_path'
import { fetchImageBytes, requestImageBytes } from './image_store'

export type EditorCurrentFile = {
    workspace: string
    path: string
}

function isHttpUrl(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://')
}

function isBlobUrl(value: string): boolean {
    return value.startsWith('blob:')
}

function isFileUrl(value: string): boolean {
    return value.startsWith('file://')
}

function isDataUri(value: string): boolean {
    return value.startsWith('data:')
}

function isDataScheme(value: string): boolean {
    return value.startsWith('data://')
}

export function resolveEditorWorkspacePath(ref: string, currentFile: EditorCurrentFile | null): string | null {
    if (ref === '' || currentFile === null) return null
    if (isHttpUrl(ref) || isBlobUrl(ref) || isFileUrl(ref) || isDataUri(ref) || isDataScheme(ref) || hasUriScheme(ref)) return null
    const baseDir = dirnamePosix(currentFile.path)
    return resolveWorkspacePath(baseDir, ref)
}

function buildWorkspaceFileUrl(workspace: string, filePath: string): string {
    const path = '/api/workspace/' + encodeURIComponent(workspace) + '/files/' + encodeURIComponent(filePath)
    return new URL(path, window.location.origin).toString()
}

// Editorimage core with.
// Data:// data:
// Http/blob/file/data.
// Path currentFile API URL to convert.
// Normalize image references from the editor into a form consumable by core.



export function resolveEditorImageRef(ref: string, currentFile: EditorCurrentFile | null): string | null {
    if (ref === '') return null
    if (isDataScheme(ref)) return 'data:' + ref.substring(7)
    if (isDataUri(ref)) return ref
    if (isHttpUrl(ref) || isBlobUrl(ref) || isFileUrl(ref)) return ref
    if (hasUriScheme(ref)) return ref
    if (currentFile === null) return null

    const baseDir = dirnamePosix(currentFile.path)
    const resolved = resolveWorkspacePath(baseDir, ref)
    if (resolved === null || resolved === '') return null
    return buildWorkspaceFileUrl(currentFile.workspace, resolved)
}

// Resolve an image reference to the data form the core layout engine consumes.
// Used by the preview through the asynchronous resolver contract of the
// preview components.
// - inline data (data:, data://) passes through for core-side decoding
// - external http(s) / file URLs and custom schemes pass through unchanged,
//   the same as the server runtime resolver
// - workspace files and blob URLs resolve to fetched bytes so scale modes can
//   use real image sizes; a file missing on the server resolves to null
//   (core onError semantics)
export async function loadEditorImageData(ref: string, currentFile: EditorCurrentFile | null): Promise<string | Uint8Array | null> {
    if (ref === '') return null
    if (isDataScheme(ref)) return 'data:' + ref.substring(7)
    if (isDataUri(ref)) return ref
    if (isBlobUrl(ref)) return fetchImageBytes(ref)
    if (isHttpUrl(ref) || isFileUrl(ref)) return ref
    if (hasUriScheme(ref)) return ref
    if (currentFile === null) return null

    const baseDir = dirnamePosix(currentFile.path)
    const resolved = resolveWorkspacePath(baseDir, ref)
    if (resolved === null || resolved === '') return null
    return fetchImageBytes(buildWorkspaceFileUrl(currentFile.workspace, resolved))
}

// Design-canvas variant: resolves synchronously from the byte cache (a cache
// miss starts a background fetch and passes the URL through meanwhile), and a
// missing file resolves to its URL instead of null so the canvas backend
// presents the unresolved reference as a placeholder box. The runtime onError
// policy is enforced by the preview/PDF path, not while the user is still
// typing a source path on the design surface.
export function resolveEditorCanvasImage(ref: string, currentFile: EditorCurrentFile | null): string | Uint8Array | null {
    if (ref === '') return null
    if (isDataScheme(ref)) return 'data:' + ref.substring(7)
    if (isDataUri(ref)) return ref
    if (isBlobUrl(ref)) return resolveCachedBytes(ref)
    if (isHttpUrl(ref) || isFileUrl(ref)) return ref
    if (hasUriScheme(ref)) return ref
    if (currentFile === null) return null

    const baseDir = dirnamePosix(currentFile.path)
    const resolved = resolveWorkspacePath(baseDir, ref)
    if (resolved === null || resolved === '') return null
    return resolveCachedBytes(buildWorkspaceFileUrl(currentFile.workspace, resolved))
}

function resolveCachedBytes(url: string): string | Uint8Array {
    const bytes = requestImageBytes(url)
    if (bytes === undefined || bytes === null) return url
    return bytes
}
