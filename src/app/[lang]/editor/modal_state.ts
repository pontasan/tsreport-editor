// Editor-level keyboard shortcuts (element delete, undo/redo, pen/path
// editing keys) must stay inert while a modal dialog owns the screen —
// otherwise a Delete pressed inside e.g. the image slice dialog also deletes
// the selected canvas element behind the dialog.

/** True while a PrimeReact modal dialog is open (its mask element is in the DOM). */
export function isModalDialogOpen(): boolean {
    return document.querySelector('.p-dialog-mask') !== null
}
