'use client'

import { Button } from 'primereact/button'
import { Checkbox } from 'primereact/checkbox'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState, type CSSProperties } from 'react'
import { Action, FolderShareRow } from './action'
import shared from './admin_table.module.css'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'

type Props = {
    visible: boolean,
    onHide: () => void,
    // The folder (own-workspace-relative path) being shared. '' means the dialog
    // is closed / no target.
    path: string
}

// Column layout for the grantee table rows (name / read / write / revoke).
const ROW_GRID: CSSProperties = { gridTemplateColumns: '1fr 4rem 4rem 3rem' }

// Owner-side folder sharing: enter another account's workspaceKey to grant it
// read and/or write access to this folder. Existing grantees are listed with
// per-permission toggles and a revoke button.
export default function FolderShareDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, path } = props
    const [rows, setRows] = useState<FolderShareRow[]>([])
    const [granteeKey, setGranteeKey] = useState('')
    const [canRead, setCanRead] = useState(true)
    const [canWrite, setCanWrite] = useState(false)
    const [error, setError] = useState('')

    function reload() {
        Action.listFolderShares(path).then(setRows).catch(function (e) { setError(errText(e)) })
    }

    useEffect(function () {
        if (visible && path !== '') {
            setGranteeKey('')
            setCanRead(true)
            setCanWrite(false)
            setError('')
            reload()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, path])

    function handleShare() {
        setError('')
        const key = granteeKey.trim()
        if (key === '') {
            setError(ui.workspaceKeyRequired)
            return
        }
        Action.createFolderShareByKey(path, key, canRead, canWrite).then(function (result) {
            if (!result.ok) {
                // Unknown key / self-share are reported identically so account
                // existence is never disclosed.
                setError(ui.shareFailed)
                return
            }
            setGranteeKey('')
            reload()
        }).catch(function (e) { setError(errText(e)) })
    }

    function handleToggle(row: FolderShareRow, nextRead: boolean, nextWrite: boolean) {
        if (!nextRead && !nextWrite) {
            // At least one permission must remain; revoke instead.
            return
        }
        Action.updateFolderShare(row.id, nextRead, nextWrite, row.version).then(reload).catch(function (e) { setError(errText(e)) })
    }

    function handleRevoke(row: FolderShareRow) {
        Action.deleteFolderShare(row.id).then(reload).catch(function (e) { setError(errText(e)) })
    }

    return (
        <Dialog header={ui.folderShare + ': ' + path} visible={visible} onHide={onHide} style={{ width: '38rem' }}>
            <div className={shared.dialog}>
                <div className={shared.sectionTitle}><span>{ui.addShare}</span></div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <InputText
                        className={shared.cellInput}
                        style={{ flex: '1 1 16rem', fontFamily: 'monospace' }}
                        placeholder={ui.partnerWorkspaceKey}
                        value={granteeKey}
                        onChange={function (e) { setGranteeKey(e.target.value) }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Checkbox checked={canRead} onChange={function (e) { setCanRead(e.checked === true) }} />{ui.readAccess}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Checkbox checked={canWrite} onChange={function (e) { setCanWrite(e.checked === true) }} />{ui.writeAccess}
                    </label>
                    <Button label={ui.share} icon="pi pi-plus" size="small" disabled={!canRead && !canWrite} onClick={handleShare} />
                </div>
                {error !== '' && <div className={shared.note} style={{ color: '#c0392b' }}>{error}</div>}

                <div className={shared.sectionTitle} style={{ marginTop: '1rem' }}><span>{ui.sharedUsers}</span></div>
                {rows.length === 0
                    ? <div className={shared.note}>{ui.notShared}</div>
                    : (
                        <div className={shared.table}>
                            <div className={shared.row + ' ' + shared.tableHeader} style={ROW_GRID}>
                                <div>{ui.grantee}</div>
                                <div className={shared.cellCenter}>{ui.readAccess}</div>
                                <div className={shared.cellCenter}>{ui.writeAccess}</div>
                                <div className={shared.cellCenter}>{ui.revoke}</div>
                            </div>
                            {rows.map(function (row) {
                                return (
                                    <div key={row.id} className={shared.row} style={ROW_GRID}>
                                        <div className={shared.monoCell}>{row.granteeDisplayName}</div>
                                        <div className={shared.cellCenter}>
                                            <Checkbox checked={row.canRead} onChange={function (e) { handleToggle(row, e.checked === true, row.canWrite) }} />
                                        </div>
                                        <div className={shared.cellCenter}>
                                            <Checkbox checked={row.canWrite} onChange={function (e) { handleToggle(row, row.canRead, e.checked === true) }} />
                                        </div>
                                        <div className={shared.cellCenter}>
                                            <button className={shared.iconBtn + ' ' + shared.dangerBtn} onClick={function () { handleRevoke(row) }}>
                                                <i className="pi pi-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )
                }
            </div>
        </Dialog>
    )
}

function errText(e: unknown): string {
    if (e !== null && typeof e === 'object' && 'message' in e) {
        return String((e as { message: unknown }).message)
    }
    return String(e)
}
