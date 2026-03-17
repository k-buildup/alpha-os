/**
 * UI Component — IconGrid
 *
 * Renders a grid of icon tiles with optional hover highlighting.
 * Used by AllApps launcher and Desktop icons.
 */

import type { DrawCommand } from "../../types/index.js";
import { Theme } from "../Theme.js";
import { Fonts } from "../Theme.js";

const h = Theme.hex;

export interface IconTile {
    icon:    string;
    label:   string;
    color:   string;
}

export interface IconGridSpec {
    x:        number;
    y:        number;
    cols:     number;
    iconSize: number;
    gap:      number;
    items:    IconTile[];
    hoveredIdx?: number;
}

export interface IconGridLayout {
    spec: IconGridSpec;
    /** Hit-test: returns index or -1 */
    hitTest(mx: number, my: number): number;
}

function tilePosition(spec: IconGridSpec, i: number): { ix: number; iy: number } {
    const { x, y, cols, iconSize, gap } = spec;
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
        ix: x + col * (iconSize + gap),
        iy: y + row * (iconSize + 28 + gap),
    };
}

export function renderIconGrid(spec: IconGridSpec, theme: Theme): DrawCommand[] {
    const { iconSize, items, hoveredIdx = -1 } = spec;
    const cmds: DrawCommand[] = [];

    items.forEach((item, i) => {
        const { ix, iy } = tilePosition(spec, i);
        const hover = hoveredIdx === i;

        cmds.push(
            // Hover background
            { type: "rect", x: ix - 6, y: iy - 6, width: iconSize + 12, height: iconSize + 30,
              color: hover ? theme.color("muted") : theme.color("bg") },
            // Icon background box
            { type: "rect", x: ix, y: iy, width: iconSize, height: iconSize,
              color: h(item.color) },
            // Icon emoji
            { type: "text",
              x: ix + Math.round(iconSize * 0.22),
              y: iy + Math.round(iconSize * 0.62),
              text: item.icon,
              font: Fonts.emoji(Math.round(iconSize * 0.42)),
              color: h("#ffffff") },
            // Label (centered below)
            { type: "text",
              x: ix + iconSize / 2 - item.label.length * 3,
              y: iy + iconSize + 16,
              text: item.label,
              font: Fonts.ui(11),
              color: theme.color("text3") },
        );
    });

    return cmds;
}

export function iconGridHitTest(spec: IconGridSpec, mx: number, my: number): number {
    const { iconSize, items } = spec;
    for (let i = 0; i < items.length; i++) {
        const { ix, iy } = tilePosition(spec, i);
        if (mx >= ix - 6 && mx <= ix + iconSize + 6 &&
            my >= iy - 6 && my <= iy + iconSize + 30) {
            return i;
        }
    }
    return -1;
}
