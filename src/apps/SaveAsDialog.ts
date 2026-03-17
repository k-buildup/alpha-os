/**
 * SaveAsDialog — Save-As file picker
 *
 * SRP: Browse directories and pick a filename to save the editor content.
 * Uses Sidebar, InputField, and Button components.
 */

import type { KernelServices } from "../services/KernelServices.js";
import { readDirClean, sortEntries, joinPath } from "../services/KernelServices.js";
import type { ClipboardService } from "../services/ClipboardService.js";
import type { DrawCommand, InputEvent, MouseEventData, KeyboardEventData, DirEntry } from "../types/index.js";
import { Theme } from "../ui/Theme.js";
import { Fonts } from "../ui/Theme.js";
import { renderSidebar, hitTestSidebar, DEFAULT_BOOKMARKS } from "../ui/components/Sidebar.js";
import { renderButton, hitTestButton, type ButtonSpec } from "../ui/components/Button.js";
import { showConflict } from "../ui/components/Modal.js";
import { writeFile } from "../services/FileService.js";
import {
    makeInputField, inputHandleKey, renderInputField,
    inputHandleMouseDown, inputHandleMouseMove,
    type InputFieldState,
} from "../kernel/InputField.js";

const h = Theme.hex;

interface SaveAsState {
    browsePath: string;
    selected:   number | null;
    fnField:    InputFieldState;
    isDragging: boolean;
}

export class SaveAsDialog {
    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
        private readonly clipboard: ClipboardService,
    ) {}

    /**
     * Open a Save As dialog for the given editor state.
     * @param editorWinId  the source editor window ID
     * @param editorLines  current editor content
     * @param currentPath  current file path (if any)
     * @param onSaved      called with the saved path after saving
     */
    open(
        editorWinId: number,
        editorLines: string[],
        currentPath: string,
        onSaved: (savedPath: string) => void,
    ): void {
        const svc = this.svc;
        const theme = this.theme;
        const srcWin = svc.getWindow(editorWinId);
        if (!srcWin) return;

        const sb = srcWin.bounds;
        const W = Math.min(560, sb.width + 40);
        const H = Math.min(440, sb.height + 40);

        const id = svc.createWindow({
            title: "Save As",
            x: Math.max(0, sb.x - 20), y: Math.max(0, sb.y - 20),
            width: W, height: H,
            ownerPID: 1, backgroundColor: theme.palette.bg,
            minWidth: 400, minHeight: 300,
        });
        const win = svc.getWindow(id);
        if (!win) return;
        svc.setFocus(id);

        const initDir = currentPath ? currentPath.replace(/\/[^/]+$/, "") || "/home/user" : "/home/user";
        const initName = currentPath ? (currentPath.split("/").pop() ?? "untitled.txt") : "untitled.txt";

        const st: SaveAsState = {
            browsePath: initDir,
            selected: null,
            fnField: makeInputField(initName),
            isDragging: false,
        };

        const HDR = 36, FTR = 58, ROW_H = 26, SB_W = 110, PAD = 10;

        const saveBtn: ButtonSpec = { x: 0, y: 0, width: 96, height: 24, label: "Save", variant: "primary" };
        const cancelBtn: ButtonSpec = { x: 0, y: 0, width: 96, height: 20, label: "Cancel", variant: "outline" };

        const render = (): void => {
            const ww = win.bounds.width, wh = win.bounds.height;
            const entries = sortEntries(readDirClean(svc.vfs, st.browsePath));
            const maxRows = Math.max(1, Math.floor((wh - HDR - FTR - 26) / ROW_H));

            // Update button positions
            saveBtn.x = ww - 106; saveBtn.y = wh - FTR + 24;
            cancelBtn.x = ww - 106; cancelBtn.y = wh - FTR + 2;

            const cmds: DrawCommand[] = [
                // Header
                { type: "rect", x: 0, y: 0, width: ww, height: HDR, color: theme.color("surface") },
                { type: "line", x: 0, y: HDR - 1, x2: ww, y2: HDR - 1, color: theme.color("border") },
                { type: "text", x: PAD, y: 22,
                  text: "Save As: " + (st.browsePath.split("/").filter(Boolean).join(" / ") || "/"),
                  font: Fonts.ui(12, 600), color: theme.color("text") },
                // Content header
                { type: "rect", x: SB_W, y: HDR, width: ww - SB_W, height: 26, color: theme.color("surface") },
                { type: "line", x: SB_W, y: HDR + 26, x2: ww, y2: HDR + 26, color: theme.color("muted") },
                { type: "text", x: SB_W + 14, y: HDR + 18, text: "Name", font: Fonts.ui(11), color: theme.color("text3") },
                // Footer
                { type: "rect", x: 0, y: wh - FTR, width: ww, height: FTR, color: theme.color("surface") },
                { type: "line", x: 0, y: wh - FTR, x2: ww, y2: wh - FTR, color: theme.color("border") },
                // Filename label
                { type: "text", x: PAD, y: wh - FTR + 18, text: "File name:", font: Fonts.ui(11), color: theme.color("text3") },
            ];

            // Sidebar
            cmds.push(...renderSidebar({
                x: 0, topY: HDR, width: SB_W, height: wh - HDR - FTR,
                items: DEFAULT_BOOKMARKS, activePath: st.browsePath,
            }, theme));

            // Filename input field
            cmds.push(...(renderInputField(st.fnField, {
                x: PAD, y: wh - FTR + 24, width: ww - 130, height: 24,
                bgColor: theme.palette.surface, textColor: theme.palette.text,
            }) as unknown as DrawCommand[]));

            // Buttons
            cmds.push(...renderButton(saveBtn, theme));
            cmds.push(...renderButton(cancelBtn, theme));

            // File list
            const listY = HDR + 26;
            entries.slice(0, maxRows).forEach((e, vi) => {
                const ry = listY + vi * ROW_H;
                const isSel = st.selected === vi;
                if (isSel) cmds.push({ type: "rect", x: SB_W + 1, y: ry, width: ww - SB_W - 1, height: ROW_H, color: h(theme.selectionBg) });
                else if (vi % 2) cmds.push({ type: "rect", x: SB_W + 1, y: ry, width: ww - SB_W - 1, height: ROW_H, color: theme.color("surface") });
                const icon = e.type === "DIRECTORY" ? "📁" : "📄";
                cmds.push(
                    { type: "text", x: SB_W + 8, y: ry + 18, text: icon, font: Fonts.emoji(13), color: theme.color("accent") },
                    { type: "text", x: SB_W + 26, y: ry + 18, text: e.name,
                      font: Fonts.ui(13), color: e.type === "DIRECTORY" ? theme.color("blue") : theme.color("text") },
                );
            });

            win.submitCommands(cmds);
        };

        render();
        win.on("resize", render);

        // Blink ticker
        const blinkTimer = setInterval(() => {
            if (!svc.getWindow(id)) { clearInterval(blinkTimer); return; }
            render();
        }, 250);

        const close = (): void => {
            clearInterval(blinkTimer);
            svc.forceDestroyWindow(id);
        };

        const doSave = (): void => {
            const fname = st.fnField.value.trim();
            if (!fname) return;
            const savePath = joinPath(st.browsePath, fname);

            const performSave = (): void => {
                try {
                    writeFile(svc.vfs, savePath, editorLines.join("\n"));
                    onSaved(savePath);
                } catch { /* ignore */ }
                close();
            };

            // Conflict check
            let exists = false;
            try { svc.vfs.stat(savePath); exists = true; } catch { /* */ }
            if (exists) {
                showConflict(fname, performSave, svc, theme);
            } else {
                performSave();
            }
        };

        const getFnOpts = () => {
            const ww = win.bounds.width, wh = win.bounds.height;
            return { x: PAD, y: wh - FTR + 24, width: ww - 130, height: 24, charW: 6.8, padLeft: 6 };
        };

        win.on("input", (e: InputEvent) => {
            const m = e.data as MouseEventData;
            const ww = win.bounds.width, wh = win.bounds.height;
            const listY = HDR + 26;
            const fnOpts = getFnOpts();

            if (e.type === "keydown") {
                const kd = e.data as KeyboardEventData;
                const result = inputHandleKey(st.fnField, kd);
                if (result === "submit") { doSave(); return; }
                if (result === "cancel") { close(); return; }
                this.clipboard.handleInputFieldClip(st.fnField, result, id, () => {
                    const w = svc.getWindow(id);
                    if (w) w.emit("__if_rerender__");
                });
                render(); return;
            }

            if (e.type === "mousemove") {
                if (st.isDragging) { inputHandleMouseMove(st.fnField, fnOpts, m.x); render(); }
                return;
            }
            if (e.type === "mouseup") { st.isDragging = false; return; }
            if (e.type !== "mousedown") return;

            svc.setFocus(id);

            // Sidebar
            const sidebarIdx = hitTestSidebar({
                x: 0, topY: HDR, width: SB_W, height: wh - HDR - FTR,
                items: DEFAULT_BOOKMARKS, activePath: st.browsePath,
            }, m.x, m.y);
            if (sidebarIdx >= 0) {
                st.browsePath = DEFAULT_BOOKMARKS[sidebarIdx].path;
                st.selected = null; render(); return;
            }

            // Filename input click
            if (m.y >= wh - FTR + 24 && m.y < wh - FTR + 48 && m.x >= PAD && m.x < ww - 120) {
                inputHandleMouseDown(st.fnField, fnOpts, m.x, m.y);
                st.isDragging = true; render(); return;
            }

            // File list
            if (m.y >= listY && m.y < wh - FTR && m.x >= SB_W) {
                const vi = Math.floor((m.y - listY) / ROW_H);
                const entries = sortEntries(readDirClean(svc.vfs, st.browsePath));
                if (vi >= 0 && vi < entries.length) {
                    const entry = entries[vi];
                    if (entry.type === "DIRECTORY") {
                        st.browsePath = joinPath(st.browsePath, entry.name);
                        st.selected = null; render();
                    } else {
                        st.selected = vi;
                        st.fnField.value = entry.name;
                        st.fnField.cursor = st.fnField.value.length;
                        st.fnField.selStart = null;
                        render();
                    }
                }
                return;
            }

            // Buttons
            if (hitTestButton(saveBtn, m.x, m.y)) { doSave(); return; }
            if (hitTestButton(cancelBtn, m.x, m.y)) { close(); return; }
        });
    }
}
