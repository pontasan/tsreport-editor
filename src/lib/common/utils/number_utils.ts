import Big from 'big.js'
import { CoreUtils } from './core_utils'

export namespace NumberUtils {
    export function formatNumber(src: number | undefined, maxFractionDigits: number = 0): string {
        if (src === undefined || src === null || isNaN(src)) {
            return ''
        }

        try {
            return formatBig(Big(src), maxFractionDigits)
            /* eslint-disable */
        } catch (e) {
            /* eslint-enable */
            // Intentionally swallowed
            return ''
        }
    }

    export function formatBig(src: Big | undefined, maxFractionDigits: number = 0): string {
        if (!src) {
            return ''
        }

        const strNum = src.toString()

        // Does it have a decimal point?
        const fractionDigitsSeparatorIdx = strNum.lastIndexOf('.')
        let strIntDigits = ''
        let strFractionDigits = ''
        if (fractionDigitsSeparatorIdx !== -1) {
            // It has a decimal point.
            // Split into integer part and fractional part.
            strIntDigits = strNum.substring(0, fractionDigitsSeparatorIdx)
            strFractionDigits = strNum.substring(fractionDigitsSeparatorIdx + 1, strNum.length)
        } else {
            // Integer only
            strIntDigits = strNum
            strFractionDigits = ''
        }

        let result = ''

        // Insert a comma every 3 digits in the integer part.
        let cnt = 0;
        for (let i = strIntDigits.length - 1; i >= 0; i--) {
            result = strIntDigits.charAt(i) + result

            cnt++
            if (cnt === 3 && i !== 0 && (i > 0 && strIntDigits.charAt(i - 1) !== '-')) {
                // Reached the 3rd digit, not at the start of the string, and the left char is not a minus sign?
                // Add a comma and reset the counter.
                result = ',' + result
                cnt = 0
            }
        }

        // Append the fractional part up to the specified number of digits.
        if (strFractionDigits !== '' && maxFractionDigits > 0) {
            result += '.'

            cnt = 0
            for (let i = 0; i < strFractionDigits.length; i++) {
                result += strFractionDigits[i]

                cnt++
                if (cnt >= maxFractionDigits) {
                    break
                }
            }
        }

        return result
    }

    const FILESIZE_DEFINES = [
        { unit: 'YB', length: Big('1208925819614629174706176') },
        { unit: 'ZB', length: Big('1180591620717411303424') },
        { unit: 'EB', length: Big('1152921504606846976') },
        { unit: 'PB', length: Big('1125899906842624') },
        { unit: 'TB', length: Big('1099511627776') },
        { unit: 'GB', length: Big('1073741824') },
        { unit: 'MB', length: Big('1048576') },
        { unit: 'KB', length: Big('1024') }
    ]

    export function formatFileLength(byteLength: number): string {
        if (byteLength === undefined || byteLength === null || isNaN(byteLength)) {
            return ''
        }

        const wkByteLen = Big(byteLength)
        for (const def of FILESIZE_DEFINES) {
            if (def.length.lte(wkByteLen)) {
                return formatBig(wkByteLen.div(def.length).round(0, Big.roundUp)) + ' ' + def.unit
            }
        }

        return formatBig(wkByteLen) + ' B'
    }

    export function toString(src: Big): string {
        return src ? src.toString() : ''
    }

    export function parseBig(src: string): Big | undefined
    export function parseBig(src: string | undefined | null): Big | undefined
    export function parseBig(src: string | undefined | null, defaultValue: Big): Big
    export function parseBig(src: string | undefined | null, defaultValue: Big | undefined = undefined): Big | undefined {
        try {
            if (src === undefined || src === null) {
                return defaultValue
            }

            // Remove commas
            return Big(src.trim().replaceAll(',', ''))
            /* eslint-disable */
        } catch (e) {
            /* eslint-enable */
            // Could not be interpreted as a number...
            return defaultValue
        }
    }

    export function parseNumber(src: string): number | undefined
    export function parseNumber(src: string | undefined | null): number | undefined
    export function parseNumber(src: string | undefined | null, defaultValue: number): number
    export function parseNumber(src: string | undefined | null, defaultValue: number | undefined = undefined): number | undefined {
        try {
            if (src === undefined || src === null) {
                return defaultValue
            }

            // Remove commas
            const ret = Big(src.trim().replaceAll(',', '')).toNumber()

            if (isNaN(ret)) {
                return defaultValue
            }

            return ret
            /* eslint-disable */
        } catch (e) {
            /* eslint-enable */
            // Could not be interpreted as a number...
            return defaultValue
        }
    }

    export function nvl(src?: number, defaultValue: number = 0): number {
        if (CoreUtils.isEmpty(src)) {
            return defaultValue
        }
        return src
    }

}