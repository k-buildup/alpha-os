import { EventEmitter } from "events";
import type { InputEvent, KeyboardEventData } from "../types/index.js";

export class KeyboardDriver extends EventEmitter {
    private _initialized = false;
    private readonly _pressedKeys = new Set<string>();

    initialize(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
    }

    /**
     * Inject a keyboard event from the simulator or bare-metal input reader.
     */
    injectEvent(type: "keydown" | "keyup", data: KeyboardEventData): void {
        if (type === "keydown") {
            this._pressedKeys.add(data.code);
        } else {
            this._pressedKeys.delete(data.code);
        }

        const event: InputEvent = {
            type,
            timestamp: Date.now(),
            data,
        };

        this.emit("event", event);
        this.emit(type, data);
    }

    isPressed(code: string): boolean {
        return this._pressedKeys.has(code);
    }

    getPressedKeys(): Set<string> {
        return new Set(this._pressedKeys);
    }

    // Helper to build KeyboardEventData from a raw key name
    static buildData(
        key: string,
        opts: Partial<Omit<KeyboardEventData, "key">> = {},
    ): KeyboardEventData {
        return {
            key,
            code: opts.code ?? `Key${key.toUpperCase()}`,
            ctrl: opts.ctrl ?? false,
            shift: opts.shift ?? false,
            alt: opts.alt ?? false,
            meta: opts.meta ?? false,
            repeat: opts.repeat ?? false,
        };
    }
}
