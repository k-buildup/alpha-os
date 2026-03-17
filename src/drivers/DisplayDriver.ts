import { EventEmitter } from "events";
import type { DrawCommand, FrameBuffer, Rect } from "../types/index.js";

export type DisplayBackend = "canvas" | "framebuffer" | "null";

/**
 * Display driver: accumulates DrawCommands and serialises a FrameBuffer.
 * The actual rendering is done by the simulator (Electron canvas) or
 * by the native /dev/fb0 backend in the bare-metal image.
 */
export class DisplayDriver extends EventEmitter {
    public readonly width: number;
    public readonly height: number;

    private _backend: DisplayBackend = "null";
    private _frameBuffer: FrameBuffer;
    private _commandQueue: DrawCommand[] = [];
    private _lastFrameCommands: DrawCommand[] = [];
    private _dirty = false;
    private _frameCount = 0;
    private _lastFpsTime = 0;
    private _fps = 0;

    constructor(width: number, height: number) {
        super();
        this.width = width;
        this.height = height;
        this._frameBuffer = {
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
        };
    }

    initialize(backend: DisplayBackend = "null"): void {
        this._backend = backend;
        this._fill(0x1e, 0x1e, 0x2e, 0xff); // Catppuccin Mocha base
        this.emit("init", { width: this.width, height: this.height, backend });
    }

    // ─── Command API ─────────────────────────────────────────────────────────

    submitCommands(commands: DrawCommand[]): void {
        this._commandQueue.push(...commands);
        this._dirty = true;
    }

    submitCommand(cmd: DrawCommand): void {
        this._commandQueue.push(cmd);
        this._dirty = true;
    }

    /**
     * Flush queued commands into the framebuffer.
     * Called each kernel tick by the compositor.
     */
    flush(): FrameBuffer {
        // Snapshot BEFORE clearing — simulator reads this after flush
        this._lastFrameCommands = [...this._commandQueue];

        if (this._commandQueue.length > 0) {
            for (const cmd of this._commandQueue) {
                this._executeCommand(cmd);
            }
            this._commandQueue = [];
        }
        this._updateFPS();
        this._dirty = false;
        return this._frameBuffer;
    }

    get isDirty(): boolean {
        return this._dirty;
    }

    get fps(): number {
        return this._fps;
    }

    get frameCount(): number {
        return this._frameCount;
    }

    /** Commands from the most recently completed frame — safe to read after flush(). */
    get lastFrameCommands(): DrawCommand[] {
        return this._lastFrameCommands;
    }

    getFrameBuffer(): FrameBuffer {
        return this._frameBuffer;
    }

    // ─── Direct pixel access ─────────────────────────────────────────────────

    setPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return;
        }
        const idx = (y * this.width + x) * 4;
        this._frameBuffer.data[idx] = r;
        this._frameBuffer.data[idx + 1] = g;
        this._frameBuffer.data[idx + 2] = b;
        this._frameBuffer.data[idx + 3] = a;
    }

    getPixel(x: number, y: number): [number, number, number, number] {
        const idx = (y * this.width + x) * 4;
        return [
            this._frameBuffer.data[idx],
            this._frameBuffer.data[idx + 1],
            this._frameBuffer.data[idx + 2],
            this._frameBuffer.data[idx + 3],
        ];
    }

    blitRect(src: Uint8ClampedArray, srcWidth: number, dest: Rect): void {
        for (let row = 0; row < dest.height; row++) {
            for (let col = 0; col < dest.width; col++) {
                const srcIdx = (row * srcWidth + col) * 4;
                this.setPixel(
                    dest.x + col,
                    dest.y + row,
                    src[srcIdx],
                    src[srcIdx + 1],
                    src[srcIdx + 2],
                    src[srcIdx + 3],
                );
            }
        }
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    private _fill(r: number, g: number, b: number, a: number): void {
        for (let i = 0; i < this._frameBuffer.data.length; i += 4) {
            this._frameBuffer.data[i] = r;
            this._frameBuffer.data[i + 1] = g;
            this._frameBuffer.data[i + 2] = b;
            this._frameBuffer.data[i + 3] = a;
        }
    }

    private _parseHex(hex: string): [number, number, number, number] {
        const h = hex.replace("#", "");
        if (h.length === 6) {
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
        }
        if (h.length === 8) {
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16)];
        }
        return [255, 255, 255, 255];
    }

    private _executeCommand(cmd: DrawCommand): void {
        switch (cmd.type) {
            case "clear": {
                const [r, g, b, a] = cmd.color ? this._parseHex(cmd.color) : [0x1e, 0x1e, 0x2e, 0xff];
                this._fill(r, g, b, a);
                break;
            }

            case "rect": {
                if (!cmd.width || !cmd.height) {
                    break;
                }
                const [r, g, b, a] = cmd.color ? this._parseHex(cmd.color) : [255, 255, 255, 255];
                for (let y = cmd.y; y < cmd.y + cmd.height; y++) {
                    for (let x = cmd.x; x < cmd.x + cmd.width; x++) {
                        this.setPixel(x, y, r, g, b, a);
                    }
                }
                break;
            }

            case "line": {
                if (cmd.x2 === undefined || cmd.y2 === undefined) {
                    break;
                }
                const [r, g, b, a] = cmd.color ? this._parseHex(cmd.color) : [255, 255, 255, 255];
                // Bresenham's line
                let x0 = Math.round(cmd.x);
                let y0 = Math.round(cmd.y);
                const x1 = Math.round(cmd.x2);
                const y1 = Math.round(cmd.y2);
                const dx = Math.abs(x1 - x0);
                const dy = -Math.abs(y1 - y0);
                const sx = x0 < x1 ? 1 : -1;
                const sy = y0 < y1 ? 1 : -1;
                let err = dx + dy;
                while (true) {
                    this.setPixel(x0, y0, r, g, b, a);
                    if (x0 === x1 && y0 === y1) {
                        break;
                    }
                    const e2 = 2 * err;
                    if (e2 >= dy) {
                        err += dy;
                        x0 += sx;
                    }
                    if (e2 <= dx) {
                        err += dx;
                        y0 += sy;
                    }
                }
                break;
            }

            case "circle": {
                if (!cmd.radius) {
                    break;
                }
                const [r, g, b, a] = cmd.color ? this._parseHex(cmd.color) : [255, 255, 255, 255];
                const cx = cmd.x;
                const cy = cmd.y;
                const rad = cmd.radius;
                for (let y = -rad; y <= rad; y++) {
                    for (let x = -rad; x <= rad; x++) {
                        if (x * x + y * y <= rad * rad) {
                            this.setPixel(cx + x, cy + y, r, g, b, a);
                        }
                    }
                }
                break;
            }

            case "image": {
                if (!cmd.imageData || !cmd.width || !cmd.height) {
                    break;
                }
                this.blitRect(cmd.imageData, cmd.width, { x: cmd.x, y: cmd.y, width: cmd.width, height: cmd.height });
                break;
            }

            case "text":
                // Text rendering delegated to renderer process (canvas 2d ctx)
                this.emit("text_command", cmd);
                break;
        }
    }

    private _updateFPS(): void {
        this._frameCount++;
        const now = Date.now();
        if (now - this._lastFpsTime >= 1000) {
            this._fps = this._frameCount;
            this._frameCount = 0;
            this._lastFpsTime = now;
        }
    }
}
