import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SUPPORTED_LANGUAGE_CODES } from '../src/lib/common/i18n/languages'
import { candidatesForLanguage, FONT_CATALOG_LANGUAGE_CODES } from '../src/lib/server/logic/font_catalog'
import { FontAdminLogic } from '../src/lib/server/logic/font_admin_logic'
import { fontDirForAccount } from '../src/lib/server/logic/font_resolver'

const COLLISION_TEST_ACCOUNT_ID = 2_147_000_019
const collisionTestFontDir = fontDirForAccount(COLLISION_TEST_ACCOUNT_ID)
const INVALID_FONT_TEST_ACCOUNT_ID = 2_147_000_020
const invalidFontTestDir = fontDirForAccount(INVALID_FONT_TEST_ACCOUNT_ID)

beforeAll(async function () {
    await rm(invalidFontTestDir, { recursive: true, force: true })
    await mkdir(collisionTestFontDir, { recursive: true })
    await writeFile(join(collisionTestFontDir, 'Collision.ttf'), 'existing')
})

afterAll(async function () {
    await rm(collisionTestFontDir, { recursive: true, force: true })
    await rm(invalidFontTestDir, { recursive: true, force: true })
})

describe('Google Fonts catalog languages', function () {
    it('covers every editor UI language with the same canonical codes', function () {
        expect(FONT_CATALOG_LANGUAGE_CODES).toEqual(SUPPORTED_LANGUAGE_CODES)
        for (let i = 0; i < SUPPORTED_LANGUAGE_CODES.length; i++) {
            expect(candidatesForLanguage(SUPPORTED_LANGUAGE_CODES[i]).length).toBeGreaterThan(0)
        }
    })

    it('uses the editor Chinese language codes directly', function () {
        expect(candidatesForLanguage('zh-CN').map(function (font) { return font.fontId })).toContain('NotoSansSC')
        expect(candidatesForLanguage('zh-TW').map(function (font) { return font.fontId })).toContain('NotoSansTC')
    })

    it('rejects unknown catalog languages instead of falling back', async function () {
        await expect(FontAdminLogic.proposeFonts(1, 'unknown')).rejects.toThrow('Unsupported font catalog language')
    })

    it('rejects account font files in the reserved built-in namespace', async function () {
        await expect(
            FontAdminLogic.uploadFont(1, 'builtin:NotoSansJP.ttf', new Uint8Array([1]).buffer)
        ).rejects.toThrow('内蔵フォント用に予約されたIDは登録できません')
    })

    it('rejects a second account font file with the same basename id', async function () {
        await expect(
            FontAdminLogic.uploadFont(COLLISION_TEST_ACCOUNT_ID, 'Collision.otf', new Uint8Array([1]).buffer)
        ).rejects.toThrow('同じフォントIDが既に登録されています: Collision')
    })

    it('accepts an exact retry after a partially completed batch upload', async function () {
        const result = await FontAdminLogic.uploadFont(
            COLLISION_TEST_ACCOUNT_ID,
            'Collision.ttf',
            new TextEncoder().encode('existing').buffer,
        )

        expect(result.fontId).toBe('Collision')
        expect(result.size).toBe(8)
    })

    it('rejects byte-identical font content registered under a different id', async function () {
        await expect(
            FontAdminLogic.uploadFont(
                COLLISION_TEST_ACCOUNT_ID,
                'RenamedCollision.ttf',
                new TextEncoder().encode('existing').buffer,
            )
        ).rejects.toThrow('同一内容のフォントが既に登録されています: Collision')
    })

    it('reports invalid uploaded font bytes as a business error', async function () {
        await expect(
            FontAdminLogic.uploadFont(INVALID_FONT_TEST_ACCOUNT_ID, 'Invalid.ttf', new Uint8Array([1]).buffer)
        ).rejects.toThrow('フォントファイルを解析できません: Invalid.ttf:')
    })
})
