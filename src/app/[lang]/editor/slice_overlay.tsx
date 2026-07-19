'use client'

// Interactive slice-editing overlay shared by the PDF import preview and
// the canvas image slice dialog. Click to add a slice point (a click on an
// existing line adds a control point onto that line), drag a point to move
// its lines (control points of a shared line follow), drop a point onto
// another line or point to attach them, select a point and press Delete to
// remove it, click a piece's center marker to toggle the piece on/off.

import { useEffect, useMemo, useRef } from 'react'
import {
    addSlicePoint, attachDroppedPoint, attachPointToLines, collectSliceLines, computeSlicePieces, deleteSlicePoint,
    moveSlicePoint, type SlicePoint, type SliceTarget,
} from './pdf_import_slicer'
import styles from './pdf_import_dialog.module.css'

/** Dropping or clicking within this screen distance of a line/point attaches to it */
const POINT_ATTACH_THRESHOLD_PX = 10

type Props = {
    /** Content-space size of the sliceable area (pt) */
    width: number,
    height: number,
    /** Screen pixels per content unit */
    scale: number,
    targets: SliceTarget[],
    /** Tint the sliceable targets (used to locate them among other content; off when the whole area is one target) */
    tintTargets: boolean,
    points: SlicePoint[],
    selectedPointId: number | null,
    disabledPieces: ReadonlySet<string>,
    onPointsChange: (points: SlicePoint[]) => void,
    onSelectPoint: (pointId: number | null) => void,
    onTogglePiece: (key: string) => void
}

export default function SliceOverlay(props: Props) {
    const { width, height, scale, targets, tintTargets, points, selectedPointId, disabledPieces, onPointsChange, onSelectPoint, onTogglePiece } = props
    const pointDragRef = useRef<{ pointId: number, startX: number, startY: number, clientX: number, clientY: number, moved: boolean } | null>(null)
    const pointsRef = useRef(points)
    pointsRef.current = points
    const selectionRef = useRef(selectedPointId)
    selectionRef.current = selectedPointId

    const pieces = useMemo(function () {
        return computeSlicePieces(targets, points)
    }, [targets, points])

    // Delete / Backspace removes the selected control point; a cut line
    // disappears together with its last control point
    useEffect(function () {
        function handleKeyDown(e: KeyboardEvent): void {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return
            const selected = selectionRef.current
            if (selected === null) return
            const target = e.target
            if (target instanceof HTMLElement
                && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
            e.preventDefault()
            onPointsChange(deleteSlicePoint(pointsRef.current, selected))
            onSelectPoint(null)
        }
        document.addEventListener('keydown', handleKeyDown)
        return function () { document.removeEventListener('keydown', handleKeyDown) }
    }, [onPointsChange, onSelectPoint])

    function handleBackdropClick(e: React.MouseEvent<SVGRectElement>): void {
        // A click while a point is selected only clears the selection so a
        // stray deselect click does not also drop a new point
        if (selectedPointId !== null) {
            onSelectPoint(null)
            return
        }
        const svg = e.currentTarget.ownerSVGElement
        if (svg === null) return
        const bounds = svg.getBoundingClientRect()
        const x = Math.min(width, Math.max(0, (e.clientX - bounds.left) / scale))
        const y = Math.min(height, Math.max(0, (e.clientY - bounds.top) / scale))
        // A click on or near an existing cut line adds the point as one of
        // that line's control points instead of a fully independent cross
        const added = addSlicePoint(points, x, y)
        onPointsChange(attachPointToLines(added, added[added.length - 1]!.id, POINT_ATTACH_THRESHOLD_PX / scale))
    }

    function handlePointMouseDown(point: SlicePoint, e: React.MouseEvent): void {
        e.preventDefault()
        e.stopPropagation()
        pointDragRef.current = { pointId: point.id, startX: point.x, startY: point.y, clientX: e.clientX, clientY: e.clientY, moved: false }
        function handleMove(ev: MouseEvent): void {
            const drag = pointDragRef.current
            if (drag === null) return
            drag.moved = true
            const x = Math.min(width, Math.max(0, drag.startX + (ev.clientX - drag.clientX) / scale))
            const y = Math.min(height, Math.max(0, drag.startY + (ev.clientY - drag.clientY) / scale))
            onPointsChange(moveSlicePoint(pointsRef.current, drag.pointId, x, y))
        }
        function handleUp(): void {
            const drag = pointDragRef.current
            pointDragRef.current = null
            document.removeEventListener('mousemove', handleMove)
            document.removeEventListener('mouseup', handleUp)
            if (drag === null) return
            // A plain click (no movement) selects the point
            if (!drag.moved) {
                onSelectPoint(drag.pointId)
                return
            }
            // Dropping onto another point or line attaches the point to it
            const attached = attachDroppedPoint(pointsRef.current, drag.pointId, POINT_ATTACH_THRESHOLD_PX / scale)
            if (attached !== pointsRef.current) {
                onPointsChange(attached)
                if (selectionRef.current !== null) onSelectPoint(null)
            }
        }
        document.addEventListener('mousemove', handleMove)
        document.addEventListener('mouseup', handleUp)
    }

    const cssWidth = Math.ceil(width * scale)
    const cssHeight = Math.ceil(height * scale)
    const thinStroke = 1 / scale
    const lineStroke = 1.5 / scale
    const selectedStroke = 2.5 / scale
    const handleRadius = 5 / scale
    const tints: React.ReactNode[] = []
    for (let i = 0; tintTargets && i < targets.length; i++) {
        const target = targets[i]!
        if (target.kind !== 'image' && target.kind !== 'path') continue
        tints.push(
            <rect
                key={'tint_' + target.key}
                className={target.kind === 'image' ? styles.sliceTintImage : styles.sliceTintPath}
                x={target.rect.x} y={target.rect.y} width={target.rect.width} height={target.rect.height}
                strokeWidth={thinStroke}
            />,
        )
    }
    // Piece rectangles are visual only; the toggle affordance is the small
    // center marker so the backdrop stays clickable over sliced targets
    // and further points can be placed anywhere
    const pieceRects: React.ReactNode[] = []
    const pieceHandles: React.ReactNode[] = []
    const pieceHandleRadius = 6 / scale
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!
        const disabled = disabledPieces.has(piece.key)
        pieceRects.push(
            <rect
                key={piece.key}
                className={disabled ? styles.slicePieceDisabled : styles.slicePiece}
                x={piece.rect.x} y={piece.rect.y} width={piece.rect.width} height={piece.rect.height}
                strokeWidth={thinStroke}
            />,
        )
        pieceHandles.push(
            <circle
                key={'toggle_' + piece.key}
                className={disabled ? styles.slicePieceHandleOff : styles.slicePieceHandle}
                cx={piece.rect.x + piece.rect.width / 2}
                cy={piece.rect.y + piece.rect.height / 2}
                r={pieceHandleRadius}
                strokeWidth={lineStroke}
                onClick={function () { onTogglePiece(piece.key) }}
            />,
        )
    }
    // One rendered line per shared line id; a selected point highlights the
    // lines it controls together with its handle. Lines have no hit area of
    // their own — a click on a line reaches the backdrop and adds a control
    // point onto it.
    const sliceLines = collectSliceLines(points)
    let selectedPoint: SlicePoint | null = null
    for (let i = 0; i < points.length; i++) {
        if (points[i]!.id === selectedPointId) selectedPoint = points[i]!
    }
    const lines: React.ReactNode[] = []
    for (let i = 0; i < sliceLines.h.length; i++) {
        const line = sliceLines.h[i]!
        const selected = selectedPoint !== null && selectedPoint.hLineId === line.lineId
        lines.push(
            <line
                key={'h_' + line.lineId}
                className={selected ? styles.sliceLineSelected : styles.sliceLine}
                x1={0} y1={line.pos} x2={width} y2={line.pos}
                strokeWidth={selected ? selectedStroke : lineStroke}
            />,
        )
    }
    for (let i = 0; i < sliceLines.v.length; i++) {
        const line = sliceLines.v[i]!
        const selected = selectedPoint !== null && selectedPoint.vLineId === line.lineId
        lines.push(
            <line
                key={'v_' + line.lineId}
                className={selected ? styles.sliceLineSelected : styles.sliceLine}
                x1={line.pos} y1={0} x2={line.pos} y2={height}
                strokeWidth={selected ? selectedStroke : lineStroke}
            />,
        )
    }
    const handles: React.ReactNode[] = []
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!
        const selected = selectedPoint !== null && selectedPoint.id === point.id
        handles.push(
            <circle
                key={'handle_' + point.id}
                className={selected ? styles.sliceHandleSelected : styles.sliceHandle}
                cx={point.x} cy={point.y} r={handleRadius}
                strokeWidth={selected ? selectedStroke : lineStroke}
                onMouseDown={function (e) { handlePointMouseDown(point, e) }}
            />,
        )
    }
    return (
        <svg
            className={styles.sliceOverlay}
            width={cssWidth}
            height={cssHeight}
            viewBox={'0 0 ' + width + ' ' + height}
            preserveAspectRatio="none"
        >
            <rect
                className={styles.sliceBackdrop}
                x={0} y={0} width={width} height={height}
                onClick={handleBackdropClick}
            />
            {tints}
            {pieceRects}
            {lines}
            {pieceHandles}
            {handles}
        </svg>
    )
}
