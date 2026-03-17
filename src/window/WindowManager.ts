import { EventEmitter } from "events";
import { OsWindow } from "./OsWindow.js";
import type { WindowCreateOpts } from "./OsWindow.js";
import type { InputEvent, DrawCommand, ColorHex, KeyboardEventData } from "../types/index.js";
import type { Kernel } from "../kernel/Kernel.js";

let _winIdCounter = 1;

export class WindowManager extends EventEmitter {
    private readonly kernel: Kernel;
    private readonly windows = new Map<number, OsWindow>();
    private _focusedId: number | null = null;
    private _zTop = 0;

    constructor(kernel: Kernel) {
        super();
        this.kernel = kernel;
    }

    initialize(): void {
        this.kernel.log("info", "[wm] WindowManager initialized");
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    createWindow(opts: WindowCreateOpts): number {
        const id  = _winIdCounter++;
        const win = new OsWindow(id, opts, ++this._zTop);

        // Note: close is handled via destroyWindow() — no internal listener needed.
        this.windows.set(id, win);
        this.setFocus(id);
        this.kernel.log("info", `[wm] Window ${id} created: "${opts.title}"`);
        this.emit("window_created", win.toDescriptor());
        return id;
    }

    destroyWindow(id: number): void {
        const win = this.windows.get(id);
        if (!win) return;

        if (win.listenerCount("close") > 0) {
            let cancelled = false;
            const cancel = (): void => { cancelled = true; };
            // Call listeners but keep them attached (clone array first)
            const listeners = [...win.rawListeners("close")] as ((cancel?: () => void) => void)[];
            for (const fn of listeners) fn(cancel);
            if (cancelled) return;            // a listener blocked close
            if (!this.windows.has(id)) return; // already destroyed by listener
        }

        this._doDestroyWindow(id);
    }

    private _doDestroyWindow(id: number): void {
        if (!this.windows.has(id)) return;
        this.kernel.shell.detachWindow(id);
        this.windows.delete(id);

        if (this._focusedId === id) {
            const newFocused = this._topWindow();
            this._focusedId  = newFocused?.id ?? null;
            if (newFocused) newFocused.focused = true;
        }

        this.kernel.log("info", `[wm] Window ${id} destroyed`);
        this.emit("window_destroyed", { id });
    }

    forceDestroyWindow(id: number): void {
        this._doDestroyWindow(id);
    }

    setFocus(id: number): void {
        const prev = this._focusedId;

        // Unfocus previous (skip if same id, unless its .focused is wrong)
        if (prev !== null && prev !== id) {
            const prevWin = this.windows.get(prev);
            if (prevWin) prevWin.focused = false;
        }

        this._focusedId = id;
        const win = this.windows.get(id);
        if (win) {
            win.focused = true;
            win.zIndex  = ++this._zTop;
        }

        if (prev !== id) {
            this.emit("focus_changed", { from: prev, to: id });
        }
    }

    submitDrawCommands(winId: number, commands: DrawCommand[]): void {
        this.windows.get(winId)?.submitCommands(commands);
    }

    // ─── Input routing ────────────────────────────────────────────────────────

    routeInputEvent(event: InputEvent): void {
        if (this._focusedId === null) return;
        const focusedWin = this.windows.get(this._focusedId);

        if (event.type === "keydown" || event.type === "keyup") {
            if (event.type === "keydown") {
                const kd = event.data as KeyboardEventData;
                if (kd.ctrl && kd.alt && kd.key === "t") { this._openNewTerminal(); return; }
                // Route to shell (only if window has a shell session)
                this.kernel.shell.handleInput(this._focusedId, kd);
            }
            // Also emit to window listeners (e.g. AppManager handlers)
            focusedWin?.emit("input", event);
            return;
        }

        // Mouse events → emit to focused window's listeners
        if (
            event.type === "mousedown" ||
            event.type === "mouseup"   ||
            event.type === "mousemove" ||
            event.type === "wheel"
        ) {
            if (focusedWin) {
                const m = event.data as import("../types/index.js").MouseEventData;
                const localEvent: InputEvent = {
                    ...event,
                    data: { ...m, x: m.x - focusedWin.bounds.x, y: m.y - focusedWin.bounds.y },
                };
                focusedWin.emit("input", localEvent);
                // Also route wheel to shell (terminal scroll)
                if (event.type === "wheel") {
                    this.kernel.shell.handleScroll(this._focusedId, m.deltaY ?? 0);
                }
            }
        }
    }

    // ─── Desktop boot ─────────────────────────────────────────────────────────

    launchDesktop(): void {
        const k = this.kernel;

        // Desktop background (no chrome, z-index lowest)
        const desktopId = this.createWindow({
            title: "__desktop__",
            x: 0, y: 0,
            width: k.config.displayWidth,
            height: k.config.displayHeight,
            ownerPID: 1, backgroundColor: "transparent",
            decorations: false, resizable: false,
        });
        k.appManager.renderDesktop(desktopId);

        // Open Terminal on boot
        const termId = this.createWindow({
            title: "Terminal",
            x: 120, y: 80, width: 580, height: 400,
            ownerPID: 1, backgroundColor: "#ffffff",
            minWidth: 300, minHeight: 200,
        });
        k.shell.attachWindow(termId);
    }

    // ─── Compositor — content only, no chrome ────────────────────────────────

    composite(): void {
        // Nothing to composite server-side — renderer draws chrome and blits window content.
        // But we do need to notify apps that a window was resized so they can re-render.
        for (const win of this.windows.values()) {
            const b = win.bounds;
            const prev = (win as unknown as { _lastRenderBounds?: { w: number; h: number } })._lastRenderBounds;
            if (!prev || prev.w !== b.width || prev.h !== b.height) {
                (win as unknown as { _lastRenderBounds: { w: number; h: number } })._lastRenderBounds = { w: b.width, h: b.height };
                win.emit("resize", { width: b.width, height: b.height });
            }
        }
        this.kernel.display.flush();
    }

    // ─── Accessors ────────────────────────────────────────────────────────────

    count(): number { return this.windows.size; }
    getWindow(id: number): OsWindow | undefined { return this.windows.get(id); }
    list(): OsWindow[] { return [...this.windows.values()]; }
    getFocusedId(): number | null { return this._focusedId; }

    /** Returns serialisable snapshot for the renderer. */
    getFrameData(): object[] {
        return [...this.windows.values()]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map(win => ({
                id:           win.id,
                title:        win.title,
                x:            win.bounds.x,
                y:            win.bounds.y,
                width:        win.bounds.width,
                height:       win.bounds.height,
                focused:      win.focused,
                state:        win.state,
                zIndex:       win.zIndex,
                ownerPID:     win.ownerPID,
                bgColor:      win.backgroundColor,
                decorations:  win.decorations,
                resizable:    win.resizable,
                drawCommands: win.flushDrawQueue(),
            }));
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    private _topWindow(): OsWindow | null {
        let top: OsWindow | null = null;
        for (const w of this.windows.values()) {
            if (!top || w.zIndex > top.zIndex) top = w;
        }
        return top;
    }

    private _openNewTerminal(): void {
        const n  = [...this.windows.values()].filter(w => w.title.startsWith("Terminal")).length;
        const id = this.createWindow({
            title: `Terminal ${n + 1}`,
            x: 80 + n * 40, y: 80 + n * 40,
            width: 560, height: 380,
            ownerPID: 1, backgroundColor: "#ffffff",
        });
        this.kernel.shell.attachWindow(id);
    }
}
