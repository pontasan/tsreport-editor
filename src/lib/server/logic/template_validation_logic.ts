// Template expression validation.
// Validates the syntax of every expression carried by an editor template.
// Used by the MCP validate_template / save_template tools.

import { validateExpressionSource } from 'tsreport-core'

export namespace TemplateValidationLogic {

    export function validateTemplateExpressions(template: Record<string, unknown>): string[] {
        const errors: string[] = []
        const bands = template.bands
        if (!Array.isArray(bands)) return errors
        for (let i = 0; i < bands.length; i++) {
            const band = bands[i] as Record<string, unknown>
            validateExpression(band.printWhenExpression, 'band[' + i + '].printWhenExpression', errors)
            const elements = band.elements
            if (Array.isArray(elements)) {
                validateElementExpressions(elements as Record<string, unknown>[], 'band[' + i + ']', errors)
            }
        }
        return errors
    }

    function validateElementExpressions(elements: Record<string, unknown>[], path: string, errors: string[]): void {
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i]
            const elPath = path + '.elements[' + i + '](' + (el.id ?? '') + ')'
            validateExpression(el.expression, elPath + '.expression', errors)
            validateExpression(el.printWhenExpression, elPath + '.printWhenExpression', errors)
            validateExpression(el.templateExpression, elPath + '.templateExpression', errors)
            validateExpression(el.dataSourceExpression, elPath + '.dataSourceExpression', errors)
            validateExpression(el.sourceExpression, elPath + '.sourceExpression', errors)
            validateExpression(el.crosstabDataSourceExpression, elPath + '.crosstabDataSourceExpression', errors)
            // svgContent is an expression too (literal markup must be quoted).
            if (el.kind === 'svg') {
                validateExpression(el.svgContent, elPath + '.svgContent', errors)
            }
            const children = el.children
            if (Array.isArray(children) && children.length > 0) {
                validateElementExpressions(children as Record<string, unknown>[], elPath, errors)
            }
        }
    }

    function validateExpression(value: unknown, path: string, errors: string[]): void {
        if (typeof value !== 'string' || value === '') return
        const error = validateExpressionSource(value)
        if (error !== null) {
            errors.push(path + ': "' + value + '" — ' + error.message)
        }
    }

}
