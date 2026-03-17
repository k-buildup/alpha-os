import { EventEmitter } from "events";
import { MemoryManager } from "./MemoryManager.js";
import { ProcessManager } from "./ProcessManager.js";
import { Scheduler } from "./Scheduler.js";
import { SyscallHandler } from "./Syscall.js";
import { DisplayDriver } from "../drivers/DisplayDriver.js";
import { KeyboardDriver } from "../drivers/KeyboardDriver.js";
import { MouseDriver } from "../drivers/MouseDriver.js";
import { VirtualFS } from "../vfs/VirtualFS.js";
import { WindowManager } from "../window/WindowManager.js";
import { Shell } from "../shell/Shell.js";
import { AppRegistry } from "../apps/AppRegistry.js";
import type { KernelServices } from "../services/KernelServices.js";
import type { OsWindow, WindowCreateOpts } from "../window/OsWindow.js";

export interface KernelConfig {
    displayWidth:  number;
    displayHeight: number;
    memorySize:    number;
    tickRate:      number;
    debug:         boolean;
}

export type LogLevel = "info" | "warn" | "error";

/**
 * Kernel — Core system
 *
 * Now implements KernelServices, providing a narrow interface for apps.
 * The monolithic AppManager is replaced by AppRegistry (composition of focused apps).
 */
export class Kernel extends EventEmitter implements KernelServices {
    private static _instance: Kernel | null = null;

    public readonly config:         KernelConfig;
    public readonly memoryManager:  MemoryManager;
    public readonly processManager: ProcessManager;
    public readonly scheduler:      Scheduler;
    public readonly syscall:        SyscallHandler;
    public readonly display:        DisplayDriver;
    public readonly keyboard:       KeyboardDriver;
    public readonly mouse:          MouseDriver;
    public readonly vfs:            VirtualFS;
    public readonly windowManager:  WindowManager;
    public readonly shell:          Shell;

    /** Replaces monolithic AppManager */
    public readonly appManager:     AppRegistry;

    private tickInterval: ReturnType<typeof setInterval> | null = null;
    private _uptime  = 0;
    private _running = false;
    private readonly _logBuffer: Array<{ level: LogLevel; msg: string; time: number }> = [];

    constructor(config: Partial<KernelConfig> = {}) {
        super();
        this.setMaxListeners(200);
        this.config = {
            displayWidth:  config.displayWidth  ?? 1280,
            displayHeight: config.displayHeight ?? 720,
            memorySize:    config.memorySize    ?? 256 * 1024 * 1024,
            tickRate:      config.tickRate      ?? 60,
            debug:         config.debug         ?? false,
        };

        this.memoryManager  = new MemoryManager(this.config.memorySize);
        this.processManager = new ProcessManager(this);
        this.scheduler      = new Scheduler(this.processManager);
        this.display        = new DisplayDriver(this.config.displayWidth, this.config.displayHeight);
        this.keyboard       = new KeyboardDriver();
        this.mouse          = new MouseDriver();
        this.vfs            = new VirtualFS();
        this.windowManager  = new WindowManager(this);
        this.shell          = new Shell(this);

        // AppRegistry receives `this` as KernelServices
        this.appManager     = new AppRegistry(this);

        this.syscall        = new SyscallHandler(this);

        this.keyboard.on("event", (e: unknown) => this.emit("input", e));
        this.mouse.on("event",    (e: unknown) => this.emit("input", e));
        this.on("input", (e: unknown) => this.windowManager.routeInputEvent(e as import("../types/index.js").InputEvent));
    }

    static getInstance(config?: Partial<KernelConfig>): Kernel {
        if (!Kernel._instance) Kernel._instance = new Kernel(config);
        return Kernel._instance;
    }
    static reset(): void { Kernel._instance = null; }

    // ─── Boot ─────────────────────────────────────────────────────────────────

    async boot(): Promise<void> {
        if (this._running) throw new Error("Kernel already running");
        this.log("info", "AlphaOS v0.1.0 booting...");
        this.log("info", `Memory: ${Math.round(this.config.memorySize / 1024 / 1024)} MiB`);
        this.log("info", `Display: ${this.config.displayWidth}×${this.config.displayHeight}`);
        this.log("info", `Tick rate: ${this.config.tickRate} Hz`);

        await this.vfs.initialize();
        this._seedVFS();
        this.display.initialize();
        this.keyboard.initialize();
        this.mouse.initialize();
        this.windowManager.initialize();

        this.log("info", "[kernel] All subsystems online");
        this.processManager.spawnInit();
        this._running = true;
        this.tickInterval = setInterval(() => this._tick(), 1000 / this.config.tickRate);
        this.emit("boot:complete");
        this.log("info", "[kernel] Boot complete");
    }

    shutdown(exitCode = 0): void {
        if (!this._running) return;
        this.log("info", "[kernel] Shutting down...");
        this._running = false;
        if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
        this.processManager.killAll();
        this.emit("shutdown", { exitCode, uptime: this._uptime });
        Kernel._instance = null;
    }

    panic(message: string): never {
        this.log("error", `[KERNEL PANIC] ${message}`);
        this.emit("panic", { message });
        if (this.tickInterval) clearInterval(this.tickInterval);
        throw new Error(`Kernel panic: ${message}`);
    }

    log(level: LogLevel, message: string): void {
        const entry = { level, msg: message, time: Date.now() };
        this._logBuffer.push(entry);
        if (this._logBuffer.length > 1000) this._logBuffer.shift();
        this.emit("log", entry);
        if (this.config.debug || level !== "info") {
            if (level === "error") console.error(`[${level.toUpperCase()}]`, message);
            else if (level === "warn") console.warn(`[${level.toUpperCase()}]`, message);
            else console.info(`[${level.toUpperCase()}]`, message);
        }
    }

    get uptime():  number  { return this._uptime; }
    get running(): boolean { return this._running; }

    getStatus(): Record<string, unknown> {
        return {
            running:   this._running,
            uptime:    this._uptime,
            processes: this.processManager.count(),
            memory:    this.memoryManager.getStats(),
            scheduler: this.scheduler.getStats(),
            windows:   this.windowManager.count(),
        };
    }

    // ─── KernelServices implementation ───────────────────────────────────────

    get displayWidth():  number { return this.config.displayWidth; }
    get displayHeight(): number { return this.config.displayHeight; }

    createWindow(opts: WindowCreateOpts): number {
        return this.windowManager.createWindow(opts);
    }
    getWindow(id: number): OsWindow | undefined {
        return this.windowManager.getWindow(id);
    }
    forceDestroyWindow(id: number): void {
        this.windowManager.forceDestroyWindow(id);
    }
    setFocus(id: number): void {
        this.windowManager.setFocus(id);
    }
    listWindows(): OsWindow[] {
        return this.windowManager.list();
    }

    attachTerminal(winId: number): void {
        if (winId === -1) {
            // Create new terminal
            (this.windowManager as unknown as { _openNewTerminal(): void })._openNewTerminal();
        } else {
            this.shell.attachWindow(winId);
        }
    }

    setShellDarkMode(dark: boolean): void {
        this.shell.darkMode = dark;
    }

    rerenderShellSessions(): void {
        for (const s of this.shell.sessions.values()) {
            this.shell.rerenderSession(s.windowId);
        }
    }

    getSystemStatus() {
        const mem = this.memoryManager.getStats();
        const sched = this.scheduler.getStats();
        return {
            uptime: this._uptime,
            memStats: { total: mem.total, used: mem.used, free: mem.free },
            schedStats: { ticks: sched.ticks, contextSwitches: sched.contextSwitches },
            windowCount: this.windowManager.count(),
            processCount: this.processManager.count(),
            displayWidth: this.config.displayWidth,
            displayHeight: this.config.displayHeight,
            tickRate: this.config.tickRate,
        };
    }

    // ─── Tick ─────────────────────────────────────────────────────────────────

    private _tick(): void {
        this._uptime += 1 / this.config.tickRate;
        this.scheduler.tick();
        this.shell.tickRender();
        this.appManager.tickRender();
        this.windowManager.composite();
        this.emit("tick", this._uptime);
    }

    // ─── VFS seed ─────────────────────────────────────────────────────────────

    private _seedVFS(): void {
        const vfs = this.vfs;
        const dirs = ["/home/user", "/home/user/Documents", "/home/user/Downloads",
                      "/home/user/Desktop", "/etc", "/usr", "/usr/bin", "/var/log"];
        for (const d of dirs) { try { vfs.mkdir(d); } catch { /* exists */ } }

        const write = (path: string, content: string): void => {
            try {
                const fd = vfs.open(path, 0x40 | 0x200, 0);
                vfs.write(fd, Buffer.from(content));
                vfs.close(fd);
            } catch { /* ignore */ }
        };

        write("/proc/version",        "AlphaOS v0.1.0 (TypeScript)\n");
        write("/etc/hostname",        "alphaos\n");
        write("/etc/os-release",      "NAME=AlphaOS\nVERSION=0.1.0\nID=alphaos\n");
        write("/home/user/readme.md", "# Welcome to AlphaOS\n\nA TypeScript OS framework.\n\nCommands: help, ls, cd, cat, mkdir, touch, write, grep, ps, mem\n");
        write("/home/user/hello.txt", "Hello from AlphaOS!\nThis is a text file.\n");
        write("/home/user/Documents/notes.txt", "Meeting notes:\n- Build the OS\n- Fix the bugs\n- Ship it\n");
        write("/var/log/boot.log",    `[boot] AlphaOS started at ${new Date().toISOString()}\n`);
    }
}
