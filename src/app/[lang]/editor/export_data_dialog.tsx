'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action } from './action'

type Props = {
    visible: boolean,
    onHide: () => void
}

// Whole-environment export (all DB records + the NFS tree as tar.gz).
export default function ExportDataDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide } = props

    function handleExport() {
        Action.exportEditorData().then(function (blob) {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'tsreport-editor-data.tar.gz'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        })
    }

    return (
        <Dialog
            header={ui.dataExport}
            visible={visible}
            onHide={onHide}
            style={{ width: '28rem' }}
            footer={
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <Button label={ui.close} severity="secondary" size="small" onClick={onHide} />
                    <Button label={ui.export} icon="pi pi-download" size="small" onClick={handleExport} />
                </div>
            }
        >
            <p style={{ margin: 0 }}>
                {ui.dataExportNote}
            </p>
        </Dialog>
    )
}
