import { BatchLockDao } from '@/lib/server/dao/BatchLock'
import { OAuthClientDao } from '@/lib/server/dao/OAuthClient'
import { SystemPropertyDao } from '@/lib/server/dao/SystemProperty'
import { TemplateAccessGrantDao } from '@/lib/server/dao/TemplateAccessGrant'
import { TemplateTagDao } from '@/lib/server/dao/TemplateTag'
import { UserAccountDao } from '@/lib/server/dao/user_account'
import { OAuthClient } from '@/lib/server/entity/OAuthClient'
import { SystemProperty } from '@/lib/server/entity/SystemProperty'
import { TemplateAccessGrant } from '@/lib/server/entity/TemplateAccessGrant'
import { FolderShareDao } from '@/lib/server/dao/FolderShare'
import { FolderShare } from '@/lib/server/entity/FolderShare'
import { UserAccount } from '@/lib/server/entity/user_account'
import { PasswordHash } from '@/lib/server/logic/password_hash'
import { ReportApiLogic } from '@/lib/server/logic/report_api_logic'
import { workspacesDir } from '@/lib/server/logic/workspace_paths'
import { DbUtils } from '@/lib/server/utils/db_utils'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { cp, mkdir, readdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { Client, ClientBase } from 'pg'
import { promisify } from 'util'
import SQL, { SQLStatement } from 'sql-template-strings'

const execFileAsync = promisify(execFile)

// Serializes first-boot initialization across the pm2 cluster processes.
const INIT_ADVISORY_LOCK_KEY = 7345001
const INITIALIZED_KEY = 'system.initialized'
// Fixed workspace keys for the seed accounts so the regression suites can
// address the seeded workspaces by a stable UUID.
const ADMIN_WORKSPACE_KEY = '00000000-0000-0000-0000-000000000001'
const TEST_WORKSPACE_KEY = '00000000-0000-0000-0000-000000000002'
const RESET_WORK_ROOT = '/tmp/tsreport-editor-factory-reset'
const DB_WAIT_ATTEMPTS = 30
const DB_WAIT_INTERVAL_MS = 2000

export const INITIAL_ACCOUNT_DISPLAY_NAMES = {
    admin: 'Administrator',
    test: 'Test User',
} as const

export type SystemInitContext = {
    workspacesRoot: string
    outputRoot: string
    seedRoot: string
}

export namespace SystemInitLogic {

    export function defaultContext(): SystemInitContext {
        return {
            workspacesRoot: workspacesDir(),
            outputRoot: '/var/nfs/report-pdf',
            // The seed directory ships with the application (repository "seed/").
            seedRoot: join(process.cwd(), 'seed')
        }
    }

    // Called once from instrumentation at server boot. Seeds the initial
    // environment (accounts, API client, sample workspace, published tag)
    // exactly once, tracked by the SystemProperty "system.initialized".
    export async function ensureInitialized(context: SystemInitContext): Promise<void> {
        await waitForDatabase()
        await DbUtils.transaction(async function (client) {
            await client.query(SQL`SELECT pg_advisory_lock(${INIT_ADVISORY_LOCK_KEY})`)
            try {
                const initialized = await SystemPropertyDao.findByKey(client, INITIALIZED_KEY)
                if (initialized !== undefined) {
                    await convergeLegacySeedDisplayNames(client)
                    await migrateLegacyPasswords(client)
                    return
                }
                await seedInitialData(client, context)
                await migrateLegacyPasswords(client)
                await markInitialized(client)
            } finally {
                await client.query(SQL`SELECT pg_advisory_unlock(${INIT_ADVISORY_LOCK_KEY})`)
            }
        })
    }

    // Administrator-only factory reset: wipes every DB table, the workspaces
    // directory and the print output directory, then rebuilds the initial
    // environment with the same seed routine as the first boot.
    // Only the workspaces/output directories are touched (fonts, certificates
    // and the NFS mount itself are left alone), and dotfiles such as
    // .gitignore inside those directories are preserved.
    export async function factoryReset(context: SystemInitContext): Promise<void> {
        const workDir = join(RESET_WORK_ROOT, randomUUID())
        await mkdir(workDir, { recursive: true })
        try {
            const workspacesBackup = join(workDir, 'workspaces')
            await execFileAsync('cp', ['-a', context.workspacesRoot, workspacesBackup])
            const hasOutputDir = existsSync(context.outputRoot)
            const outputBackup = join(workDir, 'output')
            if (hasOutputDir) {
                await execFileAsync('cp', ['-a', context.outputRoot, outputBackup])
            }

            try {
                await DbUtils.transaction(async function (client) {
                    await client.query(SQL`SELECT pg_advisory_lock(${INIT_ADVISORY_LOCK_KEY})`)
                    try {
                        await truncateAllTables(client)
                        await removeEntriesKeepingDotfiles(context.workspacesRoot)
                        if (hasOutputDir) {
                            await removeEntriesKeepingDotfiles(context.outputRoot)
                        }
                        await seedInitialData(client, context)
                        await markInitialized(client)
                    } finally {
                        await client.query(SQL`SELECT pg_advisory_unlock(${INIT_ADVISORY_LOCK_KEY})`)
                    }
                })
            } catch (e) {
                await removeEntriesKeepingDotfiles(context.workspacesRoot)
                await execFileAsync('cp', ['-a', workspacesBackup + '/.', context.workspacesRoot])
                if (hasOutputDir) {
                    await removeEntriesKeepingDotfiles(context.outputRoot)
                    await execFileAsync('cp', ['-a', outputBackup + '/.', context.outputRoot])
                }
                throw e
            }
        } finally {
            await rm(workDir, { recursive: true, force: true })
        }
    }

}

// Renames only the exact display names shipped by older seeds. User-edited
// names are preserved because the old value, login id and fixed workspace key
// must all match before an update is made.
async function convergeLegacySeedDisplayNames(client: ClientBase): Promise<void> {
    await client.query(SQL`
        UPDATE UserAccount
        SET
            displayName = ${INITIAL_ACCOUNT_DISPLAY_NAMES.admin},
            modification = NOW(),
            version = version + 1
        WHERE
            userId = 'admin' AND
            workspaceKey = ${ADMIN_WORKSPACE_KEY} AND
            displayName = '管理者'
    `)
    await client.query(SQL`
        UPDATE UserAccount
        SET
            displayName = ${INITIAL_ACCOUNT_DISPLAY_NAMES.test},
            modification = NOW(),
            version = version + 1
        WHERE
            userId = 'test' AND
            workspaceKey = ${TEST_WORKSPACE_KEY} AND
            displayName = 'テストユーザ'
    `)
}

async function migrateLegacyPasswords(client: ClientBase): Promise<void> {
    const accounts = await UserAccountDao.listLocalPasswordAccountsForUpdate(client)
    for (const account of accounts) {
        if (PasswordHash.isArgon2id(account.pw)) continue
        account.pw = await PasswordHash.create(account.pw)
        const count = await UserAccountDao.update(client, account)
        if (count !== 1) {
            throw new Error(`Failed to migrate password for account ${account.id}`)
        }
    }
}

// Boot-order sequencing: the DB container may still be starting when the app
// boots, so wait until a connection succeeds before running initialization.
async function waitForDatabase(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            const client = await DbUtils.createDbClient(false)
            await (client as Client).end()
            return
        } catch (e) {
            if (attempt >= DB_WAIT_ATTEMPTS) {
                throw e
            }
            await new Promise(function (resolve) { setTimeout(resolve, DB_WAIT_INTERVAL_MS) })
        }
    }
}

// Each step checks by natural key so initialization converges even on a
// database that already carries part of the seed (e.g. upgraded environments).
async function seedInitialData(client: ClientBase, context: SystemInitContext): Promise<void> {
    // MCP keys and workspace keys are fixed for the regression suites (like the
    // seeded passwords).
    const admin = await ensureUserAccount(client, context, INITIAL_ACCOUNT_DISPLAY_NAMES.admin, 'admin', 'pass', true, 'admin-mcp-key', ADMIN_WORKSPACE_KEY)
    const test = await ensureUserAccount(client, context, INITIAL_ACCOUNT_DISPLAY_NAMES.test, 'test', 'pass', false, 'test-mcp-key', TEST_WORKSPACE_KEY)
    await ensureSystemProperty(client, 'mcp.enabled', 'true')
    await ensureSystemProperty(client, 'mcp.port', '52006')
    // External sign-in (Google / Microsoft) is disabled until an administrator
    // configures each provider's client credentials.
    await ensureSystemProperty(client, 'oauth.google.enabled', 'false')
    await ensureSystemProperty(client, 'oauth.google.clientId', '')
    await ensureSystemProperty(client, 'oauth.google.clientSecret', '')
    await ensureSystemProperty(client, 'oauth.microsoft.enabled', 'false')
    await ensureSystemProperty(client, 'oauth.microsoft.clientId', '')
    await ensureSystemProperty(client, 'oauth.microsoft.clientSecret', '')
    // The regression OAuth client belongs to the test account (its fonts and
    // ownership follow that account). The test account's actual workspaceKey is
    // used throughout so the seed converges even on an upgraded database whose
    // test account predates the fixed key.
    await ensureSeedOAuthClient(client, test.id, test.workspaceKey)
    await ensureBatchLock(client, 'report-print')
    await ensureSampleWorkspaceFiles(context, test.workspaceKey)
    await ensureSeedTemplateTag(client, context, test.workspaceKey)
    // Example cross-account share for the regression suites: the test account
    // shares its "assets" folder with the admin account (read + write).
    await ensureSeedFolderShare(client, test.id, admin.id, 'assets')
}

async function markInitialized(client: ClientBase): Promise<void> {
    const entity = SystemProperty.create()
    entity.id = await SystemPropertyDao.getSequenceId(client)
    entity.key = INITIALIZED_KEY
    entity.value = new Date().toISOString()
    await SystemPropertyDao.insert(client, entity)
}

async function ensureUserAccount(client: ClientBase, context: SystemInitContext, displayName: string, userId: string, pw: string, adminFlag: boolean, mcpKey: string, workspaceKey: string): Promise<{ id: number, workspaceKey: string }> {
    const existing = await UserAccountDao.getByUserId(client, userId)
    if (existing !== undefined) {
        await mkdir(join(context.workspacesRoot, existing.workspaceKey), { recursive: true })
        return { id: existing.id!, workspaceKey: existing.workspaceKey }
    }
    const seqId = await UserAccountDao.getSequenceId(client)
    const entity = UserAccount.create()
    entity.id = seqId
    entity.displayName = displayName
    entity.userId = userId
    entity.pw = await PasswordHash.create(pw)
    entity.workspaceKey = workspaceKey
    entity.adminFlag = adminFlag
    entity.mcpKey = mcpKey
    await UserAccountDao.insert(client, entity)
    await mkdir(join(context.workspacesRoot, workspaceKey), { recursive: true })
    return { id: seqId, workspaceKey }
}

// Seeds one folder share (owner shares a folder with a grantee, read + write).
async function ensureSeedFolderShare(client: ClientBase, ownerId: number, granteeId: number, path: string): Promise<void> {
    const existing = await FolderShareDao.getByTriple(client, ownerId, granteeId, path)
    if (existing !== undefined) {
        return
    }
    const entity = FolderShare.create()
    entity.id = await FolderShareDao.getSequenceId(client)
    entity.fkOwnerAccount = ownerId
    entity.fkGranteeAccount = granteeId
    entity.path = path
    entity.canRead = true
    entity.canWrite = true
    await FolderShareDao.insert(client, entity)
}

async function ensureSystemProperty(client: ClientBase, key: string, value: string): Promise<void> {
    const existing = await SystemPropertyDao.findByKey(client, key)
    if (existing !== undefined) {
        return
    }
    const entity = SystemProperty.create()
    entity.id = await SystemPropertyDao.getSequenceId(client)
    entity.key = key
    entity.value = value
    await SystemPropertyDao.insert(client, entity)
}

// Seed OAuth client for the regression tests (tsreport-sdk / tsreport-react
// "test:live"): test-report-client / test-report-secret with a wildcard grant.
async function ensureSeedOAuthClient(client: ClientBase, ownerId: number, workspaceKey: string): Promise<void> {
    const existing = await OAuthClientDao.getAnyByClientId(client, 'test-report-client')
    let clientId: number
    if (existing !== undefined) {
        clientId = existing.id!
    } else {
        clientId = await OAuthClientDao.getSequenceId(client)
        const entity = OAuthClient.create()
        entity.id = clientId
        entity.fkUserAccount = ownerId
        entity.clientId = 'test-report-client'
        entity.clientSecret = 'test-report-secret'
        entity.scopes = 'report:print report:status report:download report:preview'
        await OAuthClientDao.insert(client, entity)
    }
    await ensureSeedWildcardGrant(client, clientId, workspaceKey)
}

// Ensures the seed client holds a workspace-wide (path '') grant on the owning
// account's workspaceKey, creating it when absent. Never touches grants on other
// workspaces (a client may legitimately hold one wildcard grant per workspace).
async function ensureSeedWildcardGrant(client: ClientBase, fkOAuthClient: number, workspaceKey: string): Promise<void> {
    const grants = await TemplateAccessGrantDao.listByClient(client, fkOAuthClient)
    const exists = grants.some(function (grant) { return grant.path === '' && grant.workspace === workspaceKey })
    if (exists) {
        return
    }
    const grant = TemplateAccessGrant.create()
    grant.id = await TemplateAccessGrantDao.getSequenceId(client)
    grant.fkOAuthClient = fkOAuthClient
    grant.workspace = workspaceKey
    grant.path = ''
    await TemplateAccessGrantDao.insert(client, grant)
}

async function ensureBatchLock(client: ClientBase, key: string): Promise<void> {
    const existing = await BatchLockDao.findByKey(client, key)
    if (existing !== undefined) {
        return
    }
    await BatchLockDao.insert(client, key)
}

// Copies the seed "sample" workspace contents into the test account's workspace
// (addressed by its fixed workspaceKey).
async function ensureSampleWorkspaceFiles(context: SystemInitContext, workspaceKey: string): Promise<void> {
    const sampleSeedDir = join(context.seedRoot, 'workspaces', 'sample')
    const target = join(context.workspacesRoot, workspaceKey)
    await mkdir(target, { recursive: true })
    // Marker file guards re-copy on convergent re-runs.
    if (existsSync(join(target, 'invoice.report'))) {
        return
    }
    await cp(sampleSeedDir, target, { recursive: true })
}

// Publishes the seed template tag from the seed workspace file so the file
// stays the single source of truth for the published snapshot.
async function ensureSeedTemplateTag(client: ClientBase, context: SystemInitContext, workspaceKey: string): Promise<void> {
    const existing = await TemplateTagDao.getByPathAndTag(client, workspaceKey, 'invoice.report', 'v1')
    if (existing !== undefined) {
        return
    }
    const templateJson = await readFile(join(context.seedRoot, 'workspaces', 'sample', 'invoice.report'), 'utf8')
    await ReportApiLogic.createTemplateTag(client, workspaceKey, 'invoice.report', 'v1', 'Seed tag for regression tests', templateJson, undefined)
}

async function truncateAllTables(client: ClientBase): Promise<void> {
    const tablesRes = await client.query(SQL`
        SELECT table_name AS name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `)
    if (tablesRes.rows.length === 0) {
        return
    }
    const truncateSql = SQL`TRUNCATE TABLE `
    appendQualifiedTableList(truncateSql, tablesRes.rows.map(function (row) { return row.name }))
    truncateSql.append(SQL` CASCADE`)
    await client.query(truncateSql)

    // Sequences are standalone objects (no OWNED BY), so restart them explicitly.
    const seqRes = await client.query(SQL`
        SELECT seq.relname AS name
        FROM pg_class seq
        JOIN pg_namespace ns ON ns.oid = seq.relnamespace
        WHERE seq.relkind = 'S'
          AND ns.nspname = 'public'
        ORDER BY seq.relname
    `)
    for (const row of seqRes.rows) {
        const sql = SQL`ALTER SEQUENCE `
        appendQualifiedIdentifier(sql, row.name)
        sql.append(SQL` RESTART WITH 1`)
        await client.query(sql)
    }
}

// Removes directory entries while keeping the directory itself (bind mounts
// cannot be removed) and dotfiles such as .gitignore.
async function removeEntriesKeepingDotfiles(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath)
    for (const entry of entries) {
        if (entry.startsWith('.')) {
            continue
        }
        await rm(join(dirPath, entry), { recursive: true, force: true })
    }
}

function quoteIdent(value: string): string {
    return '"' + value.replace(/"/g, '""') + '"'
}

function appendQualifiedIdentifier(sql: SQLStatement, name: string): void {
    sql.append(SQL`public.`)
    sql.append(quoteIdent(name))
}

function appendQualifiedTableList(sql: SQLStatement, tableNames: string[]): void {
    for (let i = 0; i < tableNames.length; i++) {
        if (i > 0) {
            sql.append(SQL`, `)
        }
        appendQualifiedIdentifier(sql, tableNames[i]!)
    }
}
