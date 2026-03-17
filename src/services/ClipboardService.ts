/**
 * ClipboardService — Clipboard coordination
 *
 * Manages pending paste callbacks and clipboard read/write events.
 * Extracted from AppManager's _ifClip / _ifPaste / _ifPastePending.
 */

import type { KernelServices } from "./KernelServices.js";
import type { InputFieldState } from "../kernel/InputField.js";

export class ClipboardService {
    private readonly svc: KernelServices;
    private readonly pendingPaste = new Map<number, (text: string) => void>();

    constructor(svc: KernelServices) {
        this.svc = svc;
    }

    /** Write selected text to clipboard */
    writeSelection(text: string): void {
        if (text) this.svc.emit("clipboard_write", { text });
    }

    /** Request clipboard read for a given window, with a callback for when data arrives */
    requestPaste(winId: number, callback: (text: string) => void): void {
        this.pendingPaste.set(winId, callback);
        this.svc.emit("clipboard_read_request", { winId });
    }

    /** Called when clipboard data arrives — resolves a pending paste */
    resolvePaste(winId: number, text: string): boolean {
        const cb = this.pendingPaste.get(winId);
        if (cb) {
            this.pendingPaste.delete(winId);
            cb(text);
            return true;
        }
        return false;
    }

    /**
     * Handle InputField clipboard results from inputHandleKey.
     * Returns true if a re-render is needed immediately (false = async paste pending).
     */
    handleInputFieldClip(
        field: InputFieldState,
        result: string,
        winId: number,
        onRerender: () => void,
    ): boolean {
        const { value: v, cursor: c, selStart } = field;

        if (result === "copy" || result === "cut") {
            if (selStart !== null) {
                const a = Math.min(selStart, c);
                const b = Math.max(selStart, c);
                const txt = v.slice(a, b);
                this.writeSelection(txt);
                if (result === "cut") {
                    field.value = v.slice(0, a) + v.slice(b);
                    field.cursor = a;
                    field.selStart = null;
                }
            }
            return true;
        }

        if (result === "paste") {
            this.requestPaste(winId, (text) => {
                this.pasteIntoInputField(field, text);
                onRerender();
            });
            return false;
        }

        return result !== "none";
    }

    /** Insert pasted text into an InputField state */
    private pasteIntoInputField(field: InputFieldState, text: string): void {
        const a = field.selStart !== null ? Math.min(field.selStart, field.cursor) : field.cursor;
        const b = field.selStart !== null ? Math.max(field.selStart, field.cursor) : field.cursor;
        field.value = field.value.slice(0, a) + text + field.value.slice(b);
        field.cursor = a + text.length;
        field.selStart = null;
        field.blink = Date.now();
    }
}
