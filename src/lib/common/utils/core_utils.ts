import { v4 as uuidv4 } from 'uuid'

export namespace CoreUtils {

    /**
     * Is this IE?
     * @returns
     */
    export const isIE = () => {
        const ua = window.navigator.userAgent.toLowerCase()
        return (ua.match(/(msie|trident)/) ? true : false)
    }

    /**
     * Gets the client origin.
     * Naturally this does not work on the server side.
     * @returns
     */
    export const getHost = () => {
        if (location !== undefined) {
            return location.protocol + '//' + location.host
        }

        return undefined
    }

    /**
     * Generates a UUID.
     * Providing a wrapper instead of generating uuid directly is because the implementation
     * may change later (e.g. uuidv4? uuidv5? how many digits?).
     * @returns
     */
    export function genUUID(): string {
        return uuidv4()
    }

    /**
     * Removes null or undefined properties from an object.
     * @param obj
     * @returns
     */
    export function filterNulls<T>(obj: T): T | undefined {
        if (obj === undefined || obj === null) {
            return undefined
        }

        const keyList = Object.keys(obj)
        for (const key of keyList) {
            if ((obj as any)[key] === null || (obj as any)[key] === undefined) {
                delete (obj as any)[key]
            }
        }

        return obj
    }

    /**
     * Determines whether the value is undefined/null/NaN/an empty string (after trim).
     * @param src
     * @returns
     */
    export const isEmpty = <T>(src: T | undefined): src is undefined => {
        return src === undefined || src === null || (typeof src === 'number' && isNaN(src)) ||
            (typeof src === 'string' && src.trim().length === 0)
    }

    /**
     * Sanitization to prevent command injection.
     * Throws an exception when a potentially malicious character is detected.
     * @param src
     * @returns
     */
    export function sanitizeForCmd(src: string): string {
        for (let i = 0; i < src.length; i++) {
            const c = src.charAt(i)
            if (c === '&' || c === '|' || c === '`' || c === '"' || c === "'" || c === '\\' || c === '>' || c === '<' || c === '*' || c === '?' || c === '(' || c === ')' || c === '{' || c === '}' || c === '!' || c === ';' || c === '^' || c === '%') {
                console.log(`不正な文字を検出...[${c}]`)
                throw new Error()
            }
        }
        return src
    }

}