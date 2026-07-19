import { SystemProperty } from '@/lib/server/entity/SystemProperty';
import { ClientBase } from 'pg';
import SQL, { SQLStatement } from 'sql-template-strings';

export namespace SystemPropertyDao {

    function baseQuery(): SQLStatement {
        return SQL`
            SELECT
                SystemProperty.id AS "id",
                SystemProperty.key AS "key",
                SystemProperty.value AS "value",
                SystemProperty.createUser AS "createUser",
                SystemProperty.updateUser AS "updateUser",
                SystemProperty.creation AS "creation",
                SystemProperty.modification AS "modification",
                SystemProperty.version AS "version"
            FROM
                SystemProperty
        `
    }

    export async function getById(client: ClientBase, id: number | undefined): Promise<SystemProperty.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                SystemProperty.id = ${id}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function findByKey(client: ClientBase, key: string): Promise<SystemProperty.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                SystemProperty.key = ${key}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function listAll(client: ClientBase): Promise<SystemProperty.Type[]> {
        const qres = await client.query(baseQuery().append(SQL`
            ORDER BY
                SystemProperty.id ASC
        `))
        return qres.rows
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`SELECT NEXTVAL('SystemPropertySeq') AS "id"`)
        return qres.rows[0].id
    }

    export async function insert(client: ClientBase, entity: SystemProperty.Type): Promise<number> {
        const qres = await client.query(SQL`
            INSERT INTO SystemProperty (
                id,
                key,
                value,
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.key},
                ${entity.value},
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
        return qres.rowCount as number
    }

    export async function update(client: ClientBase, entity: SystemProperty.Type): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                SystemProperty
            SET
                value = ${entity.value},
                updateUser = ${entity.updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                SystemProperty.id = ${entity.id} AND
                SystemProperty.version = ${entity.version}
        `)
        return qres.rowCount as number
    }

}
