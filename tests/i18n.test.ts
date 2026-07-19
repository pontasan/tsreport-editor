import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type * as TypeScript from 'typescript'
import {
    getLanguageDirection,
    isSupportedLanguage,
    LANGUAGE_LABEL_BY_CODE,
    localizePathname,
    SUPPORTED_LANGUAGE_CODES,
    SUPPORTED_LANGUAGES,
} from '../src/lib/common/i18n/languages'
import { UI_MESSAGE_IDS, UI_SOURCE_MESSAGE_IDS, type UiMessageId } from '../src/lib/common/i18n/ui_messages'
import { CLIENT_DICTIONARIES, getClientCatalog } from '../src/lib/server/i18n/dictionaries/client/catalog'
import { getLocalizedBandLabel, getLocalizedElementKindLabel } from '../src/app/[lang]/editor/localized_editor_labels'
import type { BandType, ElementKind } from '../src/app/[lang]/editor/reducer'

const ts = createRequire(resolve(process.cwd(), 'package.json'))('typescript') as typeof TypeScript

describe('editor internationalization', function () {
    it('has one complete catalog for every selectable language', function () {
        expect(SUPPORTED_LANGUAGES.map(function (language) { return language.code })).toEqual(SUPPORTED_LANGUAGE_CODES)
        expect(new Set(SUPPORTED_LANGUAGE_CODES).size).toBe(SUPPORTED_LANGUAGE_CODES.length)

        for (let i = 0; i < SUPPORTED_LANGUAGE_CODES.length; i++) {
            const lang = SUPPORTED_LANGUAGE_CODES[i]
            const dictionary = CLIENT_DICTIONARIES[lang]
            expect(Object.keys(dictionary.ui).sort()).toEqual(UI_MESSAGE_IDS.slice().sort())
            for (let j = 0; j < UI_MESSAGE_IDS.length; j++) {
                expect(dictionary.ui[UI_MESSAGE_IDS[j]].trim()).not.toBe('')
            }
            expect(dictionary.system.systemExceptionMessage.trim()).not.toBe('')
            expect(dictionary.primeReact.emptyMessage.trim()).not.toBe('')
        }
    })

    it('uses each selected language instead of an English fallback', function () {
        const english = getClientCatalog('en')
        for (let i = 0; i < SUPPORTED_LANGUAGE_CODES.length; i++) {
            const lang = SUPPORTED_LANGUAGE_CODES[i]
            const dictionary = getClientCatalog(lang)
            expect(dictionary).toBe(CLIENT_DICTIONARIES[lang])
            if (lang !== 'en') expect(dictionary.ui.login).not.toBe(english.ui.login)
        }
        expect(function () { getClientCatalog('unknown') }).toThrow('Unsupported UI language')
    })

    it('resolves language direction and keeps the current screen while switching', function () {
        expect(getLanguageDirection('ar')).toBe('rtl')
        expect(getLanguageDirection('he')).toBe('rtl')
        expect(getLanguageDirection('ja')).toBe('ltr')
        expect(localizePathname('/ja/editor', 'zh-CN')).toBe('/zh-CN/editor')
        expect(localizePathname('/en', 'ar')).toBe('/ar')
        expect(localizePathname('/editor', 'ko')).toBe('/ko/editor')
        expect(isSupportedLanguage('zh-TW')).toBe(true)
        expect(isSupportedLanguage('xx')).toBe(false)
    })

    it('connects the high-risk editor surfaces to translated messages', function () {
        const ids: UiMessageId[] = [
            'apiTags', 'pdfImport', 'pdfImportPreview', 'preview', 'fontManagement', 'apiClients',
            'printHistory', 'dataExport', 'dataImport', 'userManagement', 'externalAuthSettings',
            'mcpSettings', 'accountSettings', 'passwordChange', 'propertyPanel', 'pdfTextOutput',
            'templateExpression', 'crossTabSettings', 'breakSettings', 'mathSettings',
            'selectPdfFile', 'noPdfFileSelected',
        ]
        const english = getClientCatalog('en').ui
        for (let i = 0; i < ids.length; i++) {
            expect(english[ids[i]]).not.toMatch(/[ぁ-んァ-ヶ一-龠々]/)
        }
    })

    it('uses language endonyms in every language selector', function () {
        expect(LANGUAGE_LABEL_BY_CODE.en).toBe('English')
        expect(LANGUAGE_LABEL_BY_CODE.ko).toBe('한국어')
        expect(LANGUAGE_LABEL_BY_CODE.ar).toBe('العربية')
        expect(SUPPORTED_LANGUAGES.map(function (language) { return language.label })).toEqual(
            SUPPORTED_LANGUAGE_CODES.map(function (code) { return LANGUAGE_LABEL_BY_CODE[code] }),
        )
    })

    it('keeps the PDF file input hidden behind translated selection controls', function () {
        const source = readFileSync(resolve(process.cwd(), 'app/[lang]/editor/pdf_import_dialog.tsx'), 'utf8')
        expect(source).toContain('className={styles.hiddenFileInput}')
        expect(source).toContain('label={ui.selectPdfFile}')
        expect(source).toContain('file === null ? ui.noPdfFileSelected : file.name')
    })

    it('maps every visible property control label through the property catalog', function () {
        const path = resolve(process.cwd(), 'app/[lang]/editor/property_panel.tsx')
        const source = ts.createSourceFile(
            path,
            readFileSync(path, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
        )
        const visibleJapanese = new Set<string>()

        function collect(node: TypeScript.Node): void {
            let value: string | undefined
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text
            if (ts.isJsxText(node)) value = node.text.trim()
            if (value !== undefined && /[ぁ-んァ-ヶ一-龠々]/.test(value)) visibleJapanese.add(value)
            ts.forEachChild(node, collect)
        }

        collect(source)
        for (const value of visibleJapanese) {
            if (UI_SOURCE_MESSAGE_IDS[value] !== undefined) continue
            const unitStart = value.indexOf(' (')
            const sourceText = unitStart > 0 ? value.substring(0, unitStart) : value
            expect(UI_SOURCE_MESSAGE_IDS[sourceText], value).toBeDefined()
        }
    })

    it('localizes every band and element type shown by the editor', function () {
        const bandTypes: BandType[] = [
            'background', 'draft', 'title', 'pageHeader', 'columnHeader', 'groupHeader', 'detail',
            'groupFooter', 'columnFooter', 'pageFooter', 'lastPageFooter', 'summary', 'noData',
        ]
        const elementKinds: ElementKind[] = [
            'staticText', 'formField', 'textField', 'line', 'rectangle', 'ellipse', 'path', 'image',
            'svg', 'frame', 'table', 'tableColumnFrame', 'tableColumn', 'tableRowFrame', 'tableRow',
            'tableCell', 'crosstab', 'subreport', 'barcode', 'math', 'break',
        ]
        const chinese = getClientCatalog('zh-CN').ui
        const arabic = getClientCatalog('ar').ui

        for (let i = 0; i < bandTypes.length; i++) {
            expect(getLocalizedBandLabel(bandTypes[i], chinese)).not.toBe('')
            expect(getLocalizedBandLabel(bandTypes[i], arabic)).not.toBe('')
        }
        for (let i = 0; i < elementKinds.length; i++) {
            expect(getLocalizedElementKindLabel(elementKinds[i], chinese)).not.toBe('')
            expect(getLocalizedElementKindLabel(elementKinds[i], arabic)).not.toBe('')
        }
        expect(getLocalizedBandLabel('detail', chinese)).toBe('明细')
        expect(getLocalizedElementKindLabel('rectangle', arabic)).toBe('مستطيل')
    })
})
