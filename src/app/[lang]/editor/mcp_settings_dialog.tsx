'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action } from './action'
import shared from './admin_table.module.css'
import styles from './mcp_settings_dialog.module.css'

type Props = {
    visible: boolean,
    onHide: () => void,
    isAdmin: boolean
}

// Per-account MCP connection settings (every user), plus the global MCP
// switch and dedicated listener port for administrators.
export default function McpSettingsDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, isAdmin } = props
    const [settings, setSettings] = useState<Action.McpSettingsInfo | null>(null)
    const [globalEnabled, setGlobalEnabled] = useState(true)
    const [globalPort, setGlobalPort] = useState('')
    const [isRegenerateConfirmOpen, setIsRegenerateConfirmOpen] = useState(false)

    useEffect(function () {
        if (!visible) return
        setSettings(null)
        Action.getMcpSettings().then(function (info) {
            setSettings(info)
            if (info.global !== undefined) {
                setGlobalEnabled(info.global.enabled)
                setGlobalPort(String(info.global.port))
            }
        })
    }, [visible])

    function handleToggleOwn(mcpEnabled: boolean) {
        Action.updateOwnMcpEnabled(mcpEnabled).then(function () {
            setSettings(function (prev) { return prev === null ? prev : { ...prev, mcpEnabled: mcpEnabled } })
        })
    }

    function executeRegenerate() {
        setIsRegenerateConfirmOpen(false)
        Action.regenerateMcpKey().then(function (mcpKey) {
            setSettings(function (prev) { return prev === null ? prev : { ...prev, mcpKey: mcpKey } })
        })
    }

    function handleCopyKey() {
        if (settings !== null) {
            navigator.clipboard.writeText(settings.mcpKey)
        }
    }

    function handleSaveGlobal() {
        Action.updateMcpGlobalSettings(globalEnabled, parseInt(globalPort, 10)).then(function () {
            Action.getMcpSettings().then(setSettings)
        })
    }

    return (
        <>
            <Dialog
                header={ui.mcpSettings}
                visible={visible}
                onHide={onHide}
                style={{ width: '44rem' }}
            >
                {settings !== null && (
                    <div className={shared.dialog}>
                        <div className={shared.sectionTitle}>
                            <span>{ui.ownMcpConnection}</span>
                        </div>
                        <div className={shared.table}>
                            <div className={`${shared.row} ${styles.settingRow}`}>
                                <span>{ui.enableMcp}</span>
                                <span className={styles.valueCell}>
                                    <input
                                        type="checkbox"
                                        checked={settings.mcpEnabled}
                                        onChange={function (e) { handleToggleOwn(e.target.checked) }}
                                    />
                                </span>
                            </div>
                            <div className={`${shared.row} ${styles.settingRow}`}>
                                <span>{ui.accountId}</span>
                                <span className={shared.monoCell}>{settings.userId}</span>
                            </div>
                            <div className={`${shared.row} ${styles.settingRow}`}>
                                <span>{ui.mcpAuthKey}</span>
                                <span className={styles.valueCell}>
                                    <span className={styles.keyText} title={settings.mcpKey}>{settings.mcpKey}</span>
                                    <button className={shared.iconBtn} title={ui.copyKey} onClick={handleCopyKey}>
                                        <i className="pi pi-copy"></i>
                                    </button>
                                    <button className={shared.iconBtn} title={ui.regenerateKey} onClick={function () { setIsRegenerateConfirmOpen(true) }}>
                                        <i className="pi pi-refresh"></i>
                                    </button>
                                </span>
                            </div>
                            <div className={`${shared.row} ${styles.settingRow}`}>
                                <span>{ui.endpoint}</span>
                                <span className={shared.monoCell}>{window.location.origin + '/api/mcp'}</span>
                            </div>
                        </div>
                        <div className={shared.note}>
                            {ui.mcpConnectionNote}
                        </div>

                        {isAdmin && settings.global !== undefined && (
                            <>
                                <div className={shared.sectionTitle}>
                                    <span>{ui.globalSettingsAdmin}</span>
                                </div>
                                <div className={shared.table}>
                                    <div className={`${shared.row} ${styles.settingRow}`}>
                                        <span>{ui.enableMcpGlobally}</span>
                                        <span className={styles.valueCell}>
                                            <input
                                                type="checkbox"
                                                checked={globalEnabled}
                                                onChange={function (e) { setGlobalEnabled(e.target.checked) }}
                                            />
                                        </span>
                                    </div>
                                    <div className={`${shared.row} ${styles.settingRow}`}>
                                        <span>{ui.listenerPort}</span>
                                        <InputText
                                            className={`${shared.cellInput} ${styles.portInput}`}
                                            value={globalPort}
                                            onChange={function (e) { setGlobalPort(e.target.value) }}
                                        />
                                    </div>
                                </div>
                                <div className={styles.globalActions}>
                                    <Button label={ui.saveGlobalSettings} size="small" onClick={handleSaveGlobal} />
                                </div>
                                <div className={shared.note}>
                                    {ui.globalMcpNote}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </Dialog>

            <Dialog
                header={ui.confirm}
                visible={isRegenerateConfirmOpen}
                onHide={function () { setIsRegenerateConfirmOpen(false) }}
                style={{ width: '24rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={function () { setIsRegenerateConfirmOpen(false) }} />
                        <Button label={ui.regenerate} severity="danger" size="small" onClick={executeRegenerate} />
                    </div>
                }
            >
                <p style={{ margin: 0 }}>{ui.regenerateMcpKeyQuestion}</p>
            </Dialog>
        </>
    )
}
