import { DateUtils } from '@/lib/common/utils/date_utils'
import { NumberUtils } from '@/lib/common/utils/number_utils'
import dayjs from 'dayjs'
import 'dayjs/locale/ja'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Client, ClientBase, Pool, PoolClient, types } from 'pg'
import SQL, { SQLStatement } from 'sql-template-strings'

/* eslint-disable */
const Result = require('pg/lib/result.js')
/* eslint-enable */

const ENABLE_POOLING = false

// /set.

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Asia/Tokyo')
dayjs.locale('ja')

/**
  * Nullundefinedresult(column) query from.
  * Null or undefined detect.
  * MEMO: 0.001(ms)〜0.01(ms).(processcolumnrow)
 */

{
    if (Result.prototype._original_parseRow === undefined) {
        Result.prototype._original_parseRow = Result.prototype.parseRow
    }
    if (Result.prototype._original__parseRowAsArray === undefined) {
        Result.prototype._original__parseRowAsArray = Result.prototype._parseRowAsArray
    }

    Result.prototype.parseRow = function (rowData: any) {
        const result = this._original_parseRow(rowData)
        if (result === null || result === undefined) {
            return result
        }

        const keys = Object.keys(result)
        for (const key of keys) {
            if (result[key] === null || result[key] === undefined) {
                delete result[key]
            }
        }

        return result
    }

    Result.prototype._parseRowAsArray = function (rowData: any) {
        const result = this._original__parseRowAsArray(rowData)
        if (result === null || result === undefined) {
            return result
        }

        const keys = Object.keys(result)
        for (const key of keys) {
            if (result[key] === null || result[key] === undefined) {
                delete result[key]
            }
        }

        return result
    }
}

// Value.

types.setTypeParser(types.builtins.NUMERIC, (v: string) => {
    return parseFloat(v)
})
types.setTypeParser(types.builtins.INT8, (v: string) => {
    return parseInt(v)
})
types.setTypeParser(types.builtins.INT2, (v: string) => {
    return parseInt(v)
})
types.setTypeParser(types.builtins.INT4, (v: string) => {
    return parseInt(v)
})
types.setTypeParser(types.builtins.FLOAT4, (v: string) => {
    return parseFloat(v)
})
types.setTypeParser(types.builtins.FLOAT8, (v: string) => {
    return parseFloat(v)
})
types.setTypeParser(types.builtins.FLOAT8, (v: string) => {
    return parseFloat(v)
})

// Date/time types.
types.setTypeParser(types.builtins.DATE, (v: string) => {
    return DateUtils.parseDateFast(v) // dayjs(v).tz().toDate()
})
// types.setTypeParser(types.builtins.TIME, (v: string) => {
// // TODO error.support.

//     // WHAT
//     throw new NotSupportedException()
// })
types.setTypeParser(types.builtins.TIMESTAMP, (v: string) => {
    return DateUtils.parseTimeFast(v) //dayjs(v).tz().toDate()
})
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v: string) => {
    // TODO error.support.
    
    // WHAT
    // 2023-08-29 12:26:26.666355+09
    return DateUtils.parseTimeTzFast(v) //dayjs(v).tz().toDate()
})
// types.setTypeParser(types.builtins.INTERVAL, (v: string) => {
// // TODO error.support.

//     // WHAT
//     throw new NotSupportedException()
// })
// types.setTypeParser(types.builtins.TIMETZ, (v: string) => {
// // TODO error.support.

//     // WHAT
//     throw new NotSupportedException()
// })

export namespace DbUtils {
    export async function createDbClient(enableConnectionPool: boolean): Promise<PoolClient | Client> {
        // Runtime environments differ between production and development, so settings differ too.

        // Connection pool implementation.
        if (enableConnectionPool) {
            const pool = new Pool({
                host: process.env.DB_HOST,
                port: NumberUtils.parseNumber(process.env.DB_PORT),
                database: process.env.DB_NAME,
                user: process.env.DB_USER,
                password: process.env.DB_PASS,
                max: 100,
                idleTimeoutMillis: 8000,
                connectionTimeoutMillis: 20000,
            })

            const client = await pool.connect()
            return client
        }

        // For.
        
        const client = new Client({
            host: process.env.DB_HOST,
            port: NumberUtils.parseNumber(process.env.DB_PORT),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            connectionTimeoutMillis: 20000
        })

        await client.connect()
        return client
    }

    export async function transaction<T>(callback: (client: PoolClient | Client) => Promise<T>) {
        const client = await createDbClient(ENABLE_POOLING)
        try {
            const result = await callback(client)
            return result
        } finally {
            if (isPoolClient(client)) {
                client.release()
            } else {
                await client.end()
            }
        }
    }

    function isPoolClient(client: any): client is PoolClient {
        if (typeof client === 'object' && client.release) {
            return true
        }
        return false
    }

/**
      * Rowget.
 */
    
    export async function dumpExplainAnalyze(client: PoolClient | Client | ClientBase, sql: SQLStatement): Promise<string> {
        const wkSql = SQL`EXPLAIN ANALYZE `
        wkSql.append(sql)

        const qres = await client.query(wkSql)
        let result = ''

        result += '=============================================================================== DUMP EXPLAIN ===============================================================================\n'
        result += `${wkSql.query}\n`

        result += '============================================================================================================================================================================\n'
        for (let i = 0; i < wkSql.values.length; i++) {
            result += `values[${i}]: ${wkSql.values[i]}\n`
        }

        result += '============================================================================================================================================================================\n'
        for (const row of qres.rows) {
            result += `${row['QUERY PLAN']}\n`
        }
        result += '============================================================================================================================================================================\n'

        return result
    }
}
