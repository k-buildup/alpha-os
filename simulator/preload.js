"use strict";
const { contextBridge, ipcRenderer, clipboard } = require("electron");

// Inject A2G font faces into the renderer document
window.addEventListener("DOMContentLoaded", () => {
    const weights = [
        ["100","A2G-Thin"],["200","A2G-ExtraLight"],["300","A2G-Light"],
        ["400","A2G-Regular"],["500","A2G-Medium"],["600","A2G-SemiBold"],
        ["700","A2G-Bold"],["800","A2G-ExtraBold"],["900","A2G-Black"],
    ];
    const style = document.createElement("style");
    style.textContent = weights.map(([w,n]) =>
        `@font-face{font-family:'A2G';src:url('fonts/${n}.otf');font-weight:${w};}`
    ).join("");
    document.head.appendChild(style);
});

contextBridge.exposeInMainWorld("alphaOS", {
    sendEvent: (message) => {
        ipcRenderer.send("renderer-event", message);
    },
    sendWindowAction: (action) => {
        ipcRenderer.send("window-action", action);
    },
    onKernelEvent: (callback) => {
        ipcRenderer.on("kernel-event", (_event, data) => callback(data));
    },
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners("kernel-event");
    },
    // Expose Electron clipboard directly (more reliable than navigator.clipboard in Electron)
    clipboardWrite: (text) => {
        try { clipboard.writeText(text); } catch(_) {}
    },
    clipboardRead: () => {
        try { return clipboard.readText(); } catch(_) { return ""; }
    },
});
