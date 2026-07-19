export namespace PrintRequest {

    export type Status = 'queued' | 'processing' | 'completed' | 'error'

    // The path a print was issued through.
    export type Via = 'editor' | 'api' | 'mcp'

    export type Type = {
        id?: number,
        key: string,
        endpoint: string,
        // The account that issued the print (present for every path).
        fkUserAccount: number,
        via: Via,
        // Owning account's workspaceKey and the template path (self-describing;
        // set for every path, unlike the API-only tag/client foreign keys).
        workspace: string,
        templatePath: string,
        format: string,
        // API path only (NULL for editor / MCP).
        fkOAuthClient?: number,
        fkTemplateTag?: number,
        requestBodyJson: string,
        status: Status,
        pdfPath?: string,
        errorReason?: string,
        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): PrintRequest.Type {
        return {
            key: '',
            endpoint: '',
            fkUserAccount: 0,
            via: 'api',
            workspace: '',
            templatePath: '',
            format: 'pdf',
            requestBodyJson: '',
            status: 'queued',
            version: 0
        }
    }

}
