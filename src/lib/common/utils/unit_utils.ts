// Unit conversion utility
// Provides conversion between the core engine unit (pt) and editor display units (mm/inch)

export type DisplayUnit = 'mm' | 'inch'

// Conversion factors (exact fractions)
// 1pt = 1/72 inch = 25.4/72 mm
const PT_TO_MM = 25.4 / 72
const PT_TO_INCH = 1 / 72

export namespace UnitUtils {

    export function ptToMm(pt: number): number {
        return pt * PT_TO_MM
    }

    export function mmToPt(mm: number): number {
        return mm / PT_TO_MM
    }

    export function ptToInch(pt: number): number {
        return pt * PT_TO_INCH
    }

    export function inchToPt(inch: number): number {
        return inch / PT_TO_INCH
    }

    export function ptToDisplay(pt: number, unit: DisplayUnit): number {
        switch (unit) {
            case 'mm': return ptToMm(pt)
            case 'inch': return ptToInch(pt)
        }
    }

    export function displayToPt(value: number, unit: DisplayUnit): number {
        switch (unit) {
            case 'mm': return mmToPt(value)
            case 'inch': return inchToPt(value)
        }
    }

    export function ptToDisplayRounded(pt: number, unit: DisplayUnit): number {
        switch (unit) {
            case 'mm': return Math.round(ptToMm(pt) * 100) / 100
            case 'inch': return Math.round(ptToInch(pt) * 1000) / 1000
        }
    }

    export function getUnitLabel(unit: DisplayUnit): string {
        switch (unit) {
            case 'mm': return 'mm'
            case 'inch': return 'inch'
        }
    }

    export function getInputStep(unit: DisplayUnit): number {
        switch (unit) {
            case 'mm': return 0.01
            case 'inch': return 0.001
        }
    }

}
