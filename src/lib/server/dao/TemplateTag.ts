import { TemplateTag } from '@/lib/server/entity/TemplateTag'
import { ClientBase } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

export namespace TemplateTagDao {

    function baseQuery(): SQLStatement {
        return SQL`
            SELECT
                TemplateTag.id AS "id",
                TemplateTag.workspace AS "workspace",
                TemplateTag.templatePath AS "templatePath",
                TemplateTag.tag AS "tag",
                TemplateTag.description AS "description",
                TemplateTag.templateJson AS "templateJson",
                TemplateTag.endpoint AS "endpoint",
                TemplateTag.createUser AS "createUser",
                TemplateTag.updateUser AS "updateUser",
                TemplateTag.creation AS "creation",
                TemplateTag.modification AS "modification",
                TemplateTag.version AS "version"
            FROM
                TemplateTag
        `
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`SELECT NEXTVAL('TemplateTagSeq') AS "id"`)
        return qres.rows[0].id
    }

    export async function insert(client: ClientBase, entity: TemplateTag.Type): Promise<number> {
        const qres = await client.query(SQL`
            INSERT INTO TemplateTag (
                id,
                workspace,
                templatePath,
                tag,
                description,
                templateJson,
                endpoint,
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.workspace},
                ${entity.templatePath},
                ${entity.tag},
                ${entity.description},
                ${entity.templateJson},
                ${entity.endpoint},
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
        return qres.rowCount as number
    }

    export async function getByPathAndTag(client: ClientBase, workspace: string, templatePath: string, tag: string): Promise<TemplateTag.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                TemplateTag.workspace = ${workspace} AND
                TemplateTag.templatePath = ${templatePath} AND
                TemplateTag.tag = ${tag}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function getById(client: ClientBase, id: number): Promise<TemplateTag.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                TemplateTag.id = ${id}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    export async function updateTemplateJson(client: ClientBase, entity: TemplateTag.Type): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                TemplateTag
            SET
                templateJson = ${entity.templateJson},
                updateUser = ${entity.updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                TemplateTag.id = ${entity.id} AND
                TemplateTag.version = ${entity.version}
        `)
        return qres.rowCount as number
    }

    export async function del(client: ClientBase, entity: TemplateTag.Type): Promise<number> {
        const qres = await client.query(SQL`
            DELETE FROM
                TemplateTag
            WHERE
                TemplateTag.id = ${entity.id} AND
                TemplateTag.version = ${entity.version}
        `)
        return qres.rowCount as number
    }

    export async function listByTemplate(client: ClientBase, workspace: string, templatePath: string): Promise<TemplateTag.Type[]> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                TemplateTag.workspace = ${workspace} AND
                TemplateTag.templatePath = ${templatePath}
            ORDER BY
                TemplateTag.creation DESC,
                TemplateTag.id DESC
        `))
        return qres.rows
    }

    // Deletes every published tag in a workspace. Used when the owning account is
    // physically removed. Callers must first detach any print history that
    // references these tags (PrintRequest.fkTemplateTag).
    export async function deleteByWorkspace(client: ClientBase, workspace: string): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                TemplateTag
            WHERE
                TemplateTag.workspace = ${workspace}
        `)
        return qres.rowCount ? qres.rowCount : 0
    }

}
