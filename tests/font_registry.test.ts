import { describe, expect, test } from 'vitest'
import {
    DEFAULT_FONT_ID,
    LEGACY_DEFAULT_FONT_ID,
    LEGACY_MATH_FONT_ID,
    MATH_FONT_ID,
} from '../src/lib/common/font_ids'
import {
    createBuiltinFontRegistry,
    reconcileLegacyBuiltinAliases,
} from '../src/app/[lang]/editor/font_registry'
import type { FontResource } from '../src/app/[lang]/editor/font_loader'

const defaultResource = { fontId: DEFAULT_FONT_ID } as FontResource
const mathResource = { fontId: MATH_FONT_ID } as FontResource

describe('editor font registry ids', function () {
    test('adds legacy aliases only when the account does not own those ids', function () {
        const registry = createBuiltinFontRegistry(defaultResource, mathResource, [])
        expect(registry.get(DEFAULT_FONT_ID)).toBe(defaultResource)
        expect(registry.get(MATH_FONT_ID)).toBe(mathResource)
        expect(registry.get(LEGACY_DEFAULT_FONT_ID)).toBe(defaultResource)
        expect(registry.get(LEGACY_MATH_FONT_ID)).toBe(mathResource)
    })

    test('keeps canonical built-ins separate from colliding account ids', function () {
        const registry = createBuiltinFontRegistry(defaultResource, mathResource, [
            { name: LEGACY_DEFAULT_FONT_ID },
            { name: LEGACY_MATH_FONT_ID },
        ])
        expect(registry.get(DEFAULT_FONT_ID)).toBe(defaultResource)
        expect(registry.get(MATH_FONT_ID)).toBe(mathResource)
        expect(registry.has(LEGACY_DEFAULT_FONT_ID)).toBe(false)
        expect(registry.has(LEGACY_MATH_FONT_ID)).toBe(false)
    })

    test('removes a built-in legacy alias when an account font is registered', function () {
        const registry = createBuiltinFontRegistry(defaultResource, mathResource, [])
        reconcileLegacyBuiltinAliases(registry, [{ name: LEGACY_DEFAULT_FONT_ID }])
        expect(registry.has(LEGACY_DEFAULT_FONT_ID)).toBe(false)
        expect(registry.get(LEGACY_MATH_FONT_ID)).toBe(mathResource)
    })
})
