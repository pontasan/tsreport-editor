import {
    DEFAULT_FONT_ID,
    LEGACY_DEFAULT_FONT_ID,
    LEGACY_MATH_FONT_ID,
    MATH_FONT_ID,
} from '@/lib/common/font_ids'
import type { FontResource } from './font_loader'

export type AccountFontId = { name: string }

export function createBuiltinFontRegistry(
    defaultResource: FontResource,
    mathResource: FontResource,
    accountFonts: readonly AccountFontId[],
): Map<string, FontResource> {
    const registry = new Map<string, FontResource>()
    registry.set(DEFAULT_FONT_ID, defaultResource)
    registry.set(MATH_FONT_ID, mathResource)
    reconcileLegacyBuiltinAliases(registry, accountFonts)
    return registry
}

export function reconcileLegacyBuiltinAliases(
    registry: Map<string, FontResource>,
    accountFonts: readonly AccountFontId[],
): void {
    reconcileLegacyBuiltinAlias(registry, accountFonts, DEFAULT_FONT_ID, LEGACY_DEFAULT_FONT_ID)
    reconcileLegacyBuiltinAlias(registry, accountFonts, MATH_FONT_ID, LEGACY_MATH_FONT_ID)
}

function reconcileLegacyBuiltinAlias(
    registry: Map<string, FontResource>,
    accountFonts: readonly AccountFontId[],
    builtinId: string,
    legacyId: string,
): void {
    let accountOwnsLegacyId = false
    for (let i = 0; i < accountFonts.length; i++) {
        if (accountFonts[i]!.name === legacyId) {
            accountOwnsLegacyId = true
            break
        }
    }
    if (accountOwnsLegacyId) {
        if (registry.get(legacyId) === registry.get(builtinId)) registry.delete(legacyId)
        return
    }
    registry.set(legacyId, registry.get(builtinId)!)
}
