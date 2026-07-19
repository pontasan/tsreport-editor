import { OAuthAccessToken } from '@/lib/server/entity/OAuthAccessToken'
import { ClientBase } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

export namespace OAuthAccessTokenDao {

    function baseQuery(): SQLStatement {
        return SQL`
            SELECT
                OAuthAccessToken.id AS "id",
                OAuthAccessToken.fkOAuthClient AS "fkOAuthClient",
                OAuthAccessToken.tokenHash AS "tokenHash",
                OAuthAccessToken.scopes AS "scopes",
                OAuthAccessToken.expiration AS "expiration",
                OAuthAccessToken.createUser AS "createUser",
                OAuthAccessToken.updateUser AS "updateUser",
                OAuthAccessToken.creation AS "creation",
                OAuthAccessToken.modification AS "modification",
                OAuthAccessToken.version AS "version"
            FROM
                OAuthAccessToken
        `
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`SELECT NEXTVAL('OAuthAccessTokenSeq') AS "id"`)
        return qres.rows[0].id
    }

    export async function insert(client: ClientBase, entity: OAuthAccessToken.Type): Promise<number> {
        const qres = await client.query(SQL`
            INSERT INTO OAuthAccessToken (
                id,
                fkOAuthClient,
                tokenHash,
                scopes,
                expiration,
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.fkOAuthClient},
                ${entity.tokenHash},
                ${entity.scopes},
                NOW() + interval '1 hour',
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
        return qres.rowCount as number
    }

    export async function getActiveByTokenHash(client: ClientBase, tokenHash: string): Promise<OAuthAccessToken.Type | undefined> {
        // Join the owning client so tokens of logically deleted clients are
        // revoked immediately. A deleted owner account is physically removed
        // together with its clients and tokens, so no separate owner check is
        // needed.
        const qres = await client.query(baseQuery().append(SQL`
            JOIN
                OAuthClient ON OAuthClient.id = OAuthAccessToken.fkOAuthClient
            WHERE
                OAuthAccessToken.tokenHash = ${tokenHash} AND
                OAuthAccessToken.expiration > NOW() AND
                OAuthClient.deleteFlag = FALSE
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    // Deletes every access token of the clients owned by an account. Used on
    // account deletion so no live token survives the owner's removal.
    export async function deleteByOwner(client: ClientBase, ownerId: number): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                OAuthAccessToken
            WHERE
                OAuthAccessToken.fkOAuthClient IN (
                    SELECT OAuthClient.id FROM OAuthClient WHERE OAuthClient.fkUserAccount = ${ownerId}
                )
        `)
        return qres.rowCount ? qres.rowCount : 0
    }

    export async function deleteExpired(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                OAuthAccessToken
            WHERE
                OAuthAccessToken.expiration <= NOW()
        `)
        return qres.rowCount ? qres.rowCount : 0
    }

}
