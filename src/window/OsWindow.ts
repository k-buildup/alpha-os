import { EventEmitter } from "events";
import type { DrawCommand, Rect, WindowDescriptor } from "../types/index.js";
import { WindowState } from "../types/index.js";

// These mirror the renderer's TITLE_H and BORDER constants
const TITLE_BAR_HEIGHT = 36;
const BORDER_SIZE      = 1;
const MENU_BAR_H       = 26; // OS top menu bar — must leave room

export interface WindowCreateOpts {
    title: string;
    x: number; y: number; width: number; height: number;
    ownerPID: number;
    resizable?:       boolean;
    decorations?:     boolean;
    backgroundColor?: string;
    minWidth?:        number;  // minimum content width
    minHeight?:       number;  // minimum content height
}

export class OsWindow extends EventEmitter {
    public readonly id:       number;
    public readonly ownerPID: number;

    private _title:   string;
    private _x:       number;
    private _y:       number;
    private _width:   number;
    private _height:  number;
    private _state:   WindowState = WindowState.NORMAL;
    private _focused: boolean     = false;
    private _zIndex:  number;
    private _resizable:   boolean;
    private _decorations: boolean;
    private _bgColor:     string;
    private _minWidth:    number;
    private _minHeight:   number;
    private _drawQueue:   DrawCommand[] = [];

    // Saved bounds before maximize
    private _savedBounds: { x: number; y: number; width: number; height: number } | null = null;

    constructor(id: number, opts: WindowCreateOpts, zIndex = 0) {
        super();
        this.id       = id;
        this.ownerPID = opts.ownerPID;
        this._title   = opts.title;
        this._x       = opts.x;
        this._y       = opts.y;
        this._width   = opts.width;
        this._height  = opts.height;
        this._zIndex  = zIndex;
        this._resizable   = opts.resizable   ?? true;
        this._decorations = opts.decorations ?? true;
        this._bgColor     = opts.backgroundColor ?? "#09090b";
        this._minWidth    = opts.minWidth  ?? 240;
        this._minHeight   = opts.minHeight ?? 160;
    }

    // ─── Draw queue ───────────────────────────────────────────────────────────

    submitCommands(cmds: DrawCommand[]): void {
        this._drawQueue = cmds;
    }

    flushDrawQueue(): DrawCommand[] {
        return this._drawQueue;
    }

    clearDrawQueue(): void {
        this._drawQueue = [];
    }

    // ─── Bounds ───────────────────────────────────────────────────────────────

    setBounds(x: number | null, y: number | null, w: number | null, h: number | null): void {
        if (x !== null) this._x = x;
        if (y !== null) this._y = y;
        if (w !== null) this._width  = Math.max(this._minWidth,  w);
        if (h !== null) this._height = Math.max(this._minHeight, h);
        this.emit("resize", { width: this._width, height: this._height });
    }

    // ─── State ────────────────────────────────────────────────────────────────

    minimize(): void {
        this._state = WindowState.MINIMIZED;
        this.emit("minimize");
    }

    maximize(screenW: number, screenH: number): void {
        this._savedBounds = { x: this._x, y: this._y, width: this._width, height: this._height };
        // Content starts below OS menu bar (26px) + chrome (TITLE_H=36 + BORDER=1)
        this._x = BORDER_SIZE;
        this._y = MENU_BAR_H + TITLE_BAR_HEIGHT + BORDER_SIZE;
        this._width  = screenW - BORDER_SIZE * 2;
        this._height = screenH - MENU_BAR_H - TITLE_BAR_HEIGHT - BORDER_SIZE * 2;
        this._state = WindowState.MAXIMIZED;
        this.emit("maximize");
    }

    restore(): void {
        if (this._savedBounds) {
            this._x = this._savedBounds.x;
            this._y = this._savedBounds.y;
            this._width  = this._savedBounds.width;
            this._height = this._savedBounds.height;
            this._savedBounds = null;
        }
        this._state = WindowState.NORMAL;
        this.emit("restore");
    }

    close(): void {
        this.emit("close");
    }

    // ─── Accessors ────────────────────────────────────────────────────────────

    get title(): string  { return this._title; }
    set title(v: string) { this._title = v; }

    get bounds(): Rect { return { x: this._x, y: this._y, width: this._width, height: this._height }; }
    get state():  WindowState { return this._state; }

    get focused(): boolean     { return this._focused; }
    set focused(v: boolean)    { this._focused = v; }

    get zIndex(): number       { return this._zIndex; }
    set zIndex(v: number)      { this._zIndex = v; }

    get surfaceWidth():  number { return this._width; }
    get surfaceHeight(): number { return this._height; }
    get backgroundColor(): string { return this._bgColor; }
    get decorations():     boolean { return this._decorations; }
    get resizable():       boolean { return this._resizable; }
    get hasPendingCommands(): boolean { return this._drawQueue.length > 0; }

    toDescriptor(): WindowDescriptor {
        return {
            id: this.id, title: this._title,
            bounds: this.bounds, zIndex: this._zIndex,
            state: this._state, focused: this._focused,
            ownerPID: this.ownerPID, resizable: this._resizable,
            decorations: this._decorations, opacity: 1,
            backgroundColor: this._bgColor as `#${string}`,
        };
    }
}
