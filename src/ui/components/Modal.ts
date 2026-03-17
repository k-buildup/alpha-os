/**
 * UI Component — Modal
 *
 * Creates a centered dialog window with a body message and 1–3 action buttons.
 * Handles its own input routing and destroys itself on button click.
 */

import type { DrawCommand, InputEvent, MouseEventData, ColorHex } from "../../types/index.js";
import type { Theme } from "../Theme.js";
import { renderButton, hitTestButton, type ButtonSpec } from "./Button.js";
import { Fonts } from "../Theme.js";
import type { KernelServices } from "../../services/KernelServices.js";

export interface ModalButton {
    label:    string;
    variant?: "primary" | "danger" | "outline" | "ghost";
    action:   () => void;
}

export interface ModalConfig {
    title:   string;
    body:    string;
    buttons: ModalButton[];
    width?:  number;
    height?: number;
    /** position hint — center of parent window */
    anchorX?: number;
    anchorY?: number;
}

/**
 * Open a modal dialog. Returns the window ID.
 * The modal auto-closes when any button is clicked.
 */
export function openModal(cfg: ModalConfig, svc: KernelServices, theme: Theme): number {
    const W = cfg.width  ?? 340;
    const H = cfg.height ?? 130;
    const cx = cfg.anchorX ?? Math.round(svc.displayWidth / 2);
    const cy = cfg.anchorY ?? Math.round(svc.displayHeight / 2);

    const id = svc.createWindow({
        title: cfg.title,
        x: Math.round(cx - W / 2),
        y: Math.round(cy - H / 2),
        width: W, height: H,
        ownerPID: 1, backgroundColor: theme.palette.bg,
        resizable: false, minWidth: W, minHeight: H,
    });
    const win = svc.getWindow(id);
    if (!win) return id;

    // Build button specs
    const BTN_H = 30;
    const BTN_GAP = 12;
    const BTN_Y = H - 44;
    let bx = 20;
    const btnSpecs: Array<ButtonSpec & { action: () => void }> = cfg.buttons.map(b => {
        const bw = Math.max(80, b.label.length * 10 + 24);
        const spec = { x: bx, y: BTN_Y, width: bw, height: BTN_H, label: b.label, variant: b.variant, action: b.action };
        bx += bw + BTN_GAP;
        return spec;
    });

    const render = (): void => {
        const cmds: DrawCommand[] = [
            { type: "rect", x: 0, y: 0, width: W, height: H, color: theme.color("bg") },
            { type: "text", x: 20, y: 30, text: cfg.body,
              font: Fonts.ui(12), color: theme.color("text2") },
        ];
        for (const bs of btnSpecs) {
            cmds.push(...renderButton(bs, theme));
        }
        win.submitCommands(cmds);
    };
    render();

    win.on("input", (e: InputEvent) => {
        if (e.type !== "mousedown") return;
        const m = e.data as MouseEventData;
        for (const bs of btnSpecs) {
            if (hitTestButton(bs, m.x, m.y)) {
                svc.forceDestroyWindow(id);
                bs.action();
                return;
            }
        }
    });

    return id;
}

// ─── Convenience: Confirm dialog ─────────────────────────────────────────────

export function showConfirm(
    title: string,
    body: string,
    confirmLabel: string,
    onConfirm: () => void,
    svc: KernelServices,
    theme: Theme,
    danger = false,
): number {
    return openModal({
        title, body,
        buttons: [
            { label: confirmLabel, variant: danger ? "danger" : "primary", action: onConfirm },
            { label: "Cancel", variant: "outline", action: () => {} },
        ],
    }, svc, theme);
}

// ─── Convenience: Conflict dialog (file already exists) ──────────────────────

export function showConflict(
    name: string,
    onOverwrite: () => void,
    svc: KernelServices,
    theme: Theme,
): number {
    return showConfirm(
        "Conflict",
        `"${name}" already exists. Replace it?`,
        "Overwrite",
        onOverwrite,
        svc, theme, true,
    );
}
