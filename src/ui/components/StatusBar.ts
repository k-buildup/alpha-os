/**
 * UI Component — StatusBar
 *
 * A thin strip at the bottom of a window showing status text.
 */

import type { DrawCommand } from "../../types/index.js";
import type { Theme } from "../Theme.js";
import { Fonts } from "../Theme.js";

export interface StatusBarSpec {
    /** Full window width */
    width:  number;
    /** Full window height */
    height: number;
    /** Height of the status bar */
    barHeight?: number;
    /** Left text */
    left?:  string;
    /** Right text */
    right?: string;
    /** Left text X offset */
    leftX?: number;
    /** Right text color override (hex string) */
    rightColor?: string;
}

export function renderStatusBar(spec: StatusBarSpec, theme: Theme): DrawCommand[] {
    const { width, height, barHeight = 22, left, right, leftX = 8, rightColor } = spec;
    const y = height - barHeight;
    const cmds: DrawCommand[] = [
        { type: "rect", x: 0, y, width, height: barHeight, color: theme.color("surface") },
        { type: "line", x: 0, y, x2: width, y2: y, color: theme.color("border") },
    ];
    if (left) {
        cmds.push({
            type: "text", x: leftX, y: height - 7,
            text: left, font: Fonts.ui(11), color: theme.color("text3"),
        });
    }
    if (right) {
        cmds.push({
            type: "text", x: width - 64, y: height - 7,
            text: right, font: Fonts.ui(11),
            color: (rightColor ?? theme.palette.text3) as `#${string}`,
        });
    }
    return cmds;
}
