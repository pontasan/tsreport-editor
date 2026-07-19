import { UserAccount } from "@/lib/server/entity/user_account"
import { ClientBase } from "pg"
import SQL, { SQLStatement } from "sql-template-strings"

export namespace UserAccountDao {

    function sqlBaseQuery(): SQLStatement {
        return SQL`
            SELECT
                UserAccount.id AS "id",
                UserAccount.displayName AS "displayName",
                UserAccount.userId AS "userId",
                UserAccount.pw AS "pw",
                UserAccount.provider AS "provider",
                UserAccount.externalId AS "externalId",
                UserAccount.email AS "email",
                UserAccount.workspaceKey AS "workspaceKey",
                UserAccount.adminFlag AS "adminFlag",
                UserAccount.mcpEnabled AS "mcpEnabled",
                UserAccount.mcpKey AS "mcpKey",
                UserAccount.defaultColorMode AS "defaultColorMode",

                UserAccount.createUser AS "createUser",
                UserAccount.updateUser AS "updateUser",
                UserAccount.creation AS "creation",
                UserAccount.modification AS "modification",
                UserAccount.version AS "version"
            FROM
                UserAccount
        `
    }

    export async function listAll(client: ClientBase): Promise<UserAccount.Type[]> {
        const result = await client.query(sqlBaseQuery().append(SQL`
            ORDER BY
                UserAccount.id ASC
        `))
        return result.rows
    }

    // Password verification happens in the authentication layer. Locking the
    // row makes a legacy-hash upgrade and password change atomic.
    export async function getLocalByUserIdForUpdate(client: ClientBase, userId: string): Promise<UserAccount.Type | undefined> {
        const result = await client.query(sqlBaseQuery().append(SQL`
            WHERE
                UserAccount.provider = 'local' AND
                UserAccount.pw <> '' AND
                UserAccount.userId = ${userId}
            FOR UPDATE
        `))
        return result.rowCount ? result.rows[0] : undefined
    }

    export async function listLocalPasswordAccountsForUpdate(client: ClientBase): Promise<UserAccount.Type[]> {
        const result = await client.query(sqlBaseQuery().append(SQL`
            WHERE
                UserAccount.provider = 'local' AND
                UserAccount.pw <> ''
            ORDER BY
                UserAccount.id ASC
            FOR UPDATE
        `))
        return result.rows
    }

    export async function getByUserId(client: ClientBase, userId: string): Promise<UserAccount.Type | undefined> {
        const result = await client.query(sqlBaseQuery().append(SQL`
            WHERE
                UserAccount.userId = ${userId}
        `))
        return result.rowCount ? result.rows[0] : undefined
    }

    export async function getByActiveToken(client: ClientBase, token: string): Promise<UserAccount.Type | undefined> {
        const result = await client.query(sqlBaseQuery().append(SQL`
                INNER JOIN Session ON (
                    UserAccount.id=Session.fkUserAccount
                )
            WHERE
                Session.token = ${token} AND
                Session.expiration >= NOW()
        `))
        return result.rowCount ? result.rows[0] : undefined
    }

    // Counts administrators. Used to enforce the "at least one admin" invariant.
    export async function countAdmins(client: ClientBase): Promise<number> {
        const result = await client.query(SQL`
            SELECT
                COUNT(*) AS "count"
            FROM
                UserAccount
            WHERE
                UserAccount.adminFlag = TRUE
        `)
        return Number(result.rows[0].count)
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const result = await client.query(SQL`
        SELECT
            NEXTVAL('UserAccountSeq') AS "id"
        `)

        return result.rows[0].id
    }

    export async function getById(client: ClientBase, id: number): Promise<UserAccount.Type | undefined> {
        const result = await client.query(sqlBaseQuery().append(SQL`
            WHERE
            UserAccount.id = ${id}
        `))
        return result.rowCount ? result.rows[0] : undefined
    }

    export async function insert(client: ClientBase, entity: UserAccount.Type) {
        await client.query(SQL`
            INSERT INTO UserAccount(
                id,
                displayName,
                userId,
                pw,
                provider,
                externalId,
                email,
                workspaceKey,
                adminFlag,
                mcpEnabled,
                mcpKey,
                defaultColorMode,

                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.displayName},
                ${entity.userId},
                ${entity.pw},
                ${entity.provider},
                ${entity.externalId},
                ${entity.email},
                ${entity.workspaceKey},
                ${entity.adminFlag},
                ${entity.mcpEnabled},
                ${entity.mcpKey},
                ${entity.defaultColorMode},

                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
    }

    export async function update(client: ClientBase, entity: UserAccount.Type): Promise<number> {
        const result = await client.query(SQL`
            UPDATE
                UserAccount
            SET
                displayName = ${entity.displayName},
                userId = ${entity.userId},
                pw = ${entity.pw},
                provider = ${entity.provider},
                externalId = ${entity.externalId},
                email = ${entity.email},
                adminFlag = ${entity.adminFlag},
                mcpEnabled = ${entity.mcpEnabled},
                mcpKey = ${entity.mcpKey},
                defaultColorMode = ${entity.defaultColorMode},

                updateUser = ${entity.updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                id = cast(${entity.id} AS BIGINT) AND
                version = cast(${entity.version} AS BIGINT)
        `)

        return result.rowCount ? result.rowCount : 0
    }

    // Resolves the account that owns a workspace (by its UUID key). Used both to
    // resolve API/URL workspace segments to their owner and to resolve a share
    // target the user typed. A deleted account no longer exists (accounts are
    // physically removed), so a share can never target one.
    export async function getByWorkspaceKey(client: ClientBase, workspaceKey: string): Promise<UserAccount.Type | undefined> {
        const result = await client.query(sqlBaseQuery().append(SQL`
            WHERE
                UserAccount.workspaceKey = ${workspaceKey}
        `))
        return result.rowCount ? result.rows[0] : undefined
    }

    // Physically removes an account row. The caller must first remove every row
    // that references the account (sessions, shares, OAuth clients and their
    // tokens/grants, print requests, template tags) so no dangling reference
    // remains.
    export async function deleteById(client: ClientBase, id: number): Promise<number> {
        const result = await client.query(SQL`
            DELETE
            FROM
                UserAccount
            WHERE
                id = ${id}
        `)
        return result.rowCount ? result.rowCount : 0
    }

    // Looks up an account by its external identity (provider + OIDC subject). A
    // deleted account is physically gone, so this resolves only live accounts.
    export async function getByExternalId(client: ClientBase, provider: string, externalId: string): Promise<UserAccount.Type | undefined> {
        const result = await client.query(sqlBaseQuery().append(SQL`
            WHERE
                UserAccount.provider = ${provider} AND
                UserAccount.externalId = ${externalId}
        `))
        return result.rowCount ? result.rows[0] : undefined
    }

}
