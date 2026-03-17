/**
 * Single-line text input field.
 * Keyboard logic identical to the multi-line text editor (no newlines).
 */

export interface InputFieldState {
    value:    string;
    cursor:   number;
    selStart: number | null;
    blink:    number;
    // internal double-click tracking
    _lastClick: number;
    _lastClickPos: number;
}

/** Geometry options passed to every mouse handler */
export interface InputFieldOpts {
    x:       number;
    y:       number;
    width:   number;
    height:  number;
    charW?:  number;
    padLeft?: number;
    bgColor?:   string;
    textColor?:  string;
}

export function makeInputField(initial = ""): InputFieldState {
    return { value: initial, cursor: initial.length, selStart: null,
             blink: Date.now(), _lastClick: 0, _lastClickPos: -1 };
}

export function caretVisible(st: InputFieldState): boolean {
    const elapsed = Date.now() - st.blink;
    return elapsed < 500 || Math.floor(elapsed / 500) % 2 === 0;
}

export function inputSelection(st: InputFieldState): string {
    if (st.selStart === null) return "";
    const a = Math.min(st.selStart, st.cursor);
    const b = Math.max(st.selStart, st.cursor);
    return st.value.slice(a, b);
}

function deleteSel(st: InputFieldState): boolean {
    if (st.selStart === null) return false;
    const a = Math.min(st.selStart, st.cursor);
    const b = Math.max(st.selStart, st.cursor);
    st.value = st.value.slice(0, a) + st.value.slice(b);
    st.cursor = a; st.selStart = null;
    return true;
}

function wordLeft(s: string, pos: number): number {
    const m = s.slice(0, pos).match(/(\S+\s*|\s+)$/);
    return pos - (m ? m[0].length : 0);
}
function wordRight(s: string, pos: number): number {
    const m = s.slice(pos).match(/^(\s*\S+|\s+)/);
    return pos + (m ? m[0].length : 0);
}

function isWord(ch: string): boolean { return /\w/.test(ch); }

export interface InputKeyData {
    key:   string;
    ctrl:  boolean;
    shift: boolean;
    meta?: boolean;
}

export function inputHandleKey(
    st: InputFieldState,
    kd: InputKeyData,
): "submit" | "cancel" | "changed" | "moved" | "copy" | "cut" | "paste" | "none" {
    const { key, ctrl, shift } = kd;
    st.blink = Date.now();

    if (key === "Enter")  return "submit";
    if (key === "Escape") return "cancel";

    if (ctrl || kd.meta) {
        switch (key.toLowerCase()) {
            case "a": st.selStart = 0; st.cursor = st.value.length; return "moved";
            case "c": return "copy";
            case "x": return "cut";
            case "v": return "paste";
            case "arrowleft":
                if (shift && st.selStart === null) st.selStart = st.cursor;
                else if (!shift) st.selStart = null;
                st.cursor = wordLeft(st.value, st.cursor); return "moved";
            case "arrowright":
                if (shift && st.selStart === null) st.selStart = st.cursor;
                else if (!shift) st.selStart = null;
                st.cursor = wordRight(st.value, st.cursor); return "moved";
        }
    }

    switch (key) {
        case "ArrowLeft":
            if (shift && st.selStart === null) st.selStart = st.cursor;
            else if (!shift) st.selStart = null;
            st.cursor = Math.max(0, st.cursor - 1); return "moved";
        case "ArrowRight":
            if (shift && st.selStart === null) st.selStart = st.cursor;
            else if (!shift) st.selStart = null;
            st.cursor = Math.min(st.value.length, st.cursor + 1); return "moved";
        case "Home":
            if (shift && st.selStart === null) st.selStart = st.cursor;
            else if (!shift) st.selStart = null;
            st.cursor = 0; return "moved";
        case "End":
            if (shift && st.selStart === null) st.selStart = st.cursor;
            else if (!shift) st.selStart = null;
            st.cursor = st.value.length; return "moved";
        case "Backspace":
            if (!deleteSel(st)) {
                if (ctrl) {
                    const pos = wordLeft(st.value, st.cursor);
                    st.value = st.value.slice(0, pos) + st.value.slice(st.cursor);
                    st.cursor = pos;
                } else if (st.cursor > 0) {
                    st.value = st.value.slice(0, st.cursor - 1) + st.value.slice(st.cursor);
                    st.cursor--;
                }
            }
            return "changed";
        case "Delete":
            if (!deleteSel(st)) {
                if (st.cursor < st.value.length) {
                    st.value = st.value.slice(0, st.cursor) + st.value.slice(st.cursor + 1);
                }
            }
            return "changed";
        default:
            if (key.length === 1 && !ctrl && !kd.meta) {
                deleteSel(st);
                st.value  = st.value.slice(0, st.cursor) + key + st.value.slice(st.cursor);
                st.cursor++;
                return "changed";
            }
    }
    return "none";
}

/** Map a pixel X coordinate to a character index */
function xToCol(st: InputFieldState, opts: InputFieldOpts, px: number): number {
    const charW  = opts.charW  ?? 7.5;
    const padLeft = opts.padLeft ?? 6;
    const relX   = Math.max(0, px - opts.x - padLeft);
    return Math.max(0, Math.min(st.value.length, Math.round(relX / charW)));
}

/** Hit-test: is the point inside the field? */
function hitField(opts: InputFieldOpts, px: number, py: number): boolean {
    return px >= opts.x && px <= opts.x + opts.width &&
           py >= opts.y && py <= opts.y + opts.height;
}

/**
 * Handle mousedown.
 * Returns true if the click hit the field.
 * Supports double-click word select.
 */
export function inputHandleMouseDown(
    st: InputFieldState,
    opts: InputFieldOpts,
    px: number,
    py: number,
): boolean {
    if (!hitField(opts, px, py)) return false;
    const col = xToCol(st, opts, px);
    const now  = Date.now();

    // Double-click: select word
    if (now - st._lastClick < 400 && Math.abs(col - st._lastClickPos) <= 2) {
        const v = st.value;
        let w0 = col, w1 = col;
        if (col < v.length && isWord(v[col])) {
            while (w0 > 0 && isWord(v[w0 - 1])) w0--;
            while (w1 < v.length && isWord(v[w1])) w1++;
        } else if (col > 0 && isWord(v[col - 1])) {
            w1 = col; while (w0 > 0 && isWord(v[w0 - 1])) w0--;
        } else {
            w0 = 0; w1 = v.length;
        }
        st.selStart = w0; st.cursor = w1;
        st._lastClick = 0; // reset so next click is single
    } else {
        st.cursor   = col;
        st.selStart = null;
        st._lastClick    = now;
        st._lastClickPos = col;
    }
    st.blink = Date.now();
    return true;
}

/**
 * Handle mousemove while button is held (drag to select).
 * Call only when isDragging flag is set (set by mousedown returning true).
 */
export function inputHandleMouseMove(
    st: InputFieldState,
    opts: InputFieldOpts,
    px: number,
): void {
    if (st.selStart === null) st.selStart = st.cursor;
    st.cursor = xToCol(st, opts, px);
    st.blink  = Date.now();
}

/**
 * Render the input field.
 * NOTE: charW is only used for hit-testing (inputHandleMouseDown).
 * Actual cursor rendering uses measureText for accuracy.
 */
export function renderInputField(
    st: InputFieldState,
    opts: InputFieldOpts,
): Array<{ type: string; [k: string]: unknown }> {
    const {
        x, y, width, height,
        padLeft = 6,
        bgColor   = "#ffffff",
        textColor  = "#09090b",
    } = opts;
    const borderCol = "#3b82f6";
    const font = `12px 'A2G',system-ui`;
    const out: Array<{ type: string; [k: string]: unknown }> = [];

    out.push({ type:"rect", x, y, width, height, color:bgColor });

    // We need to measure text widths. Since we can't use canvas here,
    // we use charW for selection highlight but emit a special "measured_cursor" hint
    // The renderer will use its own canvas to measureText for the cursor line.
    // For selection, approximate with charW.
    const CW = opts.charW ?? 7.5;
    const PAD = padLeft;

    // Selection highlight using measureText (renderer resolves exact widths)
    if (st.selStart !== null) {
        const a = Math.min(st.selStart, st.cursor);
        const b = Math.max(st.selStart, st.cursor);
        if (b > a) {
            out.push({ type:"textselect",
                       x: x+PAD, y: y+2, height: height-4,
                       pre: st.value.slice(0, a),
                       sel: st.value.slice(a, b),
                       font: `12px 'A2G',system-ui`,
                       selColor: "#bfdbfe" });
        }
    }

    out.push({ type:"text", x: x+PAD, y: y+height-5,
               text: st.value, font, color:textColor });

    // Emit cursor as a special measured command the renderer handles
    if (caretVisible(st)) {
        // Use a "textcursor" type: renderer measures text to position it
        out.push({ type:"textcursor", x: x+PAD, y: y+2, height: height-4,
                   text: st.value.slice(0, st.cursor), font, color: borderCol });
    }

    out.push({ type:"line", x,         y,          x2: x+width, y2: y,          color: borderCol });
    out.push({ type:"line", x,         y: y+height,x2: x+width, y2: y+height,   color: borderCol });
    out.push({ type:"line", x,         y,          x2: x,       y2: y+height,   color: borderCol });
    out.push({ type:"line", x: x+width,y,          x2: x+width, y2: y+height,   color: borderCol });

    return out;
}
