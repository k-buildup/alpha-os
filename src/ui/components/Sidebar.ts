/**
 * UI Component — Sidebar
 *
 * Renders a list of bookmark items with an active indicator.
 */

import type { DrawCommand } from "../../types/index.js";
import type { Theme } from "../Theme.js";
import { Fonts } from "../Theme.js";

export interface SidebarItem {
    label: string;
    path:  string;
}

export const DEFAULT_BOOKMARKS: SidebarItem[] = [
    { label: "Home",      path: "/home/user" },
    { label: "Documents", path: "/home/user/Documents" },
    { label: "Downloads", path: "/home/user/Downloads" },
    { label: "Desktop",   path: "/home/user/Desktop" },
    { label: "Root",      path: "/" },
];

export interface SidebarSpec {
    x:          number;
    topY:       number;
    width:      number;
    height:     number;
    items:      SidebarItem[];
    activePath: string;
    rowHeight?: number;
}

export function renderSidebar(spec: SidebarSpec, theme: Theme): DrawCommand[] {
    const { x, topY, width, height, items, activePath, rowHeight = 30 } = spec;
    const cmds: DrawCommand[] = [
        { type: "rect", x, y: topY, width, height, color: theme.color("surface") },
        { type: "line", x: x + width, y: topY, x2: x + width, y2: topY + height, color: theme.color("border") },
    ];

    items.forEach((item, i) => {
        const by = topY + 8 + i * rowHeight;
        const active = activePath === item.path;
        if (active) {
            cmds.push({ type: "rect", x: x + 6, y: by - 2, width: width - 12, height: 26, color: theme.color("muted") });
        }
        cmds.push({
            type: "text", x: x + 14, y: by + 15,
            text: item.label, font: Fonts.ui(13),
            color: active ? theme.color("text") : theme.color("text3"),
        });
    });

    return cmds;
}

/**
 * Returns the index of the clicked bookmark, or -1.
 */
export function hitTestSidebar(spec: SidebarSpec, mx: number, my: number): number {
    const { x, topY, width, items, rowHeight = 30 } = spec;
    if (mx < x || mx > x + width) return -1;
    const idx = Math.floor((my - topY - 8) / rowHeight);
    if (idx >= 0 && idx < items.length) return idx;
    return -1;
}
