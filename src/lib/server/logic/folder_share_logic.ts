import { BusinessException } from '@/lib/common/exception/business_exception'
import { ConsistencyException } from '@/lib/common/exception/consistency_exception'
import { NotFoundException } from '@/lib/common/exception/not_found_exception'
import { normalizeWorkspacePath } from '@/lib/common/utils/workspace_path'
import { FolderShareDao } from '@/lib/server/dao/FolderShare'
import { FolderShare } from '@/lib/server/entity/FolderShare'
import { UserAccount } from '@/lib/server/entity/user_account'
import { UserAccountDao } from '@/lib/server/dao/user_account'
import { ClientBase } from 'pg'

// Owner-driven folder sharing. The owner shares a folder inside their own
// workspace with another account identified by the grantee's workspaceKey. All
// grantee-resolution failures (unknown key, self-share) collapse to a single
// { ok: false } so the caller can never probe whether an account exists.

export type CreateShareResult = {
    ok: boolean
}

export namespace FolderShareLogic {

    // A share always targets a concrete folder inside the owner's workspace.
    function normalizeSharePath(path: string): string {
        const normalized = normalizeWorkspacePath(path)
        if (normalized === null || normalized === '') {
            throw new BusinessException('共有するフォルダが不正です。')
        }
        return normalized
    }

    function requirePermission(canRead: boolean, canWrite: boolean): void {
        if (!canRead && !canWrite) {
            throw new BusinessException('読み取りまたは書き込みのいずれかを選択してください。')
        }
    }

    export async function createShareByKey(client: ClientBase, ownerUser: UserAccount.Type, path: string, granteeWorkspaceKey: string, canRead: boolean, canWrite: boolean): Promise<CreateShareResult> {
        const normalizedPath = normalizeSharePath(path)
        requirePermission(canRead, canWrite)

        const grantee = await UserAccountDao.getByWorkspaceKey(client, granteeWorkspaceKey)
        // Unknown grantee or an attempt to share with oneself: report the same
        // neutral failure so account existence never leaks.
        if (grantee === undefined || grantee.id === ownerUser.id) {
            return { ok: false }
        }

        const existing = await FolderShareDao.getByTriple(client, ownerUser.id!, grantee.id!, normalizedPath)
        if (existing !== undefined) {
            const updated = await FolderShareDao.updatePermissions(client, existing.id!, canRead, canWrite, existing.version, ownerUser.id!)
            if (updated !== 1) {
                throw new ConsistencyException()
            }
            return { ok: true }
        }

        const entity = FolderShare.create()
        entity.id = await FolderShareDao.getSequenceId(client)
        entity.fkOwnerAccount = ownerUser.id!
        entity.fkGranteeAccount = grantee.id!
        entity.path = normalizedPath
        entity.canRead = canRead
        entity.canWrite = canWrite
        entity.createUser = ownerUser.id
        entity.updateUser = ownerUser.id
        await FolderShareDao.insert(client, entity)
        return { ok: true }
    }

    export async function listOutgoingShares(client: ClientBase, ownerUser: UserAccount.Type, path: string): Promise<FolderShareDao.OutgoingRow[]> {
        const normalizedPath = normalizeSharePath(path)
        return await FolderShareDao.listOutgoingWithGrantee(client, ownerUser.id!, normalizedPath)
    }

    export async function listIncomingShares(client: ClientBase, granteeUser: UserAccount.Type): Promise<FolderShareDao.IncomingRow[]> {
        return await FolderShareDao.listIncomingWithOwner(client, granteeUser.id!)
    }

    // Loads a share the caller owns, or throws NotFound so a non-owner cannot
    // tell whether the share exists.
    async function requireOwnedShare(client: ClientBase, ownerUser: UserAccount.Type, id: number): Promise<FolderShare.Type> {
        const share = await FolderShareDao.getById(client, id)
        if (share === undefined || share.fkOwnerAccount !== ownerUser.id) {
            throw new NotFoundException()
        }
        return share
    }

    export async function updatePermissions(client: ClientBase, ownerUser: UserAccount.Type, id: number, canRead: boolean, canWrite: boolean, version: number): Promise<void> {
        requirePermission(canRead, canWrite)
        await requireOwnedShare(client, ownerUser, id)
        const updated = await FolderShareDao.updatePermissions(client, id, canRead, canWrite, version, ownerUser.id!)
        if (updated !== 1) {
            // Version mismatch (concurrent edit): fail loudly so a permission
            // change (e.g. revoking write) is never silently dropped.
            throw new ConsistencyException()
        }
    }

    export async function deleteShare(client: ClientBase, ownerUser: UserAccount.Type, id: number): Promise<void> {
        await requireOwnedShare(client, ownerUser, id)
        await FolderShareDao.del(client, id)
    }

    // Grantee-side: decline a share pushed onto one's own workspace view. Scoped
    // by grantee so it can only remove a share that targets the caller.
    export async function rejectIncomingShare(client: ClientBase, granteeUser: UserAccount.Type, id: number): Promise<void> {
        const removed = await FolderShareDao.deleteByGranteeAndId(client, granteeUser.id!, id)
        if (removed !== 1) {
            throw new NotFoundException()
        }
    }

    // Keeps shares consistent when the owner reorganizes their folders. Deleting
    // a folder drops the shares on that subtree (so they cannot re-attach to a
    // later same-named folder); renaming repoints them to the new path. Both are
    // keyed by the owning workspaceKey (the [name] segment of the file routes /
    // the MCP `workspace` argument) so every folder-mutating entry point applies
    // the same follow without re-resolving the owner at each call site.
    export async function onOwnerFolderDeleted(client: ClientBase, ownerWorkspaceKey: string, path: string): Promise<void> {
        const owner = await resolveWorkspaceOwner(client, ownerWorkspaceKey)
        await FolderShareDao.deleteByOwnerSubtree(client, owner.id!, normalizeSharePath(path))
    }

    export async function onOwnerFolderRenamed(client: ClientBase, ownerWorkspaceKey: string, oldPath: string, newPath: string): Promise<void> {
        const owner = await resolveWorkspaceOwner(client, ownerWorkspaceKey)
        await FolderShareDao.repathByOwnerSubtree(client, owner.id!, normalizeSharePath(oldPath), normalizeSharePath(newPath))
    }

    // Resolves the account that owns a workspace. The caller has already passed
    // write authorization for this workspaceKey, so the owner must exist; a miss
    // is a broken invariant and fails loudly rather than silently skipping the
    // share follow.
    async function resolveWorkspaceOwner(client: ClientBase, workspaceKey: string): Promise<UserAccount.Type> {
        const owner = await UserAccountDao.getByWorkspaceKey(client, workspaceKey)
        if (owner === undefined) {
            throw new BusinessException('ワークスペースの所有アカウントが見つかりません。')
        }
        return owner
    }

}
