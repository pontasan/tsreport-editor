import { OAuthClient } from '@/lib/server/entity/OAuthClient'
import { ClientBase } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

export namespace OAuthClientDao {

    function baseQuery(): SQLStatement {
        return SQL`
            SELECT
                OAuthClient.id AS "id",
                OAuthClient.fkUserAccount AS "fkUserAccount",
                OAuthClient.clientId AS "clientId",
                OAuthClient.clientSecret AS "clientSecret",
                OAuthClient.scopes AS "scopes",
                OAuthClient.deleteFlag AS "deleteFlag",
                OAuthClient.createUser AS "createUser",
                OAuthClient.updateUser AS "updateUser",
                OAuthClient.creation AS "creation",
                OAuthClient.modification AS "modification",
                OAuthClient.version AS "version"
            FROM
                OAuthClient
        `
    }

    export async function getByClientId(client: ClientBase, clientId: string): Promise<OAuthClient.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                OAuthClient.clientId = ${clientId} AND
                OAuthClient.deleteFlag = FALSE
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function getAnyByClientId(client: ClientBase, clientId: string): Promise<OAuthClient.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                OAuthClient.clientId = ${clientId}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function getById(client: ClientBase, id: number): Promise<OAuthClient.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                OAuthClient.id = ${id}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function listAll(client: ClientBase): Promise<OAuthClient.Type[]> {
        const qres = await client.query(baseQuery().append(SQL`
            ORDER BY
                OAuthClient.deleteFlag ASC,
                OAuthClient.clientId ASC
        `))
        return qres.rows
    }

    // Clients owned by a single account (SaaS tenant isolation).
    export async function listByOwner(client: ClientBase, fkUserAccount: number): Promise<OAuthClient.Type[]> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                OAuthClient.fkUserAccount = ${fkUserAccount}
            ORDER BY
                OAuthClient.deleteFlag ASC,
                OAuthClient.clientId ASC
        `))
        return qres.rows
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`SELECT NEXTVAL('OAuthClientSeq') AS "id"`)
        return qres.rows[0].id
    }

    export async function insert(client: ClientBase, entity: OAuthClient.Type): Promise<number> {
        const qres = await client.query(SQL`
            INSERT INTO OAuthClient (
                id,
                fkUserAccount,
                clientId,
                clientSecret,
                scopes,
                deleteFlag,
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.fkUserAccount},
                ${entity.clientId},
                ${entity.clientSecret},
                ${entity.scopes},
                ${entity.deleteFlag},
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
        return qres.rowCount as number
    }

    export async function update(client: ClientBase, entity: OAuthClient.Type): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                OAuthClient
            SET
                scopes = ${entity.scopes},
                deleteFlag = ${entity.deleteFlag},
                updateUser = ${entity.updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                OAuthClient.id = ${entity.id} AND
                OAuthClient.version = ${entity.version}
        `)
        return qres.rowCount as number
    }

    // Physically deletes every OAuth client owned by an account. Used when the
    // account itself is deleted (withdrawal or administrator deletion). The
    // caller must first delete the clients' access tokens and access grants so
    // no foreign key is left dangling.
    export async function deleteByOwner(client: ClientBase, ownerId: number): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                OAuthClient
            WHERE
                OAuthClient.fkUserAccount = ${ownerId}
        `)
        return qres.rowCount ? qres.rowCount : 0
    }

    export async function updateSecret(client: ClientBase, entity: OAuthClient.Type, clientSecret: string): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                OAuthClient
            SET
                clientSecret = ${clientSecret},
                updateUser = ${entity.updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                OAuthClient.id = ${entity.id} AND
                OAuthClient.version = ${entity.version}
        `)
        return qres.rowCount as number
    }

}
