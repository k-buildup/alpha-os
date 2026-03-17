/**
 * AllAppsLauncher — Application grid launcher
 *
 * SRP: Shows a grid of all available apps. Double-click to open.
 */

import type { IApp } from "./IApp.js";
import type { KernelServices } from "../services/KernelServices.js";
import type { DrawCommand, InputEvent, MouseEventData } from "../types/index.js";
import { Theme } from "../ui/Theme.js";
import { Fonts } from "../ui/Theme.js";
import { renderIconGrid, iconGridHitTest, type IconGridSpec, type IconTile } from "../ui/components/IconGrid.js";
import type { AppRegistry } from "./AppRegistry.js";

const h = Theme.hex;

const APP_TILES: Array<IconTile & { id: string }> = [
    { id: "terminal",     icon: "💻", label: "Terminal",      color: "#18181b" },
    { id: "fileExplorer",  icon: "📁", label: "File Explorer", color: "#f59e0b" },
    { id: "settings",     icon: "⚙️",  label: "Settings",      color: "#6366f1" },
    { id: "textEditor",   icon: "📝", label: "Text Editor",   color: "#3b82f6" },
];

const GRID_COLS = 4, ICON_SZ = 72, GAP = 20, TOP = 52, LEFT = 24;

export class AllAppsLauncher implements IApp {
    readonly appId = "allApps";
    private readonly windows = new Set<number>();
    private hoveredIdx = new Map<number, number>();

    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
        private readonly registry: AppRegistry,
    ) {}

    ownsWindow(id: number): boolean { return this.windows.has(id); }

    open(): number {
        const id = this.svc.createWindow({
            title: "Applications",
            x: 180, y: 100, width: 520, height: 360,
            ownerPID: 1, backgroundColor: this.theme.palette.bg,
            minWidth: 360, minHeight: 260,
        });
        this.windows.add(id);
        this.hoveredIdx.set(id, -1);
        this.render(id);

        const win = this.svc.getWindow(id);
        win?.on("resize", () => this.render(id));
        win?.on("input", (e: InputEvent) => this.handleInput(id, e));
        return id;
    }

    destroy(winId: number): void {
        this.windows.delete(winId);
        this.hoveredIdx.delete(winId);
    }

    render(winId: number): void {
        const win = this.svc.getWindow(winId);
        if (!win) return;
        const W = win.bounds.width, H = win.bounds.height;
        const hovered = this.hoveredIdx.get(winId) ?? -1;

        const gridSpec: IconGridSpec = {
            x: LEFT, y: TOP, cols: GRID_COLS,
            iconSize: ICON_SZ, gap: GAP,
            items: APP_TILES, hoveredIdx: hovered,
        };

        const cmds: DrawCommand[] = [
            { type: "rect", x: 0, y: 0, width: W, height: H, color: this.theme.color("bg") },
            { type: "text", x: LEFT, y: 30, text: "All Applications", font: Fonts.ui(14, 600), color: this.theme.color("text") },
            { type: "line", x: LEFT, y: 40, x2: W - LEFT, y2: 40, color: this.theme.color("muted") },
            ...renderIconGrid(gridSpec, this.theme),
            { type: "text", x: LEFT, y: H - 14, text: "Double-click to open", font: Fonts.ui(11), color: this.theme.color("border") },
        ];
        win.submitCommands(cmds);
    }

    private handleInput(winId: number, e: InputEvent): void {
        const gridSpec: IconGridSpec = {
            x: LEFT, y: TOP, cols: GRID_COLS,
            iconSize: ICON_SZ, gap: GAP,
            items: APP_TILES,
        };

        if (e.type === "mousemove") {
            const m = e.data as MouseEventData;
            const found = iconGridHitTest(gridSpec, m.x, m.y);
            const prev = this.hoveredIdx.get(winId) ?? -1;
            if (found !== prev) {
                this.hoveredIdx.set(winId, found);
                this.render(winId);
            }
            return;
        }

        if (e.type !== "mousedown") return;
        const m = e.data as MouseEventData;
        const hit = iconGridHitTest(gridSpec, m.x, m.y);
        if (hit < 0) return;

        // Double-click detection
        const st = this as unknown as { _lc?: number; _li?: number };
        const now = Date.now();
        if (st._li === hit && st._lc && now - st._lc < 500) {
            this.launchApp(hit);
            st._lc = 0; st._li = -1;
        } else {
            st._lc = now; st._li = hit;
        }
    }

    private launchApp(idx: number): void {
        const app = APP_TILES[idx];
        if (!app) return;
        switch (app.id) {
            case "terminal":     this.registry.openTerminal(); break;
            case "fileExplorer": this.registry.openFileExplorer(); break;
            case "settings":     this.registry.openSettings(); break;
            case "textEditor":   this.registry.openNewTextEditor(); break;
        }
    }
}
