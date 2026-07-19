'use client'

// Slice tool for an image element on the canvas, opened by double-clicking
// the image. Applying replaces the element with its slice pieces whose
// sources are provisional data URIs (see pending_slice_images.ts): a single
// undo restores the original image, and no piece file reaches the workspace
// until the template is saved.

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { useEffect, useMemo, useState } from 'react'
import { useUiMessages } from '@/lib/client/i18n/use_ui_messages'
import { fetchImageBytes } from './image_store'
import { dataUriToBytes, pngBytesToDataUri, registerPendingSliceSource } from './pending_slice_images'
import { applySlicesToImport, remapDisabledPieces, type SlicePoint, type SliceTarget } from './pdf_import_slicer'
import { resolveEditorImageRef, type EditorCurrentFile } from './resource_resolver'
import SliceOverlay from './slice_overlay'
import type { ActionType, State, TemplateElement } from './reducer'
import pdfStyles from './pdf_import_dialog.module.css'
import styles from './image_slice_dialog.module.css'

export type ImageSliceTarget = { bandId: string, elementId: string }

type Props = {
    visible: boolean,
    onHide: () => void,
    state: State,
    dispatch: (action: ActionType) => void,
    currentFile: EditorCurrentFile | null,
    target: ImageSliceTarget | null
}

const MAX_PREVIEW_WIDTH = 760
const MAX_PREVIEW_HEIGHT = 520

export default function ImageSliceDialog(props: Props) {
    const ui = useUiMessages()
    const { visible, onHide, state, dispatch, currentFile, target } = props
    const [points, setPoints] = useState<SlicePoint[]>([])
    const [selectedPointId, setSelectedPointId] = useState<number | null>(null)
    const [disabledPieces, setDisabledPieces] = useState<ReadonlySet<string>>(new Set())
    const [bytes, setBytes] = useState<Uint8Array | null>(null)
    const [applying, setApplying] = useState(false)

    const element = useMemo(function () {
        if (target === null) return null
        const band = state.template.bands.find(function (b) { return b.id === target.bandId })
        if (band === undefined) return null
        return findImageElement(band.elements, target.elementId)
    }, [state.template, target])

    useEffect(function () {
        if (!visible) return
        setPoints([])
        setSelectedPointId(null)
        setDisabledPieces(new Set())
        setApplying(false)
        setBytes(null)
        if (element === null) return
        if (element.source.startsWith('data:')) {
            setBytes(dataUriToBytes(element.source))
            return
        }
        const url = resolveEditorImageRef(element.source, currentFile)
        if (url === null) return
        let cancelled = false
        fetchImageBytes(url).then(function (loaded) {
            if (!cancelled) setBytes(loaded)
        })
        return function () { cancelled = true }
        // The element is derived from the target; re-running on target change is enough
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, target])

    const targets = useMemo<SliceTarget[]>(function () {
        if (element === null) return []
        return [{ key: '0', indexPath: [0], kind: 'image', rect: { x: 0, y: 0, width: element.width, height: element.height } }]
    }, [element])

    function changePoints(next: SlicePoint[]): void {
        // Piece keys are grid indices; carry the disabled state over to the
        // new grid geometrically so it never jumps to a different region
        if (disabledPieces.size > 0) {
            setDisabledPieces(remapDisabledPieces(targets, points, next, disabledPieces))
        }
        setPoints(next)
    }

    function togglePiece(key: string): void {
        setDisabledPieces(function (current) {
            const next = new Set(current)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    async function executeSlice(): Promise<void> {
        if (element === null || target === null || bytes === null || applying) return
        setApplying(true)
        try {
            // Slice in element-local space, then re-anchor the pieces at the
            // element position within its parent
            const localInput = [{ ...element, x: 0, y: 0 }]
            const result = await applySlicesToImport(
                localInput, { [element.source]: bytes }, targets, points, disabledPieces, state.elementIdCounter,
            )
            if (result.elements === localInput) {
                // No cut line crosses the image: nothing to apply
                onHide()
                return
            }
            const pieces = result.elements.map(function (piece) {
                const pieceBytes = result.images[piece.source]
                let source = piece.source
                if (piece.source !== element.source && pieceBytes !== undefined) {
                    source = pngBytesToDataUri(pieceBytes)
                    registerPendingSliceSource(source)
                }
                // The pixel mapping of the slicer assumes fillFrame placement
                return { ...piece, x: piece.x + element.x, y: piece.y + element.y, source, scaleMode: 'fillFrame' as const }
            })
            dispatch({
                type: 'APPLY_IMAGE_SLICE',
                payload: { bandId: target.bandId, elementId: element.id, pieces, nextElementIdCounter: result.nextElementIdCounter },
            })
            onHide()
        } finally {
            setApplying(false)
        }
    }

    if (element === null) return null

    const imageUrl = resolveEditorImageRef(element.source, currentFile)
    const scale = Math.min(MAX_PREVIEW_WIDTH / element.width, MAX_PREVIEW_HEIGHT / element.height)
    return (
        <Dialog
            header={ui.imageSlice}
            visible={visible}
            onHide={onHide}
            style={{ width: '56rem' }}
            footer={(
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <Button label={ui.cancel} severity="secondary" size="small" onClick={onHide} />
                    <Button label={ui.applySlice} icon="pi pi-th-large" size="small" disabled={bytes === null || applying} onClick={executeSlice} />
                </div>
            )}
        >
            <div className={styles.content}>
                <div
                    className={styles.pane}
                    style={{ width: Math.ceil(element.width * scale) + 'px', height: Math.ceil(element.height * scale) + 'px' }}
                >
                    {imageUrl !== null && <img src={imageUrl} className={styles.image} draggable={false} alt="" />}
                    <SliceOverlay
                        width={element.width}
                        height={element.height}
                        scale={scale}
                        targets={targets}
                        tintTargets={false}
                        points={points}
                        selectedPointId={selectedPointId}
                        disabledPieces={disabledPieces}
                        onPointsChange={changePoints}
                        onSelectPoint={setSelectedPointId}
                        onTogglePiece={togglePiece}
                    />
                </div>
                <p className={pdfStyles.sliceHint}>
                    {ui.sliceInstructions}
                </p>
                <p className={pdfStyles.sliceHint}>
                    {ui.sliceUndoNote}
                </p>
            </div>
        </Dialog>
    )
}

function findImageElement(elements: TemplateElement[], elementId: string): TemplateElement | null {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!
        if (element.id === elementId) return element.kind === 'image' ? element : null
        if (element.children.length > 0) {
            const found = findImageElement(element.children, elementId)
            if (found !== null) return found
        }
    }
    return null
}
