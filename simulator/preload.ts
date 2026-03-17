/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("alphaOS", {
    sendEvent: (message: unknown): void => {
        ipcRenderer.send("renderer-event", message);
    },
    sendWindowAction: (action: string): void => {
        ipcRenderer.send("window-action", action);
    },
    onKernelEvent: (callback: (data: unknown) => void): void => {
        ipcRenderer.on("kernel-event", (_event, data: unknown) => callback(data));
    },
    removeAllListeners: (): void => {
        ipcRenderer.removeAllListeners("kernel-event");
    },
});
