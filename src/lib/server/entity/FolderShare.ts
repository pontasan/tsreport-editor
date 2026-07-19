export namespace FolderShare {

    export type Type = {
        id?: number,
        fkOwnerAccount: number,
        fkGranteeAccount: number,
        path: string,
        canRead: boolean,
        canWrite: boolean,
        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): FolderShare.Type {
        return {
            fkOwnerAccount: 0,
            fkGranteeAccount: 0,
            path: '',
            canRead: true,
            canWrite: false,
            version: 0
        }
    }

}
