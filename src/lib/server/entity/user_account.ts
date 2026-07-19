export namespace UserAccount {

    export type Type = {
        id?: number,
        displayName: string,
        userId: string,
        // Argon2id PHC string for local accounts; empty for external accounts.
        pw: string,
        // 'local' for password accounts, or an external OIDC provider id.
        provider: string,
        // OIDC subject (sub) for external accounts; '' for local accounts.
        externalId: string,
        email: string,
        // Per-account workspace identity (UUID). Also the share key others enter
        // to receive folder access, and the workspace segment of API URLs.
        workspaceKey: string,
        adminFlag: boolean,
        mcpEnabled: boolean,
        mcpKey: string,
        // Default color mode for the editor color inputs
        defaultColorMode: 'rgb' | 'cmyk',

        createUser?: number,
        updateUser?: number,
        creation?: Date,
        modification?: Date,
        version: number
    }

    export function create(): UserAccount.Type {
        return {
            displayName: '',
            userId: '',
            pw: '',
            provider: 'local',
            externalId: '',
            email: '',
            workspaceKey: '',
            adminFlag: false,
            mcpEnabled: true,
            mcpKey: '',
            defaultColorMode: 'rgb',

            version: 0
        }
    }

}
