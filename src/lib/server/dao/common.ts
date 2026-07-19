import { ClientBase } from "pg"
import SQL from "sql-template-strings"

export namespace CommonDao {

    export async function now(client: ClientBase): Promise<Date> {
        const result = await client.query(SQL`
            SELECT NOW() AS "time"
        `)
        return result.rows[0].time
    }

    export async function currentDate(client: ClientBase): Promise<Date> {
        const result = await client.query(SQL`
            SELECT CURRENT_DATE AS "date"
        `)
        return result.rows[0].date
    }

}