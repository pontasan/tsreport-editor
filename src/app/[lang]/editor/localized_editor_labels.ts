import type { UiMessages } from '@/lib/common/i18n/ui_messages'
import type { Band, BandType, ElementKind } from './reducer'

export function getLocalizedBandLabel(type: BandType, messages: UiMessages): string {
    switch (type) {
        case 'background': return messages.bandBackground
        case 'draft': return messages.bandDraft
        case 'title': return messages.bandTitle
        case 'pageHeader': return messages.bandPageHeader
        case 'columnHeader': return messages.bandColumnHeader
        case 'groupHeader': return messages.bandGroupHeader
        case 'detail': return messages.bandDetail
        case 'groupFooter': return messages.bandGroupFooter
        case 'columnFooter': return messages.bandColumnFooter
        case 'pageFooter': return messages.bandPageFooter
        case 'lastPageFooter': return messages.bandLastPageFooter
        case 'summary': return messages.bandSummary
        case 'noData': return messages.bandNoData
    }
}

export function getLocalizedBandDisplayLabel(band: Band, messages: UiMessages): string {
    const label = getLocalizedBandLabel(band.type, messages)
    if ((band.type === 'groupHeader' || band.type === 'groupFooter') && band.groupName !== undefined) {
        return label + ' (' + band.groupName + ')'
    }
    return label
}

export function getLocalizedElementKindLabel(kind: ElementKind, messages: UiMessages): string {
    switch (kind) {
        case 'staticText': return messages.staticText
        case 'formField': return messages.formField
        case 'textField': return messages.textField
        case 'line': return messages.line
        case 'rectangle': return messages.rectangle
        case 'ellipse': return messages.ellipse
        case 'path': return messages.path
        case 'image': return messages.image
        case 'svg': return messages.svg
        case 'frame': return messages.frame
        case 'table': return messages.table
        case 'tableColumnFrame': return messages.column + ' ' + messages.frame
        case 'tableColumn': return messages.column
        case 'tableRowFrame': return messages.row + ' ' + messages.frame
        case 'tableRow': return messages.row
        case 'tableCell': return messages.cell
        case 'crosstab': return messages.crosstab
        case 'subreport': return messages.subreport
        case 'barcode': return messages.barcode
        case 'math': return messages.math
        case 'break': return messages.break
    }
}
