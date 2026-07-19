import { CoreUtils } from '@/lib/common/utils/core_utils'
import { NumberUtils } from '@/lib/common/utils/number_utils'
import { DayItem } from '@/lib/common/vo/calendar/day_item'
import { MonthItem } from '@/lib/common/vo/calendar/month_item'
import { YearItem } from '@/lib/common/vo/calendar/year_item'
import dayjs, { Dayjs } from 'dayjs'
import 'dayjs/locale/ja'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

// Timezone/locale configuration
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Asia/Tokyo')
dayjs.locale('ja')

export namespace DateUtils {
    export function parseDate(src?: string, fmt: string = 'YYYY/MM/DD'): Date | undefined {
        if (CoreUtils.isEmpty(src) || (src && src.length && fmt && fmt.length && src.length < fmt.length)) {
            return undefined
        }

        return dayjs(src, fmt).toDate()
    }

    export function parseTime(src?: string, fmt: string = 'YYYY/MM/DD HH:mm'): Date | undefined {
        if (CoreUtils.isEmpty(src) || (src && src.length && fmt && fmt.length && src.length < fmt.length)) {
            return undefined
        }

        return dayjs(src, fmt).toDate()
    }

    export function parse(src?: string, fmt: string = 'YYYY/MM/DD HH:mm:ss.SSS'): Date | undefined {
        if (CoreUtils.isEmpty(src) || (src && src.length && fmt && fmt.length && src.length < fmt.length)) {
            return undefined
        }

        return dayjs(src, fmt).toDate()
    }

    /**
     * Fast but with a fixed format. Assumes a DATE result from PostgreSQL.
     * Example: 2023-08-29
     * @param src
     * @returns
     */
    export function parseDateFast(src?: string): Date | undefined {
        if (src === null || src === undefined || typeof src !== 'string') {
            return undefined
        }

        let step = 0
        const wkValues = ['', '', '']
        let c
        for (let i = 0; i < src.length; i++) {
            if (step === 0 || step === 1) {
                // year or month
                c = src.charAt(i)
                if (c === '-') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 2) {
                // date
                wkValues[step] += src.charAt(i)
                if (i === src.length - 1) {
                    break
                }
            }
        }

        const year = NumberUtils.parseNumber(wkValues[0])
        if (year === undefined) {
            return undefined
        }

        const month = NumberUtils.parseNumber(wkValues[1])
        if (month === undefined) {
            return undefined
        }

        const date = NumberUtils.parseNumber(wkValues[2])
        if (date === undefined) {
            return undefined
        }

        return new Date(year, month - 1, date, 0, 0, 0, 0)
    }

    /**
     * Fast but with a fixed format. Assumes a TIMESTAMP result from PostgreSQL.
     * Example: 2023-08-29 10:41:52.865963
     * @param src
     */
    export function parseTimeFast(src?: string): Date | undefined {
        if (src === null || src === undefined || typeof src !== 'string') {
            return undefined
        }

        let step = 0
        const wkValues = ['', '', '', '', '', '', '']
        let c
        for (let i = 0; i < src.length; i++) {
            if (step === 0 || step === 1) {
                // year or month
                c = src.charAt(i)
                if (c === '-') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 2) {
                // date
                c = src.charAt(i)
                if (c === ' ') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 3 || step === 4 || step === 5) {
                // hours or minutes or seconds
                c = src.charAt(i)
                if (c === ':' || c === '.') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 6) {
                // millisec
                wkValues[step] += src.charAt(i)
                if (i === src.length - 1 || wkValues[step].length === 3) {
                    // JavaScript's Date only has millisecond precision, so cap at 3 digits.
                    break
                }
            }
        }

        const year = NumberUtils.parseNumber(wkValues[0])
        if (year === undefined) {
            return undefined
        }

        const month = NumberUtils.parseNumber(wkValues[1])
        if (month === undefined) {
            return undefined
        }

        const date = NumberUtils.parseNumber(wkValues[2])
        if (date === undefined) {
            return undefined
        }

        const hours = NumberUtils.parseNumber(wkValues[3], 0)
        const minutes = NumberUtils.parseNumber(wkValues[4], 0)
        const seconds = NumberUtils.parseNumber(wkValues[5], 0)
        const milli = NumberUtils.parseNumber(wkValues[6].substring(0, 3), 0)

        return new Date(year, month - 1, date, hours, minutes, seconds, milli)
    }

    /**
     * Fast but with a fixed format. Assumes a TIMESTAMP result from PostgreSQL.
     * Example: 2023-08-29 12:26:26.666355+09
     * @param src
     */
    export function parseTimeTzFast(src?: string): Date | undefined {
        if (src === null || src === undefined || typeof src !== 'string') {
            return undefined
        }

        let step = 0
        const wkValues = ['', '', '', '', '', '', '', '']
        let c
        for (let i = 0; i < src.length; i++) {
            if (step === 0 || step === 1) {
                // year or month
                c = src.charAt(i)
                if (c === '-') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 2) {
                // date
                c = src.charAt(i)
                if (c === ' ') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 3 || step === 4 || step === 5) {
                // hours or minutes or seconds
                c = src.charAt(i)
                if (c === ':' || c === '.') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 6) {
                // milli
                c = src.charAt(i)
                if (c === '+') {
                    step++
                    continue
                }
                wkValues[step] += c
            } else if (step === 7) {
                // TimeZone
                wkValues[step] += src.charAt(i)
                if (i === src.length - 1) {
                    break
                }
            }
        }

        const year = NumberUtils.parseNumber(wkValues[0])
        if (year === undefined) {
            return undefined
        }

        const month = NumberUtils.parseNumber(wkValues[1])
        if (month === undefined) {
            return undefined
        }

        const date = NumberUtils.parseNumber(wkValues[2])
        if (date === undefined) {
            return undefined
        }

        const hours = NumberUtils.parseNumber(wkValues[3], 0)
        const minutes = NumberUtils.parseNumber(wkValues[4], 0)
        const seconds = NumberUtils.parseNumber(wkValues[5], 0)
        const milli = NumberUtils.parseNumber(wkValues[6].substring(0, 3), 0)

        // TODO: for now, TZ is ignored
        // const tz = NumberUtils.parseNumber(wkValues[7], 0)

        return new Date(year, month - 1, date, hours, minutes, seconds, milli)
    }

    export function formatDate(src?: Date | Dayjs): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('YYYY/MM/DD')
    }

    export function formatYM(src?: Date | Dayjs): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('YYYY/MM')
    }

    export function formatY(src?: Date | Dayjs): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('YYYY')
    }

    export function formatTime(src?: Date | Dayjs): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('YYYY/MM/DD HH:mm')
    }

    export function formatHM(src?: Date | Dayjs): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('HH:mm')
    }

    export function formatH(src?: Date | Dayjs): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('HH')
    }

    export function format(src?: Date | Dayjs, fmt: string = 'YYYY/MM/DD HH:mm:ss.SSS'): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format(fmt)
    }

    export function formatMonth(src?: Date | Dayjs): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('MM/DD HH:mm')
    }

    export function formatHour(src?: Date | Dayjs | string): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }

        return dayjs(src).format('HH:mm')
    }

    export function createMinDate() {
        // https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/Date
        // TODO: the true JS minimum is the year 271821 BC, but that causes a "timestamp out of range" error in pg.
        // So use the UTC epoch offset "1970-01-01 00:00:00" as the minimum instead.
        const base = new Date(0)
        return base
    }

    export function createMaxDate() {
        // https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/Date
        // Year 275760
        const base = new Date(0)
        base.setDate(base.getDate() + 100000000)
        return base
    }

    export function clone(date?: Date) {
        if (date === undefined || date === null) {
            return undefined
        }

        return new Date(date.getTime())
    }

    export function getDayOfWeek(src?: Date): string {
        if (CoreUtils.isEmpty(src) || !isValid(src)) {
            return ''
        }
        if (!(src instanceof Date)) {
            return ''
        }

        switch (src.getDay()) {
            case 0: return '日'
            case 1: return '月'
            case 2: return '火'
            case 3: return '水'
            case 4: return '木'
            case 5: return '金'
            case 6: return '土'
        }

        // Unexpected
        throw new Error()
    }

    export type CalendarCell<T> = {
        date?: string,
        model?: T
    }

    /**
     * Builds a 2D array corresponding to the given year and month.
     * @param year
     * @param month
     * @param onFetchCell
     * @returns
     */
    export function buildCalendar<T>(year: number, month: number, onFetchCell: (date: Date) => T): Array<Array<CalendarCell<T>>> {
        const results = new Array<Array<CalendarCell<T>>>(6)

        // Day-of-week table
        // Could be made configurable from outside if needed.
        const dayOfWeekArray = [0, 1, 2, 3, 4, 5, 6]

        const offset = new Date(year, month - 1, 1, 0, 0, 0, 0)
        if (isNaN(offset.getTime())) {
            // Treat as an invalid date
            throw new Error()
        }

        let isDayOfWeekMatched = false
        for (let i = 0; i < results.length; i++) {
            // Add a week's worth of cells
            results[i] = new Array<CalendarCell<T>>(7)

            for (let k = 0; k < 7; k++) {
                // Search for the day-of-week position corresponding to the start of the month
                if (!isDayOfWeekMatched &&
                    offset.getDay() !== dayOfWeekArray[k]) {
                    // Day of week doesn't match, so move to next
                    continue
                }

                // Once the day of week first matches, rewind by the number of days from the start
                // of the month to the matched day, then restart from there.
                // The intent is to produce a result where the date fills in starting from
                // row 0 / column 0 of the calendar array.
                if (!isDayOfWeekMatched) {
                    isDayOfWeekMatched = true
                    // Restart
                    offset.setDate(offset.getDate() - k)
                    k = -1 // Minus 1 to account for the +1 increment when the loop continues
                    continue
                }

                results[i][k] = {
                    date: formatDate(offset),
                    model: onFetchCell(new Date(offset.getTime()))
                }

                // next
                offset.setDate(offset.getDate() + 1)
            }
        }

        return results
    }

    export function equals(target?: Date, other?: Date): boolean {
        if (CoreUtils.isEmpty(target) || CoreUtils.isEmpty(other)) {
            return target === other
        }
        return target.getTime() === other.getTime()
    }

    export function isValid(target?: Date | Dayjs | string): boolean {
        const wkDate = dayjs(target).toDate()
        return !CoreUtils.isEmpty(wkDate) && !isNaN(wkDate.getTime())
    }

    export function getMonthStartEndDates(year: number, month: number): {
        startDate: Date,
        endDate: Date
    } {
        const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0)
        const endDate = new Date(year, month, 0, 23, 59, 59, 999)
        return {
            startDate,
            endDate
        }
    }

    export function buildYearList(): Array<YearItem> {
        const list = [] as Array<YearItem>
        for (let i = new Date().getFullYear() + 3; i >= 2000; i--) {
            list.push({
                label: i + '年',
                value: i
            })
        }
        return list
    }

    export function buildMonthList(): Array<MonthItem> {
        const list = [] as Array<MonthItem>
        for (let i = 12; i >= 1; i--) {
            list.push({
                label: i + '月',
                value: i
            })
        }
        return list
    }

    export function buildMonthListAsc(): Array<MonthItem> {
        const list = [] as Array<MonthItem>
        for (let i = 1; i <= 12; i++) {
            list.push({
                label: i + '月',
                value: i
            })
        }
        return list
    }

    export function buildDayList(year: number, month: number): Array<DayItem> {
        const lastDayOfMonth = dayjs(new Date(year, month - 1, 1)).add(1, 'month').subtract(1, 'day').toDate()

        const list = [] as Array<DayItem>
        for (let i = lastDayOfMonth.getDate(); i >= 1; i--) {
            list.push({
                label: i + '日',
                value: i
            })
        }

        return list
    }

    export function createDate(year: number, month: number, date: number): Date {
        return new Date(year, month - 1, date, 0, 0, 0, 0)
    }

    /**
     * Converts a date to a pixel value.
     * @param date the date to convert
     * @param config configuration values for the conversion (pixel counts, visible-range limits, etc.)
     * @returns pixel value
     *
     * Usage example:
     *
     * // Configuration values that the pixel conversion is based on
     * const config = {
     *   // Lower-bound date of the visible range
     *   displayStartDate: DateUtils.parseDate('2024/01/24')!,
     *
     *   // Upper-bound date of the visible range
     *   displayEndDate: DateUtils.parseDate('2024/01/26')!,
     *
     *   // Lower time bound (hours)
     *   limitStartHours: 8,
     *
     *   // Lower time bound (minutes)
     *   limitStartMinutes: 0,
     *
     *   // Upper time bound (hours)
     *   limitEndHours: 21,
     *
     *   // Upper time bound (minutes)
     *   limitEndMinutes: 0,
     *
     *   // Pixels per hour
     *   pixelsPerHour: 20,
     *
     *   // Whether to use caching (about 3.5x faster)
     *   enableCache: true
     * }
     *
     * // Convert the schedule's start time to pixels
     * const startPx = DateUtils.computePixcelFromDate(DateUtils.parseTime('2024/01/24 14:30')!, config)
     *
     * // Convert the schedule's end time to pixels
     * const endPx = DateUtils.computePixcelFromDate(DateUtils.parseTime('2024/01/26 14:30')!, config)
     *
     * // Width of the schedule
     * const width = endPx - startPx
     */
    export function computePixcelFromDate(date: Date, config: ComputePixcelFromDataConfig): number {
        const MILLISECONDS_PER_DAY = 86400000 // 1000 * 60 * 60 * 24
        const MILLISECONDS_PER_HOUR = 3600000 // 1000 * 60 * 60

        if (!config || !config.displayStartDate || !config.displayEndDate) {
            // Cannot continue
            return 0
        }

        // FNV-1a (Fowler-Noll-Vo) hash algorithm
        const OFFSET_BASE_32 = 2166136261 // 64: 14695981039346656037
        const FNV_PRIME_32 = 16777619 // 64: 1099511628211

        let hashKey = OFFSET_BASE_32
        if (config.enableCache) {
            // Note: this must be updated if a new setting is added to config.
            hashKey ^= config.displayStartDate.getTime()
            hashKey *= FNV_PRIME_32

            hashKey ^= config.displayEndDate.getTime()
            hashKey *= FNV_PRIME_32

            hashKey ^= config.limitStartHours
            hashKey *= FNV_PRIME_32

            hashKey ^= config.limitStartMinutes
            hashKey *= FNV_PRIME_32

            hashKey ^= config.limitEndHours
            hashKey *= FNV_PRIME_32

            hashKey ^= config.limitEndMinutes
            hashKey *= FNV_PRIME_32

            hashKey ^= config.pixelsPerHour
            hashKey *= FNV_PRIME_32
        }

        // Computation derived from config.
        // MEMO: since this is derived from configuration values, it is cacheable; reduces heap
        // churn and is about 3.5x faster.
        if (!config.enableCache || config._hashKey !== hashKey) {
            // Compute the lower time bound (just want hours + minutes as one value; 8:30 should become 8.5)
            config._limitStartHours = config.limitStartHours + config.limitStartMinutes / 60

            // Compute the upper time bound (just want hours + minutes as one value; 8:30 should become 8.5)
            config._limitEndHours = config.limitEndHours + config.limitEndMinutes / 60

            // Clone the instance in order to normalize it.
            config._displayStartDate = new Date(config.displayStartDate.getTime())
            config._displayStartDate.setHours(config.limitStartHours)
            config._displayStartDate.setMinutes(config.limitStartMinutes)
            config._displayStartDate.setSeconds(0)
            config._displayStartDate.setMilliseconds(0)

            // The upper bound of the visible range is one day past the specified date. If the
            // visible range's upper bound is the 26th, we want it to be 00:00:00.000 on the 27th.
            config._displayEndDate = new Date(config.displayEndDate.getTime())
            config._displayEndDate.setDate(config._displayEndDate.getDate() + 1)
            config._displayEndDate.setHours(0)
            config._displayEndDate.setMinutes(0)
            config._displayEndDate.setSeconds(0)
            config._displayEndDate.setMilliseconds(0)

            // Clamp the visible range within the lower/upper time bounds
            const displayStartHours = config._displayStartDate.getHours() + config._displayStartDate.getMinutes() / 60
            if (displayStartHours < config._limitStartHours) {
                config._displayStartDate.setTime(config._displayStartDate.getTime() + (config._limitStartHours - displayStartHours) * MILLISECONDS_PER_HOUR)
            }
            if (displayStartHours > config._limitEndHours) {
                config._displayStartDate.setTime(config._displayStartDate.getTime() - (displayStartHours - config._limitEndHours) * MILLISECONDS_PER_HOUR)
            }

            const displayEndHours = config._displayEndDate.getHours() + config._displayEndDate.getMinutes() / 60
            if (displayEndHours < config._limitStartHours) {
                config._displayEndDate.setTime(config._displayEndDate.getTime() + (config._limitStartHours - displayEndHours) * MILLISECONDS_PER_HOUR)
            }
            if (displayEndHours > config._limitEndHours) {
                config._displayEndDate.setTime(config._displayEndDate.getTime() - (displayEndHours - config._limitEndHours) * MILLISECONDS_PER_HOUR)
            }

            config._hashKey = hashKey
        }

        // Normalize the date being converted
        const wkDate = new Date(date.getTime())
        wkDate.setSeconds(0)
        wkDate.setMilliseconds(0)

        // Clamp the date being converted so it stays within the visible range
        if (wkDate.getTime() < config._displayStartDate!.getTime()) {
            wkDate.setTime(config._displayStartDate!.getTime())
        }
        if (wkDate.getTime() > config._displayEndDate!.getTime()) {
            wkDate.setTime(config._displayEndDate!.getTime())
        }

        // Clamp the time within the lower/upper time bounds
        const hours = wkDate.getHours() + wkDate.getMinutes() / 60
        if (hours < config._limitStartHours!) {
            wkDate.setTime(wkDate.getTime() + (config._limitStartHours! - hours) * MILLISECONDS_PER_HOUR)
        }
        if (hours > config._limitEndHours!) {
            wkDate.setTime(wkDate.getTime() - (hours - config._limitEndHours!) * MILLISECONDS_PER_HOUR)
        }

        // Distance from the start of the display range to the date/time being converted (in milliseconds)
        const offset = wkDate.getTime() - config.displayStartDate.getTime()

        // Distance from the start of the display range to the date/time being converted (in days)
        const offsetAsDays = Math.trunc(offset / MILLISECONDS_PER_DAY)

        // Adjustment hours
        const adjustmentHours = (offsetAsDays * (24 - config._limitEndHours! + config._limitStartHours!) + config._limitStartHours!) * config.pixelsPerHour

        // Compute the pixel value
        return (offset / MILLISECONDS_PER_HOUR) * config.pixelsPerHour - adjustmentHours
    }

    export type ComputePixcelFromDataConfig = {
        // Start time of the display range
        displayStartDate: Date,
        // End time of the display range
        displayEndDate: Date,
        // Lower bound of time display (hours) 0-23
        limitStartHours: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23,
        // Lower bound of time display (minutes) 0-59
        limitStartMinutes: number,
        // Upper bound of time display (hours) 1-24
        limitEndHours: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24,
        // Upper bound of time display (minutes) 0-59
        limitEndMinutes: number,
        // Pixels per hour
        pixelsPerHour: number,
        // Whether to use caching
        enableCache: boolean,

        // The following are for the internal cache implementation; callers must not set these directly.
        // Hash key used for caching
        _hashKey?: number,
        // The following are cache fields
        _limitStartHours?: number
        _limitEndHours?: number,
        _displayStartDate?: Date,
        _displayEndDate?: Date
    }

    /**
     * Computes the date/time corresponding to the point touched or clicked on the screen.
     * (derives the date/time from a pixel value)
     *
     * Unlike computePixcelFromDate, this is expected to be needed only in response to a user
     * action (e.g. a click), so no complex processing such as caching is implemented.
     *
     * Usage example:
     *
     *    onClick={(e) => {
     *        const config = {
     *            displayStartDate: DateUtils.parseDate('2024/01/24')!,
     *            limitStartHours: 8,
     *            limitStartMinutes: 0,
     *            limitEndHours: 21,
     *            limitEndMinutes: 0,
     *            pixelsPerHour: 20
     *        } as DateUtils.ComputeDateFromPixcel
     *
     *        // The clicked HTML element is needed in order to get the offset position.
     *        const frame = ref.current!
     *        const rect = frame.getBoundingClientRect()!
     *
     *        // Get the date from the cursor position (e.clientX), offset (rect.left), and scroll position (frame.scrollLeft)
     *        const date = DateUtils.computeDateFromPixcel(e.clientX, rect.left, frame.scrollLeft, config)
     *        console.log(date.toLocaleString())
     *    }}
     *
     * @param cursorPos the touched or clicked pixel coordinate (whether it's the x or y axis is up to the caller)
     * @param htmlElementOffset the HTML element that was touched or clicked; needed to compute the offset.
     * @param scrollPos scroll position (whether it's the x or y axis is up to the caller)
     * @param config the configuration values this computation is based on
     * @returns
     */
    export function computeDateFromPixcel(cursorPos: number, htmlElementOffset: number, scrollPos: number, config: ComputeDateFromPixcel): Date {
        const MILLISECONDS_PER_HOUR = 3600000 // 1000 * 60 * 60

        // Clone the instance in order to normalize it
        const displayStartDate = new Date(config.displayStartDate.getTime())
        displayStartDate.setHours(config.limitStartHours)
        displayStartDate.setMinutes(config.limitStartMinutes)
        displayStartDate.setSeconds(0)
        displayStartDate.setMilliseconds(0)

        // Compute the lower time bound (just want hours + minutes as one value; 8:30 should become 8.5)
        const limitStartHours = config.limitStartHours + config.limitStartMinutes / 60

        // Compute the upper time bound (just want hours + minutes as one value; 8:30 should become 8.5)
        const limitEndHours = config.limitEndHours + config.limitEndMinutes / 60

        // Active hours (visible time span)
        const activeHours = limitEndHours - limitStartHours

        // Inactive hours (hidden time span)
        const deactiveHours = (24 - limitEndHours) + limitStartHours

        // Pixel position of the picked point
        const hoursAsPixcel = cursorPos - htmlElementOffset + scrollPos

        // Convert the picked point's pixel position to hours
        const hours = hoursAsPixcel / config.pixelsPerHour

        // Adjustment value
        const adjustmentHours = Math.trunc(hoursAsPixcel / (config.pixelsPerHour * activeHours)) * deactiveHours + limitStartHours

        const newTime = config.displayStartDate.getTime() + (hours + adjustmentHours) * MILLISECONDS_PER_HOUR

        // Apply the adjustment and compute the date
        if (config.timeInterval === undefined) {
            return new Date(newTime)
        } else {
            return new Date(Math.floor(newTime / config.timeInterval) * config.timeInterval)
        }
    }

    export type ComputeDateFromPixcel = {
        // Start time of the display range
        displayStartDate: Date,
        // Lower bound of time display (hours) 0-23
        limitStartHours: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23,
        // Lower bound of time display (minutes) 0-59
        limitStartMinutes: number,
        // Upper bound of time display (hours) 1-24
        limitEndHours: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24,
        // Upper bound of time display (minutes) 0-59
        limitEndMinutes: number,
        // Pixels per hour
        pixelsPerHour: number,
        // Rounding interval in milliseconds?
        timeInterval?: number
    }

    export function addDays(src: Date, days: number): Date {
        if (!src) {
            throw new Error()
        }

        const wkDate = DateUtils.clone(src)
        if (!wkDate) {
            throw new Error()
        }

        wkDate.setDate(wkDate.getDate() + days)
        return wkDate
    }

}