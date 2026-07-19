export namespace OAuthClient {

    export type Type = {
        id?: number,
        fkUserAccount: number,
        clientId: string,
        clientSecret: string,
        scopes: string,
        deleteFlag: boolean,
        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): OAuthClient.Type {
        return {
            fkUserAccount: 0,
            clientId: '',
            clientSecret: '',
            scopes: '',
            deleteFlag: false,
            version: 0
        }
    }

}
