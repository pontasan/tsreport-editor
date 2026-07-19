export namespace UserAccountVO {

    export type Type = {
        id?: number,
        displayName: string,
        userId: string,
        pw: string,
        provider: string,
        email: string,
        // The account's own workspace identity (UUID); the user shares this key
        // with others so they can grant folder access.
        workspaceKey: string,
        adminFlag: boolean,
        mcpEnabled: boolean,
        // Default color mode for the editor color inputs
        defaultColorMode: 'rgb' | 'cmyk',

        createUser?: number,
        updateUser?: number,
        creation: string,
        modification: string,
        version: number
    }

    export function create(): UserAccountVO.Type {
        return {
            displayName: '',
            userId: '',
            pw: '',
            provider: 'local',
            email: '',
            workspaceKey: '',
            adminFlag: false,
            mcpEnabled: true,
            defaultColorMode: 'rgb',

            creation: '',
            modification: '',
            version: 0
        }
    }

}
