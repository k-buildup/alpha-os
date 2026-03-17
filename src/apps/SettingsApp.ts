/**
 * SettingsApp — System settings
 *
 * SRP: Manage appearance (dark/light, wallpaper) and display settings.
 */

import type { IApp } from "./IApp.js";
import type { KernelServices } from "../services/KernelServices.js";
import type { DrawCommand, InputEvent, MouseEventData } from "../types/index.js";
import { Theme } from "../ui/Theme.js";
import { Fonts, SemanticColors } from "../ui/Theme.js";
import { renderToggle, hitTestToggle, type ToggleSpec } from "../ui/components/Toggle.js";

const h = Theme.hex;

const WALLPAPER_IDS = ["default", "blue", "green", "purple", "warm"];
const WP_COLORS = ["#eef0f3", "#dbeafe", "#dcfce7", "#f3e8ff", "#fef9c3"];
const WP_LABELS = ["Default", "Blue", "Green", "Purple", "Warm"];

export class SettingsApp implements IApp {
    readonly appId = "settings";
    private readonly windows = new Set<number>();
    private page = 0;
    private wallpaperIdx = 0;

    /** Called from AppRegistry when theme changes externally */
    private onThemeChanged: (() => void) | null = null;

    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
    ) {}

    setOnThemeChanged(fn: () => void): void { this.onThemeChanged = fn; }

    ownsWindow(id: number): boolean { return this.windows.has(id); }

    open(): number {
        const id = this.svc.createWindow({
            title: "Settings", x: 200, y: 90, width: 520, height: 400,
            ownerPID: 1, backgroundColor: this.theme.palette.bg,
            minWidth: 380, minHeight: 300,
        });
        this.windows.add(id);
        this.render(id);

        const win = this.svc.getWindow(id);
        win?.on("resize", () => this.render(id));
        win?.on("input", (e: InputEvent) => {
            if (e.type !== "mousedown") return;
            const m = e.data as MouseEventData;
            this.handleClick(id, m.x, m.y);
        });
        return id;
    }

    destroy(winId: number): void { this.windows.delete(winId); }

    render(winId: number): void {
        const win = this.svc.getWindow(winId);
        if (!win) return;
        const W = win.bounds.width, H = win.bounds.height;
        const SB = 130, CX = SB + 20;
        const A2G = (sz: number, wt = 400) => Fonts.ui(sz, wt);

        const cmds: DrawCommand[] = [
            { type: "rect", x: 0, y: 0, width: SB, height: H, color: this.theme.color("surface") },
            { type: "line", x: SB, y: 0, x2: SB, y2: H, color: this.theme.color("border") },
            { type: "text", x: 14, y: 30, text: "⚙  Settings", font: A2G(13, 600), color: this.theme.color("text") },
        ];

        // Sidebar pages
        const pages = ["Appearance", "Display"];
        pages.forEach((pg, i) => {
            const by = 48 + i * 36;
            const active = this.page === i;
            if (active) cmds.push({ type: "rect", x: 6, y: by, width: SB - 12, height: 28, color: this.theme.color("muted") });
            cmds.push({ type: "text", x: 14, y: by + 18, text: pg, font: A2G(13), color: active ? this.theme.color("text") : this.theme.color("text3") });
        });

        // Content area
        cmds.push({ type: "rect", x: SB, y: 0, width: W - SB, height: H, color: this.theme.color("bg") });

        switch (this.page) {
            case 0: { // Appearance
                cmds.push(
                    { type: "text", x: CX, y: 30, text: "Appearance", font: A2G(14, 600), color: this.theme.color("text") },
                    { type: "line", x: CX, y: 38, x2: W - 20, y2: 38, color: this.theme.color("muted") },
                );

                // Color mode toggle
                cmds.push(
                    { type: "text", x: CX, y: 65, text: "Color Mode", font: A2G(13), color: this.theme.color("text") },
                    { type: "text", x: CX, y: 82, text: this.theme.isDark ? "Dark" : "Light", font: A2G(11), color: this.theme.color("text3") },
                );
                const toggle: ToggleSpec = { x: W - 80, y: 70, on: this.theme.isDark };
                cmds.push(...renderToggle(toggle, this.theme));

                // Wallpaper swatches
                cmds.push({ type: "text", x: CX, y: 122, text: "Wallpaper", font: A2G(13), color: this.theme.color("text") });
                WP_COLORS.forEach((col, i) => {
                    const wx = CX + i * 60, wy = 140;
                    const active = this.wallpaperIdx === i;
                    cmds.push({ type: "rect", x: wx, y: wy, width: 48, height: 48, color: h(col) });
                    if (active) {
                        // Border highlight
                        cmds.push(
                            { type: "line", x: wx - 3, y: wy - 3, x2: wx + 49, y2: wy - 3, color: h(SemanticColors.cursorColor) },
                            { type: "line", x: wx - 3, y: wy + 49, x2: wx + 49, y2: wy + 49, color: h(SemanticColors.cursorColor) },
                            { type: "line", x: wx - 3, y: wy - 3, x2: wx - 3, y2: wy + 49, color: h(SemanticColors.cursorColor) },
                            { type: "line", x: wx + 49, y: wy - 3, x2: wx + 49, y2: wy + 49, color: h(SemanticColors.cursorColor) },
                        );
                    }
                    cmds.push({ type: "text", x: wx + 24 - WP_LABELS[i].length * 3, y: wy + 62, text: WP_LABELS[i], font: A2G(9), color: this.theme.color("text3") });
                });
                cmds.push({ type: "text", x: CX, y: 226, text: "Click a swatch to change desktop background", font: A2G(10), color: this.theme.color("text3") });
                break;
            }
            case 1: { // Display
                cmds.push(
                    { type: "text", x: CX, y: 30, text: "Display", font: A2G(14, 600), color: this.theme.color("text") },
                    { type: "line", x: CX, y: 38, x2: W - 20, y2: 38, color: this.theme.color("muted") },
                );
                const info = this.svc.getSystemStatus();
                const rows: [string, string][] = [
                    ["Resolution", `${info.displayWidth} × ${info.displayHeight}`],
                    ["Refresh Rate", `${info.tickRate} Hz`],
                    ["Color Profile", "sRGB"],
                    ["Font", "에이투지체 (A2G)"],
                ];
                let dy = 60;
                rows.forEach(([l, v]) => {
                    cmds.push(
                        { type: "text", x: CX, y: dy, text: l, font: A2G(12), color: this.theme.color("text3") },
                        { type: "text", x: CX + 180, y: dy, text: v, font: A2G(13), color: this.theme.color("text") },
                    );
                    dy += 30;
                });
                break;
            }
        }

        win.submitCommands(cmds);
    }

    private handleClick(winId: number, lx: number, ly: number): void {
        const SB = 130, CX = SB + 20;
        const win = this.svc.getWindow(winId);
        if (!win) return;
        const W = win.bounds.width;

        // Sidebar page selection
        if (lx < SB) {
            const pages = ["Appearance", "Display"];
            const i = Math.floor((ly - 48) / 36);
            if (i >= 0 && i < pages.length) { this.page = i; this.render(winId); }
            return;
        }

        switch (this.page) {
            case 0: {
                // Dark/light toggle
                if (hitTestToggle({ x: W - 80, y: 70, on: this.theme.isDark }, lx, ly)) {
                    this.theme.isDark = !this.theme.isDark;
                    this.svc.emit("theme_change", { dark: this.theme.isDark });
                    this.render(winId);
                    this.onThemeChanged?.();
                }
                // Wallpaper swatches
                if (ly >= 140 && ly < 200) {
                    const idx = Math.floor((lx - CX) / 60);
                    if (idx >= 0 && idx < WALLPAPER_IDS.length) {
                        this.wallpaperIdx = idx;
                        this.svc.emit("wallpaper_change", { id: WALLPAPER_IDS[idx] });
                        this.render(winId);
                    }
                }
                break;
            }
        }
    }
}
