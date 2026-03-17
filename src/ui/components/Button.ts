/**
 * UI Component — Button
 *
 * Renders a button (rect + label) and provides hit-testing.
 * Supports variants: primary, danger, outline, ghost.
 */

import type { DrawCommand, ColorHex } from "../../types/index.js";
import { Theme, Fonts, SemanticColors } from "../Theme.js";

export type ButtonVariant = "primary" | "danger" | "outline" | "ghost";

export interface ButtonSpec {
    x:       number;
    y:       number;
    width:   number;
    height:  number;
    label:   string;
    variant?: ButtonVariant;
    fontSize?: number;
    fontWeight?: number;
}

const h = Theme.hex;

export function renderButton(btn: ButtonSpec, theme: Theme): DrawCommand[] {
    const { x, y, width, height, label, variant = "primary", fontSize = 12, fontWeight = 600 } = btn;
    const pal = theme.palette;
    const cmds: DrawCommand[] = [];

    let bgColor: string;
    let textColor: string;
    let borderColor: string | null = null;

    switch (variant) {
        case "primary":
            bgColor   = pal.text;
            textColor = pal.bg;
            break;
        case "danger":
            bgColor   = SemanticColors.danger;
            textColor = SemanticColors.white;
            break;
        case "outline":
            bgColor     = pal.surface;
            textColor   = pal.text;
            borderColor = pal.border;
            break;
        case "ghost":
            bgColor   = pal.muted;
            textColor = pal.text;
            break;
    }

    cmds.push({ type: "rect", x, y, width, height, color: h(bgColor) });

    if (borderColor) {
        cmds.push(
            { type: "line", x,         y,          x2: x + width, y2: y,          color: h(borderColor) },
            { type: "line", x,         y: y + height, x2: x + width, y2: y + height, color: h(borderColor) },
            { type: "line", x,         y,          x2: x,         y2: y + height, color: h(borderColor) },
            { type: "line", x: x + width, y,       x2: x + width, y2: y + height, color: h(borderColor) },
        );
    }

    // Center text approximately
    const textX = Math.round(x + width / 2 - label.length * (fontSize * 0.33));
    const textY = Math.round(y + height / 2 + fontSize * 0.35);
    cmds.push({
        type: "text", x: textX, y: textY,
        text: label, font: Fonts.ui(fontSize, fontWeight), color: h(textColor),
    });

    return cmds;
}

export function hitTestButton(btn: ButtonSpec, mx: number, my: number): boolean {
    return mx >= btn.x && mx < btn.x + btn.width &&
           my >= btn.y && my < btn.y + btn.height;
}
