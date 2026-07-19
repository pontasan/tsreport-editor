'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action } from './action'
import SelectDropdown from './select_dropdown'
import shared from './admin_table.module.css'

type Props = {
    visible: boolean,
    onHide: () => void,
    currentDisplayName: string,
    // The account's own workspaceKey (share id) shown for the user to copy.
    workspaceKey: string,
    // Account-level default color mode for the editor color inputs.
    currentDefaultColorMode: 'rgb' | 'cmyk',
    // Called after the display name changes so the header/menu can refresh.
    onDisplayNameChanged: (displayName: string) => void,
    // Called after the default color mode changes so the editor can refresh.
    onDefaultColorModeChanged: () => void
}

// Self-service account settings: edit own display name and delete own account
// (退会). Available to every account.
export default function AccountSettingsDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, currentDisplayName, workspaceKey, currentDefaultColorMode, onDisplayNameChanged, onDefaultColorModeChanged } = props
    const [displayName, setDisplayName] = useState(currentDisplayName)
    const [isConfirmOpen, setIsConfirmOpen] = useState(false)
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState('')

    function handleCopyKey() {
        navigator.clipboard.writeText(workspaceKey).then(function () {
            setCopied(true)
            setTimeout(function () { setCopied(false) }, 1500)
        }).catch(function () {})
    }

    useEffect(function () {
        if (visible) {
            setDisplayName(currentDisplayName)
            setError('')
        }
    }, [visible, currentDisplayName])

    function handleChangeColorMode(mode: 'rgb' | 'cmyk') {
        setError('')
        Action.updateOwnDefaultColorMode(mode).then(function () {
            onDefaultColorModeChanged()
        }).catch(function (e) { setError(String(e && e.message ? e.message : e)) })
    }

    function handleSaveName() {
        setError('')
        Action.updateOwnDisplayName(displayName.trim()).then(function () {
            onDisplayNameChanged(displayName.trim())
            onHide()
        }).catch(function (e) { setError(String(e && e.message ? e.message : e)) })
    }

    function executeDelete() {
        setIsConfirmOpen(false)
        Action.deleteOwnAccount().then(function () {
            // The session is revoked; reload to the login screen.
            window.location.reload()
        }).catch(function (e) { setError(String(e && e.message ? e.message : e)) })
    }

    return (
        <>
            <Dialog header={ui.accountSettings} visible={visible} onHide={onHide} style={{ width: '30rem' }}>
                <div className={shared.dialog}>
                    <div className={shared.sectionTitle}><span>{ui.displayName}</span></div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <InputText
                            className={shared.cellInput}
                            style={{ flex: 1 }}
                            value={displayName}
                            onChange={function (e) { setDisplayName(e.target.value) }}
                        />
                        <Button label={ui.save} size="small" disabled={displayName.trim() === '' || displayName.trim() === currentDisplayName} onClick={handleSaveName} />
                    </div>

                    <div className={shared.sectionTitle} style={{ marginTop: '1rem' }}><span>{ui.defaultColorMode}</span></div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <SelectDropdown
                            className={shared.cellDropdown}
                            value={currentDefaultColorMode}
                            onChange={function (e) { handleChangeColorMode(e.target.value as 'rgb' | 'cmyk') }}
                        >
                            <option value="rgb">RGB</option>
                            <option value="cmyk">CMYK</option>
                        </SelectDropdown>
                    </div>
                    <div className={shared.note}>
                        {ui.defaultColorModeNote}
                    </div>

                    <div className={shared.sectionTitle} style={{ marginTop: '1rem' }}><span>{ui.workspaceShareKey}</span></div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <InputText
                            className={shared.cellInput}
                            style={{ flex: 1, fontFamily: 'monospace', overflowX: 'auto' }}
                            value={workspaceKey}
                            readOnly
                        />
                        <Button label={copied ? ui.copied : ui.copy} icon="pi pi-copy" size="small" onClick={handleCopyKey} />
                    </div>
                    <div className={shared.note}>
                        {ui.workspaceShareKeyNote}
                    </div>

                    <div className={shared.sectionTitle} style={{ marginTop: '1rem' }}><span>{ui.leaveAccount}</span></div>
                    <div className={shared.note}>
                        {ui.leaveAccountNote}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button label={ui.leaveAccountAction} size="small" severity="danger" onClick={function () { setIsConfirmOpen(true) }} />
                    </div>

                    {error !== '' && <div className={shared.note} style={{ color: '#c0392b' }}>{error}</div>}
                </div>
            </Dialog>

            <Dialog
                header={ui.leaveAccountConfirm}
                visible={isConfirmOpen}
                onHide={function () { setIsConfirmOpen(false) }}
                style={{ width: '24rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={function () { setIsConfirmOpen(false) }} />
                        <Button label={ui.leaveAccountAction} severity="danger" size="small" onClick={executeDelete} />
                    </div>
                }
            >
                <p style={{ margin: 0 }}>{ui.leaveAccountQuestion}</p>
            </Dialog>
        </>
    )
}
