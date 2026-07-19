export namespace TemplateTag {

    export type Type = {
        id?: number,
        workspace: string,
        templatePath: string,
        tag: string,
        description: string,
        templateJson: string,
        endpoint: string,
        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): TemplateTag.Type {
        return {
            workspace: '',
            templatePath: '',
            tag: '',
            description: '',
            templateJson: '',
            endpoint: '',
            version: 0
        }
    }

}
