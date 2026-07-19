import { ClientBase } from 'pg'
import SQL from 'sql-template-strings'

export namespace BatchLockDao {

    export async function findByKey(client: ClientBase, key: string): Promise<number | undefined> {
        const result = await client.query(SQL`
            SELECT
                BatchLock.id
            FROM
                BatchLock
            WHERE
                BatchLock.key = ${key}
        `)
        return result.rowCount ? result.rows[0].id : undefined
    }

    export async function insert(client: ClientBase, key: string): Promise<void> {
        await client.query(SQL`
            INSERT INTO BatchLock (
                id,
                key,
                creation,
                modification,
                version
            ) VALUES (
                NEXTVAL('BatchLockSeq'),
                ${key},
                NOW(),
                NOW(),
                0
            )
        `)
    }

    export async function lockNowait(client: ClientBase, key: string): Promise<void> {
        await client.query(SQL`
            SELECT
                BatchLock.id
            FROM
                BatchLock
            WHERE
                BatchLock.key = ${key}
            FOR UPDATE NOWAIT
        `)
    }

}
