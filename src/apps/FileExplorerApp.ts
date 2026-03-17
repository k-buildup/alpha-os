/**
 * FileExplorerApp — File browser
 *
 * SRP: Renders file listings, handles navigation, selection, deletion.
 * Uses reusable UI components: Sidebar, Breadcrumb, Scrollbar, StatusBar.
 */

import type { IApp } from "./IApp.js";
import type { KernelServices } from "../services/KernelServices.js";
import { readDirClean, sortEntries, joinPath } from "../services/KernelServices.js";
import { fileIcon, isProtectedPath, deleteEntry, formatFileSize, moveEntry, pathExists } from "../services/FileService.js";
import type { DrawCommand, InputEvent, MouseEventData, KeyboardEventData, DirEntry } from "../types/index.js";
import { Theme } from "../ui/Theme.js";
import { Fonts } from "../ui/Theme.js";
import { renderSidebar, hitTestSidebar, DEFAULT_BOOKMARKS } from "../ui/components/Sidebar.js";
import { renderBreadcrumb } from "../ui/components/Breadcrumb.js";
import { renderScrollbar } from "../ui/components/Scrollbar.js";
import { renderStatusBar } from "../ui/components/StatusBar.js";
import { showConflict } from "../ui/components/Modal.js";
import type { AppRegistry } from "./AppRegistry.js";
import { RenameDialog } from "./RenameDialog.js";

const h = Theme.hex;

// Layout constants
const SB = 120, HDR = 36, ROW = 28, STA = 24, COL_PAD = 22;

interface FEState {
    path:         string;
    scroll:       number;
    selected:     number | null;   // "primary" selected (for open-on-2nd-click)
    selectedSet:  Set<number>;     // all highlighted indices (multi-select)
    lastSelected: number | null;   // anchor for shift-click range
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
        const st: FEState = { path, scroll: 0, selected: null, selectedSet: new Set(), lastSelected: null };
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
            const isSel = st.selectedSet.has(absIdx);

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
        const selCount = st.selectedSet.size;
        const selText = selCount > 1 ? `  ·  ${selCount} selected` : selCount === 1 ? "  ·  1 selected" : "";
        cmds.push(...renderStatusBar({
            width: W, height: H, leftX: SB + COL_PAD,
            left: `${dirs.length} folder${dirs.length !== 1 ? "s" : ""},  ${files.length} file${files.length !== 1 ? "s" : ""}${selText}`,
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
            const ctrl  = (m as unknown as { ctrl?:  boolean }).ctrl  ?? false;
            const shift = (m as unknown as { shift?: boolean }).shift ?? false;
            const dbl   = (m as unknown as { dbl?:   boolean }).dbl   ?? false;
            this.handleClick(winId, m.x, m.y, ctrl, shift, dbl);
        }
        if (e.type === "wheel") {
            st.scroll = Math.max(0, st.scroll + Math.sign(m.deltaY ?? 0) * 3);
            this.render(winId);
        }
        if (e.type === "keydown") {
            const kd = e.data as KeyboardEventData;
            if ((kd.key === "Delete" || kd.key === "Backspace") && st.selectedSet.size > 0) {
                this.deleteSelected(winId);
            }
        }
    }

    private handleClick(winId: number, lx: number, ly: number, ctrl = false, shift = false, dbl = false): void {
        const win = this.svc.getWindow(winId);
        const st = this.state.get(winId);
        if (!win || !st) return;
        const H = win.bounds.height;

        // Sidebar bookmark click
        const sidebarIdx = hitTestSidebar({
            x: 0, topY: 0, width: SB, height: H,
            items: DEFAULT_BOOKMARKS, activePath: st.path,
        }, lx, ly);
        if (sidebarIdx >= 0) {
            st.path = DEFAULT_BOOKMARKS[sidebarIdx].path;
            st.scroll = 0; st.selected = null;
            st.selectedSet.clear(); st.lastSelected = null;
            win.title = `Files — ${st.path}`;
            this.render(winId);
            return;
        }

        // Entry click
        const rowStart = HDR + 22;
        if (ly < rowStart || ly >= H - STA || lx < SB) {
            if (!ctrl && !shift) {
                st.selected = null; st.selectedSet.clear(); st.lastSelected = null;
                this.render(winId);
            }
            return;
        }
        const visIdx = Math.floor((ly - rowStart) / ROW);
        const absIdx = st.scroll + visIdx;
        const entries = sortEntries(readDirClean(this.svc.vfs, st.path));
        if (absIdx < 0 || absIdx >= entries.length) {
            if (!ctrl && !shift) {
                st.selected = null; st.selectedSet.clear(); st.lastSelected = null;
                this.render(winId);
            }
            return;
        }

        const entry = entries[absIdx];
        const fullPath = joinPath(st.path, entry.name);

        // Double click → open immediately
        if (dbl) {
            if (entry.type === "DIRECTORY") {
                st.path = fullPath; st.scroll = 0; st.selected = null;
                st.selectedSet.clear(); st.lastSelected = null;
                win.title = `Files — ${st.path}`;
            } else {
                this.registry.openTextEditor(fullPath);
                st.selected = null; st.selectedSet.clear();
            }
            this.render(winId);
            return;
        }

        if (ctrl) {
            // Toggle this item
            if (st.selectedSet.has(absIdx)) {
                st.selectedSet.delete(absIdx);
                if (st.selected === absIdx) st.selected = st.selectedSet.size > 0 ? [...st.selectedSet][st.selectedSet.size - 1] : null;
            } else {
                st.selectedSet.add(absIdx);
                st.selected = absIdx;
                st.lastSelected = absIdx;
            }
        } else if (shift && st.lastSelected !== null) {
            // Range select from lastSelected to absIdx
            const lo = Math.min(st.lastSelected, absIdx);
            const hi = Math.max(st.lastSelected, absIdx);
            for (let i = lo; i <= hi; i++) st.selectedSet.add(i);
            st.selected = absIdx;
        } else {
            // Plain single click — always select this item (no "second click opens" on mousedown)
            // Opening happens only on double-click (dbl=true path above)
            if (!st.selectedSet.has(absIdx) || st.selectedSet.size > 1) {
                // Different item or multi-select → fresh single selection
                st.selectedSet.clear();
                st.selectedSet.add(absIdx);
                st.selected = absIdx;
                st.lastSelected = absIdx;
            } else {
                // Same single item clicked again → keep selected (will open on dblclick)
                st.selected = absIdx;
            }
        }
        this.render(winId);
    }

    private deleteSelected(winId: number): void {
        const st = this.state.get(winId);
        if (!st || st.selectedSet.size === 0) return;
        const entries = sortEntries(readDirClean(this.svc.vfs, st.path));
        // Sort descending so indices stay valid as items are deleted
        const toDelete = [...st.selectedSet].sort((a, b) => b - a);
        for (const idx of toDelete) {
            const entry = entries[idx];
            if (!entry) continue;
            deleteEntry(this.svc.vfs, joinPath(st.path, entry.name));
        }
        st.selected = null; st.selectedSet.clear(); st.lastSelected = null;
        this.render(winId);
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
                    { label: "Delete", action: () => { st.selectedSet.clear(); st.selectedSet.add(hitIdx); st.selected = hitIdx; this.deleteSelected(winId); }, danger: true },
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
        desktopSelectedIndices?: number[];   // for multi-select desktop drag
    }): void {
        type MoveItem = { srcPath: string; name: string };

        // ── 1. Resolve source items ──────────────────────────────────────────
        const items: MoveItem[] = [];

        if (msg.srcKind === "desktop") {
            // Desktop renders WITHOUT sortEntries — match that order exactly
            const allDesktop = readDirClean(this.svc.vfs, "/home/user/Desktop");

            // Multi-select: if selectedIndices includes the dragged item, move all of them
            const sel = msg.desktopSelectedIndices ?? [];
            const useMulti = sel.length > 1 && sel.includes(msg.srcIdx);
            const indices = useMulti ? sel : [msg.srcIdx];

            for (const idx of indices) {
                const entry = allDesktop[idx];
                if (entry) items.push({ srcPath: joinPath("/home/user/Desktop", entry.name), name: entry.name });
            }
        } else {
            const srcSt = this.state.get(msg.srcWinId);
            if (!srcSt) return;
            const entries = sortEntries(readDirClean(this.svc.vfs, srcSt.path));
            const absIdx  = msg.srcIdx + srcSt.scroll;

            // Multi-select: if the dragged row is inside the selectedSet, move everything in it
            if (srcSt.selectedSet.has(absIdx) && srcSt.selectedSet.size > 1) {
                for (const idx of [...srcSt.selectedSet]) {
                    const entry = entries[idx];
                    if (entry) items.push({ srcPath: joinPath(srcSt.path, entry.name), name: entry.name });
                }
            } else {
                const entry = entries[absIdx];
                if (!entry) return;
                items.push({ srcPath: joinPath(srcSt.path, entry.name), name: entry.name });
            }
        }

        if (items.length === 0) return;

        // Filter protected paths
        const moveItems = items.filter(item => !isProtectedPath(item.srcPath));
        if (moveItems.length === 0) return;

        // ── 2. Resolve destination directory ─────────────────────────────────
        const toSt  = this.state.get(msg.toWinId);
        let   dstDir = toSt ? toSt.path : "/home/user/Desktop";

        // If dropped ON a specific row that is a DIRECTORY → move inside that folder
        if (toSt && msg.dropRowVi >= 0) {
            const toEntries  = sortEntries(readDirClean(this.svc.vfs, toSt.path));
            const absDropIdx = toSt.scroll + msg.dropRowVi;
            const dropEntry  = toEntries[absDropIdx];
            if (dropEntry && dropEntry.type === "DIRECTORY") {
                const candidateDir = joinPath(toSt.path, dropEntry.name);
                // Don't drop into one of the items being moved
                const srcSet = new Set(moveItems.map(i => i.srcPath));
                if (!srcSet.has(candidateDir)) {
                    dstDir = candidateDir;
                }
            }
        }

        // Filter same-location no-ops
        const realMoves = moveItems.filter(item => item.srcPath !== joinPath(dstDir, item.name));
        if (realMoves.length === 0) return;

        // ── 3. Check for overwrite conflicts ──────────────────────────────────
        const conflicts = realMoves.filter(item =>
            pathExists(this.svc.vfs, joinPath(dstDir, item.name)).exists
        );

        const executeMove = () => {
            for (const item of realMoves) {
                moveEntry(this.svc.vfs, item.srcPath, joinPath(dstDir, item.name));
            }
            this._afterDrop(msg);
        };

        if (conflicts.length > 0) {
            const conflictName = conflicts.length === 1
                ? conflicts[0].name
                : `${conflicts.length} items`;
            showConflict(conflictName, executeMove, this.svc, this.theme);
            return;
        }

        executeMove();
    }

    private _afterDrop(msg: { srcKind: "fe" | "desktop"; srcWinId: number; toWinId: number }): void {
        if (msg.srcKind === "fe") {
            const srcSt = this.state.get(msg.srcWinId);
            if (srcSt) {
                srcSt.selected = null; srcSt.selectedSet.clear(); srcSt.lastSelected = null;
                this.render(msg.srcWinId);
            }
        }
        const toSt = this.state.get(msg.toWinId);
        if (toSt) {
            toSt.selected = null; toSt.selectedSet.clear();
            this.render(msg.toWinId);
        }
    }
}
