import { Session } from "@/lib/server/entity/session"
import { ClientBase } from "pg"
import SQL from "sql-template-strings"

export namespace SessionDao {

    export async function insert(client: ClientBase, entity: Session.Type) {
        await client.query(SQL`
            INSERT INTO Session (
                fkUserAccount,
                token,
                expiration,
                
                createUser,
                updateUser,
                creation,
                modification,
                version
            ) VALUES (
                ${entity.fkUserAccount},
                ${entity.token},
                NOW() + interval '8 hours',
    
                ${entity.createUser},
                ${entity.updateUser},
                NOW(),
                NOW(),
                0
            )
        `)
    }

    export async function deleteSessionByToken(client: ClientBase, token: string): Promise<number> {
        const result = await client.query(SQL`
            DELETE
            FROM
                Session
            WHERE
                Session.token = ${token}
        `)
        return result.rowCount ? result.rowCount : 0
    }

    export async function deleteByUserAccount(client: ClientBase, fkUserAccount: number): Promise<number> {
        const result = await client.query(SQL`
            DELETE
            FROM
                Session
            WHERE
                Session.fkUserAccount = ${fkUserAccount}
        `)
        return result.rowCount ? result.rowCount : 0
    }

    export async function deleteExpiredSession(client: ClientBase): Promise<number> {
        const result = await client.query(SQL`
            DELETE
            FROM
                Session
            WHERE
                Session.expiration < NOW()
        `)
        return result.rowCount ? result.rowCount : 0
    }

}