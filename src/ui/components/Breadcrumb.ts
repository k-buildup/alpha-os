/**
 * UI Component — Breadcrumb
 *
 * Renders a path as "/ home / user / Documents" breadcrumb trail.
 */

import type { DrawCommand } from "../../types/index.js";
import type { Theme } from "../Theme.js";
import { Fonts } from "../Theme.js";

export interface BreadcrumbSpec {
    x:    number;
    y:    number;
    path: string;
    charWidth?: number;
}

export function renderBreadcrumb(spec: BreadcrumbSpec, theme: Theme): DrawCommand[] {
    const { x, y, path, charWidth = 7.5 } = spec;
    const CW = charWidth;
    const cmds: DrawCommand[] = [];
    const parts = path.split("/").filter(Boolean);
    let bx = x;

    // Root "/"
    cmds.push({
        type: "text", x: bx, y,
        text: "/", font: Fonts.ui(13),
        color: parts.length === 0 ? theme.color("text") : theme.color("text3"),
    });
    bx += Math.round(CW) + 2;

    parts.forEach((part, i) => {
        const isLast = i === parts.length - 1;
        cmds.push({ type: "text", x: bx, y, text: " / ", font: Fonts.ui(13), color: theme.color("border") });
        bx += Math.round(CW * 3);
        cmds.push({
            type: "text", x: bx, y, text: part, font: Fonts.ui(13),
            color: isLast ? theme.color("text") : theme.color("text3"),
        });
        bx += Math.round(part.length * CW) + 2;
    });

    return cmds;
}
