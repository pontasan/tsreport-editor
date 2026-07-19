import { describe, expect, test } from 'vitest'
import { parseTemplateJson, stringifyTemplateJson } from '../src/lib/common/utils/template_json'

describe('report template JSON binary codec', () => {
    test('round-trips typed arrays without numeric-key expansion', () => {
        const bytes = new Uint8Array(1024 * 1024)
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 17) & 0xff

        const json = stringifyTemplateJson({ name: 'binary', data: bytes })
        const parsed = parseTemplateJson(json) as { name: string, data: Uint8Array }

        expect(json.length).toBeLessThan(1_410_000)
        expect(json).not.toContain('"0":')
        expect(parsed.name).toBe('binary')
        expect(parsed.data).toBeInstanceOf(Uint8Array)
        expect(parsed.data).toEqual(bytes)
    })

    test('leaves ordinary objects with similar properties unchanged', () => {
        const value = { $tsreportBinaryEncoding: 'another-format', data: 'user value' }
        expect(parseTemplateJson(stringifyTemplateJson(value))).toEqual(value)
    })

    test('round-trips compact mesh typed arrays', () => {
        const value = {
            points: new Float32Array([0.25, -10.5, 200.125]),
            colors: new Uint32Array([0xff00aa, 0x123456]),
        }

        const parsed = parseTemplateJson(stringifyTemplateJson(value)) as typeof value

        expect(parsed.points).toEqual(value.points)
        expect(parsed.colors).toEqual(value.colors)
    })
})
