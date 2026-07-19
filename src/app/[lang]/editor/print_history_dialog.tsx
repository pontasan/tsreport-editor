'use client'

import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable, type DataTablePageEvent } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { useEffect, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { Action, type PrintHistoryItem } from './action'
import styles from './print_history_dialog.module.css'

// Account-scoped print history. Lazy-loaded and paginated because rows grow
// without bound (history is never deleted).

const ROWS = 20

type Props = {
    visible: boolean,
    onHide: () => void
}

export default function PrintHistoryDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide } = props
    const [items, setItems] = useState<PrintHistoryItem[]>([])
    const [total, setTotal] = useState(0)
    const [first, setFirst] = useState(0)
    const [loading, setLoading] = useState(false)

    function load(offset: number) {
        setLoading(true)
        Action.getPrintHistory(offset, ROWS).then(function (page) {
            setItems(page.items)
            setTotal(page.total)
            setLoading(false)
        }).catch(function () { setLoading(false) })
    }

    useEffect(function () {
        if (visible) {
            setFirst(0)
            load(0)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible])

    function onPage(e: DataTablePageEvent) {
        setFirst(e.first)
        load(e.first)
    }

    function download(key: string) {
        const a = document.createElement('a')
        a.href = Action.printHistoryDownloadUrl(key)
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
    }

    function viaBody(row: PrintHistoryItem) {
        return row.via === 'editor' ? ui.editor : row.via.toUpperCase()
    }

    function whoBody(row: PrintHistoryItem) {
        return row.clientId !== '' ? row.clientId : '—'
    }

    function templateBody(row: PrintHistoryItem) {
        return row.templatePath !== '' ? row.templatePath : ui.inline
    }

    function statusBody(row: PrintHistoryItem) {
        const label = row.status === 'queued' ? ui.queued
            : row.status === 'processing' ? ui.processing
                : row.status === 'completed' ? ui.completed
                    : row.status === 'error' ? ui.error : row.status
        if (row.status === 'error' && row.errorReason !== '') {
            return <span title={row.errorReason} style={{ color: '#c0392b' }}>{label}</span>
        }
        return label
    }

    function downloadBody(row: PrintHistoryItem) {
        if (!row.downloadable) {
            return null
        }
        return (
            <Button icon="pi pi-download" size="small" text tooltip={ui.download} onClick={function () { download(row.key) }} />
        )
    }

    return (
        <Dialog header={ui.printHistory} visible={visible} onHide={onHide} style={{ width: '62rem' }}>
            <DataTable
                className={styles.table}
                value={items}
                lazy
                paginator
                first={first}
                rows={ROWS}
                totalRecords={total}
                onPage={onPage}
                loading={loading}
                dataKey="key"
                size="small"
                emptyMessage={ui.noPrintHistory}
            >
                <Column field="creation" header={ui.dateTime} style={{ width: '11rem', whiteSpace: 'nowrap' }} />
                <Column header={ui.channel} body={viaBody} style={{ width: '6rem' }} />
                <Column header={ui.actor} body={whoBody} style={{ width: '12rem' }} />
                <Column header={ui.template} body={templateBody} />
                <Column field="format" header={ui.format} style={{ width: '5rem' }} />
                <Column header={ui.status} body={statusBody} style={{ width: '6rem' }} />
                <Column header="" body={downloadBody} style={{ width: '4rem', textAlign: 'center' }} />
            </DataTable>
        </Dialog>
    )
}
