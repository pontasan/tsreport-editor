'use client'

import { UserAccountVO } from '@/lib/common/vo/entity/user_account'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action } from './action'
import shared from './admin_table.module.css'
import styles from './user_management_dialog.module.css'

type Props = {
    visible: boolean,
    onHide: () => void,
    // Id of the logged-in user (to label the own account row).
    loginUserId?: number
}

// User management (administrator only): a directly editable user table with
// the selected user's workspace view grants (folder-scoped) below — the same
// look and feel as the API client management dialog.
export default function UserManagementDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, loginUserId } = props
    const [users, setUsers] = useState<UserAccountVO.Type[]>([])
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
    // The account pending a delete confirmation (deletion is permanent).
    const [deleteTarget, setDeleteTarget] = useState<UserAccountVO.Type | null>(null)

    // Creation row.
    const [newDisplayName, setNewDisplayName] = useState('')
    const [newUserId, setNewUserId] = useState('')
    const [newPw, setNewPw] = useState('')
    const [newAdminFlag, setNewAdminFlag] = useState(false)

    useEffect(function () {
        if (!visible) return
        Action.listUsers().then(function (list) {
            setUsers(list)
            const selected = list.length > 0 ? list[0] : null
            setSelectedUserId(selected !== null && selected.id !== undefined ? selected.id : null)
        })
        /* eslint-disable */
    }, [visible])
    /* eslint-enable */

    async function reload(selectedId: number | null) {
        const list = await Action.listUsers()
        setUsers(list)
        setSelectedUserId(selectedId)
    }

    function selectUser(user: UserAccountVO.Type) {
        if (user.id === undefined || user.id === selectedUserId) return
        setSelectedUserId(user.id)
    }

    async function handleCreate() {
        await Action.createUser(newDisplayName.trim(), newUserId.trim(), newPw, newAdminFlag)
        setNewDisplayName('')
        setNewUserId('')
        setNewPw('')
        setNewAdminFlag(false)
        await reload(selectedUserId)
    }

    // Inline table edits: commit each cell when it loses focus.
    async function commitDisplayName(user: UserAccountVO.Type, value: string) {
        if (user.id === undefined || value.trim() === user.displayName) return
        await Action.updateUser(user.id, value.trim(), user.userId, user.adminFlag, user.mcpEnabled, '', user.version)
        await reload(selectedUserId)
    }

    async function commitUserId(user: UserAccountVO.Type, value: string) {
        if (user.id === undefined || value.trim() === user.userId) return
        await Action.updateUser(user.id, user.displayName, value.trim(), user.adminFlag, user.mcpEnabled, '', user.version)
        await reload(selectedUserId)
    }

    async function commitPassword(user: UserAccountVO.Type, value: string) {
        if (user.id === undefined || value === '') return
        await Action.updateUser(user.id, user.displayName, user.userId, user.adminFlag, user.mcpEnabled, value, user.version)
        await reload(selectedUserId)
    }

    async function handleToggleAdmin(user: UserAccountVO.Type, adminFlag: boolean) {
        if (user.id === undefined) return
        await Action.updateUser(user.id, user.displayName, user.userId, adminFlag, user.mcpEnabled, '', user.version)
        await reload(selectedUserId)
    }

    async function handleToggleMcp(user: UserAccountVO.Type, mcpEnabled: boolean) {
        if (user.id === undefined) return
        await Action.updateUser(user.id, user.displayName, user.userId, user.adminFlag, mcpEnabled, '', user.version)
        await reload(selectedUserId)
    }

    async function executeDelete() {
        const user = deleteTarget
        setDeleteTarget(null)
        if (user === null || user.id === undefined) return
        await Action.deleteUser(user.id)
        // The row is gone permanently: select the first remaining user.
        const list = await Action.listUsers()
        setUsers(list)
        const next = list.length > 0 ? list[0] : null
        setSelectedUserId(next !== null && next.id !== undefined ? next.id : null)
    }

    return (
        <>
        <Dialog
            header={ui.userManagement}
            visible={visible}
            onHide={onHide}
            style={{ width: '58rem' }}
        >
            <div className={shared.dialog}>
                <div className={shared.sectionTitle}>
                    <span>{ui.users}</span>
                </div>
                <div className={shared.table}>
                    <div className={`${shared.row} ${styles.userRow} ${shared.tableHeader}`}>
                        <span>{ui.displayName}</span>
                        <span>{ui.loginId}</span>
                        <span>{ui.password}</span>
                        <span>{ui.administratorRole}</span>
                        <span>MCP</span>
                        <span></span>
                        <span></span>
                    </div>
                    {users.map(function (user) {
                        return (
                            <div
                                key={`${user.id}:${user.version}`}
                                className={`${shared.row} ${styles.userRow} ${shared.selectableRow} ${user.id === selectedUserId ? shared.rowActive : ''}`}
                                onClick={function () { selectUser(user) }}
                            >
                                <InputText
                                    className={shared.cellInput}
                                    defaultValue={user.displayName}
                                    onBlur={function (e) { commitDisplayName(user, e.target.value) }}
                                    onKeyDown={function (e) { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                />
                                <InputText
                                    className={shared.cellInput}
                                    defaultValue={user.userId}
                                    onBlur={function (e) { commitUserId(user, e.target.value) }}
                                    onKeyDown={function (e) { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                />
                                <InputText
                                    className={shared.cellInput}
                                    type="password"
                                    defaultValue=""
                                    placeholder={ui.onlyWhenChanging}
                                    onBlur={function (e) { commitPassword(user, e.target.value) }}
                                    onKeyDown={function (e) { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                />
                                <span className={shared.cellCenter}>
                                    <input
                                        type="checkbox"
                                        checked={user.adminFlag}
                                        onChange={function (e) { handleToggleAdmin(user, e.target.checked) }}
                                    />
                                </span>
                                <span className={shared.cellCenter}>
                                    <input
                                        type="checkbox"
                                        checked={user.mcpEnabled}
                                        onChange={function (e) { handleToggleMcp(user, e.target.checked) }}
                                    />
                                </span>
                                <span className={shared.cellCenter}>
                                    {user.id === loginUserId && <span className={shared.selfBadge}>{ui.me}</span>}
                                </span>
                                <span className={shared.cellCenter}>
                                    <button className={`${shared.iconBtn} ${shared.dangerBtn}`} title={ui.delete} onClick={function () { setDeleteTarget(user) }}>
                                        <i className="pi pi-trash"></i>
                                    </button>
                                </span>
                            </div>
                        )
                    })}
                    <div className={`${shared.row} ${styles.userRow} ${shared.newRow}`}>
                        <InputText
                            className={shared.cellInput}
                            placeholder={ui.newUserDisplayName}
                            value={newDisplayName}
                            onChange={function (e) { setNewDisplayName(e.target.value) }}
                        />
                        <InputText
                            className={shared.cellInput}
                            placeholder={ui.loginId}
                            value={newUserId}
                            onChange={function (e) { setNewUserId(e.target.value) }}
                        />
                        <InputText
                            className={shared.cellInput}
                            type="password"
                            placeholder={ui.password}
                            value={newPw}
                            onChange={function (e) { setNewPw(e.target.value) }}
                        />
                        <span className={shared.cellCenter}>
                            <input
                                type="checkbox"
                                checked={newAdminFlag}
                                onChange={function (e) { setNewAdminFlag(e.target.checked) }}
                            />
                        </span>
                        <span></span>
                        <span></span>
                        <span className={shared.cellCenter}>
                            <button
                                className={shared.iconBtn} title={ui.create}
                                disabled={newDisplayName.trim() === '' || newUserId.trim() === '' || newPw === ''}
                                onClick={handleCreate}
                            >
                                <i className="pi pi-plus"></i>
                            </button>
                        </span>
                    </div>
                </div>
                <div className={shared.note}>{ui.userManagementNote}</div>
            </div>
        </Dialog>
            <Dialog
                header={ui.userDeleteConfirm}
                visible={deleteTarget !== null}
                onHide={function () { setDeleteTarget(null) }}
                style={{ width: '32rem' }}
                footer={
                    <div>
                        <Button label={ui.cancel} size="small" text onClick={function () { setDeleteTarget(null) }} />
                        <Button label={ui.deleteUser} severity="danger" size="small" onClick={executeDelete} />
                    </div>
                }
            >
                <p style={{ margin: 0 }}>
                    {ui.userDeleteQuestion} ({deleteTarget?.displayName})
                </p>
            </Dialog>
        </>
    )
}
