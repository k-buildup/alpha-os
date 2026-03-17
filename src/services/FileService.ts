/**
 * FileService — File operations
 *
 * Single Responsibility: all file manipulation logic (move, copy, rename, delete)
 * plus protected-path enforcement, extracted from the old AppManager.
 */

import type { VirtualFS } from "../vfs/VirtualFS.js";
import type { DirEntry } from "../types/index.js";

// ─── Protected paths ─────────────────────────────────────────────────────────

const PROTECTED_PATHS = new Set([
    "/", "/home", "/home/user",
    "/home/user/Desktop",
    "/home/user/Documents",
    "/home/user/Downloads",
    "/etc", "/proc", "/var", "/var/log",
]);

export function isProtectedPath(path: string): boolean {
    const p = path.replace(/\/+$/, "") || "/";
    return PROTECTED_PATHS.has(p);
}

// ─── File icon mapping ───────────────────────────────────────────────────────

const ICON_MAP: Record<string, string> = {
    ts: "📄", js: "📄", json: "📋", md: "📝", txt: "📝",
    sh: "⚙️", html: "🌐", css: "🎨", png: "🖼️", jpg: "🖼️",
    svg: "🖼️", mp3: "🎵", mp4: "🎬", zip: "📦", tar: "📦",
    gz: "📦", log: "📋",
};

export function fileIcon(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return ICON_MAP[ext] ?? "📄";
}

// ─── Path utilities ──────────────────────────────────────────────────────────

export function joinPath(parent: string, name: string): string {
    return (parent === "/" ? "" : parent) + "/" + name;
}

export function pathExists(vfs: VirtualFS, path: string): { exists: boolean; isDir: boolean } {
    try {
        const s = vfs.stat(path);
        return { exists: true, isDir: s.type === "DIRECTORY" };
    } catch {
        return { exists: false, isDir: false };
    }
}

// ─── Recursive move ──────────────────────────────────────────────────────────

/**
 * Move a file or directory from srcPath to dstPath.
 * This is a copy + delete operation through the VFS.
 */
export function moveEntry(vfs: VirtualFS, srcPath: string, dstPath: string): void {
    const { isDir } = pathExists(vfs, srcPath);
    if (!pathExists(vfs, srcPath).exists) return;

    if (isDir) {
        try { vfs.mkdir(dstPath); } catch { /* exists */ }
        try {
            const children = vfs.readdir(srcPath)
                .filter((e: DirEntry) => e.name !== "." && e.name !== "..");
            for (const ch of children) {
                moveEntry(vfs, srcPath + "/" + ch.name, dstPath + "/" + ch.name);
            }
        } catch { /* empty */ }
        try { vfs.unlink(srcPath); } catch { /* ignore */ }
    } else {
        try {
            const data = vfs.readFile(srcPath);
            const fd = vfs.open(dstPath, 0x40 | 0x200, 0);
            vfs.write(fd, data);
            vfs.close(fd);
            vfs.unlink(srcPath);
        } catch { /* ignore */ }
    }
}

/**
 * Delete a file or directory. Returns true on success.
 */
export function deleteEntry(vfs: VirtualFS, path: string): boolean {
    if (isProtectedPath(path)) return false;
    try {
        vfs.unlink(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Write text content to a file (create or overwrite).
 */
export function writeFile(vfs: VirtualFS, path: string, content: string): void {
    const fd = vfs.open(path, 0x40 | 0x200, 0);
    vfs.write(fd, Buffer.from(content));
    vfs.close(fd);
}

/**
 * Read file as UTF-8 text.
 */
export function readFileText(vfs: VirtualFS, path: string): string {
    try {
        return vfs.readFile(path).toString("utf8");
    } catch {
        return "";
    }
}

/**
 * Get formatted file size string.
 */
export function formatFileSize(vfs: VirtualFS, path: string): string {
    try {
        const info = vfs.stat(path);
        return info.size < 1024 ? `${info.size}B` : `${(info.size / 1024).toFixed(1)}K`;
    } catch {
        return "?";
    }
}
