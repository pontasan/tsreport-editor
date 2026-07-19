'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action } from './action'

type Props = {
    visible: boolean,
    onHide: () => void
}

// Whole-environment import: replaces every DB record and all files with the
// archive contents. References inside templates are workspace-relative
// virtual paths, so the archive restores as-is (no path rewriting involved).
export default function ImportDataDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide } = props
    const [importFile, setImportFile] = useState<File | null>(null)
    const [isConfirmOpen, setIsConfirmOpen] = useState(false)
    const [importCompleted, setImportCompleted] = useState(false)

    useEffect(function () {
        if (visible) {
            setImportFile(null)
        }
    }, [visible])

    function executeImport() {
        if (importFile === null) return
        setIsConfirmOpen(false)
        Action.importEditorData(importFile).then(function () {
            // The import replaces the Session table too, so the current login is gone.
            // Show the completion dialog; closing it reloads to land on the login screen.
            onHide()
            setImportCompleted(true)
        })
    }

    return (
        <>
            <Dialog
                header={ui.dataImport}
                visible={visible}
                onHide={onHide}
                style={{ width: '28rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={onHide} />
                        <Button label={ui.import} icon="pi pi-upload" size="small" severity="danger" disabled={importFile === null} onClick={function () { setIsConfirmOpen(true) }} />
                    </div>
                }
            >
                <p style={{ margin: '0 0 0.75rem 0' }}>
                    {ui.dataImportNote}
                </p>
                <input
                    type="file"
                    accept=".gz,.tgz,.tar.gz,application/gzip"
                    onChange={function (e) { setImportFile(e.target.files !== null && e.target.files.length > 0 ? e.target.files[0] : null) }}
                />
            </Dialog>

            <Dialog
                header={ui.confirm}
                visible={isConfirmOpen}
                onHide={function () { setIsConfirmOpen(false) }}
                style={{ width: '24rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={function () { setIsConfirmOpen(false) }} />
                        <Button label={ui.ok} severity="danger" size="small" onClick={executeImport} />
                    </div>
                }
            >
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{ui.replaceDataConfirm}</p>
            </Dialog>

            <Dialog
                header={ui.importCompleted}
                visible={importCompleted}
                onHide={function () { window.location.reload() }}
                style={{ width: '24rem' }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button label={ui.ok} size="small" onClick={function () { window.location.reload() }} />
                    </div>
                }
            >
                <p style={{ margin: 0 }}>{ui.importCompleteNote}</p>
            </Dialog>
        </>
    )
}
