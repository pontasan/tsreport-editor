import { DateUtils } from '@/lib/common/utils/date_utils'
import { PrintRequestDao } from '@/lib/server/dao/PrintRequest'
import { PrintRequest } from '@/lib/server/entity/PrintRequest'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { ClientBase } from 'pg'

// Unified print history: recording of editor/MCP prints (the API path records
// its own rows through the queue) and account-scoped, paginated listing.
//
// Every path stores its PDF under the same flat output directory, named by the
// history row's public key, and downloads go through an account-checked route.

const OUTPUT_DIR = '/var/nfs/report-pdf'

export type PrintHistoryItem = {
    key: string
    via: string
    workspace: string
    templatePath: string
    format: string
    status: string
    errorReason: string
    // The API client id for API prints; '' for editor / MCP.
    clientId: string
    creation: string
    downloadable: boolean
}

export type PrintHistoryPage = {
    items: PrintHistoryItem[]
    total: number
}

export namespace PrintHistoryLogic {

    // A public key that is also safe as a PDF filename.
    function generateKey(): string {
        return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
    }

    // Stores a rendered PDF and inserts a completed history row for a path that
    // produces its output synchronously (editor / MCP). Returns the key.
    export async function recordCompleted(
        client: ClientBase,
        fkUserAccount: number,
        via: PrintRequest.Via,
        workspace: string,
        templatePath: string,
        format: string,
        endpoint: string,
        pdfBytes: Uint8Array
    ): Promise<string> {
        const key = generateKey()
        await mkdir(OUTPUT_DIR, { recursive: true })
        const pdfPath = join(OUTPUT_DIR, key + '.pdf')
        await writeFile(pdfPath, Buffer.from(pdfBytes))

        const entity = PrintRequest.create()
        entity.id = await PrintRequestDao.getSequenceId(client)
        entity.key = key
        entity.endpoint = endpoint
        entity.fkUserAccount = fkUserAccount
        entity.via = via
        entity.workspace = workspace
        entity.templatePath = templatePath
        entity.format = format
        entity.requestBodyJson = ''
        entity.status = 'completed'
        entity.pdfPath = pdfPath
        entity.createUser = fkUserAccount
        entity.updateUser = fkUserAccount
        await PrintRequestDao.insert(client, entity)
        return key
    }

    // Newest-first page of an account's print history plus the total count (for
    // the lazy-loaded, paginated history table).
    export async function listHistory(client: ClientBase, fkUserAccount: number, offset: number, limit: number): Promise<PrintHistoryPage> {
        const rows = await PrintRequestDao.listByAccount(client, fkUserAccount, offset, limit)
        const items: PrintHistoryItem[] = []
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            items.push({
                key: row.key,
                via: row.via,
                workspace: row.workspace,
                templatePath: row.templatePath,
                format: row.format,
                status: row.status,
                errorReason: row.errorReason ?? '',
                clientId: row.clientId ?? '',
                creation: DateUtils.formatTime(row.creation),
                downloadable: row.status === 'completed' && row.pdfPath !== null && row.pdfPath !== undefined
            })
        }
        const total = await PrintRequestDao.countByAccount(client, fkUserAccount)
        return { items, total }
    }

}
