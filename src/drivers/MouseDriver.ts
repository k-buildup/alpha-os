import { EventEmitter } from "events";
import type { InputEvent, MouseEventData } from "../types/index.js";

export class MouseDriver extends EventEmitter {
    private _initialized = false;
    private _x = 0;
    private _y = 0;
    private _buttons = 0;
    private readonly _cursorPixels: Uint8ClampedArray;

    constructor() {
        super();
        // 12×20 cursor bitmap (RGBA)
        this._cursorPixels = new Uint8ClampedArray(12 * 20 * 4).fill(0);
        this._drawDefaultCursor();
    }

    initialize(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
    }

    injectEvent(
        type: "mousedown" | "mouseup" | "mousemove" | "wheel",
        data: MouseEventData,
    ): void {
        this._x = data.x;
        this._y = data.y;

        if (type === "mousedown") {
            this._buttons |= 1 << data.button;
        } else if (type === "mouseup") {
            this._buttons &= ~(1 << data.button);
        }

        const event: InputEvent = { type, timestamp: Date.now(), data: { ...data, buttons: this._buttons } };
        this.emit("event", event);
        this.emit(type, data);
    }

    get x(): number {
        return this._x;
    }

    get y(): number {
        return this._y;
    }

    get buttons(): number {
        return this._buttons;
    }

    isButtonDown(button: number): boolean {
        return (this._buttons & (1 << button)) !== 0;
    }

    getCursorPixels(): Uint8ClampedArray {
        return this._cursorPixels;
    }

    // ─── Default arrow cursor ─────────────────────────────────────────────────

    private _drawDefaultCursor(): void {
        const W = 12;
        // Simple arrow: draw left edge diagonal
        for (let row = 0; row < 20; row++) {
            for (let col = 0; col <= Math.min(row, W - 1); col++) {
                const fill = col === 0 || col === row || row === 19 ? [0, 0, 0, 255] : [255, 255, 255, 220];
                const idx = (row * W + col) * 4;
                this._cursorPixels[idx] = fill[0];
                this._cursorPixels[idx + 1] = fill[1];
                this._cursorPixels[idx + 2] = fill[2];
                this._cursorPixels[idx + 3] = fill[3];
            }
        }
    }
}
