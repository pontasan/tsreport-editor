import { FolderShare } from '@/lib/server/entity/FolderShare'
import { ClientBase } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

export namespace FolderShareDao {

    // A share joined with the grantee account, for the owner's share dialog.
    export type OutgoingRow = {
        id: number,
        path: string,
        canRead: boolean,
        canWrite: boolean,
        granteeWorkspaceKey: string,
        granteeDisplayName: string,
        version: number
    }

    // A share joined with the owner account, for the grantee's workspace tree.
    export type IncomingRow = {
        id: number,
        path: string,
        canRead: boolean,
        canWrite: boolean,
        ownerWorkspaceKey: string,
        ownerDisplayName: string,
        version: number
    }

    function baseQuery(): SQLStatement {
        return SQL`
            SELECT
                FolderShare.id AS "id",
                FolderShare.fkOwnerAccount AS "fkOwnerAccount",
                FolderShare.fkGranteeAccount AS "fkGranteeAccount",
                FolderShare.path AS "path",
                FolderShare.canRead AS "canRead",
                FolderShare.canWrite AS "canWrite",
                FolderShare.createUser AS "createUser",
                FolderShare.updateUser AS "updateUser",
                FolderShare.creation AS "creation",
                FolderShare.modification AS "modification",
                FolderShare.version AS "version"
            FROM
                FolderShare
        `
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`SELECT NEXTVAL('FolderShareSeq') AS "id"`)
        return qres.rows[0].id
    }

    export async function getById(client: ClientBase, id: number): Promise<FolderShare.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                FolderShare.id = ${id}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    // All shares the owner has granted (any grantee, any path).
    export async function listByOwner(client: ClientBase, fkOwnerAccount: number): Promise<FolderShare.Type[]> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                FolderShare.fkOwnerAccount = ${fkOwnerAccount}
            ORDER BY
                FolderShare.path ASC,
                FolderShare.id ASC
        `))
        return qres.rows
    }

    export async function getByTriple(client: ClientBase, fkOwnerAccount: number, fkGranteeAccount: number, path: string): Promise<FolderShare.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                FolderShare.fkOwnerAccount = ${fkOwnerAccount} AND
                FolderShare.fkGranteeAccount = ${fkGranteeAccount} AND
                FolderShare.path = ${path}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    // Shares the owner granted on a specific folder, with grantee display info.
    export async function listOutgoingWithGrantee(client: ClientBase, fkOwnerAccount: number, path: string): Promise<OutgoingRow[]> {
        const qres = await client.query(SQL`
            SELECT
                FolderShare.id AS "id",
                FolderShare.path AS "path",
                FolderShare.canRead AS "canRead",
                FolderShare.canWrite AS "canWrite",
                UserAccount.workspaceKey AS "granteeWorkspaceKey",
                UserAccount.displayName AS "granteeDisplayName",
                FolderShare.version AS "version"
            FROM
                FolderShare
                INNER JOIN UserAccount ON (UserAccount.id = FolderShare.fkGranteeAccount)
            WHERE
                FolderShare.fkOwnerAccount = ${fkOwnerAccount} AND
                FolderShare.path = ${path}
            ORDER BY
                UserAccount.displayName ASC,
                FolderShare.id ASC
        `)
        return qres.rows
    }

    // Every folder shared with this grantee, with owner display info.
    export async function listIncomingWithOwner(client: ClientBase, fkGranteeAccount: number): Promise<IncomingRow[]> {
        const qres = await client.query(SQL`
            SELECT
                FolderShare.id AS "id",
                FolderShare.path AS "path",
                FolderShare.canRead AS "canRead",
                FolderShare.canWrite AS "canWrite",
                UserAccount.workspaceKey AS "ownerWorkspaceKey",
                UserAccount.displayName AS "ownerDisplayName",
                FolderShare.version AS "version"
            FROM
                FolderShare
                INNER JOIN UserAccount ON (UserAccount.id = FolderShare.fkOwnerAccount)
            WHERE
                FolderShare.fkGranteeAccount = ${fkGranteeAccount}
            ORDER BY
                UserAccount.displayName ASC,
                FolderShare.path ASC
        `)
        return qres.rows
    }

    export async function insert(client: ClientBase, entity: FolderShare.Type): Promise<number> {
        const qres = await client.query(SQL`
            INSERT INTO FolderShare (
                id,
                fkOwnerAccount,
                fkGranteeAccount,
                path,
                canRead,
                canWrite,
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.fkOwnerAccount},
                ${entity.fkGranteeAccount},
                ${entity.path},
                ${entity.canRead},
                ${entity.canWrite},
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
        return qres.rowCount as number
    }

    export async function updatePermissions(client: ClientBase, id: number, canRead: boolean, canWrite: boolean, version: number, updateUser: number): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                FolderShare
            SET
                canRead = ${canRead},
                canWrite = ${canWrite},
                updateUser = ${updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                FolderShare.id = ${id} AND
                FolderShare.version = ${version}
        `)
        return qres.rowCount as number
    }

    export async function del(client: ClientBase, id: number): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                FolderShare
            WHERE
                FolderShare.id = ${id}
        `)
        return qres.rowCount as number
    }

    // Deletes a single incoming share the grantee received, so a grantee can
    // decline a share pushed onto their workspace view. Scoped by grantee so one
    // account can never delete another's incoming share.
    export async function deleteByGranteeAndId(client: ClientBase, granteeId: number, id: number): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                FolderShare
            WHERE
                FolderShare.id = ${id} AND
                FolderShare.fkGranteeAccount = ${granteeId}
        `)
        return qres.rowCount as number
    }

    // Deletes every share the owner granted on a folder subtree (the folder
    // itself and everything beneath it). Used when the owner deletes that folder
    // so shares can never linger and re-attach to a later same-named folder.
    // starts_with(path, prefix) matches the subtree exactly: it is not a LIKE
    // pattern (so folder names containing '%'/'_' cannot over-match) and it
    // compares by characters (so multibyte / non-BMP folder names are handled
    // correctly, unlike passing a JS UTF-16 length into left()).
    export async function deleteByOwnerSubtree(client: ClientBase, ownerId: number, path: string): Promise<number> {
        const prefix = path + '/'
        const qres = await client.query(SQL`
            DELETE
            FROM
                FolderShare
            WHERE
                FolderShare.fkOwnerAccount = ${ownerId} AND
                (FolderShare.path = ${path} OR starts_with(FolderShare.path, ${prefix}))
        `)
        return qres.rowCount as number
    }

    // Repoints the owner's shares from an old folder subtree to a new one when
    // the owner renames that folder, so grantees keep access to the moved folder.
    // The rename target folder did not exist on disk before the rename (the route
    // rejects a colliding destination), so any of the owner's shares already
    // sitting under the new subtree are stale; they are dropped first so the
    // repoint can never violate UNIQUE (owner, grantee, path). Subtree matching
    // uses starts_with and the splice offset uses char_length so multibyte paths
    // are handled by characters, not JS UTF-16 units.
    export async function repathByOwnerSubtree(client: ClientBase, ownerId: number, oldPath: string, newPath: string): Promise<number> {
        const oldPrefix = oldPath + '/'
        const newPrefix = newPath + '/'
        await client.query(SQL`
            DELETE
            FROM
                FolderShare
            WHERE
                FolderShare.fkOwnerAccount = ${ownerId} AND
                (FolderShare.path = ${newPath} OR starts_with(FolderShare.path, ${newPrefix}))
        `)
        const qres = await client.query(SQL`
            UPDATE
                FolderShare
            SET
                path = ${newPath} || substr(FolderShare.path, char_length(${oldPath}) + 1),
                modification = NOW(),
                version = version + 1
            WHERE
                FolderShare.fkOwnerAccount = ${ownerId} AND
                (FolderShare.path = ${oldPath} OR starts_with(FolderShare.path, ${oldPrefix}))
        `)
        return qres.rowCount as number
    }

    // Remove every share this account participates in (either side). Used on
    // account deletion so no dangling grants remain.
    export async function deleteByAccount(client: ClientBase, accountId: number): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                FolderShare
            WHERE
                FolderShare.fkOwnerAccount = ${accountId} OR
                FolderShare.fkGranteeAccount = ${accountId}
        `)
        return qres.rowCount as number
    }

}
