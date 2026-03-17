/**
 * KernelServices — Abstraction layer for apps
 *
 * Apps depend on this interface, not on Kernel directly.
 * This follows Dependency Inversion: apps → KernelServices ← Kernel implements.
 */

import type { OsWindow, WindowCreateOpts } from "../window/OsWindow.js";
import type { VirtualFS } from "../vfs/VirtualFS.js";
import type { DirEntry } from "../types/index.js";

export interface KernelServices {
    // ─── Display ─────────────────────────────────────────────────────────────
    readonly displayWidth:  number;
    readonly displayHeight: number;

    // ─── Window management ───────────────────────────────────────────────────
    createWindow(opts: WindowCreateOpts): number;
    getWindow(id: number): OsWindow | undefined;
    forceDestroyWindow(id: number): void;
    setFocus(id: number): void;
    listWindows(): OsWindow[];

    // ─── VFS ─────────────────────────────────────────────────────────────────
    readonly vfs: VirtualFS;

    // ─── Events ──────────────────────────────────────────────────────────────
    emit(event: string, payload?: unknown): void;

    // ─── Shell bridge ────────────────────────────────────────────────────────
    attachTerminal(winId: number): void;
    setShellDarkMode(dark: boolean): void;
    rerenderShellSessions(): void;

    // ─── System info ─────────────────────────────────────────────────────────
    getSystemStatus(): {
        uptime:   number;
        memStats: { total: number; used: number; free: number };
        schedStats: { ticks: number; contextSwitches: number };
        windowCount: number;
        processCount: number;
        displayWidth: number;
        displayHeight: number;
        tickRate: number;
    };

    // ─── Logging ─────────────────────────────────────────────────────────────
    log(level: "info" | "warn" | "error", msg: string): void;
}

// ─── VFS helpers used across apps ────────────────────────────────────────────

/**
 * Read directory entries, filtering out . and ..
 */
export function readDirClean(vfs: VirtualFS, path: string): DirEntry[] {
    try {
        return vfs.readdir(path).filter(e => e.name !== "." && e.name !== "..");
    } catch {
        return [];
    }
}

/**
 * Sort entries: directories first, then files.
 */
export function sortEntries(entries: DirEntry[]): DirEntry[] {
    const dirs  = entries.filter(e => e.type === "DIRECTORY");
    const files = entries.filter(e => e.type !== "DIRECTORY");
    return [...dirs, ...files];
}

/**
 * Build a full path from parent + name.
 */
export function joinPath(parent: string, name: string): string {
    return (parent === "/" ? "" : parent) + "/" + name;
}
