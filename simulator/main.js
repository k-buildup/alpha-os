"use strict";
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");

let Kernel;
try {
    Kernel = require("../dist/src/kernel/Kernel.js").Kernel;
} catch (e) {
    console.error("[main] Run `npm run build` first");
    process.exit(1);
}

const DISPLAY_W = 1280;
const DISPLAY_H = 720;

let mainWindow = null;
let kernel     = null;
let shuttingDown = false;

// Safe send — never throws even if window is destroyed
function safeSend(channel, data) {
    try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
    } catch (_) { /* window already gone */ }
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
    mainWindow = new BrowserWindow({
        width: DISPLAY_W, height: DISPLAY_H + 32,
        minWidth: 800, minHeight: 500,
        frame: false, resizable: true,
        backgroundColor: "#ffffff",
        show: false, title: "AlphaOS",
        webPreferences: {
            preload:          path.join(__dirname, "preload.js"),
            nodeIntegration:  false,
            contextIsolation: true,
            sandbox:          false,
        },
    });
    Menu.setApplicationMenu(null);
    mainWindow.loadFile(path.join(__dirname, "index.html"));
    mainWindow.once("ready-to-show", () => { mainWindow.show(); mainWindow.focus(); });

    mainWindow.on("close", () => {
        if (!shuttingDown) {
            shuttingDown = true;
            if (kernel) {
                try { kernel.shutdown(0); } catch (_) {}
                kernel = null;
            }
        }
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function setupIPC() {
    ipcMain.on("renderer-event", (_e, msg) => {
        if (!kernel || shuttingDown) return;
        try {
            switch (msg.type) {

                // ── Input ───────────────────────────────────────────────────
                case "input_event": {
                    const ev = msg.event;
                    if (ev.type === "keydown" || ev.type === "keyup")
                        kernel.keyboard.injectEvent(ev.type, ev.data);
                    else if (["mousedown","mouseup","mousemove","wheel"].includes(ev.type))
                        kernel.mouse.injectEvent(ev.type, ev.data);
                    break;
                }

                // ── Window management ────────────────────────────────────────
                case "win_focus":    kernel.windowManager.setFocus(msg.id); break;
                case "win_close":    kernel.windowManager.destroyWindow(msg.id); break;
                case "win_move":     kernel.windowManager.getWindow(msg.id)?.setBounds(msg.x, msg.y, null, null); break;
                case "win_resize":   kernel.windowManager.getWindow(msg.id)?.setBounds(msg.x ?? null, msg.y ?? null, msg.width ?? null, msg.height ?? null); break;
                case "win_minimize": kernel.windowManager.getWindow(msg.id)?.minimize(); break;
                case "win_maximize": {
                    const win = kernel.windowManager.getWindow(msg.id);
                    if (win) { if (win.state === "MAXIMIZED") win.restore(); else win.maximize(DISPLAY_W, DISPLAY_H); }
                    break;
                }

                // ── App launching ────────────────────────────────────────────
                case "dock_app_click":
                    switch (msg.appId) {
                        case "files":    kernel.appManager.openFileExplorer("/home/user"); break;
                        case "terminal": kernel.windowManager._openNewTerminal(); break;
                        case "settings": kernel.appManager.openSettings(); break;
                        case "allapps":  /* handled by renderer launcher overlay */ break;
                        case "newfile":  kernel.appManager.newTextFile(); break;
                        case "sysinfo":  kernel.appManager.openSystemInfo(); break;
                        case "restart":
                            safeSend("kernel-event", { type: "restart" });
                            setTimeout(() => { if (!mainWindow||mainWindow.isDestroyed()) return; mainWindow.reload(); }, 600);
                            break;
                    }
                    break;
                case "desktop_click":
                    kernel.appManager.handleDesktopClick(msg.x, msg.y, msg.dbl || false);
                    break;

                // ── Desktop context menu ─────────────────────────────────────
                case "desktop_context_menu": {
                    const items = kernel.appManager.desktopBuildContextMenu(msg.x, msg.y);
                    safeSend("kernel-event", {
                        type: "desktop_context_menu_result",
                        x: msg.x, y: msg.y,
                        items: items.map(it => ({
                            label:     it.label,
                            danger:    it.danger    || false,
                            hasAction: typeof it.action === "function",
                        })),
                    });
                    break;
                }
                case "desktop_context_action": {
                    const items = kernel.appManager.desktopBuildContextMenu(msg.x, msg.y);
                    const item  = items[msg.idx];
                    if (item && typeof item.action === "function") item.action();
                    break;
                }

                // ── Drag & drop ──────────────────────────────────────────────
                case "fe_drag_info": {
                    const st = kernel.appManager.feState.get(msg.winId);
                    let name = "";
                    if (st) {
                        try {
                            const ents = kernel.vfs.readdir(st.path)
                                .filter(e => e.name !== "." && e.name !== "..");
                            const all = [...ents.filter(e=>e.type==="DIRECTORY"), ...ents.filter(e=>e.type!=="DIRECTORY")];
                            const entry = all[msg.entryIdx + (st.scroll||0)];
                            if (entry) name = entry.name;
                        } catch {/**/}
                    }
                    safeSend("kernel-event", { type:"fe_drag_info_result", name, winId:msg.winId, entryIdx:msg.entryIdx });
                    break;
                }
                case "desktop_drag_info": {
                    let name = "", icon = "📄";
                    try {
                        const ents = kernel.vfs.readdir("/home/user/Desktop")
                            .filter(e => e.name !== "." && e.name !== "..");
                        const entry = ents[msg.entryIdx];
                        if (entry) { name = entry.name; icon = entry.type === "DIRECTORY" ? "📁" : "📄"; }
                    } catch {/**/}
                    safeSend("kernel-event", { type:"desktop_drag_info_result", name, icon, entryIdx:msg.entryIdx });
                    break;
                }
                case "unified_drop":
                    kernel.appManager.unifiedDrop(msg);
                    break;
                case "desktop_to_fe": {
                    const toSt = kernel.appManager.feState.get(msg.toWinId);
                    if (toSt && msg.label) {
                        kernel.appManager.unifiedDrop({
                            srcKind: "desktop", srcWinId: -1, srcIdx: 0,
                            srcPath: "/home/user/Desktop/" + msg.label,
                            toWinId: msg.toWinId, dropRowVi: -1,
                        });
                    }
                    break;
                }

                // ── File explorer ────────────────────────────────────────────
                case "fe_context_menu": {
                    const items = kernel.appManager.feBuildContextMenu(msg.winId, msg.lx, msg.ly);
                    safeSend("kernel-event", {
                        type: "fe_context_menu_result",
                        x: msg.x, y: msg.y,
                        winId: msg.winId, lx: msg.lx, ly: msg.ly,
                        items: items.map(it => ({
                            label:     it.label,
                            danger:    it.danger    || false,
                            hasAction: typeof it.action === "function",
                        })),
                    });
                    break;
                }
                case "fe_context_action": {
                    const items = kernel.appManager.feBuildContextMenu(msg.winId, msg.lx, msg.ly);
                    const item  = items[msg.idx];
                    if (item && typeof item.action === "function") item.action();
                    break;
                }

                // ── Text editor ──────────────────────────────────────────────
                case "editor_action": {
                    const am  = kernel.appManager;
                    const wid = msg.winId;
                    switch (msg.action) {
                        case "new":       am.newTextFile(); break;
                        case "save":      am._saveEditorPublic(wid); break;
                        case "saveAs":    am._saveEditorAs(wid); break;
                        case "selectAll": am._editorSelectAll(wid); break;
                        case "copy":      am._editorCopy(wid); break;
                        case "paste":     kernel.emit("clipboard_read_request", { winId: wid }); break;
                    }
                    break;
                }
                case "paste_text":
                    if (msg.winId && msg.text !== undefined) {
                        kernel.appManager.pasteText(msg.winId, msg.text);
                    }
                    break;

                // ── System ────────────────────────────────────────────────────
                case "shutdown_request": shuttingDown = true; kernel.shutdown(0); break;
            }
        } catch (err) {
            console.error("[ipc] error:", err.message);
        }
    });

    ipcMain.on("window-action", (_e, action) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (action === "minimize") mainWindow.minimize();
        if (action === "maximize") mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
        if (action === "close")    mainWindow.close();
    });
}

// ─── Frame pump ───────────────────────────────────────────────────────────────
function startFramePump() {
    kernel.on("tick", () => {
        if (shuttingDown || !kernel) return;
        safeSend("kernel-event", {
            type:    "frame",
            windows: kernel.windowManager.getFrameData(),
            focused: kernel.windowManager.getFocusedId(),
            status: {
                uptime:      kernel.uptime,
                processes:   kernel.processManager.count(),
                windows:     kernel.windowManager.count(),
                memory:      kernel.memoryManager.getStats(),
                processList: kernel.processManager.list(),
            },
        });
    });

    // Clipboard: kernel → system clipboard
    kernel.on("clipboard_write", ({ text }) => {
        safeSend("kernel-event", { type: "clipboard_write", text });
    });

    // Clipboard: kernel requests paste → ask renderer for clipboard content
    kernel.on("clipboard_read_request", ({ winId }) => {
        safeSend("kernel-event", { type: "clipboard_read_request", winId });
    });

    // Theme / wallpaper
    kernel.on("theme_change",     (data) => safeSend("kernel-event", { type: "theme_change",     ...data }));
    kernel.on("wallpaper_change", (data) => safeSend("kernel-event", { type: "wallpaper_change", ...data }));

    kernel.on("log", e => {
        if (shuttingDown) return;
        safeSend("kernel-event", { type: "log", level: e.level, message: e.msg });
    });

    kernel.on("shutdown", () => {
        shuttingDown = true;
        safeSend("kernel-event", { type: "shutdown" });
        setTimeout(() => { if (!mainWindow || mainWindow.isDestroyed()) app.quit(); else mainWindow.close(); }, 800);
    });

    kernel.on("panic", ({ message }) => {
        safeSend("kernel-event", { type: "panic", message });
    });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    createWindow();
    setupIPC();

    kernel = new Kernel({
        displayWidth: DISPLAY_W, displayHeight: DISPLAY_H,
        memorySize: 256*1024*1024, tickRate: 60,
        debug: process.argv.includes("--debug"),
    });

    mainWindow.webContents.once("did-finish-load", async () => {
        startFramePump();
        safeSend("kernel-event", { type: "boot_start", width: DISPLAY_W, height: DISPLAY_H });
        try {
            await kernel.boot();
            safeSend("kernel-event", { type: "boot_complete" });
        } catch (err) {
            console.error("[boot]", err);
        }
    });
});

app.on("window-all-closed", () => {
    shuttingDown = true;
    if (kernel) { try { kernel.shutdown(0); } catch (_) {} kernel = null; }
    if (process.platform !== "darwin") app.quit();
});

if (!app.requestSingleInstanceLock()) app.quit();
