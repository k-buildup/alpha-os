/**
 * UI Component — Toggle
 *
 * A pill-shaped on/off switch used in Settings.
 */

import type { DrawCommand } from "../../types/index.js";
import { Theme, SemanticColors } from "../Theme.js";

const h = Theme.hex;

export interface ToggleSpec {
    x:      number;
    y:      number;
    on:     boolean;
    width?:  number;
    height?: number;
}

export function renderToggle(spec: ToggleSpec, theme: Theme): DrawCommand[] {
    const { x, y, on, width = 44, height = 22 } = spec;
    const radius = Math.round(height / 2);
    const circleR = Math.round(height * 0.36);
    const circleX = on ? x + width - radius : x + radius;
    const circleY = y + radius;
    const trackColor = on ? SemanticColors.cursorColor : theme.color("border");

    return [
        { type: "rrect", x, y, width, height, radius, color: h(trackColor) } as unknown as DrawCommand,
        { type: "circle", x: circleX, y: circleY, radius: circleR, color: theme.color("bg") },
    ];
}

export function hitTestToggle(spec: ToggleSpec, mx: number, my: number): boolean {
    const w = spec.width ?? 44;
    const ht = spec.height ?? 22;
    return mx >= spec.x && mx < spec.x + w && my >= spec.y && my < spec.y + ht;
}
