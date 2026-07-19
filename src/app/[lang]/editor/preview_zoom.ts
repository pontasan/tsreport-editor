const CSS_PIXELS_PER_POINT = 96 / 72

export const PREVIEW_ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300, 400, 500] as const
export type PreviewZoomPercent = typeof PREVIEW_ZOOM_LEVELS[number] | null

export function resolvePreviewScale(zoomPercent: PreviewZoomPercent, fitScale: number): number {
    return zoomPercent === null ? fitScale : CSS_PIXELS_PER_POINT * zoomPercent / 100
}

export function fitScalePercent(fitScale: number): number {
    return Math.round(fitScale / CSS_PIXELS_PER_POINT * 100)
}

export function maximumPreviewScale(maxPageWidth: number, availableWidth: number): number {
    return Math.min(CSS_PIXELS_PER_POINT, availableWidth / maxPageWidth)
}

export function previewAvailableWidth(viewportWidth: number): number {
    return viewportWidth - 64
}

export function stepPreviewZoom(
    zoomPercent: PreviewZoomPercent,
    fitScale: number,
    direction: -1 | 1,
): PreviewZoomPercent {
    const current = zoomPercent ?? fitScale / CSS_PIXELS_PER_POINT * 100
    if (direction > 0) {
        for (let i = 0; i < PREVIEW_ZOOM_LEVELS.length; i++) {
            if (PREVIEW_ZOOM_LEVELS[i]! > current + 0.01) return PREVIEW_ZOOM_LEVELS[i]!
        }
        return zoomPercent
    }
    for (let i = PREVIEW_ZOOM_LEVELS.length - 1; i >= 0; i--) {
        if (PREVIEW_ZOOM_LEVELS[i]! < current - 0.01) return PREVIEW_ZOOM_LEVELS[i]!
    }
    return zoomPercent
}
