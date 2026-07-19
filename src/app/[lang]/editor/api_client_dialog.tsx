'use client'

import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action, type OAuthClientInfo, type TemplateAccessGrantInfo } from './action'
import shared from './admin_table.module.css'
import styles from './api_client_dialog.module.css'

type Props = {
    visible: boolean,
    onHide: () => void
}

// API client management: a directly editable client table with the selected
// client's access grants (folder-scoped) in a second table below.
export default function ApiClientDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide } = props
    // The account owns a single workspace; grants always target it, so only the
    // folder path is configurable (no workspace selector).
    const [ownWorkspaceKey, setOwnWorkspaceKey] = useState('')
    const [oauthClients, setOAuthClients] = useState<OAuthClientInfo[]>([])
    const [selectedOAuthClientId, setSelectedOAuthClientId] = useState<number | null>(null)
    const [accessGrants, setAccessGrants] = useState<TemplateAccessGrantInfo[]>([])
    const [newClientId, setNewClientId] = useState('')
    const [newClientScopes, setNewClientScopes] = useState('report:print report:status report:download report:preview')
    const [grantPath, setGrantPath] = useState('')
    const [showDeleted, setShowDeleted] = useState(false)

    useEffect(function () {
        if (!visible) return
        setShowDeleted(false)
        Action.getMyWorkspaceKey().then(setOwnWorkspaceKey)
        Action.getOAuthClients().then(function (clients) {
            setOAuthClients(clients)
            const selected = clients.find(function (row) { return !row.deleteFlag }) ?? null
            setSelectedOAuthClientId(selected !== null ? selected.id : null)
            if (selected !== null) {
                Action.getTemplateAccessGrants(selected.id).then(setAccessGrants)
            } else {
                setAccessGrants([])
            }
        })
        /* eslint-disable */
    }, [visible])
    /* eslint-enable */

    // Deactivated clients are hidden unless the show-deleted toggle is on.
    function visibleClients(): OAuthClientInfo[] {
        if (showDeleted) return oauthClients
        return oauthClients.filter(function (client) { return !client.deleteFlag })
    }

    function selectedOAuthClient(): OAuthClientInfo | null {
        if (selectedOAuthClientId === null) return null
        for (let i = 0; i < oauthClients.length; i++) {
            if (oauthClients[i].id === selectedOAuthClientId) return oauthClients[i]
        }
        return null
    }

    function selectOAuthClient(client: OAuthClientInfo) {
        if (client.id === selectedOAuthClientId) return
        setSelectedOAuthClientId(client.id)
        Action.getTemplateAccessGrants(client.id).then(setAccessGrants)
    }

    function refreshOAuthClients(selectedId: number) {
        Action.getOAuthClients().then(function (clients) {
            setOAuthClients(clients)
            setSelectedOAuthClientId(selectedId)
        })
    }

    function handleCreateOAuthClient() {
        Action.createOAuthClient(newClientId.trim(), newClientScopes.trim()).then(function (client) {
            setNewClientId('')
            refreshOAuthClients(client.id)
            Action.getTemplateAccessGrants(client.id).then(setAccessGrants)
        })
    }

    // Inline table edit: commit the scopes cell when it loses focus.
    function commitClientScopes(client: OAuthClientInfo, value: string) {
        if (value.trim() === client.scopes) return
        Action.updateOAuthClient(client.id, value.trim(), client.deleteFlag).then(function (updated) {
            refreshOAuthClients(updated.id)
        })
    }

    function handleSetClientDeleted(client: OAuthClientInfo, deleteFlag: boolean) {
        Action.updateOAuthClient(client.id, client.scopes, deleteFlag).then(function (updated) {
            if (deleteFlag && !showDeleted) {
                // The row disappears from the list: select the first remaining client.
                Action.getOAuthClients().then(function (clients) {
                    setOAuthClients(clients)
                    const next = clients.find(function (row) { return !row.deleteFlag }) ?? null
                    setSelectedOAuthClientId(next !== null ? next.id : null)
                    if (next !== null) {
                        Action.getTemplateAccessGrants(next.id).then(setAccessGrants)
                    } else {
                        setAccessGrants([])
                    }
                })
                return
            }
            refreshOAuthClients(updated.id)
        })
    }

    function handleRotateSecret(client: OAuthClientInfo) {
        Action.rotateOAuthClientSecret(client.id).then(function (updated) {
            refreshOAuthClients(updated.id)
        })
    }

    function handleCopySecret(client: OAuthClientInfo) {
        navigator.clipboard.writeText(client.clientSecret)
    }

    function handleCreateAccessGrant() {
        const client = selectedOAuthClient()
        if (client === null) return
        Action.createTemplateAccessGrant(client.id, ownWorkspaceKey, grantPath.trim()).then(function (grant) {
            setAccessGrants(function (prev) { return prev.concat([grant]) })
            setGrantPath('')
        })
    }

    function handleDeleteAccessGrant(id: number) {
        Action.deleteTemplateAccessGrant(id).then(function () {
            setAccessGrants(function (prev) {
                return prev.filter(function (grant) { return grant.id !== id })
            })
        })
    }

    return (
        <Dialog
            header={ui.apiClients}
            visible={visible}
            onHide={onHide}
            style={{ width: '64rem' }}
        >
            <div className={shared.dialog}>
                <div className={shared.sectionTitle}>
                    <span>{ui.clients}</span>
                    <label className={shared.showDeletedToggle}>
                        <input
                            type="checkbox"
                            checked={showDeleted}
                            onChange={function (e) { setShowDeleted(e.target.checked) }}
                        />
                        {ui.showRetired}
                    </label>
                </div>
                <div className={shared.table}>
                    <div className={`${shared.row} ${styles.clientRow} ${shared.tableHeader}`}>
                        <span>Client ID</span>
                        <span>Scopes</span>
                        <span>Secret</span>
                        <span></span>
                    </div>
                    {visibleClients().map(function (client) {
                        return (
                            <div
                                key={`${client.id}:${client.version}`}
                                className={`${shared.row} ${styles.clientRow} ${shared.selectableRow} ${client.id === selectedOAuthClientId ? shared.rowActive : ''}`}
                                onClick={function () { selectOAuthClient(client) }}
                            >
                                <span className={shared.monoCell}>
                                    {client.clientId}
                                    {client.deleteFlag && <span className={shared.deletedBadge}>{ui.retired}</span>}
                                </span>
                                <InputText
                                    className={shared.cellInput}
                                    defaultValue={client.scopes}
                                    disabled={client.deleteFlag}
                                    onBlur={function (e) { commitClientScopes(client, e.target.value) }}
                                    onKeyDown={function (e) { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                />
                                <span className={styles.secretCell}>
                                    <span className={styles.secretText} title={client.clientSecret}>{client.clientSecret}</span>
                                    <button className={shared.iconBtn} title={ui.copySecret} onClick={function () { handleCopySecret(client) }}>
                                        <i className="pi pi-copy"></i>
                                    </button>
                                    <button className={shared.iconBtn} title={ui.rotateSecret} disabled={client.deleteFlag} onClick={function () { handleRotateSecret(client) }}>
                                        <i className="pi pi-refresh"></i>
                                    </button>
                                </span>
                                <span className={shared.cellCenter}>
                                    {client.deleteFlag ? (
                                        <button className={shared.iconBtn} title={ui.restore} onClick={function () { handleSetClientDeleted(client, false) }}>
                                            <i className="pi pi-replay"></i>
                                        </button>
                                    ) : (
                                        <button className={`${shared.iconBtn} ${shared.dangerBtn}`} title={ui.retire} onClick={function () { handleSetClientDeleted(client, true) }}>
                                            <i className="pi pi-trash"></i>
                                        </button>
                                    )}
                                </span>
                            </div>
                        )
                    })}
                    <div className={`${shared.row} ${styles.clientRow} ${shared.newRow}`}>
                        <InputText
                            className={shared.cellInput}
                            placeholder={ui.newClientId}
                            value={newClientId}
                            onChange={function (e) { setNewClientId(e.target.value) }}
                        />
                        <InputText
                            className={shared.cellInput}
                            value={newClientScopes}
                            onChange={function (e) { setNewClientScopes(e.target.value) }}
                        />
                        <span></span>
                        <span className={shared.newRowHint}>{ui.secretAutoIssued}</span>
                        <span className={shared.cellCenter}>
                            <button className={shared.iconBtn} title={ui.create} disabled={newClientId.trim() === ''} onClick={handleCreateOAuthClient}>
                                <i className="pi pi-plus"></i>
                            </button>
                        </span>
                    </div>
                </div>

                {selectedOAuthClient() !== null && (
                    <>
                        <div className={shared.sectionTitle}>{ui.accessGrants} ({selectedOAuthClient()!.clientId})</div>
                        <div className={shared.table}>
                            <div className={`${shared.row} ${styles.grantRow} ${shared.tableHeader}`}>
                                <span>{ui.folderPath}</span>
                                <span></span>
                            </div>
                            {accessGrants.map(function (grant) {
                                return (
                                    <div key={grant.id} className={`${shared.row} ${styles.grantRow}`}>
                                        <span className={styles.grantPath}>{grant.path === '' ? ui.wholeWorkspace : grant.path}</span>
                                        <span className={shared.cellCenter}>
                                            <button className={`${shared.iconBtn} ${shared.dangerBtn}`} title={ui.delete} onClick={function () { handleDeleteAccessGrant(grant.id) }}>
                                                <i className="pi pi-trash"></i>
                                            </button>
                                        </span>
                                    </div>
                                )
                            })}
                            <div className={`${shared.row} ${styles.grantRow} ${shared.newRow}`}>
                                <InputText
                                    className={shared.cellInput}
                                    value={grantPath}
                                    onChange={function (e) { setGrantPath(e.target.value) }}
                                    placeholder={ui.folderPathPlaceholder}
                                />
                                <span className={shared.cellCenter}>
                                    <button className={shared.iconBtn} title={ui.add} disabled={ownWorkspaceKey === ''} onClick={handleCreateAccessGrant}>
                                        <i className="pi pi-plus"></i>
                                    </button>
                                </span>
                            </div>
                        </div>
                        <div className={shared.note}>{ui.accessGrantsNote}</div>
                    </>
                )}
            </div>
        </Dialog>
    )
}
