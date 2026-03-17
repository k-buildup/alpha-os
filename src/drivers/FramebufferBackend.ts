import { EventEmitter } from "events";
import * as fs from "fs";
import type { Kernel } from "../kernel/Kernel.js";

/**
 * Bare-metal /dev/fb0 display driver.
 * Writes RGBA framebuffer data directly to the Linux framebuffer device.
 * Used when running inside the ISO (no Electron / browser canvas).
 */
export class FramebufferBackend extends EventEmitter {
    private readonly kernel: Kernel;
    private _fd: number | null = null;
    private _width  = 1024;
    private _height = 768;
    private _bpp    = 32;
    private _stride = 0;
    private _buffer: Buffer | null = null;
    private _interval: ReturnType<typeof setInterval> | null = null;

    constructor(kernel: Kernel) {
        super();
        this.kernel = kernel;
    }

    async initialize(fbDevice = "/dev/fb0"): Promise<void> {
        this._stride = this._width * (this._bpp / 8);
        const bufSize = this._stride * this._height;

        try {
            this._fd = fs.openSync(fbDevice, "r+");
            this._buffer = Buffer.allocUnsafe(bufSize);
            this.kernel.log("info", `[fb] Opened ${fbDevice} — ${this._width}×${this._height} ${this._bpp}bpp`);
        } catch (err) {
            this.kernel.log("warn", `[fb] Cannot open ${fbDevice}: ${String(err)} — using null backend`);
            this._fd = null;
        }

        // Wire kernel tick → framebuffer flush
        this.kernel.on("tick", () => this._flush());
    }

    destroy(): void {
        if (this._interval) {
            clearInterval(this._interval);
        }
        if (this._fd !== null) {
            fs.closeSync(this._fd);
            this._fd = null;
        }
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    private _flush(): void {
        if (this._fd === null || !this._buffer) {
            return;
        }

        const fb = this.kernel.display.getFrameBuffer();
        const srcData = fb.data;

        // Convert RGBA → BGRA (Linux fb0 typically uses BGRA)
        for (let i = 0; i < srcData.length; i += 4) {
            this._buffer[i]     = srcData[i + 2]; // B
            this._buffer[i + 1] = srcData[i + 1]; // G
            this._buffer[i + 2] = srcData[i];     // R
            this._buffer[i + 3] = srcData[i + 3]; // A
        }

        try {
            fs.writeSync(this._fd, this._buffer, 0, this._buffer.length, 0);
        } catch (_err) {
            // Device write failures are non-fatal
        }
    }
}
