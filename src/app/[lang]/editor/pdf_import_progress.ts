export function waitForPdfImportProgressPaint(): Promise<void> {
    return new Promise(function (resolve) {
        requestAnimationFrame(function () {
            setTimeout(resolve, 0)
        })
    })
}
