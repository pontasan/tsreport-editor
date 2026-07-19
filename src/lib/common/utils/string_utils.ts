import { CoreUtils } from "./core_utils"

export namespace StringUtils {
    export function nvl(src: string | undefined | null, other: string = '') {
        if (typeof src !== 'string') {
            return !(src === undefined || src === null) ? String(src) : other
        }

        return !CoreUtils.isEmpty(src) ? src : other
    }

    /**
     * Converts full-width characters to half-width characters.
     * @param src Source string.
     * @returns Converted string.
     */
    export const convertHankaku = (src: string) => {
        if (CoreUtils.isEmpty(src)) {
            return src
        }

        // UTF-16 code units only.
        const len = src.length
        let buffer = ''
        for (let i = 0; i < len; i++) {
            const c = src.charCodeAt(i)

            // alphabet & ALPHABET & Number
            // Full-width lowercase Latin letters U+FF41-U+FF5A -> U+0061-U+007A
            // Full-width uppercase Latin letters U+FF21-U+FF3A -> U+0041-U+005A
            // Full-width digits U+FF10-U+FF19 -> U+0030-U+0039
            if ((c >= 65345 && c <= 65370) || (c >= 65313 && c <= 65338) || (c >= 65296 && c <= 65305)) {
                buffer += String.fromCharCode(c - 65248)
                continue
            }
            // U+3000 -> U+0020
            else if (c === 12288) {
                buffer += String.fromCharCode(32)
                continue
            }
            // U+FF01 -> U+0021
            else if (c === 65281) {
                buffer += String.fromCharCode(33)
                continue
            }
            // U+201D -> U+0022
            else if (c === 8221) {
                buffer += String.fromCharCode(34)
                continue
            }
            // U+FF03 -> U+0023
            else if (c === 65283) {
                buffer += String.fromCharCode(35)
                continue
            }
            // U+FF04 -> U+0024
            else if (c === 65284) {
                buffer += String.fromCharCode(36)
                continue
            }
            // U+FF05 -> U+0025
            else if (c === 65285) {
                buffer += String.fromCharCode(37)
                continue
            }
            // U+FF06 -> U+0026
            else if (c === 65286) {
                buffer += String.fromCharCode(38)
                continue
            }
            // U+2019 -> U+0027
            else if (c === 8217) {
                buffer += String.fromCharCode(39)
                continue
            }
            // U+FF08 -> U+0028
            else if (c === 65288) {
                buffer += String.fromCharCode(40)
                continue
            }
            // U+FF09 -> U+0029
            else if (c === 65289) {
                buffer += String.fromCharCode(41)
                continue
            }
            // U+FF0A -> U+002A
            else if (c === 65290) {
                buffer += String.fromCharCode(42)
                continue
            }
            // U+FF0B -> U+002B
            else if (c === 65291) {
                buffer += String.fromCharCode(43)
                continue
            }
            
            // U+3001 -> U+FF64
            else if (c === 12289) {
                buffer += String.fromCharCode(65380)
                continue
            }
            
            // U+FF0C -> U+002C
            else if (c === 65292) {
                buffer += String.fromCharCode(44)
                continue
            }
            
            // U+30FC -> U+FF70
            else if (c === 12540) {
                buffer += String.fromCharCode(65392)
                continue
            }
            
            // U+2212 -> U+002D
            else if (c === 8722) {
                buffer += String.fromCharCode(45)
                continue
            }
            
            // U+2015 -> U+002D
            else if (c === 8213) {
                buffer += String.fromCharCode(45)
                continue
            }
            
            // U+2010 -> U+002D
            else if (c === 8208) {
                buffer += String.fromCharCode(45)
                continue
            }
            
            // U+FF0E -> U+002E
            else if (c === 65294) {
                buffer += String.fromCharCode(46)
                continue
            }
            
            // U+3002 -> U+FF61
            else if (c === 12290) {
                buffer += String.fromCharCode(65377)
                continue
            }
            // U+FF0F -> U+002F
            else if (c === 65295) {
                buffer += String.fromCharCode(47)
                continue
            }
            // U+FF1A -> U+003A
            else if (c === 65306) {
                buffer += String.fromCharCode(58)
                continue
            }
            // U+FF1B -> U+003B
            else if (c === 65307) {
                buffer += String.fromCharCode(59)
                continue
            }
            // U+FF1C -> U+003C
            else if (c === 65308) {
                buffer += String.fromCharCode(60)
                continue
            }
            // U+3008 -> U+003C
            else if (c === 12296) {
                buffer += String.fromCharCode(60)
                continue
            }
            // U+FF1D -> U+003D
            else if (c === 65309) {
                buffer += String.fromCharCode(61)
                continue
            }
            // U+FF1E -> U+003E
            else if (c === 65310) {
                buffer += String.fromCharCode(62)
                continue
            }
            // U+3009 -> U+003E
            else if (c === 12297) {
                buffer += String.fromCharCode(62)
                continue
            }
            // U+FF1F -> U+003F
            else if (c === 65311) {
                buffer += String.fromCharCode(63)
                continue
            }
            // U+FF20 -> U+0040
            else if (c === 65312) {
                buffer += String.fromCharCode(64)
                continue
            }
            // U+FF3B -> U+005B
            else if (c === 65339) {
                buffer += String.fromCharCode(91)
                continue
            }
            // U+3010 -> U+005B
            else if (c === 12304) {
                buffer += String.fromCharCode(91)
                continue
            }
            // U+FFE5 -> U+005C
            else if (c === 65509) {
                buffer += String.fromCharCode(92)
                continue
            }
            // U+FF3D -> U+005D
            else if (c === 65341) {
                buffer += String.fromCharCode(93)
                continue
            }
            // U+3011 -> U+005D
            else if (c === 12305) {
                buffer += String.fromCharCode(93)
                continue
            }
            // U+FF3E -> U+005E
            else if (c === 65342) {
                buffer += String.fromCharCode(94)
                continue
            }
            // U+FF3F -> U+005F
            else if (c === 65343) {
                buffer += String.fromCharCode(95)
                continue
            }
            // U+FF40 -> U+0060
            else if (c === 65344) {
                buffer += String.fromCharCode(96)
                continue
            }
            // U+FF5B -> U+007B
            else if (c === 65371) {
                buffer += String.fromCharCode(123)
                continue
            }
            // U+FF5C -> U+007C
            else if (c === 65372) {
                buffer += String.fromCharCode(124)
                continue
            }
            
            // U+4E28 -> U+007C
            else if (c === 20008) {
                buffer += String.fromCharCode(124)
                continue
            }
            // U+FFE4 -> U+007C
            else if (c === 65508) {
                buffer += String.fromCharCode(124)
                continue
            }
            // U+2758 -> U+007C
            else if (c === 10072) {
                buffer += String.fromCharCode(124)
                continue
            }
            // U+2759 -> U+007C
            else if (c === 10073) {
                buffer += String.fromCharCode(124)
                continue
            }
            // U+275A -> U+007C
            else if (c === 10074) {
                buffer += String.fromCharCode(124)
                continue
            }
            // U+FF5D -> U+007D
            else if (c === 65373) {
                buffer += String.fromCharCode(125)
                continue
            }
            // U+301C -> U+007E
            else if (c === 12316) {
                buffer += String.fromCharCode(126)
                continue
            }
            
            // U+FFE3 -> U+007E
            else if (c === 65507) {
                buffer += String.fromCharCode(126)
                continue
            }
            // Full-width katakana U+30A1-U+30F3 are converted to half-width katakana.
            // U+30A2 maps to U+FF71.
            // U+30F3 maps to U+FF9D.
            // Voiced full-width katakana map to a base half-width character plus U+FF9E.
            // Semi-voiced full-width katakana map to a base half-width character plus U+FF9F.
            // Small kana use the half-width small-kana range U+FF67-U+FF6F.
            // Half-width output uses U+FF66-U+FF9D plus voiced marks U+FF9E/U+FF9F.
            // The first small-kana mapping starts at U+30A1.
            // U+30A1 -> U+FF67
            else if (c === 12449) {
                buffer += String.fromCharCode(65383)
                continue
            }
            
            // U+30A2 -> U+FF71
            else if (c === 12450) {
                buffer += String.fromCharCode(65393)
                continue
            }
            
            // U+30A3 -> U+FF68
            else if (c === 12451) {
                buffer += String.fromCharCode(65384)
                continue
            }
            
            // U+30A4 -> U+FF72
            else if (c === 12452) {
                buffer += String.fromCharCode(65394)
                continue
            }
            
            // U+30A5 -> U+FF69
            else if (c === 12453) {
                buffer += String.fromCharCode(65385)
                continue
            }
            
            // U+30A6 -> U+FF73
            else if (c === 12454) {
                buffer += String.fromCharCode(65395)
                continue
            }
            
            // U+30A7 -> U+FF6A
            else if (c === 12455) {
                buffer += String.fromCharCode(65386)
                continue
            }
            
            // U+30A8 -> U+FF74
            else if (c === 12456) {
                buffer += String.fromCharCode(65396)
                continue
            }
            
            // U+30A9 -> U+FF6B
            else if (c === 12457) {
                buffer += String.fromCharCode(65387)
                continue
            }
            
            // U+30AA -> U+FF75
            else if (c === 12458) {
                buffer += String.fromCharCode(65397)
                continue
            }
            
            // U+30AB -> U+FF76
            else if (c === 12459) {
                buffer += String.fromCharCode(65398)
                continue
            }
            
            // U+30AC -> U+FF76 + U+FF9E
            else if (c === 12460) {
                buffer += String.fromCharCode(65398)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30AD -> U+FF77
            else if (c === 12461) {
                buffer += String.fromCharCode(65399)
                continue
            }
            
            // U+30AE -> U+FF77 + U+FF9E
            else if (c === 12462) {
                buffer += String.fromCharCode(65399)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30AF -> U+FF78
            else if (c === 12463) {
                buffer += String.fromCharCode(65400)
                continue
            }
            
            // U+30B0 -> U+FF78 + U+FF9E
            else if (c === 12464) {
                buffer += String.fromCharCode(65400)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30B1 -> U+FF79
            else if (c === 12465) {
                buffer += String.fromCharCode(65401)
                continue
            }
            
            // U+30B2 -> U+FF79 + U+FF9E
            else if (c === 12466) {
                buffer += String.fromCharCode(65401)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30B3 -> U+FF7A
            else if (c === 12467) {
                buffer += String.fromCharCode(65402)
                continue
            }
            
            // U+30B4 -> U+FF7A + U+FF9E
            else if (c === 12468) {
                buffer += String.fromCharCode(65402)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30B5 -> U+FF7B
            else if (c === 12469) {
                buffer += String.fromCharCode(65403)
                continue
            }
            
            // U+30B6 -> U+FF7B + U+FF9E
            else if (c === 12470) {
                buffer += String.fromCharCode(65403)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30B7 -> U+FF7C
            else if (c === 12471) {
                buffer += String.fromCharCode(65404)
                continue
            }
            
            // U+30B8 -> U+FF7C + U+FF9E
            else if (c === 12472) {
                buffer += String.fromCharCode(65404)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30B9 -> U+FF7D
            else if (c === 12473) {
                buffer += String.fromCharCode(65405)
                continue
            }
            
            // U+30BA -> U+FF7D + U+FF9E
            else if (c === 12474) {
                buffer += String.fromCharCode(65405)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30BB -> U+FF7E
            else if (c === 12475) {
                buffer += String.fromCharCode(65406)
                continue
            }
            
            // U+30BC -> U+FF7E + U+FF9E
            else if (c === 12476) {
                buffer += String.fromCharCode(65406)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30BD -> U+FF7F
            else if (c === 12477) {
                buffer += String.fromCharCode(65407)
                continue
            }
            
            // U+30BE -> U+FF7F + U+FF9E
            else if (c === 12478) {
                buffer += String.fromCharCode(65407)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30BF -> U+FF80
            else if (c === 12479) {
                buffer += String.fromCharCode(65408)
                continue
            }
            
            // U+30C0 -> U+FF80 + U+FF9E
            else if (c === 12480) {
                buffer += String.fromCharCode(65408)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30C1 -> U+FF81
            else if (c === 12481) {
                buffer += String.fromCharCode(65409)
                continue
            }
            
            // U+30C2 -> U+FF81 + U+FF9E
            else if (c === 12482) {
                buffer += String.fromCharCode(65409)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30C3 -> U+FF6F
            else if (c === 12483) {
                buffer += String.fromCharCode(65391)
                continue
            }
            
            // U+30C4 -> U+FF82
            else if (c === 12484) {
                buffer += String.fromCharCode(65410)
                continue
            }
            
            // U+30C5 -> U+FF82 + U+FF9E
            else if (c === 12485) {
                buffer += String.fromCharCode(65410)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30C6 -> U+FF83
            else if (c === 12486) {
                buffer += String.fromCharCode(65411)
                continue
            }
            
            // U+30C7 -> U+FF83 + U+FF9E
            else if (c === 12487) {
                buffer += String.fromCharCode(65411)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30C8 -> U+FF84
            else if (c === 12488) {
                buffer += String.fromCharCode(65412)
                continue
            }
            
            // U+30C9 -> U+FF84 + U+FF9E
            else if (c === 12489) {
                buffer += String.fromCharCode(65412)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30CA -> U+FF85
            else if (c === 12490) {
                buffer += String.fromCharCode(65413)
                continue
            }
            
            // U+30CB -> U+FF86
            else if (c === 12491) {
                buffer += String.fromCharCode(65414)
                continue
            }
            
            // U+30CC -> U+FF87
            else if (c === 12492) {
                buffer += String.fromCharCode(65415)
                continue
            }
            
            // U+30CD -> U+FF88
            else if (c === 12493) {
                buffer += String.fromCharCode(65416)
                continue
            }
            
            // U+30CE -> U+FF89
            else if (c === 12494) {
                buffer += String.fromCharCode(65417)
                continue
            }
            
            // U+30CF -> U+FF8A
            else if (c === 12495) {
                buffer += String.fromCharCode(65418)
                continue
            }
            
            // U+30D0 -> U+FF8A + U+FF9E
            else if (c === 12496) {
                buffer += String.fromCharCode(65418)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30D1 -> U+FF8A + U+FF9F
            else if (c === 12497) {
                buffer += String.fromCharCode(65418)
                buffer += String.fromCharCode(65439)
                continue
            }
            
            // U+30D2 -> U+FF8B
            else if (c === 12498) {
                buffer += String.fromCharCode(65419)
                continue
            }
            
            // U+30D3 -> U+FF8B + U+FF9E
            else if (c === 12499) {
                buffer += String.fromCharCode(65419)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30D4 -> U+FF8B + U+FF9F
            else if (c === 12500) {
                buffer += String.fromCharCode(65419)
                buffer += String.fromCharCode(65439)
                continue
            }
            
            // U+30D5 -> U+FF8C
            else if (c === 12501) {
                buffer += String.fromCharCode(65420)
                continue
            }
            
            // U+30D6 -> U+FF8C + U+FF9E
            else if (c === 12502) {
                buffer += String.fromCharCode(65420)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30D7 -> U+FF8C + U+FF9F
            else if (c === 12503) {
                buffer += String.fromCharCode(65420)
                buffer += String.fromCharCode(65439)
                continue
            }
            
            // U+30D8 -> U+FF8D
            else if (c === 12504) {
                buffer += String.fromCharCode(65421)
                continue
            }
            
            // U+30D9 -> U+FF8D + U+FF9E
            else if (c === 12505) {
                buffer += String.fromCharCode(65421)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30DA -> U+FF8D + U+FF9F
            else if (c === 12506) {
                buffer += String.fromCharCode(65421)
                buffer += String.fromCharCode(65439)
                continue
            }
            
            // U+30DB -> U+FF8E
            else if (c === 12507) {
                buffer += String.fromCharCode(65422)
                continue
            }
            
            // U+30DC -> U+FF8E + U+FF9E
            else if (c === 12508) {
                buffer += String.fromCharCode(65422)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30DD -> U+FF8E + U+FF9F
            else if (c === 12509) {
                buffer += String.fromCharCode(65422)
                buffer += String.fromCharCode(65439)
                continue
            }
            
            // U+30DE -> U+FF8F
            else if (c === 12510) {
                buffer += String.fromCharCode(65423)
                continue
            }
            
            // U+30DF -> U+FF90
            else if (c === 12511) {
                buffer += String.fromCharCode(65424)
                continue
            }
            
            // U+30E0 -> U+FF91
            else if (c === 12512) {
                buffer += String.fromCharCode(65425)
                continue
            }
            
            // U+30E1 -> U+FF92
            else if (c === 12513) {
                buffer += String.fromCharCode(65426)
                continue
            }
            
            // U+30E2 -> U+FF93
            else if (c === 12514) {
                buffer += String.fromCharCode(65427)
                continue
            }
            
            // U+30E3 -> U+FF6C
            else if (c === 12515) {
                buffer += String.fromCharCode(65388)
                continue
            }
            
            // U+30E4 -> U+FF94
            else if (c === 12516) {
                buffer += String.fromCharCode(65428)
                continue
            }
            
            // U+30E5 -> U+FF6D
            else if (c === 12517) {
                buffer += String.fromCharCode(65389)
                continue
            }
            
            // U+30E6 -> U+FF95
            else if (c === 12518) {
                buffer += String.fromCharCode(65429)
                continue
            }
            
            // U+30E7 -> U+FF6E
            else if (c === 12519) {
                buffer += String.fromCharCode(65390)
                continue
            }
            
            // U+30E8 -> U+FF96
            else if (c === 12520) {
                buffer += String.fromCharCode(65430)
                continue
            }
            
            // U+30E9 -> U+FF97
            else if (c === 12521) {
                buffer += String.fromCharCode(65431)
                continue
            }
            
            // U+30EA -> U+FF98
            else if (c === 12522) {
                buffer += String.fromCharCode(65432)
                continue
            }
            
            // U+30EB -> U+FF99
            else if (c === 12523) {
                buffer += String.fromCharCode(65433)
                continue
            }
            
            // U+30EC -> U+FF9A
            else if (c === 12524) {
                buffer += String.fromCharCode(65434)
                continue
            }
            
            // U+30ED -> U+FF9B
            else if (c === 12525) {
                buffer += String.fromCharCode(65435)
                continue
            }
            // U+30EE has no half-width mapping in this table.
            // U+30EF -> U+FF9C
            else if (c === 12527) {
                buffer += String.fromCharCode(65436)
                continue
            }
            
            // U+30F2 -> U+FF66
            else if (c === 12530) {
                buffer += String.fromCharCode(65382)
                continue
            }
            
            // U+30F3 -> U+FF9D
            else if (c === 12531) {
                buffer += String.fromCharCode(65437)
                continue
            }
            
            // U+30F7 -> U+FF74 + U+FF9E
            else if (c === 12535) {
                buffer += String.fromCharCode(65396)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30F4 -> U+FF73 + U+FF9E
            else if (c === 12532) {
                buffer += String.fromCharCode(65395)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+30FA -> U+FF66 + U+FF9E
            else if (c === 12538) {
                buffer += String.fromCharCode(65382)
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+309B -> U+FF9E
            else if (c === 12443) {
                buffer += String.fromCharCode(65438)
                continue
            }
            
            // U+309C -> U+FF9F
            else if (c === 12444) {
                buffer += String.fromCharCode(65439)
                continue
            }

            // Leave other characters unchanged.
            buffer += String.fromCharCode(c)
        }
        return buffer
    }

/**
      * Convert hiragana to katakana.
 */
    
    export const convertKatakana = (src: string) => {
        if (CoreUtils.isEmpty(src)) {
            return src
        }

        // Iterate by UTF-16 code unit.
        const len = src.length
        let buffer = ''
        for (let i = 0; i < len; i++) {
            // Hiragana U+3041-U+3094 map to katakana by adding 96 to the code unit.
            const c = src.charCodeAt(i)

            if (c >= 12353 && c <= 12436) {
                buffer += String.fromCharCode(c + 96)
                continue
            }
            // Leave other characters unchanged.
            buffer += String.fromCharCode(c)
        }
        return buffer
    }

/**
      * Convert katakana to hiragana.
 */
    
    export const convertHiragana = (src: string) => {
        if (CoreUtils.isEmpty(src)) {
            return src
        }

        // TODO: define the exact conversion target range.
        // Iterate by UTF-16 code unit.
        const len = src.length
        let buffer = ''
        for (let i = 0; i < len; i++) {
            // Katakana U+30A1-U+30F4 map to hiragana by subtracting 96 from the code unit.
            const c = src.charCodeAt(i)

            if (c >= 12449 && c <= 12532) {
                buffer += String.fromCharCode(c - 96)
                continue
            }
            // Leave other characters unchanged.
            buffer += String.fromCharCode(c)
        }

        return buffer
    }

    /**
     * Normalize keyword index values and search condition values.
     * Converts to half-width characters.
     * @param src Source string.
     * @returns Normalized string.
     */
    
    export const normalizeForKeywordIndex = (src: string) => {
        if (CoreUtils.isEmpty(src)) {
            return ''
        }

        // Convert to katakana, convert to half-width, and trim both ends.
        // Normalize multiple hyphen-like characters to the ASCII hyphen.
        return convertHankaku(convertKatakana(src)).replaceAll(/[ｰ－ー―‐-–—−]/g, '-').toLowerCase().trim()
    }

    /**
     * Normalize keyword index values and search condition values for phone and fax numbers.
     * Converts to half-width characters and removes hyphens.
     * @param src Source string.
     * @returns Normalized phone/fax string.
     */
    
    export const normalizePhoneNumberForKeywordIndex = (src: string) => {
        if (CoreUtils.isEmpty(src)) {
            return ''
        }

        // Remove hyphens after normal keyword normalization.
        return normalizeForKeywordIndex(src).replaceAll('-', '')
    }

/**
      * Left.
 */
    
    export const padStart = (src: string, targetLength: number, padString: string) => {
        return !CoreUtils.isEmpty(src) ? src.padStart(targetLength, padString) : ''.padStart(targetLength, padString)
    }

/**
      * Right.
 */
    
    export const padEnd = (src: string, targetLength: number, padString: string) => {
        return !CoreUtils.isEmpty(src) ? src.padEnd(targetLength, padString) : ''.padEnd(targetLength, padString)
    }

/**
      * Get(character with)
 */
    
    export const getByteLength = (src: string) => {
        if (CoreUtils.isEmpty(src)) {
            return 0
        }

        let length = 0
        for (let i = 0; i < src.length; i++) {
            const c = src.charCodeAt(i);
            // ASCII U+0000-U+007F: http://www.unicode.org/charts/PDF/U0000.pdf
            // Half-width katakana U+FF61-U+FF9F: http://www.unicode.org/charts/PDF/UFF00.pdf
            if ((c >= 0x0000 && c <= 0x007f) || (c >= 0xff61 && c <= 0xff9f)) {
                length++
            } else {
                length += 2
            }
        }
        return length
    }
}
