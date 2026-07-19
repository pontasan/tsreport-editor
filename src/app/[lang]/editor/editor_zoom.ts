export const EDITOR_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5] as const

export function stepEditorZoom(zoom: number, direction: -1 | 1): number {
    const index = EDITOR_ZOOM_LEVELS.indexOf(zoom as typeof EDITOR_ZOOM_LEVELS[number])
    if (index < 0) return zoom
    const next = index + direction
    if (next < 0 || next >= EDITOR_ZOOM_LEVELS.length) return zoom
    return EDITOR_ZOOM_LEVELS[next]!
}
