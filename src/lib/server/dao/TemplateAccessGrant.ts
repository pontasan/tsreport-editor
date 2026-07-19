import { TemplateAccessGrant } from '@/lib/server/entity/TemplateAccessGrant'
import { ClientBase } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

export namespace TemplateAccessGrantDao {

    function baseQuery(): SQLStatement {
        return SQL`
            SELECT
                TemplateAccessGrant.id AS "id",
                TemplateAccessGrant.fkOAuthClient AS "fkOAuthClient",
                TemplateAccessGrant.workspace AS "workspace",
                TemplateAccessGrant.path AS "path",
                TemplateAccessGrant.createUser AS "createUser",
                TemplateAccessGrant.updateUser AS "updateUser",
                TemplateAccessGrant.creation AS "creation",
                TemplateAccessGrant.modification AS "modification",
                TemplateAccessGrant.version AS "version"
            FROM
                TemplateAccessGrant
        `
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`SELECT NEXTVAL('TemplateAccessGrantSeq') AS "id"`)
        return qres.rows[0].id
    }

    export async function insert(client: ClientBase, entity: TemplateAccessGrant.Type): Promise<number> {
        const qres = await client.query(SQL`
            INSERT INTO TemplateAccessGrant (
                id,
                fkOAuthClient,
                workspace,
                path,
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.fkOAuthClient},
                ${entity.workspace},
                ${entity.path},
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
        return qres.rowCount as number
    }

    export async function getById(client: ClientBase, id: number): Promise<TemplateAccessGrant.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                TemplateAccessGrant.id = ${id}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function listByClient(client: ClientBase, fkOAuthClient: number): Promise<TemplateAccessGrant.Type[]> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                TemplateAccessGrant.fkOAuthClient = ${fkOAuthClient}
            ORDER BY
                TemplateAccessGrant.workspace ASC,
                TemplateAccessGrant.path ASC
        `))
        return qres.rows
    }

    export async function hasAccess(client: ClientBase, fkOAuthClient: number, workspace: string, templatePath: string): Promise<boolean> {
        const qres = await client.query(SQL`
            SELECT
                TemplateAccessGrant.id AS "id"
            FROM
                TemplateAccessGrant
            WHERE
                TemplateAccessGrant.fkOAuthClient = ${fkOAuthClient} AND
                (TemplateAccessGrant.workspace = ${workspace} OR TemplateAccessGrant.workspace = '*') AND
                (
                    TemplateAccessGrant.path = '' OR
                    ${templatePath} = TemplateAccessGrant.path OR
                    ${templatePath} LIKE TemplateAccessGrant.path || '/%'
                )
            LIMIT 1
        `)
        return qres.rowCount !== 0
    }

    // True when the client holds any grant that covers the workspace (including '*' grants),
    // regardless of the granted path. Used by the preview API for workspace-scoped resources.
    export async function hasWorkspaceAccess(client: ClientBase, fkOAuthClient: number, workspace: string): Promise<boolean> {
        const qres = await client.query(SQL`
            SELECT
                TemplateAccessGrant.id AS "id"
            FROM
                TemplateAccessGrant
            WHERE
                TemplateAccessGrant.fkOAuthClient = ${fkOAuthClient} AND
                (TemplateAccessGrant.workspace = ${workspace} OR TemplateAccessGrant.workspace = '*')
            LIMIT 1
        `)
        return qres.rowCount !== 0
    }

    export async function del(client: ClientBase, entity: TemplateAccessGrant.Type): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                TemplateAccessGrant
            WHERE
                TemplateAccessGrant.id = ${entity.id} AND
                TemplateAccessGrant.version = ${entity.version}
        `)
        return qres.rowCount as number
    }

    // Deletes every access grant belonging to the OAuth clients of an account.
    // Used when the account is physically removed, before its clients are deleted.
    export async function deleteByOwnerAccount(client: ClientBase, ownerId: number): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                TemplateAccessGrant
            WHERE
                TemplateAccessGrant.fkOAuthClient IN (
                    SELECT OAuthClient.id FROM OAuthClient WHERE OAuthClient.fkUserAccount = ${ownerId}
                )
        `)
        return qres.rowCount ? qres.rowCount : 0
    }

}
