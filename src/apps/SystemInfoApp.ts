/**
 * SystemInfoApp — Live system information
 *
 * SRP: Display system stats (OS, display, memory, scheduler).
 */

import type { IApp } from "./IApp.js";
import type { KernelServices } from "../services/KernelServices.js";
import type { DrawCommand } from "../types/index.js";
import type { Theme } from "../ui/Theme.js";
import { Fonts } from "../ui/Theme.js";

export class SystemInfoApp implements IApp {
    readonly appId = "systemInfo";
    private readonly windows = new Map<number, ReturnType<typeof setInterval>>();

    constructor(
        private readonly svc: KernelServices,
        private readonly theme: Theme,
    ) {}

    ownsWindow(id: number): boolean { return this.windows.has(id); }

    open(): number {
        const id = this.svc.createWindow({
            title: "System Information", x: 220, y: 110, width: 500, height: 380,
            ownerPID: 1, backgroundColor: this.theme.palette.bg,
            minWidth: 360, minHeight: 280,
        });
        this.render(id);

        const win = this.svc.getWindow(id);
        win?.on("resize", () => this.render(id));

        // Live refresh every 2 seconds
        const interval = setInterval(() => {
            if (this.svc.getWindow(id)) this.render(id);
            else { clearInterval(interval); this.windows.delete(id); }
        }, 2000);
        this.windows.set(id, interval);

        win?.on("close", () => clearInterval(interval));
        return id;
    }

    destroy(winId: number): void {
        const interval = this.windows.get(winId);
        if (interval) clearInterval(interval);
        this.windows.delete(winId);
    }

    render(winId: number): void {
        const win = this.svc.getWindow(winId);
        if (!win) return;
        const W = win.bounds.width, H = win.bounds.height;
        const PAD = 20;
        const status = this.svc.getSystemStatus();
        const up = Math.floor(status.uptime);

        const sections: Array<{ title: string; items: [string, string][] }> = [
            { title: "System", items: [
                ["OS", "AlphaOS v0.1.0"],
                ["Kernel", "TypeScript / Node.js"],
                ["Uptime", `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${up % 60}s`],
            ]},
            { title: "Display", items: [
                ["Resolution", `${status.displayWidth}×${status.displayHeight}`],
                ["Tick Rate", `${status.tickRate} Hz`],
            ]},
            { title: "Memory", items: [
                ["Total", `${(status.memStats.total / 1024 / 1024).toFixed(0)} MiB`],
                ["Used", `${(status.memStats.used / 1024 / 1024).toFixed(1)} MiB`],
                ["Free", `${(status.memStats.free / 1024 / 1024).toFixed(1)} MiB`],
            ]},
            { title: "Scheduler", items: [
                ["Ticks", String(status.schedStats.ticks)],
                ["Context Switches", String(status.schedStats.contextSwitches)],
                ["Windows", String(status.windowCount)],
                ["Processes", String(status.processCount)],
            ]},
        ];

        const cmds: DrawCommand[] = [{ type: "rect", x: 0, y: 0, width: W, height: H, color: this.theme.color("bg") }];
        let y = PAD + 6;
        cmds.push({ type: "text", x: PAD, y: y + 12, text: "System Information", font: Fonts.ui(15, 600), color: this.theme.color("text") });
        y += 28;
        cmds.push({ type: "line", x: PAD, y, x2: W - PAD, y2: y, color: this.theme.color("border") });
        y += 16;

        for (const sec of sections) {
            cmds.push({ type: "text", x: PAD, y, text: sec.title.toUpperCase(), font: Fonts.ui(10, 600), color: this.theme.color("text3") });
            y += 8;
            cmds.push({ type: "line", x: PAD, y, x2: W - PAD, y2: y, color: this.theme.color("muted") });
            y += 18;
            for (const [lbl, val] of sec.items) {
                cmds.push(
                    { type: "text", x: PAD, y, text: lbl, font: Fonts.ui(11), color: this.theme.color("text3") },
                    { type: "text", x: PAD + 180, y, text: val, font: Fonts.ui(13), color: this.theme.color("text") },
                );
                y += 22;
            }
            y += 10;
            if (y > H - 20) break;
        }
        win.submitCommands(cmds);
    }
}
