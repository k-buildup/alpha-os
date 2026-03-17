/**
 * UI Component — Scrollbar
 *
 * Renders a minimal vertical scrollbar track + thumb.
 */

import type { DrawCommand } from "../../types/index.js";
import type { Theme } from "../Theme.js";

export interface ScrollbarSpec {
    /** right edge X of the containing area */
    x:      number;
    /** top of scroll area */
    top:    number;
    /** height of scroll area */
    height: number;
    /** total number of items */
    total:  number;
    /** max visible items */
    visible: number;
    /** current scroll offset (0-based) */
    offset: number;
    /** track width */
    width?: number;
}

export function renderScrollbar(spec: ScrollbarSpec, theme: Theme): DrawCommand[] {
    const { x, top, height, total, visible, offset, width = 3 } = spec;
    if (total <= visible) return [];

    const track   = height - 4;
    const thumb   = Math.max(24, track * visible / total);
    const maxOff  = Math.max(1, total - visible);
    const thumbY  = top + 2 + (track - thumb) * offset / maxOff;

    return [
        { type: "rect", x: x - width - 2, y: top + 2, width, height: track, color: theme.color("muted") },
        { type: "rect", x: x - width - 2, y: thumbY,  width, height: thumb, color: theme.color("border") },
    ];
}
