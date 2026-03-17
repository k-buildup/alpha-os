/**
 * RenameDialog — Shared rename modal
 *
 * Extracted from the duplicated rename dialogs in DesktopApp and FileExplorerApp.
 * Uses InputField for text input with cursor blink and selection.
 */

import type { DrawCommand, InputEvent, MouseEventData } from "../types/index.js";
import type { KernelServices } from "../services/KernelServices.js";
import { Theme } from "../ui/Theme.js";
import { Fonts } from "../ui/Theme.js";
import { renderButton, hitTestButton, type ButtonSpec } from "../ui/components/Button.js";
import { moveEntry } from "../services/FileService.js";
import type { ClipboardService } from "../services/ClipboardService.js";
import {
    makeInputField, inputHandleKey, renderInputField,
    inputHandleMouseDown, inputHandleMouseMove,
    type InputFieldState,
} from "../kernel/InputField.js";

const h = Theme.hex;

export class RenameDialog {
    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
        private readonly clipboard: ClipboardService,
    ) {}

    /**
     * Open a rename dialog.
     * @param oldName current file/folder name
     * @param parentPath directory containing the item
     * @param onDone called after rename completes (for re-render)
     */
    open(oldName: string, parentPath: string, onDone: () => void): void {
        const svc = this.svc;
        const theme = this.theme;
        const field = makeInputField(oldName);
        const W = 340, H = 100;

        const dlgId = svc.createWindow({
            title: "Rename",
            x: Math.round(svc.displayWidth / 2 - W / 2),
            y: 200,
            width: W, height: H,
            ownerPID: 1, backgroundColor: theme.palette.bg,
            resizable: false, minWidth: W, minHeight: H,
        });
        const dlgWin = svc.getWindow(dlgId);
        if (!dlgWin) return;
        svc.setFocus(dlgId);

        const okBtn: ButtonSpec = { x: 20, y: 66, width: 88, height: 26, label: "OK", variant: "primary" };
        const cancelBtn: ButtonSpec = { x: 116, y: 66, width: 88, height: 26, label: "Cancel", variant: "outline" };
        const fieldOpts = { x: 20, y: 30, width: W - 40, height: 26, charW: 7.0, padLeft: 6 };

        const render = (): void => {
            const cmds: DrawCommand[] = [
                { type: "rect", x: 0, y: 0, width: W, height: H, color: theme.color("bg") },
                { type: "text", x: 20, y: 22, text: "Rename:", font: Fonts.ui(12), color: theme.color("text3") },
                ...(renderInputField(field, {
                    ...fieldOpts,
                    bgColor: theme.palette.surface,
                    textColor: theme.palette.text,
                }) as unknown as DrawCommand[]),
                ...renderButton(okBtn, theme),
                ...renderButton(cancelBtn, theme),
            ];
            dlgWin.submitCommands(cmds);
        };
        render();

        const blinkInterval = setInterval(() => {
            if (!svc.getWindow(dlgId)) { clearInterval(blinkInterval); return; }
            render();
        }, 250);

        const close = (): void => {
            clearInterval(blinkInterval);
            svc.forceDestroyWindow(dlgId);
        };

        const doRename = (): void => {
            const newName = field.value.trim();
            if (!newName || newName === oldName) { close(); return; }
            const srcPath = (parentPath === "/" ? "" : parentPath) + "/" + oldName;
            const dstPath = (parentPath === "/" ? "" : parentPath) + "/" + newName;
            moveEntry(svc.vfs, srcPath, dstPath);
            close();
            onDone();
        };

        let isDragging = false;

        dlgWin.on("__if_rerender__", render);
        dlgWin.on("input", (e: InputEvent) => {
            if (e.type === "keydown") {
                const kd = e.data as import("../types/index.js").KeyboardEventData;
                const result = inputHandleKey(field, kd);
                if (result === "submit") { doRename(); return; }
                if (result === "cancel") { close(); return; }
                this.clipboard.handleInputFieldClip(field, result, dlgId, () => {
                    const w = svc.getWindow(dlgId);
                    if (w) w.emit("__if_rerender__");
                });
                render();
            } else if (e.type === "mousedown") {
                svc.setFocus(dlgId);
                const m = e.data as MouseEventData;
                if (hitTestButton(okBtn, m.x, m.y)) { doRename(); return; }
                if (hitTestButton(cancelBtn, m.x, m.y)) { close(); return; }
                if (inputHandleMouseDown(field, fieldOpts, m.x, m.y)) { isDragging = true; render(); }
            } else if (e.type === "mousemove" && isDragging) {
                inputHandleMouseMove(field, fieldOpts, (e.data as MouseEventData).x);
                render();
            } else if (e.type === "mouseup") {
                isDragging = false;
            }
        });
    }
}
