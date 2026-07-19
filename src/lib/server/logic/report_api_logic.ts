import { BusinessException } from '@/lib/common/exception/business_exception'
import { ForbiddenException } from '@/lib/common/exception/forbidden_exception'
import { OAuthTokenException } from '@/lib/common/exception/oauth_token_exception'
import { OAuthAccessTokenDao } from '@/lib/server/dao/OAuthAccessToken'
import { OAuthClientDao } from '@/lib/server/dao/OAuthClient'
import { PrintRequestDao } from '@/lib/server/dao/PrintRequest'
import { TemplateAccessGrantDao } from '@/lib/server/dao/TemplateAccessGrant'
import { TemplateTagDao } from '@/lib/server/dao/TemplateTag'
import { UserAccountDao } from '@/lib/server/dao/user_account'
import { WorkspaceAccessLogic } from '@/lib/server/logic/workspace_access_logic'
import { OAuthAccessToken } from '@/lib/server/entity/OAuthAccessToken'
import { OAuthClient } from '@/lib/server/entity/OAuthClient'
import { PrintRequest } from '@/lib/server/entity/PrintRequest'
import { TemplateAccessGrant } from '@/lib/server/entity/TemplateAccessGrant'
import { TemplateTag } from '@/lib/server/entity/TemplateTag'
import { ClientBase } from 'pg'
import { createHash, randomUUID } from 'crypto'
import { secretEquals } from '@/lib/server/utils/secret_compare'
import { fontDirForAccount } from '@/lib/server/logic/font_resolver'

export type TemplateTagInfo = {
    tag: string
    description: string
    endpoint: string
    creation?: Date
    modification?: Date
}

export type TemplateTagDetailInfo = TemplateTagInfo & {
    templateJson: string
}

export type OAuthClientInfo = {
    id: number
    clientId: string
    // Shown in the administration screen, so the client secret remains retrievable.
    clientSecret: string
    scopes: string
    deleteFlag: boolean
    creation?: Date
    modification?: Date
    version: number
}

export type TemplateAccessGrantInfo = {
    id: number
    fkOAuthClient: number
    workspace: string
    path: string
    version: number
}

const TAG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const CLIENT_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/
const RESERVED_TAGS = new Set(['latest', 'current', 'draft'])
const DEFAULT_SCOPES = 'report:print report:status report:download report:preview'

export namespace ReportApiLogic {

    export function validateTag(tag: string): void {
        if (!TAG_PATTERN.test(tag) || tag.indexOf('..') !== -1 || RESERVED_TAGS.has(tag)) {
            throw new BusinessException('タグ名にはURLで指定可能な英数字、ドット、アンダースコア、ハイフンのみ使用できます。')
        }
    }

    export function hashSecret(value: string): string {
        return createHash('sha256').update(value).digest('hex')
    }

    // Splits a catch-all route segment list into the template path and the trailing tag.
    // Shared by the print and preview APIs so both parse template addresses identically.
    export function splitTemplatePathAndTag(path: string[]): { templatePath: string, tag: string } {
        if (path.length < 2) {
            throw new BusinessException('テンプレートパスとタグを指定してください。')
        }
        const tag = path[path.length - 1]
        const templateParts = path.slice(0, path.length - 1)
        for (let i = 0; i < templateParts.length; i++) {
            if (templateParts[i] === '..' || templateParts[i] === '.') {
                throw new BusinessException('テンプレートパスが不正です。')
            }
        }
        return { templatePath: templateParts.join('/'), tag }
    }

    export function buildPrintEndpoint(workspace: string, templatePath: string, tag: string): string {
        return '/api/report/print/'
            + encodeURIComponent(workspace)
            + '/'
            + templatePath.split('/').map(function (part) { return encodeURIComponent(part) }).join('/')
            + '/'
            + encodeURIComponent(tag)
    }

    export function generatePublicKey(): string {
        return randomUUID() + randomUUID() + randomUUID() + randomUUID()
    }

    // API clients are strictly owned by the account that created them: only the
    // owner may list, view, or manage them (administrators included). ownerId is
    // the session user's account id.
    export async function listOAuthClients(client: ClientBase, ownerId: number): Promise<OAuthClientInfo[]> {
        const clients = await OAuthClientDao.listByOwner(client, ownerId)
        const result: OAuthClientInfo[] = []
        for (let i = 0; i < clients.length; i++) {
            result.push(toOAuthClientInfo(clients[i]))
        }
        return result
    }

    export async function createOAuthClient(
        client: ClientBase,
        clientId: string,
        scopes: string,
        ownerId: number
    ): Promise<OAuthClientInfo> {
        validateClientId(clientId)
        // clientId is globally unique (the token endpoint looks it up without an
        // account context), so uniqueness is checked across all owners.
        const existing = await OAuthClientDao.getAnyByClientId(client, clientId)
        if (existing !== undefined) {
            throw new BusinessException('同じクライアントIDが既に存在します。')
        }

        const entity = OAuthClient.create()
        entity.id = await OAuthClientDao.getSequenceId(client)
        entity.fkUserAccount = ownerId
        entity.clientId = clientId
        entity.clientSecret = generatePublicKey()
        entity.scopes = normalizeScopes(scopes)
        entity.deleteFlag = false
        entity.createUser = ownerId
        entity.updateUser = ownerId
        await OAuthClientDao.insert(client, entity)
        return toOAuthClientInfo(entity)
    }

    export async function updateOAuthClient(
        client: ClientBase,
        id: number,
        scopes: string,
        deleteFlag: boolean,
        ownerId: number
    ): Promise<OAuthClientInfo> {
        const entity = await getOwnedOAuthClient(client, id, ownerId)
        entity.scopes = normalizeScopes(scopes)
        entity.deleteFlag = deleteFlag
        entity.updateUser = ownerId
        const count = await OAuthClientDao.update(client, entity)
        if (count !== 1) {
            throw new BusinessException('OAuthクライアントを更新できませんでした。')
        }
        return toOAuthClientInfo({ ...entity, version: entity.version + 1 })
    }

    export async function rotateOAuthClientSecret(
        client: ClientBase,
        id: number,
        ownerId: number
    ): Promise<OAuthClientInfo> {
        const entity = await getOwnedOAuthClient(client, id, ownerId)
        const clientSecret = generatePublicKey()
        entity.updateUser = ownerId
        const count = await OAuthClientDao.updateSecret(client, entity, clientSecret)
        if (count !== 1) {
            throw new BusinessException('クライアントシークレットを更新できませんでした。')
        }
        return toOAuthClientInfo({ ...entity, clientSecret, version: entity.version + 1 })
    }

    export async function listTemplateAccessGrants(client: ClientBase, fkOAuthClient: number, ownerId: number): Promise<TemplateAccessGrantInfo[]> {
        await getOwnedOAuthClient(client, fkOAuthClient, ownerId)
        const grants = await TemplateAccessGrantDao.listByClient(client, fkOAuthClient)
        const result: TemplateAccessGrantInfo[] = []
        for (let i = 0; i < grants.length; i++) {
            result.push(toTemplateAccessGrantInfo(grants[i]))
        }
        return result
    }

    export async function createTemplateAccessGrant(
        client: ClientBase,
        fkOAuthClient: number,
        workspace: string,
        path: string,
        ownerId: number
    ): Promise<TemplateAccessGrantInfo> {
        await getOwnedOAuthClient(client, fkOAuthClient, ownerId)
        validateAccessGrant(workspace, path)
        const entity = TemplateAccessGrant.create()
        entity.id = await TemplateAccessGrantDao.getSequenceId(client)
        entity.fkOAuthClient = fkOAuthClient
        entity.workspace = workspace
        entity.path = path
        entity.createUser = ownerId
        entity.updateUser = ownerId
        await TemplateAccessGrantDao.insert(client, entity)
        return toTemplateAccessGrantInfo(entity)
    }

    export async function deleteTemplateAccessGrant(client: ClientBase, id: number, ownerId: number): Promise<void> {
        const entity = await TemplateAccessGrantDao.getById(client, id)
        if (entity === undefined) {
            throw new BusinessException('アクセス許可が見つかりません。')
        }
        // The grant's client must belong to the caller.
        await getOwnedOAuthClient(client, entity.fkOAuthClient, ownerId)
        const count = await TemplateAccessGrantDao.del(client, entity)
        if (count !== 1) {
            throw new BusinessException('アクセス許可を削除できませんでした。')
        }
    }

    export async function createAccessToken(
        client: ClientBase,
        clientId: string,
        clientSecret: string,
        requestedScope: string
    ): Promise<{ accessToken: string, scope: string, expiresIn: number }> {
        const oauthClient = await OAuthClientDao.getByClientId(client, clientId)
        if (oauthClient === undefined || !secretEquals(oauthClient.clientSecret, clientSecret)) {
            throw new OAuthTokenException('invalid_client', 'クライアント認証に失敗しました。')
        }

        const scope = normalizeRequestedScope(oauthClient.scopes, requestedScope)
        const accessToken = generatePublicKey()
        const entity = OAuthAccessToken.create()
        entity.id = await OAuthAccessTokenDao.getSequenceId(client)
        entity.fkOAuthClient = oauthClient.id!
        entity.tokenHash = hashSecret(accessToken)
        entity.scopes = scope
        await OAuthAccessTokenDao.insert(client, entity)
        await OAuthAccessTokenDao.deleteExpired(client)

        return { accessToken, scope, expiresIn: 3600 }
    }

    export async function checkBearerToken(client: ClientBase, authorization: string, requiredScope: string): Promise<OAuthAccessToken.Type> {
        const prefix = 'Bearer '
        if (!authorization.startsWith(prefix)) {
            throw new ForbiddenException()
        }
        const token = authorization.substring(prefix.length)
        const entity = await OAuthAccessTokenDao.getActiveByTokenHash(client, hashSecret(token))
        if (entity === undefined) {
            throw new ForbiddenException()
        }
        if (!hasScope(entity.scopes, requiredScope)) {
            throw new ForbiddenException()
        }
        return entity
    }

    // Authorizes an OAuth client to read a (workspaceKey, path). Access is the
    // intersection of two scopes: the client's own TemplateAccessGrant scope AND
    // what the owning account can actually reach (its own workspace, or a folder
    // shared with it). A client can therefore never exceed its account, and an
    // account's API surface follows the folder shares it holds.
    export async function checkClientTemplateAccess(client: ClientBase, fkOAuthClient: number, workspace: string, path: string): Promise<void> {
        const hasGrant = await TemplateAccessGrantDao.hasAccess(client, fkOAuthClient, workspace, path)
        if (!hasGrant) {
            throw new ForbiddenException()
        }
        const oauthClient = await OAuthClientDao.getById(client, fkOAuthClient)
        if (oauthClient === undefined || oauthClient.fkUserAccount === undefined) {
            throw new ForbiddenException()
        }
        const owner = await UserAccountDao.getById(client, oauthClient.fkUserAccount)
        if (owner === undefined) {
            throw new ForbiddenException()
        }
        const access = await WorkspaceAccessLogic.loadAccess(client, owner)
        if (!WorkspaceAccessLogic.isReadable(access, workspace, path)) {
            throw new ForbiddenException()
        }
    }

    // Font directory of the account that owns the given OAuth client. Preview
    // and (via the batch) print render with the owning account's fonts.
    export async function resolveClientFontDir(client: ClientBase, fkOAuthClient: number): Promise<string> {
        const oauthClient = await OAuthClientDao.getById(client, fkOAuthClient)
        if (oauthClient === undefined || oauthClient.fkUserAccount === undefined) {
            throw new ForbiddenException()
        }
        return fontDirForAccount(oauthClient.fkUserAccount)
    }

    export async function createTemplateTag(
        client: ClientBase,
        workspace: string,
        templatePath: string,
        tag: string,
        description: string,
        templateJson: string,
        userId: number | undefined
    ): Promise<TemplateTag.Type> {
        validateTag(tag)
        const existing = await TemplateTagDao.getByPathAndTag(client, workspace, templatePath, tag)
        if (existing !== undefined) {
            throw new BusinessException('同じタグが既に存在します。')
        }

        const entity = TemplateTag.create()
        entity.id = await TemplateTagDao.getSequenceId(client)
        entity.workspace = workspace
        entity.templatePath = templatePath
        entity.tag = tag
        entity.description = description
        entity.templateJson = templateJson
        entity.endpoint = buildPrintEndpoint(workspace, templatePath, tag)
        entity.createUser = userId
        entity.updateUser = userId
        await TemplateTagDao.insert(client, entity)
        return entity
    }

    export async function listTemplateTags(client: ClientBase, workspace: string, templatePath: string): Promise<TemplateTagInfo[]> {
        const tags = await TemplateTagDao.listByTemplate(client, workspace, templatePath)
        const result: TemplateTagInfo[] = []
        for (let i = 0; i < tags.length; i++) {
            result.push(toTemplateTagInfo(tags[i]))
        }
        return result
    }

    export async function getTemplateTag(
        client: ClientBase,
        workspace: string,
        templatePath: string,
        tag: string
    ): Promise<TemplateTagDetailInfo> {
        validateTag(tag)
        const entity = await TemplateTagDao.getByPathAndTag(client, workspace, templatePath, tag)
        if (entity === undefined) {
            throw new BusinessException('指定されたAPI公開タグが見つかりません。')
        }
        return { ...toTemplateTagInfo(entity), templateJson: entity.templateJson }
    }

    export async function updateTemplateTag(
        client: ClientBase,
        workspace: string,
        templatePath: string,
        tag: string,
        templateJson: string,
        userId: number | undefined
    ): Promise<TemplateTagDetailInfo> {
        validateTag(tag)
        const entity = await TemplateTagDao.getByPathAndTag(client, workspace, templatePath, tag)
        if (entity === undefined) {
            throw new BusinessException('指定されたAPI公開タグが見つかりません。')
        }
        entity.templateJson = templateJson
        entity.updateUser = userId
        const count = await TemplateTagDao.updateTemplateJson(client, entity)
        if (count !== 1) {
            throw new BusinessException('API公開タグを更新できませんでした。')
        }
        return { ...toTemplateTagInfo({ ...entity, version: entity.version + 1 }), templateJson }
    }

    export async function deleteTemplateTag(
        client: ClientBase,
        workspace: string,
        templatePath: string,
        tag: string
    ): Promise<void> {
        validateTag(tag)
        const entity = await TemplateTagDao.getByPathAndTag(client, workspace, templatePath, tag)
        if (entity === undefined) {
            throw new BusinessException('指定されたAPI公開タグが見つかりません。')
        }
        // Print requests keep a foreign key to the tag; deleting the tag would break their history.
        const requestCount = await PrintRequestDao.countByTemplateTag(client, entity.id!)
        if (requestCount > 0) {
            throw new BusinessException('このタグには印字リクエスト履歴があるため削除できません。')
        }
        const count = await TemplateTagDao.del(client, entity)
        if (count !== 1) {
            throw new BusinessException('API公開タグを削除できませんでした。')
        }
    }

    export async function enqueuePrintRequest(
        client: ClientBase,
        workspace: string,
        templatePath: string,
        tag: string,
        endpoint: string,
        fkOAuthClient: number,
        requestBody: unknown
    ): Promise<string> {
        validateTag(tag)
        await checkClientTemplateAccess(client, fkOAuthClient, workspace, templatePath)
        const templateTag = await TemplateTagDao.getByPathAndTag(client, workspace, templatePath, tag)
        if (templateTag === undefined) {
            throw new BusinessException('指定されたAPI公開タグが見つかりません。')
        }
        // Owning account (the print history is scoped per account).
        const oauthClient = await OAuthClientDao.getById(client, fkOAuthClient)
        if (oauthClient === undefined || oauthClient.fkUserAccount === undefined) {
            throw new ForbiddenException()
        }

        const entity = PrintRequest.create()
        entity.id = await PrintRequestDao.getSequenceId(client)
        entity.key = generatePublicKey()
        entity.endpoint = endpoint
        entity.fkUserAccount = oauthClient.fkUserAccount
        entity.via = 'api'
        entity.workspace = workspace
        entity.templatePath = templatePath
        entity.format = 'pdf'
        entity.fkOAuthClient = fkOAuthClient
        entity.fkTemplateTag = templateTag.id!
        entity.requestBodyJson = JSON.stringify(requestBody)
        entity.status = 'queued'
        entity.createUser = oauthClient.fkUserAccount
        entity.updateUser = oauthClient.fkUserAccount
        await PrintRequestDao.insert(client, entity)
        return entity.key
    }

    export async function getPrintRequestByKey(client: ClientBase, key: string, fkOAuthClient: number): Promise<PrintRequest.Type> {
        const request = await PrintRequestDao.getByKey(client, key, fkOAuthClient)
        if (request === undefined) {
            throw new BusinessException('指定された印字リクエストが見つかりません。')
        }
        return request
    }

}

function validateClientId(clientId: string): void {
    if (!CLIENT_ID_PATTERN.test(clientId)) {
        throw new BusinessException('クライアントIDには英数字、ドット、アンダースコア、ハイフン、コロンのみ使用できます。')
    }
}

// Grants are folder-scoped only: the granted path (empty = whole workspace)
// covers itself and everything below it.
function validateAccessGrant(workspace: string, path: string): void {
    if (workspace !== '*' && (workspace === '' || workspace.indexOf('/') !== -1 || workspace.indexOf('..') !== -1)) {
        throw new BusinessException('ワークスペース名が不正です。')
    }
    if (path.indexOf('..') !== -1 || path.startsWith('/')) {
        throw new BusinessException('パスが不正です。')
    }
}

// Fetches a client and enforces that it belongs to the caller. A client owned
// by another account is reported as not found, so ownership is never disclosed.
async function getOwnedOAuthClient(client: ClientBase, id: number, ownerId: number): Promise<OAuthClient.Type> {
    const entity = await OAuthClientDao.getById(client, id)
    if (entity === undefined || entity.fkUserAccount !== ownerId) {
        throw new BusinessException('OAuthクライアントが見つかりません。')
    }
    return entity
}

function toOAuthClientInfo(entity: OAuthClient.Type): OAuthClientInfo {
    return {
        id: entity.id!,
        clientId: entity.clientId,
        clientSecret: entity.clientSecret,
        scopes: entity.scopes,
        deleteFlag: entity.deleteFlag,
        creation: entity.creation,
        modification: entity.modification,
        version: entity.version
    }
}

function toTemplateTagInfo(entity: TemplateTag.Type): TemplateTagInfo {
    return {
        tag: entity.tag,
        description: entity.description,
        endpoint: entity.endpoint,
        creation: entity.creation,
        modification: entity.modification
    }
}

function toTemplateAccessGrantInfo(entity: TemplateAccessGrant.Type): TemplateAccessGrantInfo {
    return {
        id: entity.id!,
        fkOAuthClient: entity.fkOAuthClient,
        workspace: entity.workspace,
        path: entity.path,
        version: entity.version
    }
}

function normalizeRequestedScope(clientScopes: string, requestedScope: string): string {
    if (requestedScope.trim() === '') {
        return clientScopes
    }
    const clientSet = toScopeSet(clientScopes)
    const requested = requestedScope.trim().split(/\s+/)
    for (let i = 0; i < requested.length; i++) {
        if (!clientSet.has(requested[i])) {
            throw new OAuthTokenException('invalid_scope', '許可されていないスコープが要求されました: ' + requested[i])
        }
    }
    return requested.join(' ')
}

function normalizeScopes(scopes: string): string {
    if (scopes.trim() === '') {
        return DEFAULT_SCOPES
    }
    const parts = scopes.trim().split(/\s+/)
    const valid = toScopeSet(DEFAULT_SCOPES)
    const result: string[] = []
    for (let i = 0; i < parts.length; i++) {
        if (!valid.has(parts[i])) {
            throw new BusinessException('未対応のスコープが指定されています。')
        }
        result.push(parts[i])
    }
    return result.join(' ')
}

function hasScope(scopes: string, requiredScope: string): boolean {
    return toScopeSet(scopes).has(requiredScope)
}

function toScopeSet(scopes: string): Set<string> {
    const result = new Set<string>()
    const parts = scopes.trim().split(/\s+/)
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] !== '') result.add(parts[i])
    }
    return result
}
