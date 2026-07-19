import { BusinessException } from '@/lib/common/exception/business_exception'
import { randomUUID } from 'node:crypto'
import { rm } from 'fs/promises'
import { FolderShareDao } from '@/lib/server/dao/FolderShare'
import { OAuthAccessTokenDao } from '@/lib/server/dao/OAuthAccessToken'
import { OAuthClientDao } from '@/lib/server/dao/OAuthClient'
import { PrintRequestDao } from '@/lib/server/dao/PrintRequest'
import { SessionDao } from '@/lib/server/dao/session'
import { TemplateAccessGrantDao } from '@/lib/server/dao/TemplateAccessGrant'
import { TemplateTagDao } from '@/lib/server/dao/TemplateTag'
import { UserAccountDao } from '@/lib/server/dao/user_account'
import { UserAccount } from '@/lib/server/entity/user_account'
import { fontDirForAccount } from '@/lib/server/logic/font_resolver'
import { PasswordHash } from '@/lib/server/logic/password_hash'
import { WorkspacePaths } from '@/lib/server/logic/workspace_paths'
import { ClientBase } from 'pg'

export namespace UserAdminLogic {

    export async function listUsers(client: ClientBase): Promise<UserAccount.Type[]> {
        return UserAccountDao.listAll(client)
    }

    // Per-user MCP authentication key. It must remain retrievable for display
    // in the MCP settings dialog and is revocable by regeneration at any time.
    export function generateMcpKey(): string {
        return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
    }

    export async function createUser(
        client: ClientBase,
        displayName: string,
        userId: string,
        pw: string,
        adminFlag: boolean,
        operatorId: number | undefined
    ): Promise<UserAccount.Type> {
        validateDisplayName(displayName)
        validateUserId(userId)
        validatePassword(pw)

        const existing = await UserAccountDao.getByUserId(client, userId)
        if (existing !== undefined) {
            throw new BusinessException('同じログインIDのユーザーが既に存在します。')
        }

        const entity = UserAccount.create()
        entity.id = await UserAccountDao.getSequenceId(client)
        entity.displayName = displayName
        entity.userId = userId
        entity.pw = await PasswordHash.create(pw)
        entity.workspaceKey = randomUUID()
        entity.adminFlag = adminFlag
        entity.mcpKey = generateMcpKey()
        entity.createUser = operatorId
        entity.updateUser = operatorId
        await UserAccountDao.insert(client, entity)
        await WorkspacePaths.ensureWorkspaceDir(entity.workspaceKey)
        return entity
    }

    export async function updateUser(
        client: ClientBase,
        id: number,
        displayName: string,
        userId: string,
        adminFlag: boolean,
        mcpEnabled: boolean,
        pw: string,
        version: number,
        operatorId: number | undefined
    ): Promise<UserAccount.Type> {
        validateDisplayName(displayName)
        validateUserId(userId)
        if (pw.length > 0) {
            validatePassword(pw)
        }

        const entity = await UserAccountDao.getById(client, id)
        if (entity === undefined) {
            throw new BusinessException('ユーザーが存在しません。')
        }

        // Passwords belong only to local accounts. Setting one on an external
        // (OIDC) account would create a password login path for it — an
        // impersonation route across the identity provider — so it is refused.
        if (pw.length > 0 && entity.provider !== 'local') {
            throw new BusinessException('外部アカウントにはパスワードを設定できません。')
        }

        if (userId !== entity.userId) {
            const duplicated = await UserAccountDao.getByUserId(client, userId)
            if (duplicated !== undefined && duplicated.id !== id) {
                throw new BusinessException('同じログインIDのユーザーが既に存在します。')
            }
        }

        // "At least one administrator" invariant: an admin may not demote the
        // last remaining administrator.
        if (entity.adminFlag && !adminFlag) {
            await ensureAnotherAdmin(client)
        }

        entity.displayName = displayName
        entity.userId = userId
        entity.adminFlag = adminFlag
        entity.mcpEnabled = mcpEnabled
        if (pw.length > 0) {
            entity.pw = await PasswordHash.create(pw)
        }
        entity.updateUser = operatorId
        entity.version = version
        const count = await UserAccountDao.update(client, entity)
        if (count !== 1) {
            throw new BusinessException('ユーザーを更新できませんでした。')
        }
        return entity
    }

    export async function deleteUser(client: ClientBase, id: number): Promise<PurgedAccountFiles> {
        const entity = await UserAccountDao.getById(client, id)
        if (entity === undefined) {
            throw new BusinessException('ユーザーが存在しません。')
        }

        // "At least one administrator" invariant.
        if (entity.adminFlag) {
            await ensureAnotherAdmin(client)
        }

        return await purgeAccount(client, entity)
    }

    // On-disk artifacts of a purged account, returned by purgeAccount so the
    // caller can remove them AFTER the database transaction commits (a filesystem
    // delete cannot be rolled back, so it must never run inside the transaction).
    export type PurgedAccountFiles = {
        workspaceKey: string,
        accountId: number,
        pdfPaths: string[],
    }

    // Physically removes an account and every database record that belongs to it,
    // in foreign-key-safe order. Returns the account's on-disk artifacts; the
    // caller must pass them to removeAccountFiles once the transaction commits.
    // Shared by administrator deletion and self-service withdrawal.
    export async function purgeAccount(client: ClientBase, account: UserAccount.Type): Promise<PurgedAccountFiles> {
        const id = account.id!
        // The account's own rendered PDFs, captured before the rows are deleted.
        const pdfPaths = await PrintRequestDao.listPdfPathsByAccount(client, id)
        // Remove the account's own requests/history first, then detach the
        // surviving other-account history rows from this account's published tags
        // (those rows are self-describing and are kept), so the tags have no
        // remaining referrer and can be deleted.
        await PrintRequestDao.deleteByUserAccount(client, id)
        await PrintRequestDao.detachTemplateTagsByWorkspace(client, account.workspaceKey)
        await TemplateTagDao.deleteByWorkspace(client, account.workspaceKey)
        // OAuth clients and everything hanging off them.
        await OAuthAccessTokenDao.deleteByOwner(client, id)
        await TemplateAccessGrantDao.deleteByOwnerAccount(client, id)
        await OAuthClientDao.deleteByOwner(client, id)
        // Folder shares (either side) and sessions.
        await FolderShareDao.deleteByAccount(client, id)
        await SessionDao.deleteByUserAccount(client, id)
        // The account row itself.
        await UserAccountDao.deleteById(client, id)
        return { workspaceKey: account.workspaceKey, accountId: id, pdfPaths }
    }

    // Deletes the on-disk artifacts of a purged account. Called after the purge
    // transaction commits; a failure here only leaves orphaned files (self-healing
    // on a later purge), never a live account with missing data.
    export async function removeAccountFiles(files: PurgedAccountFiles): Promise<void> {
        await rm(WorkspacePaths.dirForWorkspaceKey(files.workspaceKey), { recursive: true, force: true })
        await rm(fontDirForAccount(files.accountId), { recursive: true, force: true })
        for (const pdfPath of files.pdfPaths) {
            await rm(pdfPath, { force: true })
        }
    }

    export async function changeOwnPassword(
        client: ClientBase,
        user: UserAccount.Type,
        currentPw: string,
        newPw: string
    ): Promise<void> {
        // Only local accounts have a password to change.
        if (user.provider !== 'local') {
            throw new BusinessException('外部アカウントはパスワードを変更できません。')
        }
        validatePassword(newPw)

        const current = await UserAccountDao.getLocalByUserIdForUpdate(client, user.userId)
        if (current === undefined || current.id !== user.id) {
            throw new BusinessException('現在のパスワードが正しくありません。')
        }
        const verification = await PasswordHash.check(current.pw, currentPw)
        if (!verification.valid) {
            throw new BusinessException('現在のパスワードが正しくありません。')
        }

        current.pw = await PasswordHash.create(newPw)
        current.updateUser = user.id
        const count = await UserAccountDao.update(client, current)
        if (count !== 1) {
            throw new BusinessException('パスワードを変更できませんでした。')
        }
    }

    // Self-service account settings (every account manages its own).

    export async function updateOwnDisplayName(client: ClientBase, user: UserAccount.Type, displayName: string): Promise<UserAccount.Type> {
        validateDisplayName(displayName)
        user.displayName = displayName
        user.updateUser = user.id
        const count = await UserAccountDao.update(client, user)
        if (count !== 1) {
            throw new BusinessException('表示名を更新できませんでした。')
        }
        user.version = user.version + 1
        return user
    }

    export async function updateOwnDefaultColorMode(client: ClientBase, user: UserAccount.Type, defaultColorMode: string): Promise<UserAccount.Type> {
        if (defaultColorMode !== 'rgb' && defaultColorMode !== 'cmyk') {
            throw new BusinessException('カラーモードは rgb または cmyk を指定してください。')
        }
        user.defaultColorMode = defaultColorMode
        user.updateUser = user.id
        const count = await UserAccountDao.update(client, user)
        if (count !== 1) {
            throw new BusinessException('カラーモードを更新できませんでした。')
        }
        user.version = user.version + 1
        return user
    }

    // Self-service account withdrawal. Preserves the "at least one administrator"
    // invariant, then physically purges the account and all of its data.
    export async function deleteOwnAccount(client: ClientBase, user: UserAccount.Type): Promise<PurgedAccountFiles> {
        if (user.adminFlag) {
            await ensureAnotherAdmin(client)
        }
        return await purgeAccount(client, user)
    }

    // Own MCP settings (every account can manage its own MCP access).

    export async function updateOwnMcpEnabled(client: ClientBase, user: UserAccount.Type, mcpEnabled: boolean): Promise<UserAccount.Type> {
        user.mcpEnabled = mcpEnabled
        user.updateUser = user.id
        const count = await UserAccountDao.update(client, user)
        if (count !== 1) {
            throw new BusinessException('MCP設定を更新できませんでした。')
        }
        user.version = user.version + 1
        return user
    }

    export async function regenerateOwnMcpKey(client: ClientBase, user: UserAccount.Type): Promise<UserAccount.Type> {
        user.mcpKey = generateMcpKey()
        user.updateUser = user.id
        const count = await UserAccountDao.update(client, user)
        if (count !== 1) {
            throw new BusinessException('MCP認証キーを再生成できませんでした。')
        }
        user.version = user.version + 1
        return user
    }

    async function ensureAnotherAdmin(client: ClientBase): Promise<void> {
        const count = await UserAccountDao.countAdmins(client)
        if (count <= 1) {
            throw new BusinessException('管理者アカウントは最低1つ必要です。')
        }
    }

    function validateDisplayName(displayName: string): void {
        if (displayName.length === 0) {
            throw new BusinessException('表示名を入力してください。')
        }
    }

    function validateUserId(userId: string): void {
        if (userId.length === 0) {
            throw new BusinessException('ログインIDを入力してください。')
        }
    }

    // Password policy aligned with the Microsoft personal account (MSA) rules:
    // at least 8 characters, and at least two of the four character categories
    // (uppercase, lowercase, number, symbol). Length is counted in Unicode code
    // points so multibyte passwords are measured by characters, not bytes.
    const MIN_PASSWORD_LENGTH = 8
    const REQUIRED_CATEGORY_COUNT = 2

    function validatePassword(pw: string): void {
        if (pw.length === 0) {
            throw new BusinessException('パスワードを入力してください。')
        }
        if ([...pw].length < MIN_PASSWORD_LENGTH) {
            throw new BusinessException('パスワードは8文字以上で入力してください。')
        }
        let categories = 0
        if (/[A-Z]/.test(pw)) categories++
        if (/[a-z]/.test(pw)) categories++
        if (/[0-9]/.test(pw)) categories++
        if (/[^A-Za-z0-9]/.test(pw)) categories++
        if (categories < REQUIRED_CATEGORY_COUNT) {
            throw new BusinessException('パスワードは大文字・小文字・数字・記号のうち2種類以上を含めてください。')
        }
    }

}
