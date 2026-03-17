/**
 * TextEditorApp — Multi-line text editor
 *
 * SRP: Text editing, cursor/selection, save/save-as, paste.
 */

import type { IApp } from "./IApp.js";
import type { KernelServices } from "../services/KernelServices.js";
import type { ClipboardService } from "../services/ClipboardService.js";
import { readFileText, writeFile } from "../services/FileService.js";
import type { DrawCommand, InputEvent, MouseEventData, KeyboardEventData } from "../types/index.js";
import { Theme } from "../ui/Theme.js";
import { Fonts, SemanticColors } from "../ui/Theme.js";
import { renderScrollbar } from "../ui/components/Scrollbar.js";
import { renderStatusBar } from "../ui/components/StatusBar.js";
import { openModal } from "../ui/components/Modal.js";

const h = Theme.hex;

// Layout constants
const LH = 18, GUTTER = 50, HDR = 32, STAT = 22, PX = GUTTER + 8, CW = 7.8;

interface EdState {
    lines: string[];
    curRow: number; curCol: number;
    scrollRow: number;
    modified: boolean;
    path: string;
    blinkReset: number;
    selAnchorRow: number | null; selAnchorCol: number | null;
    dragging: boolean;
    // double-click tracking
    _lct?: number; _lcr?: number; _lcc?: number;
}

export class TextEditorApp implements IApp {
    readonly appId = "textEditor";
    private readonly state = new Map<number, EdState>();
    private openSaveAs: ((winId: number) => void) | null = null;

    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
        private readonly clipboard: ClipboardService,
    ) {}

    /** Inject SaveAs opener to avoid circular dependency */
    setSaveAsOpener(fn: (winId: number) => void): void { this.openSaveAs = fn; }

    ownsWindow(id: number): boolean { return this.state.has(id); }
    getEditorState(winId: number): EdState | undefined { return this.state.get(winId); }

    // ─── Open ────────────────────────────────────────────────────────────────

    /** Open an existing file in the editor */
    openFile(filePath: string): number {
        const raw = readFileText(this.svc.vfs, filePath);
        const id = this.createEditorWindow(filePath.split("/").pop() ?? filePath);
        const st = this.state.get(id)!;
        st.lines = raw.split("\n");
        st.path = filePath;
        this.render(id);
        this.bindCloseHandler(id);
        return id;
    }

    /** Create a new untitled editor */
    newFile(_dirPath = "/home/user"): number {
        const id = this.createEditorWindow("untitled");
        this.render(id);
        this.bindCloseHandler(id);
        return id;
    }

    private createEditorWindow(title: string): number {
        const id = this.svc.createWindow({
            title, x: 200, y: 100, width: 600, height: 440,
            ownerPID: 1, backgroundColor: this.theme.palette.bg,
            minWidth: 360, minHeight: 240,
        });
        const st: EdState = {
            lines: [""], curRow: 0, curCol: 0, scrollRow: 0,
            modified: false, path: "", blinkReset: Date.now(),
            selAnchorRow: null, selAnchorCol: null, dragging: false,
        };
        this.state.set(id, st);

        const win = this.svc.getWindow(id)!;
        win.on("input", (e: InputEvent) => this.handleInput(id, e));
        win.on("resize", () => this.render(id));
        return id;
    }

    private bindCloseHandler(id: number): void {
        const win = this.svc.getWindow(id);
        const st = this.state.get(id);
        if (!win || !st) return;

        win.on("close", (cancel?: () => void) => {
            const hasContent = st.lines.join("") !== "";
            const needsAction = st.modified || (hasContent && st.path === "");
            if (needsAction) {
                if (cancel) cancel();
                this.showSaveDialog(id);
            } else {
                this.state.delete(id);
            }
        });
    }

    destroy(winId: number): void { this.state.delete(winId); }

    // ─── Rendering ───────────────────────────────────────────────────────────

    render(winId: number): void {
        const win = this.svc.getWindow(winId);
        const st = this.state.get(winId);
        if (!win || !st) return;
        const W = win.bounds.width, H = win.bounds.height;
        const maxRows = Math.max(1, Math.floor((H - HDR - STAT) / LH));

        // Selection normalized range
        const hasSel = st.selAnchorRow !== null;
        let selR0 = 0, selC0 = 0, selR1 = 0, selC1 = 0;
        if (hasSel) {
            const ar = st.selAnchorRow!, ac = st.selAnchorCol!;
            const cr = st.curRow, cc = st.curCol;
            if (ar < cr || (ar === cr && ac <= cc)) { selR0 = ar; selC0 = ac; selR1 = cr; selC1 = cc; }
            else { selR0 = cr; selC0 = cc; selR1 = ar; selC1 = ac; }
        }

        const cmds: DrawCommand[] = [
            // Header
            { type: "rect", x: 0, y: 0, width: W, height: HDR, color: this.theme.color("surface") },
            { type: "line", x: 0, y: HDR - 1, x2: W, y2: HDR - 1, color: this.theme.color("border") },
            { type: "text", x: GUTTER, y: 20,
              text: (st.modified ? "● " : "") + (st.path.split("/").pop() ?? (st.path || "untitled")),
              font: Fonts.ui(12, 600), color: h(st.modified ? SemanticColors.warning : this.theme.palette.text) },
            // Shortcut hints
            { type: "text", x: W - 260, y: 20, text: "File", font: Fonts.ui(12), color: this.theme.color("text2") },
            { type: "text", x: W - 220, y: 20, text: "·", font: Fonts.ui(12), color: this.theme.color("border") },
            { type: "text", x: W - 208, y: 20, text: "^S Save", font: Fonts.ui(11), color: this.theme.color("text3") },
            { type: "text", x: W - 148, y: 20, text: "^Z Undo", font: Fonts.ui(11), color: this.theme.color("text3") },
            { type: "text", x: W - 88, y: 20, text: "^A All", font: Fonts.ui(11), color: this.theme.color("text3") },
            // Editor body + gutter
            { type: "rect", x: 0, y: HDR, width: W, height: H - HDR - STAT, color: this.theme.color("bg") },
            { type: "rect", x: 0, y: HDR, width: GUTTER - 2, height: H - HDR - STAT, color: this.theme.color("surface") },
            { type: "line", x: GUTTER - 2, y: HDR, x2: GUTTER - 2, y2: H - STAT, color: this.theme.color("border") },
        ];

        // Lines
        st.lines.slice(st.scrollRow, st.scrollRow + maxRows).forEach((line, vi) => {
            const absRow = st.scrollRow + vi;
            const ry = HDR + 4 + vi * LH;
            const rowTop = ry - 2;

            // Current line highlight
            if (absRow === st.curRow && !hasSel) {
                cmds.push({ type: "rect", x: GUTTER - 2, y: rowTop, width: W - GUTTER + 2, height: LH + 2, color: h(this.theme.lineHighlight) });
            }

            // Selection highlight
            if (hasSel && absRow >= selR0 && absRow <= selR1) {
                let x0: number, x1: number;
                if (absRow === selR0 && absRow === selR1) { x0 = PX + selC0 * CW; x1 = PX + selC1 * CW; }
                else if (absRow === selR0) { x0 = PX + selC0 * CW; x1 = PX + line.length * CW + CW; }
                else if (absRow === selR1) { x0 = PX; x1 = PX + selC1 * CW; }
                else { x0 = PX; x1 = PX + line.length * CW + CW; }
                if (x1 > x0) {
                    cmds.push({ type: "rect", x: Math.round(x0), y: rowTop, width: Math.round(x1 - x0), height: LH + 2, color: h(this.theme.selectionHighlight) });
                }
            }

            // Line number
            cmds.push({ type: "text", x: 6, y: ry + LH - 4, text: String(absRow + 1), font: Fonts.mono(11), color: absRow === st.curRow ? h(SemanticColors.cursorColor) : h("#c4c4c4") });
            // Line text
            cmds.push({ type: "text", x: PX, y: ry + LH - 4, text: line, font: Fonts.mono(13), color: this.theme.color("text") });

            // Cursor blink
            if (absRow === st.curRow) {
                const elapsed = Date.now() - st.blinkReset;
                const blinkOn = elapsed < 500 || Math.floor(elapsed / 500) % 2 === 0;
                if (blinkOn) {
                    const cx = PX + Math.min(st.curCol, line.length) * CW;
                    cmds.push({ type: "rect", x: Math.round(cx), y: rowTop, width: 2, height: LH + 2, color: h(SemanticColors.cursorColor) });
                }
            }
        });

        // Scrollbar
        cmds.push(...renderScrollbar({
            x: W, top: HDR, height: H - HDR - STAT,
            total: st.lines.length, visible: maxRows, offset: st.scrollRow,
        }, this.theme));

        // Status bar
        const selInfo = hasSel ? ` — ${this.selectionText(st).length} chars selected` : "";
        cmds.push(...renderStatusBar({
            width: W, height: H, leftX: GUTTER,
            left: `Ln ${st.curRow + 1}  Col ${st.curCol + 1}  |  ${st.lines.length} lines${selInfo}`,
            right: st.modified ? "Modified" : "Saved",
            rightColor: st.modified ? SemanticColors.warning : undefined,
        }, this.theme));

        win.submitCommands(cmds);
    }

    tickRender(): void {
        for (const winId of this.state.keys()) this.render(winId);
    }

    // ─── Selection helpers ───────────────────────────────────────────────────

    private selectionText(st: EdState): string {
        if (st.selAnchorRow === null) return "";
        const ar = st.selAnchorRow, ac = st.selAnchorCol!, cr = st.curRow, cc = st.curCol;
        let r0: number, c0: number, r1: number, c1: number;
        if (ar < cr || (ar === cr && ac <= cc)) { r0 = ar; c0 = ac; r1 = cr; c1 = cc; }
        else { r0 = cr; c0 = cc; r1 = ar; c1 = ac; }
        if (r0 === r1) return st.lines[r0].slice(c0, c1);
        const p = [st.lines[r0].slice(c0)];
        for (let r = r0 + 1; r < r1; r++) p.push(st.lines[r]);
        p.push(st.lines[r1].slice(0, c1));
        return p.join("\n");
    }

    private clearSel(st: EdState): void { st.selAnchorRow = null; st.selAnchorCol = null; }
    private startSel(st: EdState): void {
        if (st.selAnchorRow === null) { st.selAnchorRow = st.curRow; st.selAnchorCol = st.curCol; }
    }

    private deleteSel(st: EdState): void {
        if (st.selAnchorRow === null) return;
        const ar = st.selAnchorRow, ac = st.selAnchorCol!, cr = st.curRow, cc = st.curCol;
        let r0: number, c0: number, r1: number, c1: number;
        if (ar < cr || (ar === cr && ac <= cc)) { r0 = ar; c0 = ac; r1 = cr; c1 = cc; }
        else { r0 = cr; c0 = cc; r1 = ar; c1 = ac; }
        const before = st.lines[r0].slice(0, c0);
        const after = st.lines[r1].slice(c1);
        st.lines.splice(r0, r1 - r0 + 1, before + after);
        st.curRow = r0; st.curCol = c0;
        this.clearSel(st); st.modified = true;
    }

    private wordBound(line: string, col: number, dir: 1 | -1): number {
        if (dir === 1) { const m = line.slice(col).match(/^(\s*\S+|\s+)/); return col + (m ? m[0].length : 0); }
        const m = line.slice(0, col).match(/(\S+\s*|\s*)$/); return col - (m ? m[0].length : 0);
    }

    // ─── Input handling ──────────────────────────────────────────────────────

    private handleInput(winId: number, e: InputEvent): void {
        const st = this.state.get(winId);
        const win = this.svc.getWindow(winId);
        if (!st || !win) return;
        const maxRows = Math.max(1, Math.floor((win.bounds.height - HDR - STAT) / LH));

        if (e.type === "wheel") {
            const m = e.data as MouseEventData;
            st.scrollRow = Math.max(0, Math.min(Math.max(0, st.lines.length - 1), st.scrollRow + Math.sign(m.deltaY ?? 0) * 3));
            this.render(winId); return;
        }

        if (e.type === "mousedown") {
            const m = e.data as MouseEventData;
            if (m.y >= HDR + 4) {
                const vi = Math.floor((m.y - (HDR + 4)) / LH);
                const row = Math.min(st.lines.length - 1, Math.max(0, st.scrollRow + vi));
                const col = Math.max(0, Math.min(st.lines[row].length, Math.round((m.x - PX) / CW)));
                st.curRow = row; st.curCol = col;
                this.clearSel(st); st.dragging = true;
                st.selAnchorRow = row; st.selAnchorCol = col;
                st.blinkReset = Date.now();

                // Double-click word select
                const now = Date.now();
                if (st._lct && now - st._lct < 400 && st._lcr === row && Math.abs((st._lcc ?? 0) - col) <= 2) {
                    const line = st.lines[row];
                    let w0 = col, w1 = col;
                    const isW = (ch: string) => /\w/.test(ch);
                    if (col < line.length && isW(line[col])) { while (w0 > 0 && isW(line[w0 - 1])) w0--; while (w1 < line.length && isW(line[w1])) w1++; }
                    else if (col > 0 && isW(line[col - 1])) { w1 = col; while (w0 > 0 && isW(line[w0 - 1])) w0--; }
                    else { w0 = 0; w1 = line.length; }
                    st.selAnchorRow = row; st.selAnchorCol = w0; st.curCol = w1; st.dragging = false;
                    st._lct = 0;
                } else { st._lct = now; st._lcr = row; st._lcc = col; }
            }
            this.render(winId); return;
        }

        if (e.type === "mousemove") {
            const m = e.data as MouseEventData;
            if (!st.dragging) return;
            if (m.y >= HDR + 4) {
                const vi = Math.floor((m.y - (HDR + 4)) / LH);
                const row = Math.min(st.lines.length - 1, Math.max(0, st.scrollRow + vi));
                const col = Math.max(0, Math.min(st.lines[row].length, Math.round((m.x - PX) / CW)));
                st.curRow = row; st.curCol = col;
                if (row === st.selAnchorRow && col === st.selAnchorCol) this.clearSel(st);
                // Auto-scroll
                if (st.curRow < st.scrollRow) st.scrollRow = st.curRow;
                if (st.curRow >= st.scrollRow + maxRows) st.scrollRow = st.curRow - maxRows + 1;
            }
            this.render(winId); return;
        }

        if (e.type === "mouseup") {
            if (st.dragging) {
                st.dragging = false;
                if (st.selAnchorRow === st.curRow && st.selAnchorCol === st.curCol) this.clearSel(st);
            }
            this.render(winId); return;
        }

        if (e.type !== "keydown") { this.render(winId); return; }

        const kd = e.data as KeyboardEventData;
        const { key, ctrl, shift } = kd;
        st.blinkReset = Date.now();
        const lines = st.lines;

        // ─── Ctrl shortcuts ──────────────────────────────────────────────────
        if (ctrl) {
            switch (key.toLowerCase()) {
                case "s":
                    if (st.path === "") this.openSaveAs?.(winId);
                    else this.saveEditor(winId);
                    break;
                case "a": st.selAnchorRow = 0; st.selAnchorCol = 0; st.curRow = lines.length - 1; st.curCol = lines[st.curRow].length; break;
                case "c": { const txt = this.selectionText(st); this.clipboard.writeSelection(txt); break; }
                case "x": { const txt = this.selectionText(st); if (txt) { this.clipboard.writeSelection(txt); this.deleteSel(st); } break; }
                case "v": this.svc.emit("clipboard_read_request", { winId }); break;
                case "z":
                    if (!st.modified || !st.path) break;
                    try {
                        const orig = this.svc.vfs.readFile(st.path).toString("utf8");
                        st.lines = orig.split("\n"); st.modified = false; st.curRow = 0; st.curCol = 0; st.scrollRow = 0; this.clearSel(st);
                    } catch { /* */ }
                    break;
                case "d": lines.splice(st.curRow + 1, 0, lines[st.curRow]); st.curRow++; this.clearSel(st); st.modified = true; break;
                case "k":
                    if (lines.length > 1) { lines.splice(st.curRow, 1); st.curRow = Math.min(st.curRow, lines.length - 1); }
                    else lines[0] = "";
                    st.curCol = 0; this.clearSel(st); st.modified = true; break;
                case "arrowleft": if (shift) this.startSel(st); else this.clearSel(st); st.curCol = this.wordBound(lines[st.curRow], st.curCol, -1); break;
                case "arrowright": if (shift) this.startSel(st); else this.clearSel(st); st.curCol = this.wordBound(lines[st.curRow], st.curCol, 1); break;
                case "arrowup": if (shift) this.startSel(st); else this.clearSel(st); st.curRow = Math.max(0, st.curRow - 10); st.curCol = Math.min(st.curCol, lines[st.curRow].length); break;
                case "arrowdown": if (shift) this.startSel(st); else this.clearSel(st); st.curRow = Math.min(lines.length - 1, st.curRow + 10); st.curCol = Math.min(st.curCol, lines[st.curRow].length); break;
                case "home": if (shift) this.startSel(st); else this.clearSel(st); st.curRow = 0; st.curCol = 0; st.scrollRow = 0; break;
                case "end": if (shift) this.startSel(st); else this.clearSel(st); st.curRow = lines.length - 1; st.curCol = lines[st.curRow].length; break;
            }
            this.ensureVisible(st, maxRows); this.render(winId); return;
        }

        // ─── Normal keys ─────────────────────────────────────────────────────
        const mv = (action: () => void): void => {
            if (shift) this.startSel(st); else this.clearSel(st);
            action();
            this.ensureVisible(st, maxRows);
        };

        switch (key) {
            case "ArrowUp":    mv(() => { if (st.curRow > 0) { st.curRow--; st.curCol = Math.min(st.curCol, lines[st.curRow].length); } }); break;
            case "ArrowDown":  mv(() => { if (st.curRow < lines.length - 1) { st.curRow++; st.curCol = Math.min(st.curCol, lines[st.curRow].length); } }); break;
            case "ArrowLeft":  mv(() => { if (st.curCol > 0) st.curCol--; else if (st.curRow > 0) { st.curRow--; st.curCol = lines[st.curRow].length; } }); break;
            case "ArrowRight": mv(() => { if (st.curCol < lines[st.curRow].length) st.curCol++; else if (st.curRow < lines.length - 1) { st.curRow++; st.curCol = 0; } }); break;
            case "Home": mv(() => { const ind = lines[st.curRow].match(/^(\s*)/)?.[1].length ?? 0; st.curCol = st.curCol > ind ? ind : 0; }); break;
            case "End": mv(() => { st.curCol = lines[st.curRow].length; }); break;
            case "PageUp": mv(() => { st.curRow = Math.max(0, st.curRow - maxRows); st.scrollRow = Math.max(0, st.scrollRow - maxRows); st.curCol = Math.min(st.curCol, lines[st.curRow].length); }); break;
            case "PageDown": mv(() => { st.curRow = Math.min(lines.length - 1, st.curRow + maxRows); st.scrollRow = Math.min(lines.length - 1, st.scrollRow + maxRows); st.curCol = Math.min(st.curCol, lines[st.curRow].length); }); break;
            case "Enter": {
                if (st.selAnchorRow !== null) this.deleteSel(st);
                const row = lines[st.curRow], indent = row.match(/^(\s*)/)?.[1] ?? "";
                lines[st.curRow] = row.slice(0, st.curCol);
                lines.splice(st.curRow + 1, 0, indent + row.slice(st.curCol));
                st.curRow++; st.curCol = indent.length;
                if (st.curRow >= st.scrollRow + maxRows) st.scrollRow++;
                st.modified = true; break;
            }
            case "Backspace":
                if (st.selAnchorRow !== null) { this.deleteSel(st); }
                else if (kd.ctrl) { const r = lines[st.curRow], b = r.slice(0, st.curCol).replace(/\S+\s*$/, ""); lines[st.curRow] = b + r.slice(st.curCol); st.curCol = b.length; }
                else if (st.curCol > 0) { const r = lines[st.curRow]; lines[st.curRow] = r.slice(0, st.curCol - 1) + r.slice(st.curCol); st.curCol--; }
                else if (st.curRow > 0) { const pl = lines[st.curRow - 1].length; lines[st.curRow - 1] += lines[st.curRow]; lines.splice(st.curRow, 1); st.curRow--; st.curCol = pl; if (st.curRow < st.scrollRow) st.scrollRow = st.curRow; }
                st.modified = true; break;
            case "Delete":
                if (st.selAnchorRow !== null) { this.deleteSel(st); }
                else if (st.curCol < lines[st.curRow].length) { const r = lines[st.curRow]; lines[st.curRow] = r.slice(0, st.curCol) + r.slice(st.curCol + 1); }
                else if (st.curRow < lines.length - 1) { lines[st.curRow] += lines[st.curRow + 1]; lines.splice(st.curRow + 1, 1); }
                st.modified = true; break;
            case "Tab":
                if (st.selAnchorRow !== null) {
                    const ar = st.selAnchorRow!, cr2 = st.curRow;
                    const r0 = Math.min(ar, cr2), r1 = Math.max(ar, cr2);
                    for (let r = r0; r <= r1; r++) {
                        if (shift) { if (lines[r].startsWith("    ")) lines[r] = lines[r].slice(4); }
                        else lines[r] = "    " + lines[r];
                    }
                    st.modified = true; break;
                }
                if (shift) { const r = lines[st.curRow]; if (r.startsWith("    ")) { lines[st.curRow] = r.slice(4); st.curCol = Math.max(0, st.curCol - 4); } }
                else { const r = lines[st.curRow]; lines[st.curRow] = r.slice(0, st.curCol) + "    " + r.slice(st.curCol); st.curCol += 4; }
                st.modified = true; break;
            default:
                if (key.length === 1 && !ctrl && !kd.meta) {
                    if (st.selAnchorRow !== null) this.deleteSel(st);
                    const r = lines[st.curRow];
                    lines[st.curRow] = r.slice(0, st.curCol) + key + r.slice(st.curCol);
                    st.curCol++; st.modified = true;
                }
        }
        this.ensureVisible(st, maxRows);
        this.render(winId);
    }

    private ensureVisible(st: EdState, maxRows: number): void {
        if (st.curRow < st.scrollRow) st.scrollRow = st.curRow;
        if (st.curRow >= st.scrollRow + maxRows) st.scrollRow = st.curRow - maxRows + 1;
    }

    // ─── Paste ───────────────────────────────────────────────────────────────

    pasteText(winId: number, text: string): void {
        // Check clipboard service pending first
        if (this.clipboard.resolvePaste(winId, text)) return;

        const st = this.state.get(winId);
        if (!st) return;
        if (st.selAnchorRow !== null) this.deleteSel(st);
        const pasteLines = text.split("\n");
        const row = st.lines[st.curRow];
        const before = row.slice(0, st.curCol), after = row.slice(st.curCol);

        if (pasteLines.length === 1) {
            st.lines[st.curRow] = before + pasteLines[0] + after;
            st.curCol += pasteLines[0].length;
        } else {
            st.lines[st.curRow] = before + pasteLines[0];
            for (let i = 1; i < pasteLines.length - 1; i++) st.lines.splice(st.curRow + i, 0, pasteLines[i]);
            st.lines.splice(st.curRow + pasteLines.length - 1, 0, pasteLines[pasteLines.length - 1] + after);
            st.curRow += pasteLines.length - 1;
            st.curCol = pasteLines[pasteLines.length - 1].length;
        }
        st.modified = true; st.blinkReset = Date.now();
        this.render(winId);
    }

    // ─── Save ────────────────────────────────────────────────────────────────

    saveEditor(winId: number): void {
        const st = this.state.get(winId);
        if (!st || !st.path) return;
        try {
            writeFile(this.svc.vfs, st.path, st.lines.join("\n"));
            st.modified = false;
        } catch (err) {
            this.svc.log("warn", `[editor] save: ${String(err)}`);
        }
    }

    savePublic(winId: number): void { this.saveEditor(winId); this.render(winId); }
    selectAll(winId: number): void {
        const st = this.state.get(winId);
        if (!st) return;
        st.selAnchorRow = 0; st.selAnchorCol = 0;
        st.curRow = st.lines.length - 1; st.curCol = st.lines[st.curRow].length;
        this.render(winId);
    }
    copySelection(winId: number): void {
        const st = this.state.get(winId);
        if (!st) return;
        this.clipboard.writeSelection(this.selectionText(st));
    }

    // ─── Save dialog (unsaved changes) ───────────────────────────────────────

    private showSaveDialog(sourceWinId: number): void {
        const src = this.svc.getWindow(sourceWinId);
        const st = this.state.get(sourceWinId);
        if (!src || !st) return;

        const sb = src.bounds;
        const W = 340, H = 140;
        const dx = Math.round(sb.x + (sb.width - W) / 2);
        const dy = Math.round(sb.y + (sb.height - H) / 2);

        openModal({
            title: "Unsaved Changes",
            body: `"${src.title}" has unsaved changes.`,
            width: W, height: H,
            anchorX: dx + W / 2, anchorY: dy + H / 2,
            buttons: [
                { label: "Save", variant: "primary", action: () => {
                    if (st.path) { this.saveEditor(sourceWinId); }
                    else { this.openSaveAs?.(sourceWinId); return; }
                    this.state.delete(sourceWinId);
                    this.svc.forceDestroyWindow(sourceWinId);
                }},
                { label: "Discard", variant: "danger", action: () => {
                    this.state.delete(sourceWinId);
                    this.svc.forceDestroyWindow(sourceWinId);
                }},
                { label: "Cancel", variant: "outline", action: () => {} },
            ],
        }, this.svc, this.theme);
    }
}
