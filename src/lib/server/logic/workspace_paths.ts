import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { normalizeWorkspacePath } from '@/lib/common/utils/workspace_path'
import { mkdir } from 'fs/promises'
import { join, resolve } from 'path'

// Single source of truth for on-disk workspace locations. Every filesystem path
// that touches a workspace must be built through here so the UUID form of a
// workspaceKey and the "stay inside the workspace root" guard are enforced in
// exactly one place.

// Deployment infrastructure path (like the DB connection), read at call time so
// the container mount and the test fixtures can point it at different roots.
const DEFAULT_WORKSPACES_DIR = '/var/nfs/workspaces'

export function workspacesDir(): string {
    return process.env.WORKSPACES_ROOT ?? DEFAULT_WORKSPACES_DIR
}

// Matches the lowercase UUID produced by crypto.randomUUID() and the fixed seed
// keys. A workspaceKey is used directly as a directory name, so it must never
// contain path separators or traversal segments.
const WORKSPACE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export namespace WorkspacePaths {

    // The root directory of an account's workspace. Rejects anything that is not
    // a well-formed UUID key.
    export function dirForWorkspaceKey(workspaceKey: string): string {
        if (!WORKSPACE_KEY_PATTERN.test(workspaceKey)) {
            throw new ForbiddenException()
        }
        return join(workspacesDir(), workspaceKey)
    }

    // Resolves a relative path inside a workspace to an absolute path, refusing
    // any result that would escape the workspace root. `relativePath` may be ''
    // (the workspace root itself). Traversal segments normalize away or, if they
    // escape the root, are rejected outright.
    export function resolveInside(workspaceKey: string, relativePath: string): string {
        const root = dirForWorkspaceKey(workspaceKey)
        const normalized = normalizeWorkspacePath(relativePath)
        if (normalized === null) {
            throw new ForbiddenException()
        }
        if (normalized === '') {
            return root
        }
        const targetPath = resolve(join(root, normalized))
        if (!targetPath.startsWith(root + '/')) {
            throw new ForbiddenException()
        }
        return targetPath
    }

    // Like resolveInside, but refuses the workspace root itself. Used by delete
    // and rename, which must target a concrete entry inside the workspace — a
    // path that normalizes to the root (e.g. '' or '.') would otherwise wipe or
    // move the whole workspace. Refuses by comparing the resolved path to the
    // root, so it stays correct whatever normalization resolveInside applies.
    export function resolveEntryInside(workspaceKey: string, relativePath: string): string {
        const resolved = resolveInside(workspaceKey, relativePath)
        if (resolved === dirForWorkspaceKey(workspaceKey)) {
            throw new ForbiddenException()
        }
        return resolved
    }

    // Creates an account's workspace directory. Called when an account is
    // provisioned so every account always has its own workspace root.
    export async function ensureWorkspaceDir(workspaceKey: string): Promise<void> {
        await mkdir(dirForWorkspaceKey(workspaceKey), { recursive: true })
    }

}
