export namespace OAuthAccessToken {

    export type Type = {
        id?: number,
        fkOAuthClient: number,
        tokenHash: string,
        scopes: string,
        expiration?: Date,
        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): OAuthAccessToken.Type {
        return {
            fkOAuthClient: 0,
            tokenHash: '',
            scopes: '',
            version: 0
        }
    }

}
