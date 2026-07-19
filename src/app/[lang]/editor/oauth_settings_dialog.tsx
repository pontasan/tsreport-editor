'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action } from './action'
import shared from './admin_table.module.css'

type Props = {
    visible: boolean,
    onHide: () => void
}

type Draft = { enabled: boolean, clientId: string, clientSecret: string, callbackUrl: string }

// Administrator: configure external sign-in (Google / Microsoft). Each provider
// becomes selectable on the login page once enabled and fully configured.
export default function OAuthSettingsDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide } = props
    const [google, setGoogle] = useState<Draft>({ enabled: false, clientId: '', clientSecret: '', callbackUrl: '' })
    const [microsoft, setMicrosoft] = useState<Draft>({ enabled: false, clientId: '', clientSecret: '', callbackUrl: '' })

    useEffect(function () {
        if (!visible) return
        Action.getOAuthSettings().then(function (s) {
            setGoogle(s.google)
            setMicrosoft(s.microsoft)
        })
    }, [visible])

    function save(provider: 'google' | 'microsoft', draft: Draft) {
        Action.updateOAuthSettings(provider, draft.enabled, draft.clientId.trim(), draft.clientSecret.trim()).then(function () {
            Action.getOAuthSettings().then(function (s) { setGoogle(s.google); setMicrosoft(s.microsoft) })
        })
    }

    function renderProvider(name: string, provider: 'google' | 'microsoft', draft: Draft, setDraft: (d: Draft) => void) {
        return (
            <div className={shared.dialog} style={{ marginBottom: '0.75rem' }}>
                <div className={shared.sectionTitle}>
                    <span>{name}</span>
                    <label className={shared.showDeletedToggle}>
                        <input type="checkbox" checked={draft.enabled} onChange={function (e) { setDraft({ ...draft, enabled: e.target.checked }) }} />
                        {ui.enabled}
                    </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '9rem 1fr', gap: '0.4rem', alignItems: 'center' }}>
                    <span>Client ID</span>
                    <InputText className={shared.cellInput} value={draft.clientId} onChange={function (e) { setDraft({ ...draft, clientId: e.target.value }) }} />
                    <span>Client Secret</span>
                    <InputText className={shared.cellInput} value={draft.clientSecret} onChange={function (e) { setDraft({ ...draft, clientSecret: e.target.value }) }} />
                    <span>{ui.redirectUri}</span>
                    <span className={shared.monoCell}>{draft.callbackUrl}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                    <Button label={ui.save} size="small" onClick={function () { save(provider, draft) }} />
                </div>
            </div>
        )
    }

    return (
        <Dialog header={ui.externalAuthSettings} visible={visible} onHide={onHide} style={{ width: '44rem' }}>
            <div className={shared.note} style={{ marginBottom: '0.5rem' }}>
                {ui.oauthSettingsNote}
            </div>
            {renderProvider('Google', 'google', google, setGoogle)}
            {renderProvider('Microsoft', 'microsoft', microsoft, setMicrosoft)}
        </Dialog>
    )
}
