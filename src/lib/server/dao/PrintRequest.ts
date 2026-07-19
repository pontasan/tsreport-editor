import { PrintRequest } from '@/lib/server/entity/PrintRequest'
import { ClientBase } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

export namespace PrintRequestDao {

    // A history row projected for the account-scoped listing, with the API
    // client id joined in (NULL for editor / MCP rows).
    export type HistoryRow = {
        id: number,
        key: string,
        via: string,
        workspace: string,
        templatePath: string,
        format: string,
        status: string,
        errorReason: string | null,
        pdfPath: string | null,
        creation: Date,
        clientId: string | null
    }

    function baseQuery(): SQLStatement {
        return SQL`
            SELECT
                PrintRequest.id AS "id",
                PrintRequest.key AS "key",
                PrintRequest.endpoint AS "endpoint",
                PrintRequest.fkUserAccount AS "fkUserAccount",
                PrintRequest.via AS "via",
                PrintRequest.workspace AS "workspace",
                PrintRequest.templatePath AS "templatePath",
                PrintRequest.format AS "format",
                PrintRequest.fkOAuthClient AS "fkOAuthClient",
                PrintRequest.fkTemplateTag AS "fkTemplateTag",
                PrintRequest.requestBodyJson AS "requestBodyJson",
                PrintRequest.status AS "status",
                PrintRequest.pdfPath AS "pdfPath",
                PrintRequest.errorReason AS "errorReason",
                PrintRequest.createUser AS "createUser",
                PrintRequest.updateUser AS "updateUser",
                PrintRequest.creation AS "creation",
                PrintRequest.modification AS "modification",
                PrintRequest.version AS "version"
            FROM
                PrintRequest
        `
    }

    export async function getSequenceId(client: ClientBase): Promise<number> {
        const qres = await client.query(SQL`SELECT NEXTVAL('PrintRequestSeq') AS "id"`)
        return qres.rows[0].id
    }

    export async function insert(client: ClientBase, entity: PrintRequest.Type): Promise<number> {
        const qres = await client.query(SQL`
            INSERT INTO PrintRequest (
                id,
                key,
                endpoint,
                fkUserAccount,
                via,
                workspace,
                templatePath,
                format,
                fkOAuthClient,
                fkTemplateTag,
                requestBodyJson,
                status,
                pdfPath,
                errorReason,
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.id},
                ${entity.key},
                ${entity.endpoint},
                ${entity.fkUserAccount},
                ${entity.via},
                ${entity.workspace},
                ${entity.templatePath},
                ${entity.format},
                ${entity.fkOAuthClient},
                ${entity.fkTemplateTag},
                ${entity.requestBodyJson},
                ${entity.status},
                ${entity.pdfPath},
                ${entity.errorReason},
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
        return qres.rowCount as number
    }

    export async function getByKey(client: ClientBase, key: string, fkOAuthClient: number): Promise<PrintRequest.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                PrintRequest.key = ${key} AND
                PrintRequest.fkOAuthClient = ${fkOAuthClient}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    // A history row the account owns, for a cookie-authenticated download.
    export async function getByKeyAndAccount(client: ClientBase, key: string, fkUserAccount: number): Promise<PrintRequest.Type | undefined> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                PrintRequest.key = ${key} AND
                PrintRequest.fkUserAccount = ${fkUserAccount}
        `))
        return qres.rowCount !== 0 ? qres.rows[0] : undefined
    }

    // Newest-first page of an account's print history, with the API client id
    // joined in for display.
    export async function listByAccount(client: ClientBase, fkUserAccount: number, offset: number, limit: number): Promise<HistoryRow[]> {
        const qres = await client.query(SQL`
            SELECT
                PrintRequest.id AS "id",
                PrintRequest.key AS "key",
                PrintRequest.via AS "via",
                PrintRequest.workspace AS "workspace",
                PrintRequest.templatePath AS "templatePath",
                PrintRequest.format AS "format",
                PrintRequest.status AS "status",
                PrintRequest.errorReason AS "errorReason",
                PrintRequest.pdfPath AS "pdfPath",
                PrintRequest.creation AS "creation",
                OAuthClient.clientId AS "clientId"
            FROM
                PrintRequest
                LEFT JOIN OAuthClient ON (OAuthClient.id = PrintRequest.fkOAuthClient)
            WHERE
                PrintRequest.fkUserAccount = ${fkUserAccount}
            ORDER BY
                PrintRequest.id DESC
            LIMIT ${limit} OFFSET ${offset}
        `)
        return qres.rows
    }

    export async function countByAccount(client: ClientBase, fkUserAccount: number): Promise<number> {
        const qres = await client.query(SQL`
            SELECT
                COUNT(*) AS "count"
            FROM
                PrintRequest
            WHERE
                PrintRequest.fkUserAccount = ${fkUserAccount}
        `)
        return Number(qres.rows[0].count)
    }

    export async function listQueued(client: ClientBase, limit: number): Promise<PrintRequest.Type[]> {
        const qres = await client.query(baseQuery().append(SQL`
            WHERE
                PrintRequest.status = 'queued'
            ORDER BY
                PrintRequest.id ASC
            LIMIT ${limit}
        `))
        return qres.rows
    }

    export async function markProcessing(client: ClientBase, entity: PrintRequest.Type): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                PrintRequest
            SET
                status = 'processing',
                updateUser = ${entity.updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                PrintRequest.id = ${entity.id} AND
                PrintRequest.version = ${entity.version} AND
                PrintRequest.status = 'queued'
        `)
        return qres.rowCount as number
    }

    export async function markCompleted(client: ClientBase, entity: PrintRequest.Type, pdfPath: string): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                PrintRequest
            SET
                status = 'completed',
                pdfPath = ${pdfPath},
                errorReason = NULL,
                updateUser = ${entity.updateUser},
                modification = NOW(),
                version = version + 1
            WHERE
                PrintRequest.id = ${entity.id}
        `)
        return qres.rowCount as number
    }

    export async function countByTemplateTag(client: ClientBase, fkTemplateTag: number): Promise<number> {
        const qres = await client.query(SQL`
            SELECT
                COUNT(*) AS "count"
            FROM
                PrintRequest
            WHERE
                PrintRequest.fkTemplateTag = ${fkTemplateTag}
        `)
        return Number(qres.rows[0].count)
    }

    export async function markError(client: ClientBase, id: number, errorReason: string): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                PrintRequest
            SET
                status = 'error',
                errorReason = ${errorReason},
                modification = NOW(),
                version = version + 1
            WHERE
                PrintRequest.id = ${id}
        `)
        return qres.rowCount as number
    }

    // Lists the on-disk PDF paths of an account's completed requests, so the
    // caller can unlink the files when the account is physically removed.
    export async function listPdfPathsByAccount(client: ClientBase, fkUserAccount: number): Promise<string[]> {
        const qres = await client.query(SQL`
            SELECT
                PrintRequest.pdfPath AS "pdfPath"
            FROM
                PrintRequest
            WHERE
                PrintRequest.fkUserAccount = ${fkUserAccount} AND
                PrintRequest.pdfPath IS NOT NULL
        `)
        return qres.rows.map(function (row) { return row.pdfPath as string })
    }

    // Deletes every print request (queue + history) owned by an account. Used
    // when the account is physically removed.
    export async function deleteByUserAccount(client: ClientBase, fkUserAccount: number): Promise<number> {
        const qres = await client.query(SQL`
            DELETE
            FROM
                PrintRequest
            WHERE
                PrintRequest.fkUserAccount = ${fkUserAccount}
        `)
        return qres.rowCount ? qres.rowCount : 0
    }

    // Detaches history rows (of any account) from the template tags published in
    // a workspace, so those tags can be deleted when their owning account is
    // removed. The history rows stay: they are self-describing via
    // workspace/templatePath/format.
    export async function detachTemplateTagsByWorkspace(client: ClientBase, workspace: string): Promise<number> {
        const qres = await client.query(SQL`
            UPDATE
                PrintRequest
            SET
                fkTemplateTag = NULL,
                modification = NOW(),
                version = version + 1
            WHERE
                PrintRequest.fkTemplateTag IN (
                    SELECT TemplateTag.id FROM TemplateTag WHERE TemplateTag.workspace = ${workspace}
                )
        `)
        return qres.rowCount ? qres.rowCount : 0
    }

}
