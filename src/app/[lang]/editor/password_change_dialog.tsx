'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action } from './action'
import styles from './password_change_dialog.module.css'

type Props = {
    visible: boolean,
    onHide: () => void,
    onChanged: () => void
}

// Own password change (available to every account).
export default function PasswordChangeDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, onChanged } = props
    const [currentPw, setCurrentPw] = useState('')
    const [newPw, setNewPw] = useState('')
    const [confirmPw, setConfirmPw] = useState('')

    useEffect(function () {
        if (visible) {
            setCurrentPw('')
            setNewPw('')
            setConfirmPw('')
        }
    }, [visible])

    async function handleChange() {
        await Action.changeOwnPassword(currentPw, newPw)
        onChanged()
    }

    const mismatch = confirmPw !== '' && newPw !== confirmPw

    return (
        <Dialog
            header={ui.passwordChange}
            visible={visible}
            onHide={onHide}
            style={{ width: '26rem' }}
            footer={
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <Button label={ui.cancel} severity="secondary" size="small" onClick={onHide} />
                    <Button
                        label={ui.change} size="small" onClick={handleChange}
                        disabled={currentPw === '' || newPw === '' || newPw !== confirmPw}
                    />
                </div>
            }
        >
            <div className={styles.formGrid}>
                <label>{ui.currentPassword}</label>
                <InputText type="password" value={currentPw} onChange={function (e) { setCurrentPw(e.target.value) }} autoFocus />
                <label>{ui.newPassword}</label>
                <InputText type="password" value={newPw} onChange={function (e) { setNewPw(e.target.value) }} />
                <label>{ui.confirmation}</label>
                <InputText type="password" value={confirmPw} onChange={function (e) { setConfirmPw(e.target.value) }} />
            </div>
            {mismatch && <p style={{ color: '#c0392b', fontSize: '0.75rem', margin: '0.5rem 0 0 0' }}>{ui.passwordMismatch}</p>}
        </Dialog>
    )
}
