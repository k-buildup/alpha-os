/**
 * DesktopApp — Desktop icon layer
 *
 * Renders desktop file/folder icons and dock app icons.
 * Watches for file changes and auto-refreshes.
 */

import type { IApp } from "./IApp.js";
import type { KernelServices, } from "../services/KernelServices.js";
import { readDirClean, joinPath } from "../services/KernelServices.js";
import { fileIcon, isProtectedPath, deleteEntry } from "../services/FileService.js";
import type { DrawCommand, InputEvent, MouseEventData, DirEntry } from "../types/index.js";
import type { Theme } from "../ui/Theme.js";
import { Fonts, SemanticColors } from "../ui/Theme.js";
import type { AppRegistry } from "./AppRegistry.js";
import { RenameDialog } from "./RenameDialog.js";

const h = (s: string) => s as `#${string}`;

// Layout constants
const PAD = 16, IW = 72, IH = 72, SLOT = 100;

export const DOCK_APPS = [
    { id: "files",    icon: "📁", label: "Files",    color: "#3b82f6" },
    { id: "terminal", icon: "💻", label: "Terminal",  color: "#18181b" },
    { id: "settings", icon: "⚙️",  label: "Settings", color: "#6366f1" },
    { id: "allapps",  icon: "◉",  label: "All Apps", color: "#71717a" },
] as const;

export class DesktopApp implements IApp {
    readonly appId = "desktop";
    private winId = -1;
    private cachedFiles: string[] = [];

    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
        private readonly registry: AppRegistry,
    ) {}

    ownsWindow(id: number): boolean { return id === this.winId; }

    render(winId: number): void {
        this.winId = winId;
        const win = this.svc.getWindow(winId);
        if (!win) return;
        const W = win.bounds.width, H = win.bounds.height;

        const entries = readDirClean(this.svc.vfs, "/home/user/Desktop");
        this.cachedFiles = entries.map(e => e.name);

        const cmds: DrawCommand[] = [
            { type: "rect", x: 0, y: 0, width: W, height: H, color: h("transparent") },
        ];

        entries.forEach((entry, i) => {
            const col = Math.floor(i / 8);
            const row = i % 8;
            const ix = PAD + col * (IW + 20);
            const iy = PAD + row * SLOT;
            const isDir = entry.type === "DIRECTORY";
            const icon = isDir ? "📁" : fileIcon(entry.name);
            const label = entry.name.length > 10 ? entry.name.slice(0, 9) + "…" : entry.name;
            const labelX = ix + IW / 2 - Math.min(label.length, 10) * 3.2;

            cmds.push(
                { type: "rect", x: ix, y: iy, width: IW, height: IH, color: h("rgba(255,255,255,0.7)") },
                { type: "text", x: ix + 16, y: iy + 46, text: icon, font: Fonts.emoji(30), color: h("#18181b") },
                { type: "rect", x: ix - 2, y: iy + IH + 3, width: IW + 4, height: 18, color: h("rgba(0,0,0,0.0)") },
                { type: "text", x: Math.round(labelX), y: iy + IH + 15, text: label, font: Fonts.ui(11), color: this.theme.color("text") },
            );
        });

        win.submitCommands(cmds);
    }

    tickRender(): void {
        if (this.winId < 0) return;
        if (!this.svc.getWindow(this.winId)) { this.winId = -1; return; }
        // File-change watch
        const files = readDirClean(this.svc.vfs, "/home/user/Desktop").map(e => e.name);
        const changed = files.length !== this.cachedFiles.length ||
            files.some((f, i) => f !== this.cachedFiles[i]);
        if (changed) this.render(this.winId);
    }

    destroy(_winId: number): void { this.winId = -1; }

    // ─── Click handling ──────────────────────────────────────────────────────

    handleClick(x: number, y: number): void {
        const entries = readDirClean(this.svc.vfs, "/home/user/Desktop");

        // Icon clicks
        for (let i = 0; i < entries.length; i++) {
            const col = Math.floor(i / 8), row = i % 8;
            const ix = PAD + col * (IW + 20), iy = PAD + row * SLOT;
            if (x >= ix && x <= ix + IW && y >= iy && y <= iy + IH + 20) {
                const fullPath = "/home/user/Desktop/" + entries[i].name;
                if (entries[i].type === "DIRECTORY") {
                    this.registry.openFileExplorer(fullPath);
                } else {
                    this.registry.openTextEditor(fullPath);
                }
                return;
            }
        }

        // Dock clicks
        const W = this.svc.displayWidth;
        const dockIW = 72, IX = W - dockIW - 18;
        DOCK_APPS.forEach((app, i) => {
            const iy = 20 + i * (dockIW + 10);
            if (x >= IX - 4 && x <= IX + dockIW + 4 && y >= iy - 4 && y <= iy + dockIW + 4) {
                if (app.id === "files")    this.registry.openFileExplorer("/home/user");
                else if (app.id === "settings") this.registry.openSettings();
                else if (app.id === "terminal") this.registry.openTerminal();
                else if (app.id === "allapps")  this.registry.openAllApps();
            }
        });
    }

    // ─── Context menu ────────────────────────────────────────────────────────

    buildContextMenu(
        clickX: number, clickY: number,
    ): Array<{ label: string; action?: () => void; danger?: boolean }> {
        const entries = readDirClean(this.svc.vfs, "/home/user/Desktop");

        for (let i = 0; i < entries.length; i++) {
            const col = Math.floor(i / 8), row = i % 8;
            const ix = PAD + col * (IW + 20), iy = PAD + row * SLOT;
            if (clickX >= ix && clickX <= ix + IW && clickY >= iy && clickY <= iy + IH + 20) {
                const entry = entries[i];
                const fullPath = "/home/user/Desktop/" + entry.name;
                const isDir = entry.type === "DIRECTORY";
                const prot = isProtectedPath(fullPath);
                return [
                    { label: entry.name },
                    { label: "---" },
                    ...(isDir
                        ? [{ label: "Open", action: () => this.registry.openFileExplorer(fullPath) }]
                        : [{ label: "Open", action: () => this.registry.openTextEditor(fullPath) }]),
                    ...(!prot ? [
                        { label: "Rename…", action: () => {
                            new RenameDialog(this.svc, this.theme, this.registry.clipboard)
                                .open(entry.name, "/home/user/Desktop", () => {});
                        }},
                        { label: "---" },
                        { label: "Delete", action: () => deleteEntry(this.svc.vfs, fullPath), danger: true },
                    ] : []),
                ];
            }
        }

        // Background menu
        return [
            { label: "New File", action: () => this.registry.openNewTextEditor("/home/user/Desktop") },
            { label: "New Folder", action: () => {
                const base = "/home/user/Desktop/New Folder";
                let p = base, n = 1;
                while (true) { try { this.svc.vfs.stat(p); p = `${base} ${++n}`; } catch { break; } }
                try { this.svc.vfs.mkdir(p); } catch { /* */ }
            }},
            { label: "---" },
            { label: "Open Files", action: () => this.registry.openFileExplorer("/home/user/Desktop") },
            { label: "New Terminal", action: () => this.registry.openTerminal() },
            { label: "---" },
            { label: "Settings", action: () => this.registry.openSettings() },
        ];
    }
}
