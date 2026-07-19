import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { FolderShareDao } from '@/lib/server/dao/FolderShare'
import { UserAccount } from '@/lib/server/entity/user_account'
import { normalizeWorkspacePath } from '@/lib/common/utils/workspace_path'
import { ClientBase } from 'pg'

// Multi-tenant workspace access. Each account owns exactly one workspace,
// identified by its workspaceKey (UUID). An account has:
// - full read+write on its own workspace, and
// - read and/or write on folders other accounts have shared with it
//   (FolderShare), limited to the shared folder and its descendants.
// There is no administrator override: admins see only their own workspace and
// what has been shared with them, like everyone else.

export type IncomingShare = {
    ownerWorkspaceKey: string,
    path: string,
    canRead: boolean,
    canWrite: boolean
}

export type WorkspaceAccess = {
    ownWorkspaceKey: string,
    shares: IncomingShare[]
}

export type AccessResult = {
    read: boolean,
    write: boolean
}

export namespace WorkspaceAccessLogic {

    // Snapshots the acting account's effective access: its own workspaceKey plus
    // every folder shared with it (projected to the owner's workspaceKey).
    export async function loadAccess(client: ClientBase, user: UserAccount.Type): Promise<WorkspaceAccess> {
        const rows = await FolderShareDao.listIncomingWithOwner(client, user.id!)
        const shares: IncomingShare[] = []
        for (let i = 0; i < rows.length; i++) {
            shares.push({
                ownerWorkspaceKey: rows[i].ownerWorkspaceKey,
                path: rows[i].path,
                canRead: rows[i].canRead,
                canWrite: rows[i].canWrite
            })
        }
        return { ownWorkspaceKey: user.workspaceKey, shares }
    }

    // Resolves read/write capability for a (workspaceKey, path). Own workspace is
    // always full access; a foreign workspace grants capability only through a
    // share that covers the path. A path that escapes the workspace root (leading
    // "..") normalizes to null and is denied.
    export function resolveAccess(access: WorkspaceAccess, workspaceKey: string, path: string): AccessResult {
        const normalizedPath = normalizeWorkspacePath(path)
        if (normalizedPath === null) {
            return { read: false, write: false }
        }
        if (workspaceKey === access.ownWorkspaceKey) {
            return { read: true, write: true }
        }
        let read = false
        let write = false
        for (let i = 0; i < access.shares.length; i++) {
            const share = access.shares[i]
            if (share.ownerWorkspaceKey !== workspaceKey) {
                continue
            }
            if (normalizedPath === share.path || normalizedPath.startsWith(share.path + '/')) {
                if (share.canRead) {
                    read = true
                }
                if (share.canWrite) {
                    write = true
                }
            }
        }
        return { read, write }
    }

    export function checkRead(access: WorkspaceAccess, workspaceKey: string, path: string): void {
        if (!resolveAccess(access, workspaceKey, path).read) {
            throw new ForbiddenException()
        }
    }

    export function checkWrite(access: WorkspaceAccess, workspaceKey: string, path: string): void {
        if (!resolveAccess(access, workspaceKey, path).write) {
            throw new ForbiddenException()
        }
    }

    export function isReadable(access: WorkspaceAccess, workspaceKey: string, path: string): boolean {
        return resolveAccess(access, workspaceKey, path).read
    }

    // Per-asset read gate for template rendering. Rendering may pull in any image
    // or subreport a template references; on a shared workspace the caller may
    // hold only a subtree, so every referenced asset must independently pass
    // isReadable. On the caller's own workspace this is always true; the check
    // only bites when a template in a shared subtree references a path outside
    // that subtree. Shared by the print batch and the MCP layout/render tools so
    // both apply identical confinement.
    export function assetAuthorizer(access: WorkspaceAccess, workspaceKey: string): (relativePath: string) => boolean {
        return function authorizeAsset(relativePath: string): boolean {
            return isReadable(access, workspaceKey, relativePath)
        }
    }

    // Whether a directory is worth descending into when recursively listing a
    // workspace: true for the own workspace, or when a share on this workspace
    // either covers the directory or lies beneath it (so the shared subtree is
    // reachable only by descending through this ancestor directory).
    export function mayTraverse(access: WorkspaceAccess, workspaceKey: string, dirPath: string): boolean {
        const normalized = normalizeWorkspacePath(dirPath)
        if (normalized === null) {
            return false
        }
        if (workspaceKey === access.ownWorkspaceKey) {
            return true
        }
        for (let i = 0; i < access.shares.length; i++) {
            const share = access.shares[i]
            if (share.ownerWorkspaceKey !== workspaceKey) {
                continue
            }
            if (normalized === share.path || normalized.startsWith(share.path + '/')) {
                return true
            }
            if (normalized === '' || share.path.startsWith(normalized + '/')) {
                return true
            }
        }
        return false
    }

}
