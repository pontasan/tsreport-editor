// Purpose-built, intuitive icons for the element tools (staticText ... break).
// Each is a 16x16 inline SVG using currentColor, so it scales crisply and
// follows the toolbar text color / theme. Artwork fills the viewBox edge to
// edge (~1..15) so the picture reads clearly at toolbar size.

import type { JSX } from 'react'
import type { ToolType } from './reducer'

function Svg(props: { children: React.ReactNode }) {
    return (
        <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true"
            fill="none" stroke="currentColor" strokeWidth={1.4}
            strokeLinecap="round" strokeLinejoin="round">
            {props.children}
        </svg>
    )
}

// Static text: a block of literal text lines (a fixed label / paragraph).
function StaticTextIcon() {
    return (
        <Svg>
            <line x1="1.5" y1="3" x2="14.5" y2="3" />
            <line x1="1.5" y1="6.7" x2="14.5" y2="6.7" />
            <line x1="1.5" y1="10.4" x2="10.5" y2="10.4" />
            <line x1="1.5" y1="14" x2="12.5" y2="14" />
        </Svg>
    )
}

// Text field: a data-bound input — a caret and text inside a field box.
function TextFieldIcon() {
    return (
        <Svg>
            <rect x="1" y="2.5" width="14" height="11" rx="1.4" />
            <path d="M4 5v6" strokeWidth={1.3} />
            <line x1="6.4" y1="6.2" x2="11.5" y2="6.2" strokeWidth={1.2} />
            <line x1="6.4" y1="9.8" x2="9.5" y2="9.8" strokeWidth={1.2} />
        </Svg>
    )
}

// Line: a diagonal stroke with its two endpoints marked.
function LineIcon() {
    return (
        <Svg>
            <line x1="2.6" y1="13.4" x2="13.4" y2="2.6" />
            <circle cx="2.6" cy="13.4" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="13.4" cy="2.6" r="1.7" fill="currentColor" stroke="none" />
        </Svg>
    )
}

// Rectangle: an outlined box (wider than tall to read as a rectangle).
function RectangleIcon() {
    return (
        <Svg>
            <rect x="1.5" y="3" width="13" height="10" rx="0.8" />
        </Svg>
    )
}

// Ellipse: an oval, clearly not a perfect circle.
function EllipseIcon() {
    return (
        <Svg>
            <ellipse cx="8" cy="8" rx="7" ry="4.8" />
        </Svg>
    )
}

// Pen / path: a bezier S-curve with anchor squares at each end and their
// control handles — the unmistakable "edit a path" picture.
function PathIcon() {
    return (
        <Svg>
            <path d="M2.4 13.2C2.4 7 13.6 9 13.6 2.8" />
            <line x1="2.4" y1="13.2" x2="2.4" y2="8.2" strokeWidth={1.1} opacity="0.85" />
            <line x1="13.6" y1="2.8" x2="13.6" y2="7.8" strokeWidth={1.1} opacity="0.85" />
            <circle cx="2.4" cy="8.2" r="1.15" fill="currentColor" stroke="none" opacity="0.85" />
            <circle cx="13.6" cy="7.8" r="1.15" fill="currentColor" stroke="none" opacity="0.85" />
            <rect x="0.8" y="11.6" width="3.2" height="3.2" rx="0.4" fill="currentColor" stroke="none" />
            <rect x="12" y="1.2" width="3.2" height="3.2" rx="0.4" fill="currentColor" stroke="none" />
        </Svg>
    )
}

// Image: a photo frame with a sun and mountains.
function ImageIcon() {
    return (
        <Svg>
            <rect x="1" y="2" width="14" height="12" rx="1.4" />
            <circle cx="5.2" cy="6" r="1.5" fill="currentColor" stroke="none" />
            <path d="M1.6 13.2l3.9-4.5 2.7 2.9 2.6-3L14.4 13.2z" fill="currentColor" stroke="none" opacity="0.9" />
        </Svg>
    )
}

// SVG: a vector graphic — a shape defined by editable anchor nodes.
function SvgIcon() {
    return (
        <Svg>
            <path d="M8 1.6l5.4 4-2.05 6.4H4.65L2.6 5.6z" />
            <circle cx="8" cy="1.6" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="13.4" cy="5.6" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="11.35" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="4.65" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="2.6" cy="5.6" r="1.5" fill="currentColor" stroke="none" />
        </Svg>
    )
}

// Frame: a grouping container drawn as four corner brackets.
function FrameIcon() {
    return (
        <Svg>
            <path d="M2 5.5V2h3.5" />
            <path d="M10.5 2H14v3.5" />
            <path d="M14 10.5V14h-3.5" />
            <path d="M5.5 14H2v-3.5" />
        </Svg>
    )
}

// Table: a grid with a header row.
function TableIcon() {
    return (
        <Svg>
            <rect x="1.2" y="2.4" width="13.6" height="11.2" rx="1" />
            <line x1="1.2" y1="6" x2="14.8" y2="6" />
            <line x1="1.2" y1="9.8" x2="14.8" y2="9.8" />
            <line x1="6.1" y1="6" x2="6.1" y2="13.6" />
            <line x1="10.4" y1="6" x2="10.4" y2="13.6" />
        </Svg>
    )
}

// Subreport: a report page nested inside another report page.
function SubreportIcon() {
    return (
        <Svg>
            <rect x="1.4" y="1.4" width="9" height="11" rx="1" />
            <rect x="5.6" y="5" width="9" height="9.6" rx="1" fill="var(--toolbar-bg, #ffffff)" />
            <line x1="7.4" y1="8" x2="12.8" y2="8" strokeWidth={1.1} />
            <line x1="7.4" y1="10.6" x2="12.8" y2="10.6" strokeWidth={1.1} />
            <line x1="7.4" y1="13.2" x2="10.4" y2="13.2" strokeWidth={1.1} />
        </Svg>
    )
}

// Barcode: 1D bars of varying width.
function BarcodeIcon() {
    return (
        <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" fill="currentColor">
            <rect x="1" y="2" width="1.5" height="12" />
            <rect x="3.3" y="2" width="1" height="12" />
            <rect x="5.3" y="2" width="2" height="12" />
            <rect x="8.1" y="2" width="1" height="12" />
            <rect x="10" y="2" width="1.5" height="12" />
            <rect x="12.2" y="2" width="1" height="12" />
            <rect x="14" y="2" width="1.6" height="12" />
        </svg>
    )
}

// Math: a square-root radical over an expression bar.
// Form field: an input box with a check mark.
function FormFieldIcon() {
    return (
        <Svg>
            <rect x="1.5" y="3" width="13" height="10" rx="1.5" strokeWidth={1.3} />
            <path d="M4 8.6l1.8 1.8 3.4-4" strokeWidth={1.5} />
            <path d="M11 10.8h2" strokeWidth={1.3} />
        </Svg>
    )
}

function MathIcon() {
    return (
        <Svg>
            <path d="M1.2 8.6l2.1 0 2.1 5.4 2.9-11.6h6.5" strokeWidth={1.5} />
        </Svg>
    )
}

// Break: a page split by a dashed line with a return arrow to the next page.
function BreakIcon() {
    return (
        <Svg>
            <path d="M2 2.4h12" strokeWidth={1.3} />
            <path d="M2 13.6h12" strokeWidth={1.3} />
            <line x1="0.8" y1="8" x2="15.2" y2="8" strokeDasharray="2.3 1.8" strokeWidth={1.3} />
            <path d="M12.2 10l2-2-2-2" />
            <path d="M14.2 8H8.6v2.4" />
        </Svg>
    )
}

export const ELEMENT_TOOL_ICONS: Partial<Record<ToolType, () => JSX.Element>> = {
    staticText: StaticTextIcon,
    textField: TextFieldIcon,
    line: LineIcon,
    rectangle: RectangleIcon,
    ellipse: EllipseIcon,
    path: PathIcon,
    image: ImageIcon,
    svg: SvgIcon,
    frame: FrameIcon,
    table: TableIcon,
    subreport: SubreportIcon,
    barcode: BarcodeIcon,
    math: MathIcon,
    formField: FormFieldIcon,
    break: BreakIcon,
}
