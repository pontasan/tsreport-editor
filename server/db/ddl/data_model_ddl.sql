DROP TABLE IF EXISTS public.UserAccount CASCADE;
DROP SEQUENCE IF EXISTS UserAccountSeq;
DROP TABLE IF EXISTS public.Session CASCADE;
DROP TABLE IF EXISTS public.SystemProperty CASCADE;
DROP SEQUENCE IF EXISTS SystemPropertySeq;
DROP TABLE IF EXISTS public.PrintRequest CASCADE;
DROP SEQUENCE IF EXISTS PrintRequestSeq;
DROP TABLE IF EXISTS public.TemplateAccessGrant CASCADE;
DROP SEQUENCE IF EXISTS TemplateAccessGrantSeq;
DROP TABLE IF EXISTS public.TemplateTag CASCADE;
DROP SEQUENCE IF EXISTS TemplateTagSeq;
DROP TABLE IF EXISTS public.OAuthAccessToken CASCADE;
DROP SEQUENCE IF EXISTS OAuthAccessTokenSeq;
DROP TABLE IF EXISTS public.OAuthClient CASCADE;
DROP SEQUENCE IF EXISTS OAuthClientSeq;
DROP TABLE IF EXISTS public.BatchLock CASCADE;
DROP SEQUENCE IF EXISTS BatchLockSeq;
DROP TABLE IF EXISTS public.FolderShare CASCADE;
DROP SEQUENCE IF EXISTS FolderShareSeq;
CREATE TABLE public.UserAccount (
    id bigint NOT NULL,
    displayName text NOT NULL,
    userId text NOT NULL,
    pw text NOT NULL, -- Argon2id PHC string for local accounts; empty for OIDC accounts.
    provider text NOT NULL DEFAULT 'local',
    externalId text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    -- Per-account workspace identity (UUID). Each account owns exactly one
    -- workspace, physically isolated at /var/nfs/workspaces/{workspaceKey}/.
    -- This key is also the identifier a user shares with others so they can
    -- grant folder access, and the workspace segment of the public API URLs.
    workspaceKey text NOT NULL,
    adminFlag boolean NOT NULL DEFAULT FALSE,
    mcpEnabled boolean NOT NULL DEFAULT TRUE,
    mcpKey text NOT NULL,
    -- Default color mode for the editor color inputs ('rgb' | 'cmyk')
    defaultColorMode text NOT NULL DEFAULT 'rgb',
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.UserAccount
    ADD UNIQUE (userId);
ALTER TABLE public.UserAccount
    ADD UNIQUE (workspaceKey);
-- One external identity (provider + subject) maps to at most one account.
-- Local accounts all share ('local',''), so the constraint is partial.
CREATE UNIQUE INDEX UserAccount_external_idx
    ON public.UserAccount (provider, externalId)
    WHERE externalId <> '';
CREATE  SEQUENCE UserAccountSeq;
CREATE TABLE public.Session (
    fkUserAccount bigint NOT NULL,
    token text NOT NULL,
    expiration timestamp without time zone NOT NULL,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL
) WITHOUT OIDS;
ALTER TABLE public.Session
    ADD UNIQUE (token);
CREATE TABLE public.SystemProperty (
    id bigint NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.SystemProperty
    ADD UNIQUE (key);
CREATE SEQUENCE SystemPropertySeq;
CREATE TABLE public.OAuthClient (
    id bigint NOT NULL,
    fkUserAccount bigint NOT NULL,
    clientId text NOT NULL,
    clientSecret text NOT NULL,
    scopes text NOT NULL,
    deleteFlag boolean NOT NULL DEFAULT FALSE,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.OAuthClient
    ADD UNIQUE (clientId);
CREATE SEQUENCE OAuthClientSeq;
CREATE TABLE public.OAuthAccessToken (
    id bigint NOT NULL,
    fkOAuthClient bigint NOT NULL,
    tokenHash text NOT NULL,
    scopes text NOT NULL,
    expiration timestamp without time zone NOT NULL,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.OAuthAccessToken
    ADD UNIQUE (tokenHash);
CREATE INDEX ON public.OAuthAccessToken
    (fkOAuthClient);
CREATE SEQUENCE OAuthAccessTokenSeq;
CREATE TABLE public.TemplateTag (
    id bigint NOT NULL,
    -- Owning account's workspaceKey (UUID). See UserAccount.workspaceKey.
    workspace text NOT NULL,
    templatePath text NOT NULL,
    tag text NOT NULL,
    description text NOT NULL DEFAULT '',
    templateJson text NOT NULL,
    endpoint text NOT NULL,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.TemplateTag
    ADD UNIQUE (workspace, templatePath, tag);
CREATE SEQUENCE TemplateTagSeq;
-- Unified print history across all paths (editor / API / MCP). The API path
-- keeps its queued -> processing -> completed lifecycle; editor/MCP insert a
-- 'completed' row directly. fkOAuthClient/fkTemplateTag apply to the API path
-- only (NULL otherwise); fkUserAccount/via/workspace/templatePath/format make a
-- row self-describing for every path.
CREATE TABLE public.PrintRequest (
    id bigint NOT NULL,
    key text NOT NULL,
    endpoint text NOT NULL,
    fkUserAccount bigint NOT NULL,
    via text NOT NULL DEFAULT 'api',
    workspace text NOT NULL DEFAULT '',
    templatePath text NOT NULL DEFAULT '',
    format text NOT NULL DEFAULT 'pdf',
    fkOAuthClient bigint,
    fkTemplateTag bigint,
    requestBodyJson text NOT NULL,
    status text NOT NULL,
    pdfPath text,
    errorReason text,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.PrintRequest
    ADD UNIQUE (key);
CREATE INDEX ON public.PrintRequest
    (fkOAuthClient);
CREATE INDEX ON public.PrintRequest
    (fkTemplateTag);
CREATE INDEX ON public.PrintRequest
    (status, id);
-- Paginated history listing scoped to an account, newest first.
CREATE INDEX ON public.PrintRequest
    (fkUserAccount, id);
CREATE SEQUENCE PrintRequestSeq;
CREATE TABLE public.TemplateAccessGrant (
    id bigint NOT NULL,
    fkOAuthClient bigint NOT NULL,
    -- Owning account's workspaceKey (UUID), or '*' for "any workspace the
    -- owning account can access". See UserAccount.workspaceKey.
    workspace text NOT NULL,
    path text NOT NULL,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.TemplateAccessGrant
    ADD UNIQUE (fkOAuthClient, workspace, path);
CREATE INDEX ON public.TemplateAccessGrant
    (fkOAuthClient);
CREATE INDEX ON public.TemplateAccessGrant
    (workspace, path);
CREATE SEQUENCE TemplateAccessGrantSeq;
-- Cross-account folder sharing. An owner grants a grantee access to a folder
-- (path) inside the owner's workspace, with independent read/write flags.
-- Replaces the former admin-managed UserAccessGrant visibility model.
CREATE TABLE public.FolderShare (
    id bigint NOT NULL,
    fkOwnerAccount bigint NOT NULL,
    fkGranteeAccount bigint NOT NULL,
    path text NOT NULL,
    canRead boolean NOT NULL DEFAULT TRUE,
    canWrite boolean NOT NULL DEFAULT FALSE,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.FolderShare
    ADD UNIQUE (fkOwnerAccount, fkGranteeAccount, path);
CREATE INDEX ON public.FolderShare
    (fkGranteeAccount);
CREATE INDEX ON public.FolderShare
    (fkOwnerAccount);
CREATE SEQUENCE FolderShareSeq;
CREATE TABLE public.BatchLock (
    id bigint NOT NULL,
    key text NOT NULL,
    createUser bigint,
    updateUser bigint,
    creation timestamp without time zone NOT NULL,
    modification timestamp without time zone NOT NULL,
    version bigint NOT NULL,
    PRIMARY KEY (id)
) WITHOUT OIDS;
ALTER TABLE public.BatchLock
    ADD UNIQUE (key);
CREATE SEQUENCE BatchLockSeq;
ALTER TABLE public.Session ADD CONSTRAINT FK_Session__fkUserAccount FOREIGN KEY (fkUserAccount) REFERENCES public.UserAccount(id);
ALTER TABLE public.FolderShare ADD CONSTRAINT FK_FolderShare__fkOwnerAccount FOREIGN KEY (fkOwnerAccount) REFERENCES public.UserAccount(id);
ALTER TABLE public.FolderShare ADD CONSTRAINT FK_FolderShare__fkGranteeAccount FOREIGN KEY (fkGranteeAccount) REFERENCES public.UserAccount(id);
ALTER TABLE public.OAuthAccessToken ADD CONSTRAINT FK_OAuthAccessToken__fkOAuthClient FOREIGN KEY (fkOAuthClient) REFERENCES public.OAuthClient(id);
ALTER TABLE public.TemplateAccessGrant ADD CONSTRAINT FK_TemplateAccessGrant__fkOAuthClient FOREIGN KEY (fkOAuthClient) REFERENCES public.OAuthClient(id);
ALTER TABLE public.PrintRequest ADD CONSTRAINT FK_PrintRequest__fkUserAccount FOREIGN KEY (fkUserAccount) REFERENCES public.UserAccount(id);
ALTER TABLE public.PrintRequest ADD CONSTRAINT FK_PrintRequest__fkOAuthClient FOREIGN KEY (fkOAuthClient) REFERENCES public.OAuthClient(id);
ALTER TABLE public.PrintRequest ADD CONSTRAINT FK_PrintRequest__fkTemplateTag FOREIGN KEY (fkTemplateTag) REFERENCES public.TemplateTag(id);
