'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { useEffect, useRef, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { LANGUAGE_LABEL_BY_CODE, type LanguageCode } from '@/lib/common/i18n/languages'
import { isSupportedFontFileName } from '@/lib/common/font_files'
import { Action } from './action'
import SelectDropdown from './select_dropdown'
import shared from './admin_table.module.css'
import styles from './font_management_dialog.module.css'

type Props = {
    visible: boolean,
    onHide: () => void,
    // Preferred language for the initial download proposal (editor lang).
    defaultLanguage: LanguageCode,
    // Called after the account font set changes so the editor reloads its list.
    onFontsChanged: () => void
}

// Per-account font management: upload / delete fonts and download curated Google
// Fonts by language. Internal drawing fonts are not shown (not selectable).
export default function FontManagementDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, defaultLanguage, onFontsChanged } = props
    const [fonts, setFonts] = useState<Action.AccountFont[]>([])
    const [proposal, setProposal] = useState<Action.GoogleFontProposal | null>(null)
    const [language, setLanguage] = useState(defaultLanguage)
    const [checked, setChecked] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState(false)
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number, name: string } | null>(null)
    const [isDragOver, setIsDragOver] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    function reload() {
        Action.getAccountFonts().then(function (list) {
            setFonts(list)
            onFontsChanged()
        })
    }

    useEffect(function () {
        if (!visible) return
        reload()
        loadProposal(defaultLanguage)
        setLanguage(defaultLanguage)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible])

    function loadProposal(lang: LanguageCode) {
        Action.proposeGoogleFonts(lang).then(function (p) {
            setProposal(p)
            setChecked(new Set())
        })
    }

    function handleLanguageChange(lang: LanguageCode) {
        setLanguage(lang)
        loadProposal(lang)
    }

    function toggleCandidate(fontId: string) {
        setChecked(function (prev) {
            const next = new Set(prev)
            if (next.has(fontId)) next.delete(fontId); else next.add(fontId)
            return next
        })
    }

    function handleDownload() {
        if (checked.size === 0) return
        setBusy(true)
        Action.downloadGoogleFonts(Array.from(checked)).then(function () {
            setBusy(false)
            reload()
            loadProposal(language)
        }).catch(function () { setBusy(false) })
    }

    function handleUploadClick() {
        if (fileRef.current !== null) fileRef.current.click()
    }

    function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const selected = e.target.files
        if (selected === null || selected.length === 0) return
        const files: File[] = []
        for (let i = 0; i < selected.length; i++) files.push(selected[i]!)
        e.target.value = ''
        startUpload(files)
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault()
        setIsDragOver(false)
        if (busy) return
        const dropped = e.dataTransfer.files
        const files: File[] = []
        for (let i = 0; i < dropped.length; i++) {
            if (isSupportedFontFileName(dropped[i]!.name)) files.push(dropped[i]!)
        }
        startUpload(files)
    }

    function startUpload(files: File[]) {
        if (files.length === 0) return
        setBusy(true)
        // Upload sequentially so failures point at the specific file and the
        // server processes one font at a time.
        uploadFontsSequentially(files, 0)
    }

    function uploadFontsSequentially(files: File[], index: number) {
        if (index >= files.length) {
            setBusy(false)
            setUploadProgress(null)
            reload()
            return
        }
        setUploadProgress({ current: index + 1, total: files.length, name: files[index]!.name })
        Action.uploadAccountFont(files[index]!).then(function () {
            uploadFontsSequentially(files, index + 1)
        }).catch(function (error) {
            setBusy(false)
            setUploadProgress(null)
            reload()
            throw error
        })
    }

    function handleDelete(font: Action.AccountFont) {
        Action.deleteAccountFont(font.path).then(reload)
    }

    function formatSize(bytes: number): string {
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
        return Math.max(1, Math.round(bytes / 1024)) + ' KB'
    }

    return (
        <Dialog header={ui.fontManagement} visible={visible} onHide={onHide} style={{ width: '48rem' }}>
            <div className={shared.dialog}>
                {fonts.length === 0 && (
                    <div className={styles.emptyNotice}>
                        {ui.noFonts}
                    </div>
                )}

                <div className={shared.sectionTitle}>
                    <span>{ui.installedFonts}</span>
                    <Button label={ui.uploadFonts} icon="pi pi-upload" size="small" text disabled={busy} onClick={handleUploadClick} />
                    <input ref={fileRef} type="file" multiple accept=".ttf,.otf,.woff,.woff2,.ttc,.otc" style={{ display: 'none' }} onChange={handleFileSelected} />
                </div>

                <div
                    className={styles.dropZone + (isDragOver ? ' ' + styles.dropZoneActive : '')}
                    onClick={busy ? undefined : handleUploadClick}
                    onDragOver={function (e) { e.preventDefault(); if (!busy) setIsDragOver(true) }}
                    onDragLeave={function () { setIsDragOver(false) }}
                    onDrop={handleDrop}
                >
                    {uploadProgress !== null
                        ? <span><i className="pi pi-spin pi-spinner" /> {ui.uploading} {uploadProgress.current}/{uploadProgress.total}: {uploadProgress.name}</span>
                        : <span><i className="pi pi-upload" /> {ui.fontDropHint} (.ttf / .otf / .ttc / .woff)</span>
                    }
                </div>
                <div className={shared.table}>
                    <div className={`${shared.row} ${styles.fontRow} ${shared.tableHeader}`}>
                        <span>{ui.fontName}</span>
                        <span>{ui.size}</span>
                        <span></span>
                    </div>
                    {fonts.map(function (font) {
                        return (
                            <div key={font.path} className={`${shared.row} ${styles.fontRow}`}>
                                <span className={shared.monoCell}>{font.name}</span>
                                <span className={styles.sizeCell}>{formatSize(font.size)}</span>
                                <span className={shared.cellCenter}>
                                    <button className={`${shared.iconBtn} ${shared.dangerBtn}`} title={ui.delete} onClick={function () { handleDelete(font) }}>
                                        <i className="pi pi-trash"></i>
                                    </button>
                                </span>
                            </div>
                        )
                    })}
                </div>

                <div className={shared.sectionTitle}>
                    <span>{ui.googleFontsDownload}</span>
                </div>
                <div className={styles.downloadBar}>
                    <span>{ui.language}</span>
                    <SelectDropdown className={shared.select} value={language} onChange={function (e) { handleLanguageChange(e.target.value as LanguageCode) }}>
                        {(proposal !== null ? proposal.languages : []).map(function (code) {
                            return <option key={code} value={code}>{LANGUAGE_LABEL_BY_CODE[code]}</option>
                        })}
                    </SelectDropdown>
                    <Button
                        label={busy ? ui.downloading : ui.downloadSelectedFonts}
                        icon="pi pi-download" size="small"
                        disabled={busy || checked.size === 0}
                        onClick={handleDownload}
                    />
                </div>
                <div className={shared.table}>
                    {(proposal !== null ? proposal.candidates : []).map(function (candidate) {
                        const installed = proposal !== null && proposal.installed.indexOf(candidate.fontId) !== -1
                        return (
                            <div key={candidate.fontId} className={`${shared.row} ${styles.candidateRow}`}>
                                <span className={shared.cellCenter}>
                                    <input
                                        type="checkbox"
                                        checked={checked.has(candidate.fontId)}
                                        disabled={installed}
                                        onChange={function () { toggleCandidate(candidate.fontId) }}
                                    />
                                </span>
                                <span>{candidate.family}</span>
                                <span className={styles.sizeCell}>{installed ? ui.installed : ''}</span>
                            </div>
                        )
                    })}
                </div>
                <div className={shared.note}>
                    {ui.fontsDownloadNote}
                </div>
            </div>
        </Dialog>
    )
}
