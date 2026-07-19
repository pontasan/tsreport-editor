import { BusinessException } from '@/lib/common/exception/business_exception'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import { ClientBase } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

const execFileAsync = promisify(execFile)
const NFS_DIR = '/var/nfs'
const ARCHIVE_ROOT = '/tmp/tsreport-editor-archive'

type ExportTable = {
    name: string
    rows: unknown[]
}

type ExportData = {
    schema: 'tsreport-editor-data'
    version: 1
    exportedAt: string
    tables: ExportTable[]
}

// All user-level references (images, subreports, test data JSON) are
// workspace-relative virtual paths, and the server-internal absolute paths
// (/var/nfs/...) are fixed by the deployment layout, so an archive restores
// verbatim on any environment — no path rewriting is needed or offered.
export namespace EditorDataArchiveLogic {

    export async function exportData(): Promise<{ fileName: string, data: Buffer }> {
        const workDir = await createWorkDir()
        try {
            const exportDir = join(workDir, 'export')
            const archivePath = join(workDir, 'tsreport-editor-data.tar.gz')
            await mkdir(exportDir, { recursive: true })

            const exportData = await createSnapshotExportData()
            await writeFile(join(exportDir, 'db.json'), JSON.stringify(exportData, null, 2))
            await writeFile(join(exportDir, 'manifest.json'), JSON.stringify({
                schema: 'tsreport-editor-data',
                version: 1,
                exportedAt: exportData.exportedAt,
                format: 'tar.gz'
            }, null, 2))
            await execFileAsync('cp', ['-a', NFS_DIR, join(exportDir, 'nfs')])
            await execFileAsync('tar', ['-czf', archivePath, '-C', exportDir, '.'])
            const archive = await readFile(archivePath)
            return {
                fileName: 'tsreport-editor-data-' + buildTimestamp() + '.tar.gz',
                data: archive
            }
        } finally {
            await rm(workDir, { recursive: true, force: true })
        }
    }

    export async function importData(archiveBuffer: Buffer): Promise<void> {
        const workDir = await createWorkDir()
        try {
            const archivePath = join(workDir, 'import.tar.gz')
            const extractDir = join(workDir, 'extract')
            const backupNfsDir = join(workDir, 'backup-nfs')
            await mkdir(extractDir, { recursive: true })
            await writeFile(archivePath, archiveBuffer)
            // GNU tar strips leading "/" and rejects ".." components by default.
            // Symlink entries, however, would be recreated inside the extract dir
            // and then copied into /var/nfs, where the file-read APIs (which
            // validate logical paths, not realpath) could follow them out of the
            // workspace. Extract without owner changes, then reject any symlink.
            await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir, '--no-same-owner'])
            await assertNoSymlinks(extractDir)

            const manifest = JSON.parse(await readFile(join(extractDir, 'manifest.json'), 'utf8'))
            if (manifest.schema !== 'tsreport-editor-data' || manifest.version !== 1) {
                throw new BusinessException('インポートファイルの形式が不正です。')
            }

            const exportData: ExportData = JSON.parse(await readFile(join(extractDir, 'db.json'), 'utf8'))
            if (exportData.schema !== 'tsreport-editor-data' || exportData.version !== 1) {
                throw new BusinessException('DBダンプの形式が不正です。')
            }

            await rm(backupNfsDir, { recursive: true, force: true })
            await execFileAsync('cp', ['-a', NFS_DIR, backupNfsDir])

            try {
                await DbUtils.transaction(async function (client) {
                    await importTables(client, exportData)
                    // /var/nfs is a bind mount in the container deployment: the directory
                    // itself cannot be removed (EBUSY), so swap its contents instead.
                    await emptyDir(NFS_DIR)
                    await execFileAsync('cp', ['-a', join(extractDir, 'nfs') + '/.', NFS_DIR])
                })
            } catch (e) {
                await emptyDir(NFS_DIR)
                await execFileAsync('cp', ['-a', backupNfsDir + '/.', NFS_DIR])
                throw e
            }
        } finally {
            await rm(workDir, { recursive: true, force: true })
        }
    }

}

// Dump all tables through the shared DB connection helper; each SQL statement
// runs under PostgreSQL's implicit transaction behavior.
async function createSnapshotExportData(): Promise<ExportData> {
    return await DbUtils.transaction(async function (client) {
        return await createExportData(client)
    })
}

async function createExportData(client: ClientBase): Promise<ExportData> {
    const tableNames = await listTableNames(client)
    const orderedTableNames = await sortTablesByForeignKeys(client, tableNames)
    const tables: ExportTable[] = []
    for (const tableName of orderedTableNames) {
        const sql = SQL`SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM (SELECT * FROM `
        appendQualifiedTable(sql, tableName)
        sql.append(SQL` ORDER BY 1) t`)
        const qres = await client.query(sql)
        tables.push({ name: tableName, rows: qres.rows[0].rows })
    }
    return {
        schema: 'tsreport-editor-data',
        version: 1,
        exportedAt: new Date().toISOString(),
        tables
    }
}

async function importTables(client: ClientBase, exportData: ExportData): Promise<void> {
    const tableNames = exportData.tables.map(function (table) { return table.name })
    if (tableNames.length === 0) return
    const truncateSql = SQL`TRUNCATE TABLE `
    appendQualifiedTableList(truncateSql, tableNames)
    truncateSql.append(SQL` RESTART IDENTITY CASCADE`)
    await client.query(truncateSql)
    for (const table of exportData.tables) {
        if (table.rows.length === 0) continue
        const insertSql = SQL`INSERT INTO `
        appendQualifiedTable(insertSql, table.name)
        insertSql.append(SQL` SELECT * FROM jsonb_populate_recordset(NULL::`)
        appendQualifiedTable(insertSql, table.name)
        insertSql.append(SQL`, ${JSON.stringify(table.rows)}::jsonb)`)
        await client.query(insertSql)
    }
    await resetSequences(client, tableNames)
}

async function listTableNames(client: ClientBase): Promise<string[]> {
    const qres = await client.query(SQL`
        SELECT table_name AS name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `)
    return qres.rows.map(function (row) { return row.name })
}

async function sortTablesByForeignKeys(client: ClientBase, tableNames: string[]): Promise<string[]> {
    const qres = await client.query(SQL`
        SELECT
            source.relname AS source,
            target.relname AS target
        FROM pg_constraint c
        JOIN pg_class source ON source.oid = c.conrelid
        JOIN pg_class target ON target.oid = c.confrelid
        JOIN pg_namespace n ON n.oid = source.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname = 'public'
    `)
    const tableSet = new Set(tableNames)
    const dependencies = new Map<string, Set<string>>()
    for (const tableName of tableNames) {
        dependencies.set(tableName, new Set())
    }
    for (const row of qres.rows) {
        if (tableSet.has(row.source) && tableSet.has(row.target)) {
            dependencies.get(row.source)!.add(row.target)
        }
    }

    const result: string[] = []
    while (result.length < tableNames.length) {
        let progressed = false
        for (const tableName of tableNames) {
            if (result.includes(tableName)) continue
            const deps = dependencies.get(tableName)!
            let ready = true
            deps.forEach(function (dep) {
                if (!result.includes(dep)) ready = false
            })
            if (ready) {
                result.push(tableName)
                progressed = true
            }
        }
        if (!progressed) {
            throw new BusinessException('DBテーブルの依存関係を解決できません。')
        }
    }
    return result
}

// This project's sequences are standalone objects named "<table>seq" (no OWNED BY,
// no serial/identity), so pg_depend has no link between sequence and table.
// Resolve them by the naming convention and realign each to the imported table's
// max primary-key value, otherwise NEXTVAL after import collides with imported ids.
async function resetSequences(client: ClientBase, tableNames: string[]): Promise<void> {
    const seqRes = await client.query(SQL`
        SELECT seq.relname AS sequence_name
        FROM pg_class seq
        JOIN pg_namespace ns ON ns.oid = seq.relnamespace
        WHERE seq.relkind = 'S'
          AND ns.nspname = 'public'
        ORDER BY seq.relname
    `)
    const pkRes = await client.query(SQL`
        SELECT
            tc.table_name AS table_name,
            kcu.column_name AS column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
    `)
    const pkColumns = new Map<string, string[]>()
    for (const row of pkRes.rows) {
        const columns = pkColumns.get(row.table_name)
        if (columns === undefined) {
            pkColumns.set(row.table_name, [row.column_name])
        } else {
            columns.push(row.column_name)
        }
    }

    const tableSet = new Set(tableNames)
    for (const row of seqRes.rows) {
        const sequenceName: string = row.sequence_name
        if (!sequenceName.endsWith('seq')) continue
        const tableName = sequenceName.substring(0, sequenceName.length - 3)
        if (!tableSet.has(tableName)) continue
        const columns = pkColumns.get(tableName)
        if (columns === undefined || columns.length !== 1) continue
        const column = columns[0]
        const sql = SQL`SELECT setval(${'public.' + quoteIdent(sequenceName)}::regclass, COALESCE((SELECT MAX(`
        sql.append(quoteIdent(column))
        sql.append(SQL`) FROM `)
        appendQualifiedTable(sql, tableName)
        sql.append(SQL`), 1), (SELECT MAX(`)
        sql.append(quoteIdent(column))
        sql.append(SQL`) IS NOT NULL FROM `)
        appendQualifiedTable(sql, tableName)
        sql.append(SQL`))`)
        await client.query(sql)
    }
}

// Removes every entry inside the directory while keeping the directory itself
// (required because /var/nfs is a container bind mount).
async function emptyDir(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath)
    for (const entry of entries) {
        await rm(join(dirPath, entry), { recursive: true, force: true })
    }
}

async function createWorkDir(): Promise<string> {
    const workDir = join(ARCHIVE_ROOT, randomUUID())
    await mkdir(workDir, { recursive: true })
    return workDir
}

// Rejects an extracted archive that contains any symbolic link, so no link can
// be copied into /var/nfs and later followed out of the workspace by the
// path-validating file APIs.
async function assertNoSymlinks(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)
        const stat = await lstat(fullPath)
        if (stat.isSymbolicLink()) {
            throw new BusinessException('インポートファイルにシンボリックリンクが含まれているため取り込めません。')
        }
        if (stat.isDirectory()) {
            await assertNoSymlinks(fullPath)
        }
    }
}

function quoteIdent(value: string): string {
    return '"' + value.replace(/"/g, '""') + '"'
}

function appendQualifiedTable(sql: SQLStatement, tableName: string): void {
    sql.append(SQL`public.`)
    sql.append(quoteIdent(tableName))
}

function appendQualifiedTableList(sql: SQLStatement, tableNames: string[]): void {
    for (let i = 0; i < tableNames.length; i++) {
        if (i > 0) {
            sql.append(SQL`, `)
        }
        appendQualifiedTable(sql, tableNames[i]!)
    }
}

function buildTimestamp(): string {
    const d = new Date()
    return String(d.getFullYear())
        + String(d.getMonth() + 1).padStart(2, '0')
        + String(d.getDate()).padStart(2, '0')
        + String(d.getHours()).padStart(2, '0')
        + String(d.getMinutes()).padStart(2, '0')
        + String(d.getSeconds()).padStart(2, '0')
}
