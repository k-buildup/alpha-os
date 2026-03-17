/**
 * FileExplorerApp — File browser
 *
 * SRP: Renders file listings, handles navigation, selection, deletion.
 * Uses reusable UI components: Sidebar, Breadcrumb, Scrollbar, StatusBar.
 */

import type { IApp } from "./IApp.js";
import type { KernelServices } from "../services/KernelServices.js";
import { readDirClean, sortEntries, joinPath } from "../services/KernelServices.js";
import { fileIcon, isProtectedPath, deleteEntry, formatFileSize, moveEntry } from "../services/FileService.js";
import type { DrawCommand, InputEvent, MouseEventData, KeyboardEventData, DirEntry } from "../types/index.js";
import { Theme } from "../ui/Theme.js";
import { Fonts } from "../ui/Theme.js";
import { renderSidebar, hitTestSidebar, DEFAULT_BOOKMARKS } from "../ui/components/Sidebar.js";
import { renderBreadcrumb } from "../ui/components/Breadcrumb.js";
import { renderScrollbar } from "../ui/components/Scrollbar.js";
import { renderStatusBar } from "../ui/components/StatusBar.js";
import type { AppRegistry } from "./AppRegistry.js";
import { RenameDialog } from "./RenameDialog.js";

const h = Theme.hex;

// Layout constants
const SB = 120, HDR = 36, ROW = 28, STA = 24, COL_PAD = 22;

interface FEState {
    path:     string;
    scroll:   number;
    selected: number | null;
}

export class FileExplorerApp implements IApp {
    readonly appId = "fileExplorer";
    private readonly state = new Map<number, FEState>();

    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
        private readonly registry: AppRegistry,
    ) {}

    ownsWindow(id: number): boolean { return this.state.has(id); }

    open(path = "/home/user"): number {
        const id = this.svc.createWindow({
            title: `Files — ${path}`,
            x: 160, y: 80, width: 580, height: 400,
            ownerPID: 1, backgroundColor: this.theme.palette.bg,
            minWidth: 360, minHeight: 240,
        });
        const st: FEState = { path, scroll: 0, selected: null };
        this.state.set(id, st);
        this.render(id);

        const win = this.svc.getWindow(id)!;
        win.on("input", (e: InputEvent) => this.handleInput(id, e));
        win.on("resize", () => this.render(id));
        return id;
    }

    destroy(winId: number): void { this.state.delete(winId); }

    getState(winId: number): FEState | undefined { return this.state.get(winId); }

    // ─── Rendering ───────────────────────────────────────────────────────────

    render(winId: number): void {
        const win = this.svc.getWindow(winId);
        const st = this.state.get(winId);
        if (!win || !st) return;

        const W = win.bounds.width, H = win.bounds.height;
        const entries = sortEntries(readDirClean(this.svc.vfs, st.path));
        const dirs = entries.filter(e => e.type === "DIRECTORY");
        const files = entries.filter(e => e.type !== "DIRECTORY");
        const maxRows = Math.max(1, Math.floor((H - HDR - STA) / ROW));

        const cmds: DrawCommand[] = [
            { type: "rect", x: 0, y: 0, width: W, height: H, color: this.theme.color("bg") },
            // Header bar
            { type: "rect", x: SB, y: 0, width: W - SB, height: HDR, color: this.theme.color("surface") },
            { type: "line", x: 0, y: HDR, x2: W, y2: HDR, color: this.theme.color("border") },
        ];

        // Sidebar
        cmds.push(...renderSidebar({
            x: 0, topY: 0, width: SB, height: H,
            items: DEFAULT_BOOKMARKS, activePath: st.path,
        }, this.theme));

        // Breadcrumb
        cmds.push(...renderBreadcrumb({ x: SB + 10, y: 23, path: st.path }, this.theme));

        // Column headers
        cmds.push(
            { type: "text", x: SB + COL_PAD + 18, y: HDR + 18, text: "Name", font: Fonts.ui(11), color: this.theme.color("text3") },
            { type: "text", x: W - 70, y: HDR + 18, text: "Size", font: Fonts.ui(11), color: this.theme.color("text3") },
            { type: "line", x: SB, y: HDR + 22, x2: W, y2: HDR + 22, color: this.theme.color("muted") },
        );

        // Entries
        entries.slice(st.scroll, st.scroll + maxRows).forEach((e, vi) => {
            const absIdx = st.scroll + vi;
            const rowY = HDR + 22 + vi * ROW;
            const isDir = e.type === "DIRECTORY";
            const isSel = st.selected === absIdx;

            if (isSel) {
                cmds.push({ type: "rect", x: SB + 1, y: rowY - 2, width: W - SB - 1, height: ROW, color: h(this.theme.selectionBg) });
            } else if (vi % 2) {
                cmds.push({ type: "rect", x: SB + 1, y: rowY - 2, width: W - SB - 1, height: ROW, color: this.theme.color("surface") });
            }

            cmds.push(
                { type: "text", x: SB + COL_PAD - 2, y: rowY + 14, text: isDir ? "📁" : fileIcon(e.name), font: Fonts.emoji(13), color: this.theme.color("text") },
                { type: "text", x: SB + COL_PAD + 18, y: rowY + 14, text: e.name, font: Fonts.ui(13), color: isDir ? this.theme.color("blue") : this.theme.color("text") },
            );
            if (!isDir) {
                const fp = joinPath(st.path, e.name);
                cmds.push({ type: "text", x: W - 68, y: rowY + 14, text: formatFileSize(this.svc.vfs, fp), font: Fonts.ui(12), color: this.theme.color("text3") });
            }
        });

        if (entries.length === 0) {
            cmds.push({ type: "text", x: SB + COL_PAD, y: HDR + 60, text: "(empty)", font: Fonts.ui(13), color: this.theme.color("border") });
        }

        // Scrollbar
        cmds.push(...renderScrollbar({
            x: W, top: HDR, height: H - HDR - STA,
            total: entries.length, visible: maxRows, offset: st.scroll,
        }, this.theme));

        // Status bar
        cmds.push(...renderStatusBar({
            width: W, height: H, leftX: SB + COL_PAD,
            left: `${dirs.length} folder${dirs.length !== 1 ? "s" : ""},  ${files.length} file${files.length !== 1 ? "s" : ""}`,
        }, this.theme));

        win.submitCommands(cmds);
    }

    // ─── Input handling ──────────────────────────────────────────────────────

    private handleInput(winId: number, e: InputEvent): void {
        const st = this.state.get(winId);
        if (!st) return;
        const m = e.data as MouseEventData;

        if (e.type === "mousedown") {
            if ((m as unknown as { button?: number }).button === 2) return;
            this.handleClick(winId, m.x, m.y);
        }
        if (e.type === "wheel") {
            st.scroll = Math.max(0, st.scroll + Math.sign(m.deltaY ?? 0) * 3);
            this.render(winId);
        }
        if (e.type === "keydown") {
            const kd = e.data as KeyboardEventData;
            if ((kd.key === "Delete" || kd.key === "Backspace") && st.selected !== null) {
                this.deleteSelected(winId);
            }
        }
    }

    private handleClick(winId: number, lx: number, ly: number): void {
        const win = this.svc.getWindow(winId);
        const st = this.state.get(winId);
        if (!win || !st) return;
        const H = win.bounds.height;
        const maxRows = Math.max(1, Math.floor((H - HDR - STA) / ROW));

        // Sidebar bookmark click
        const sidebarIdx = hitTestSidebar({
            x: 0, topY: 0, width: SB, height: H,
            items: DEFAULT_BOOKMARKS, activePath: st.path,
        }, lx, ly);
        if (sidebarIdx >= 0) {
            st.path = DEFAULT_BOOKMARKS[sidebarIdx].path;
            st.scroll = 0; st.selected = null;
            win.title = `Files — ${st.path}`;
            this.render(winId);
            return;
        }

        // Entry click
        const rowStart = HDR + 22;
        if (ly < rowStart || ly >= H - STA || lx < SB) return;
        const visIdx = Math.floor((ly - rowStart) / ROW);
        const absIdx = st.scroll + visIdx;
        const entries = sortEntries(readDirClean(this.svc.vfs, st.path));
        if (absIdx < 0 || absIdx >= entries.length) {
            if (st.selected !== null) { st.selected = null; this.render(winId); }
            return;
        }

        const entry = entries[absIdx];
        const fullPath = joinPath(st.path, entry.name);
        if (st.selected === absIdx) {
            if (entry.type === "DIRECTORY") {
                st.path = fullPath; st.scroll = 0; st.selected = null;
                win.title = `Files — ${st.path}`;
            } else {
                this.registry.openTextEditor(fullPath);
                st.selected = null;
            }
        } else {
            st.selected = absIdx;
        }
        this.render(winId);
    }

    private deleteSelected(winId: number): void {
        const st = this.state.get(winId);
        if (!st || st.selected === null) return;
        const entries = sortEntries(readDirClean(this.svc.vfs, st.path));
        const entry = entries[st.selected];
        if (!entry) return;
        const fullPath = joinPath(st.path, entry.name);
        if (deleteEntry(this.svc.vfs, fullPath)) {
            st.selected = null;
            this.render(winId);
        }
    }

    // ─── Context menu (called from renderer) ─────────────────────────────────

    buildContextMenu(winId: number, lx: number, ly: number): Array<{ label: string; action?: () => void; danger?: boolean }> {
        const win = this.svc.getWindow(winId);
        const st = this.state.get(winId);
        if (!win || !st) return [];

        const H = win.bounds.height;
        const rowStart = HDR + 22;
        let hitEntry: DirEntry | null = null;
        let hitIdx = -1;

        if (lx >= SB && ly >= rowStart && ly < H - STA) {
            const visIdx = Math.floor((ly - rowStart) / ROW);
            const absIdx = st.scroll + visIdx;
            const entries = sortEntries(readDirClean(this.svc.vfs, st.path));
            if (absIdx >= 0 && absIdx < entries.length) {
                hitEntry = entries[absIdx];
                hitIdx = absIdx;
            }
        }

        if (hitEntry) {
            const fullPath = joinPath(st.path, hitEntry.name);
            const isDir = hitEntry.type === "DIRECTORY";
            const prot = isProtectedPath(fullPath);
            const entryName = hitEntry.name;

            return [
                { label: entryName },
                { label: "---" },
                ...(isDir
                    ? [{ label: "Open", action: () => { st.path = fullPath; st.scroll = 0; st.selected = null; win.title = `Files — ${st.path}`; this.render(winId); } }]
                    : [{ label: "Open", action: () => this.registry.openTextEditor(fullPath) }]),
                ...(!prot ? [
                    { label: "Rename…", action: () => {
                        new RenameDialog(this.svc, this.theme, this.registry.clipboard)
                            .open(entryName, st.path, () => this.render(winId));
                    }},
                    { label: "---" },
                    { label: "Delete", action: () => { st.selected = hitIdx; this.deleteSelected(winId); }, danger: true },
                ] : []),
            ];
        }

        // Background context menu
        return [
            { label: "New File", action: () => {
                const fp = joinPath(st.path, "untitled.txt");
                try { const fd = this.svc.vfs.open(fp, 0x40 | 0x200, 0); this.svc.vfs.close(fd); this.render(winId); } catch { /* */ }
            }},
            { label: "New Folder", action: () => {
                try { this.svc.vfs.mkdir(joinPath(st.path, "New Folder")); this.render(winId); } catch { /* */ }
            }},
            { label: "---" },
            { label: "Refresh", action: () => this.render(winId) },
        ];
    }

    // ─── Drag & drop support (exposed for AppRegistry) ───────────────────────

    unifiedDrop(msg: {
        srcKind: "fe" | "desktop"; srcWinId: number; srcIdx: number;
        srcPath: string; toWinId: number; dropRowVi: number;
    }): void {
        // Simplified re-implementation: resolves source and destination, then moves
        const entries = sortEntries(readDirClean(this.svc.vfs, this.state.get(msg.srcWinId)?.path ?? "/"));
        const absIdx = msg.srcIdx + (this.state.get(msg.srcWinId)?.scroll ?? 0);
        const entry = entries[absIdx];
        if (!entry) return;

        const srcSt = this.state.get(msg.srcWinId);
        if (!srcSt) return;
        const srcPath = joinPath(srcSt.path, entry.name);

        const toSt = this.state.get(msg.toWinId);
        const dstDir = toSt ? toSt.path : "/home/user/Desktop";
        const dstPath = joinPath(dstDir, entry.name);

        if (srcPath === dstPath || isProtectedPath(srcPath)) return;

        moveEntry(this.svc.vfs, srcPath, dstPath);

        if (srcSt) { srcSt.selected = null; this.render(msg.srcWinId); }
        if (toSt) this.render(msg.toWinId);
    }
}
