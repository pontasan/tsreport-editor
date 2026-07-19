export namespace TemplateAccessGrant {

    export type Type = {
        id?: number,
        fkOAuthClient: number,
        workspace: string,
        path: string,
        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): TemplateAccessGrant.Type {
        return {
            fkOAuthClient: 0,
            workspace: '',
            path: '',
            version: 0
        }
    }

}
