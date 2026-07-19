import { describe, expect, test } from 'vitest'
import { resolveStaticStringExpression } from '../src/lib/common/report/subreport_reference'

// Static evaluation of subreport template path expressions (design-time only, no dynamic references)
describe('resolveStaticStringExpression', function () {
    // Verify concatenation of string literals resolves to a static value
    test('accepts static literal concatenation', function () {
        expect(resolveStaticStringExpression("'reports/' + 'child.report'")).toEqual({
            ok: true,
            value: 'reports/child.report',
        })
    })

    // Verify template literals with static substitutions resolve to a static value
    test('accepts static template literal', function () {
        expect(resolveStaticStringExpression('`reports/${"child"}.report`')).toEqual({
            ok: true,
            value: 'reports/child.report',
        })
    })

    // Verify runtime identifier references are rejected with an explanatory message
    test('rejects dynamic identifier references', function () {
        expect(resolveStaticStringExpression('param.subreportPath')).toEqual({
            ok: false,
            message: 'サブレポートのテンプレート式は、設計時に確定する文字列式のみ指定できます。',
        })
    })

    // Verify dangerous property access such as __proto__ is rejected
    test('rejects forbidden property access', function () {
        const result = resolveStaticStringExpression('payload.__proto__')
        expect(result.ok).toBe(false)
    })
})
