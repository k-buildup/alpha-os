/* eslint-disable @typescript-eslint/no-require-imports */
// Electron main process — simulator entry point

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { app, BrowserWindow, ipcMain, Menu } = require("electron") as typeof import("electron");

import * as path from "path";
import { Kernel } from "../src/kernel/Kernel.js";
import type { RendererToKernel, DrawCommand, KeyboardEventData, MouseEventData } from "../src/types/index.js";

const DISPLAY_W  = 1280;
const DISPLAY_H  = 720;
const TICK_RATE  = 60;

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let kernel: Kernel | null = null;

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width:           DISPLAY_W,
        height:          DISPLAY_H + 32,
        minWidth:        800,
        minHeight:       500,
        frame:           false,
        resizable:       true,
        backgroundColor: "#11111b",
        show:            false,
        title:           "AlphaOS Simulator",
        webPreferences: {
            preload:          path.join(__dirname, "preload.js"),
            nodeIntegration:  false,
            contextIsolation: true,
            sandbox:          false,
        },
    });

    Menu.setApplicationMenu(null);
    mainWindow.loadFile(path.join(__dirname, "index.html"));

    mainWindow.once("ready-to-show", () => {
        mainWindow?.show();
        mainWindow?.focus();
    });

    mainWindow.on("closed", () => {
        kernel?.shutdown(0);
        mainWindow = null;
    });
}

// ─── IPC bridge ───────────────────────────────────────────────────────────────

function setupIPC(): void {
    ipcMain.on("renderer-event", (_event: unknown, message: RendererToKernel) => {
        if (!kernel) return;
        switch (message.type) {
            case "input_event": {
                const e = message.event;
                if (e.type === "keydown" || e.type === "keyup") {
                    kernel.keyboard.injectEvent(e.type, e.data as KeyboardEventData);
                } else if (
                    e.type === "mousedown" ||
                    e.type === "mouseup"   ||
                    e.type === "mousemove" ||
                    e.type === "wheel"
                ) {
                    kernel.mouse.injectEvent(e.type as "mousedown" | "mouseup" | "mousemove" | "wheel", e.data as MouseEventData);
                }
                break;
            }
            case "shutdown_request":
                kernel.shutdown(0);
                app.quit();
                break;
            case "resize":
                // Future: reinitialize display at new size
                break;
        }
    });

    // Window control events from renderer titlebar
    ipcMain.on("window-action", (_event: unknown, action: string) => {
        if (!mainWindow) return;
        if (action === "minimize")  mainWindow.minimize();
        if (action === "maximize")  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
        if (action === "close")     mainWindow.close();
    });
}

// ─── Frame pump  kernel → renderer ───────────────────────────────────────────

function startFramePump(): void {
    if (!kernel || !mainWindow) return;

    // Send draw command list every kernel tick
    kernel.on("tick", () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        // Access the internal command queue that was built during composite()
        const display    = kernel!.display;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cmdQueue   = (display as any)["_commandQueue"] as DrawCommand[];

        mainWindow.webContents.send("kernel-event", {
            type:         "frame",
            width:        display.width,
            height:       display.height,
            drawCommands: [...cmdQueue],
            status: {
                uptime:      kernel!.uptime,
                processes:   kernel!.processManager.count(),
                windows:     kernel!.windowManager.count(),
                memory:      kernel!.memoryManager.getStats(),
                scheduler:   kernel!.scheduler.getStats(),
                processList: kernel!.processManager.list(),
            },
        });
    });

    kernel.on("log", (entry: { level: string; msg: string }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("kernel-event", {
            type:    "log",
            level:   entry.level,
            message: entry.msg,
        });
    });

    kernel.on("shutdown", ({ exitCode }: { exitCode: number }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("kernel-event", { type: "shutdown" });
        setTimeout(() => app.quit(), 1200);
        void exitCode;
    });

    kernel.on("panic", ({ message }: { message: string }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("kernel-event", { type: "panic", message });
    });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    createWindow();
    setupIPC();

    kernel = new Kernel({
        displayWidth:  DISPLAY_W,
        displayHeight: DISPLAY_H,
        memorySize:    256 * 1024 * 1024,
        tickRate:      TICK_RATE,
        debug:         process.argv.includes("--debug"),
    });

    mainWindow!.webContents.once("did-finish-load", async () => {
        startFramePump();
        mainWindow!.webContents.send("kernel-event", {
            type: "boot_start", width: DISPLAY_W, height: DISPLAY_H,
        });
        await kernel!.boot();
        mainWindow!.webContents.send("kernel-event", { type: "boot_complete" });
    });
});

app.on("window-all-closed", () => {
    kernel?.shutdown(0);
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Single-instance guard
if (!app.requestSingleInstanceLock()) {
    app.quit();
}
