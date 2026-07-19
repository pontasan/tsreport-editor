export namespace SystemProperty {

    export type Type = {
        id?: number,
        key: string,
        value: string,
        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): SystemProperty.Type {
        return {
            key: '',
            value: '',
            version: 0
        }
    }

}
