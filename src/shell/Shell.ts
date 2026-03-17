import { EventEmitter } from "events";
import type { Kernel } from "../kernel/Kernel.js";
import type { DrawCommand, ColorHex, KeyboardEventData } from "../types/index.js";

interface Session {
    windowId:    number;
    output:      string[];
    input:       string;
    history:     string[];
    historyIdx:  number;
    cwd:         string;
    env:         Record<string, string>;
    scrollOffset: number;  // lines scrolled up from bottom (0 = at bottom)
}

interface Command {
    name:        string;
    description: string;
    run: (args: string[], s: Session, shell: Shell) => string | Promise<string>;
}

export class Shell extends EventEmitter {
    private readonly kernel   : Kernel;
    readonly sessions  = new Map<number, Session>();

    rerenderSession(winId: number): void {
        const s = this.sessions.get(winId);
        if (s) this._render(s);
    }
    private readonly commands  = new Map<string, Command>();

    constructor(kernel: Kernel) {
        super();
        this.kernel = kernel;
        this._registerBuiltins();
    }

    start(): void { this.kernel.log("info", "[shell] Shell started"); }

    attachWindow(winId: number): void {
        if (this.sessions.has(winId)) return;
        const s: Session = {
            windowId: winId, output: ["AlphaOS Shell v0.1.0", "Type 'help' for commands.", ""],
            input: "", history: [], historyIdx: -1, cwd: "/home/user",
            env: { HOME: "/home/user", USER: "root", TERM: "alphaterm" },
            scrollOffset: 0,
        };
        this.sessions.set(winId, s);
        this._render(s);
    }

    detachWindow(winId: number): void { this.sessions.delete(winId); }

    tickRender(): void {
        for (const s of this.sessions.values()) this._render(s);
    }

    renderPrompt(): void {
        for (const s of this.sessions.values()) this._render(s);
    }

    handleScroll(winId: number, deltaY: number): void {
        const s = this.sessions.get(winId);
        if (!s) return;
        const LH = 18, PY = 18;
        const win = this.kernel.windowManager.getWindow(winId);
        if (!win) return;
        const H   = win.bounds.height;
        const MAX = Math.max(1, Math.floor((H - PY - LH * 2) / LH));
        const maxScroll = Math.max(0, s.output.length - MAX);
        // deltaY > 0 = scroll down = less offset (closer to bottom)
        // deltaY < 0 = scroll up = more offset (further from bottom)
        s.scrollOffset = Math.max(0, Math.min(maxScroll, s.scrollOffset - Math.sign(deltaY) * 3));
        this._render(s);
    }

    async handleInput(winId: number, data: KeyboardEventData): Promise<void> {
        const s = this.sessions.get(winId);
        if (!s) return;
        const key = data.key;

        if (key === "Enter") {
            const line = s.input.trim();
            this._print(s, `$ ${line}`);
            s.input = ""; s.historyIdx = -1;
            if (line) {
                s.history.unshift(line);
                const out = await this._execute(line, s);
                if (out) this._print(s, out);
            }
            this._print(s, "");
        } else if (key === "Backspace") {
            if (data.ctrl) {
                // Ctrl+W: delete last word
                s.input = s.input.replace(/\S+\s*$/, "");
            } else {
                s.input = s.input.slice(0, -1);
            }
        } else if (key === "ArrowUp") {
            if (s.historyIdx < s.history.length - 1) { s.historyIdx++; s.input = s.history[s.historyIdx]; }
        } else if (key === "ArrowDown") {
            if (s.historyIdx > 0) { s.historyIdx--; s.input = s.history[s.historyIdx]; }
            else { s.historyIdx = -1; s.input = ""; }
        } else if (key === "Tab") {
            this._autocomplete(s);
        } else if (key === "l" && data.ctrl) {
            s.output = [];
        } else if (key === "c" && data.ctrl) {
            this._print(s, "^C"); s.input = "";
        } else if (key === "d" && data.ctrl) {
            this._print(s, "logout"); setTimeout(() => this.kernel.windowManager.destroyWindow(winId), 200);
        } else if (key.length === 1 && !data.ctrl && !data.meta) {
            s.input += data.shift ? key.toUpperCase() : key;
        }
        this._render(s);
    }

    // ── Rendering ──────────────────────────────────────────────────────────────

    /** Set by AppManager when theme changes */
    darkMode = false;

    private _render(s: Session): void {
        const win = this.kernel.windowManager.getWindow(s.windowId);
        if (!win) return;
        const W = win.bounds.width, H = win.bounds.height;
        const FONT = "500 13px 'FiraCode','Courier New',monospace";
        const LH = 18, PX = 10, PY = 18;
        const MAX      = Math.max(1, Math.floor((H - PY - LH * 2) / LH));
        const totalOut = s.output.length;
        const maxScroll = Math.max(0, totalOut - MAX);
        const startIdx = Math.max(0, totalOut - MAX - s.scrollOffset);
        const vis      = s.output.slice(startIdx, startIdx + MAX);

        // Theme-aware colors
        const dark = this.darkMode;
        const BG    = (dark ? "#0f0f13" : "#ffffff") as ColorHex;
        const FG    = (dark ? "#d4d4d8" : "#3f3f46") as ColorHex;
        const FG2   = (dark ? "#f4f4f5" : "#09090b") as ColorHex;
        const BLUE  = (dark ? "#60a5fa" : "#2563eb") as ColorHex;
        const RED   = "#dc2626" as ColorHex;
        const GRAY  = (dark ? "#3f3f46" : "#e4e4e7") as ColorHex;
        const GRAY2 = (dark ? "#52525b" : "#d4d4d8") as ColorHex;

        const cmds: DrawCommand[] = [
            { type: "rect", x: 0, y: 0, width: W, height: H, color: BG },
        ];
        vis.forEach((line, i) => {
            let c: ColorHex = FG;
            if (line.startsWith("$ "))               c = FG2;
            else if (line.startsWith("AlphaOS"))     c = BLUE;
            else if (/^(error|not found|no such|missing|invalid|cannot)/i.test(line)) c = RED;
            else if (line.startsWith("  "))          c = FG2;
            cmds.push({ type:"text", x:PX, y:PY+i*LH, text:line, font:FONT, color:c });
        });

        const cwdDisplay = s.cwd === "/" ? "/" : s.cwd.split("/").filter(Boolean).pop() ?? s.cwd;
        const cursor = Date.now() % 1000 < 500 ? "█" : " ";
        if (s.scrollOffset === 0) {
            cmds.push({
                type: "text", x: PX, y: PY + vis.length * LH,
                text: `${cwdDisplay} $ ${s.input}${cursor}`,
                font: FONT, color: BLUE,
            });
        }

        if (maxScroll > 0) {
            const track = H - PY - 4;
            const thumb = Math.max(20, track * MAX / totalOut);
            const ty    = PY + 2 + (track - thumb) * (maxScroll - s.scrollOffset) / maxScroll;
            cmds.push(
                { type: "rect", x: W - 5, y: PY + 2, width: 3, height: track, color: GRAY  },
                { type: "rect", x: W - 5, y: ty,      width: 3, height: thumb, color: GRAY2 },
            );
        }

        win.submitCommands(cmds);
    }

    private _print(s: Session, line: string): void {
        for (const p of line.split("\n")) {
            s.output.push(p);
            if (s.output.length > 2000) s.output.shift();
        }
        s.scrollOffset = 0; // always scroll to bottom on new output
    }

    private async _execute(line: string, s: Session): Promise<string> {
        // Handle variable expansion
        line = line.replace(/\$(\w+)/g, (_, k) => s.env[k] ?? "");
        // Handle pipes (basic: last command only actually runs)
        const parts = line.split(/\s+/);
        const name = parts[0].toLowerCase();
        const args = parts.slice(1);
        const cmd = this.commands.get(name);
        if (!cmd) return `${name}: command not found`;
        try { return await cmd.run(args, s, this); }
        catch (err) { return `${name}: ${String(err)}`; }
    }

    private _autocomplete(s: Session): void {
        const words = s.input.split(/\s+/);
        // Complete command name
        if (words.length <= 1) {
            const prefix  = words[0].toLowerCase();
            const matches = [...this.commands.keys()].filter(k => k.startsWith(prefix));
            if (matches.length === 1) { s.input = matches[0] + " "; }
            else if (matches.length > 1) {
                this._print(s, `$ ${s.input}`);
                this._print(s, matches.join("  "));
            }
            return;
        }
        // Complete path argument
        const pathPrefix = words[words.length - 1];
        const dir  = pathPrefix.includes("/") ? pathPrefix.replace(/\/[^/]*$/, "") || "/" : s.cwd;
        const base = pathPrefix.includes("/") ? pathPrefix.split("/").pop()! : pathPrefix;
        try {
            const entries = this.kernel.vfs.readdir(dir);
            const matches = entries.filter(e => e.name.startsWith(base) && e.name !== "." && e.name !== "..");
            if (matches.length === 1) {
                words[words.length-1] = (dir === "/" ? "" : dir) + "/" + matches[0].name + (matches[0].type === "DIRECTORY" ? "/" : "");
                s.input = words.join(" ");
            } else if (matches.length > 1) {
                this._print(s, matches.map(e => e.name).join("  "));
            }
        } catch { /* ignore */ }
    }

    // ── Builtins ──────────────────────────────────────────────────────────────

    private _registerBuiltins(): void {
        const r = (cmd: Command): void => { this.commands.set(cmd.name, cmd); };
        const k = this.kernel;

        const resolvePath = (path: string, cwd: string): string => {
            if (path === "~") return "/home";
            if (path.startsWith("~/")) return "/home" + path.slice(1);
            if (path.startsWith("/")) return path;
            if (path === ".") return cwd;
            if (path === "..") return cwd.split("/").slice(0, -1).join("/") || "/";
            return (cwd === "/" ? "" : cwd) + "/" + path;
        };

        r({ name:"help", description:"Show commands",
            run:() => [...this.commands.values()].map(c => `  ${c.name.padEnd(12)} ${c.description}`).join("\n") });

        r({ name:"echo", description:"Print text",
            run:(a) => a.join(" ") });

        r({ name:"clear", description:"Clear screen",
            run:(_,s) => { s.output = []; return ""; } });

        r({ name:"pwd", description:"Print working directory",
            run:(_,s) => s.cwd });

        r({ name:"cd", description:"Change directory",
            run:(a, s) => {
                const p = resolvePath(a[0] ?? "~", s.cwd);
                if (!k.vfs.exists(p)) return `cd: ${a[0]}: No such file or directory`;
                try { const st = k.vfs.stat(p); if (st.type !== "DIRECTORY") return `cd: ${a[0]}: Not a directory`; }
                catch { return `cd: ${a[0]}: Error`; }
                s.cwd = p; return "";
            } });

        r({ name:"ls", description:"List directory  [-l] [path]",
            run:(a, s) => {
                const longFlag = a.includes("-l") || a.includes("-la") || a.includes("-al");
                const pathArg  = a.find(x => !x.startsWith("-")) ?? s.cwd;
                const p = resolvePath(pathArg, s.cwd);
                try {
                    const entries = k.vfs.readdir(p).filter(e => e.name !== "." && e.name !== "..");
                    if (!entries.length) return "(empty)";
                    if (longFlag) {
                        return entries.map(e => {
                            try {
                                const st = k.vfs.stat((p==="/"?"":p)+"/"+e.name);
                                const d = e.type==="DIRECTORY" ? "d" : "-";
                                const sz = String(st.size).padStart(6);
                                return `  ${d}rw-r--r--  ${sz}  ${e.name}${e.type==="DIRECTORY"?"/":""}`;
                            } catch { return `  -  ${e.name}`; }
                        }).join("\n");
                    }
                    // Short: group dirs first
                    const dirs  = entries.filter(e => e.type==="DIRECTORY").map(e => e.name+"/");
                    const files = entries.filter(e => e.type!=="DIRECTORY").map(e => e.name);
                    return [...dirs,...files].join("  ") || "(empty)";
                } catch { return `ls: ${pathArg}: No such file or directory`; }
            } });

        r({ name:"cat", description:"Print file contents",
            run:(a, s) => {
                if (!a[0]) return "cat: missing operand";
                const p = resolvePath(a[0], s.cwd);
                try { return k.vfs.readFile(p).toString("utf8") || "(empty file)"; }
                catch { return `cat: ${a[0]}: No such file or directory`; }
            } });

        r({ name:"touch", description:"Create empty file",
            run:(a, s) => {
                if (!a[0]) return "touch: missing operand";
                const p = resolvePath(a[0], s.cwd);
                try { const fd = k.vfs.open(p, 0x40, 0); k.vfs.close(fd); return ""; }
                catch (e) { return `touch: ${String(e)}`; }
            } });

        r({ name:"mkdir", description:"Create directory  [-p]",
            run:(a, s) => {
                const args = a.filter(x => !x.startsWith("-"));
                if (!args[0]) return "mkdir: missing operand";
                try { k.vfs.mkdir(resolvePath(args[0], s.cwd)); return ""; }
                catch (e) { return `mkdir: ${String(e)}`; }
            } });

        r({ name:"rm", description:"Remove file  [-r] [-f]",
            run:(a, s) => {
                const flags = a.filter(x => x.startsWith("-")).join("");
                const target = a.find(x => !x.startsWith("-"));
                if (!target) return "rm: missing operand";
                const p = resolvePath(target, s.cwd);
                try {
                    const st = k.vfs.stat(p);
                    if (st.type === "DIRECTORY" && !flags.includes("r")) return "rm: is a directory, use -r";
                    k.vfs.unlink(p);
                    return "";
                } catch { return flags.includes("f") ? "" : `rm: cannot remove '${target}'`; }
            } });

        r({ name:"cp", description:"Copy file",
            run:(a, s) => {
                if (a.length < 2) return "cp: missing operand";
                const src = resolvePath(a[0], s.cwd), dst = resolvePath(a[1], s.cwd);
                try {
                    // Check source type
                    const stat = k.vfs.stat(src);
                    if (stat.type === "DIRECTORY") return "cp: omitting directory '" + a[0] + "' (use cp -r not supported yet)";
                    const data = k.vfs.readFile(src);
                    // Check destination
                    let finalDst = dst;
                    try {
                        const dstStat = k.vfs.stat(dst);
                        if (dstStat.type === "DIRECTORY") finalDst = dst + "/" + src.split("/").pop();
                        // File exists: overwrite silently (Unix behaviour)
                    } catch { /* dst doesn't exist — ok */ }
                    const fd = k.vfs.open(finalDst, 0x40|0x200, 0);
                    k.vfs.write(fd, data); k.vfs.close(fd);
                    return "";
                } catch (e) { return `cp: ${String(e)}`; }
            } });

        r({ name:"mv", description:"Move/rename file or folder",
            run:(a, s) => {
                if (a.length < 2) return "mv: missing operand";
                const src = resolvePath(a[0], s.cwd), dst = resolvePath(a[1], s.cwd);
                try {
                    const srcStat = k.vfs.stat(src);
                    let finalDst = dst;
                    try {
                        const dstStat = k.vfs.stat(dst);
                        if (dstStat.type === "DIRECTORY") finalDst = dst + "/" + src.split("/").pop();
                    } catch { /* dst doesn't exist — ok */ }
                    if (srcStat.type === "DIRECTORY") {
                        // Move directory: mkdir dst, move contents, remove src
                        const moveDir = (sp: string, dp: string): void => {
                            try { k.vfs.mkdir(dp); } catch {/**/}
                            const ch = k.vfs.readdir(sp).filter((e: {name:string}) => e.name !== "." && e.name !== "..");
                            for (const ci of ch) {
                                const cs = sp + "/" + ci.name, cd = dp + "/" + ci.name;
                                try {
                                    const cst = k.vfs.stat(cs);
                                    if (cst.type === "DIRECTORY") moveDir(cs, cd);
                                    else { const d=k.vfs.readFile(cs); const fd=k.vfs.open(cd,0x40|0x200,0); k.vfs.write(fd,d); k.vfs.close(fd); k.vfs.unlink(cs); }
                                } catch {/**/}
                            }
                            try { k.vfs.unlink(sp); } catch {/**/}
                        };
                        moveDir(src, finalDst);
                    } else {
                        const data = k.vfs.readFile(src);
                        const fd = k.vfs.open(finalDst, 0x40|0x200, 0);
                        k.vfs.write(fd, data); k.vfs.close(fd);
                        k.vfs.unlink(src);
                    }
                    return "";
                } catch (e) { return `mv: ${String(e)}`; }
            } });

        r({ name:"write", description:"Write text to file  write <file> <text>",
            run:(a, s) => {
                if (a.length < 2) return "write: usage: write <file> <text...>";
                const p = resolvePath(a[0], s.cwd);
                const text = a.slice(1).join(" ") + "\n";
                try {
                    const fd = k.vfs.open(p, 0x40|0x200, 0);
                    k.vfs.write(fd, Buffer.from(text)); k.vfs.close(fd);
                    return "";
                } catch (e) { return `write: ${String(e)}`; }
            } });

        r({ name:"append", description:"Append text to file",
            run:(a, s) => {
                if (a.length < 2) return "append: usage: append <file> <text...>";
                const p = resolvePath(a[0], s.cwd);
                const text = a.slice(1).join(" ") + "\n";
                try {
                    let existing: Buffer = Buffer.alloc(0);
                    try { existing = Buffer.from(k.vfs.readFile(p)); } catch { /* new file */ }
                    const combined = Buffer.allocUnsafe(existing.length + Buffer.byteLength(text));
                    existing.copy(combined, 0);
                    Buffer.from(text).copy(combined, existing.length);
                    const fd = k.vfs.open(p, 0x40|0x200, 0);
                    k.vfs.write(fd, combined);
                    k.vfs.close(fd);
                    return "";
                } catch (e) { return `append: ${String(e)}`; }
            } });

        r({ name:"stat", description:"Show file info",
            run:(a, s) => {
                if (!a[0]) return "stat: missing operand";
                const p = resolvePath(a[0], s.cwd);
                try {
                    const st = k.vfs.stat(p);
                    return [
                        `  File:  ${a[0]}`,
                        `  Type:  ${st.type}`,
                        `  Size:  ${st.size} bytes`,
                        `  Inode: ${st.ino}`,
                        `  Mode:  ${st.mode.toString(8)}`,
                    ].join("\n");
                } catch { return `stat: ${a[0]}: No such file or directory`; }
            } });

        r({ name:"wc", description:"Word/line count",
            run:(a, s) => {
                if (!a[0]) return "wc: missing operand";
                const p = resolvePath(a[0], s.cwd);
                try {
                    const txt = k.vfs.readFile(p).toString("utf8");
                    const lines = txt.split("\n").length;
                    const words = txt.trim().split(/\s+/).filter(Boolean).length;
                    const chars = txt.length;
                    return `  ${String(lines).padStart(4)}  ${String(words).padStart(4)}  ${String(chars).padStart(4)}  ${a[0]}`;
                } catch { return `wc: ${a[0]}: No such file`; }
            } });

        r({ name:"grep", description:"Search text in file  grep <pattern> <file>",
            run:(a, s) => {
                if (a.length < 2) return "grep: usage: grep <pattern> <file>";
                const p = resolvePath(a[1], s.cwd);
                try {
                    const lines = k.vfs.readFile(p).toString("utf8").split("\n");
                    const re = new RegExp(a[0], "i");
                    const hits = lines.filter(l => re.test(l));
                    return hits.length ? hits.join("\n") : "(no matches)";
                } catch { return `grep: ${a[1]}: No such file`; }
            } });

        r({ name:"head", description:"First N lines  head [-n N] <file>",
            run:(a, s) => {
                let n = 10, file = a[0];
                if (a[0] === "-n") { n = parseInt(a[1])||10; file = a[2]; }
                if (!file) return "head: missing file";
                const p = resolvePath(file, s.cwd);
                try { return k.vfs.readFile(p).toString("utf8").split("\n").slice(0,n).join("\n"); }
                catch { return `head: ${file}: No such file`; }
            } });

        r({ name:"tail", description:"Last N lines  tail [-n N] <file>",
            run:(a, s) => {
                let n = 10, file = a[0];
                if (a[0] === "-n") { n = parseInt(a[1])||10; file = a[2]; }
                if (!file) return "tail: missing file";
                const p = resolvePath(file, s.cwd);
                try { return k.vfs.readFile(p).toString("utf8").split("\n").slice(-n).join("\n"); }
                catch { return `tail: ${file}: No such file`; }
            } });

        r({ name:"ps", description:"Process list",
            run:() => {
                const h = "  PID   PPID  NAME            STATE";
                const rows = k.processManager.list().map(p =>
                    `  ${String(p.pid).padEnd(6)}${String(p.ppid).padEnd(6)}${p.name.padEnd(16)}${p.state}`);
                return [h, ...rows].join("\n");
            } });

        r({ name:"kill", description:"Kill process by PID",
            run:(a) => {
                const pid = parseInt(a[0]??"0",10);
                if (isNaN(pid)) return "kill: invalid PID";
                return k.processManager.kill(pid) ? `Killed ${pid}` : `kill: no process ${pid}`;
            } });

        r({ name:"mem", description:"Memory statistics",
            run:() => {
                const s = k.memoryManager.getStats();
                const m = (n: number) => `${(n/1024/1024).toFixed(1)} MiB`;
                return [`  Total:  ${m(s.total)}`,`  Used:   ${m(s.used)}`,`  Free:   ${m(s.free)}`,`  Blocks: ${s.blocks}`].join("\n");
            } });

        r({ name:"uptime", description:"System uptime",
            run:() => {
                const u=k.uptime;
                return `  up ${Math.floor(u/3600)}h ${Math.floor((u%3600)/60)}m ${Math.floor(u%60)}s`;
            } });

        r({ name:"uname", description:"System info",
            run:(a) => {
                const all = a.includes("-a");
                if (all) return "AlphaOS 0.1.0 #1 TypeScript/Node.js x86_64 GNU/Linux";
                return "AlphaOS";
            } });

        r({ name:"env", description:"Show environment variables",
            run:(_,s) => Object.entries(s.env).map(([k,v]) => `  ${k}=${v}`).join("\n") });

        r({ name:"export", description:"Set environment variable  export KEY=VALUE",
            run:(a, s) => {
                for (const arg of a) {
                    const [key, ...vals] = arg.split("=");
                    if (key) s.env[key] = vals.join("=");
                }
                return "";
            } });

        r({ name:"date", description:"Print current date/time",
            run:() => new Date().toISOString() });

        r({ name:"history", description:"Command history",
            run:(_,s) => s.history.map((h,i) => `  ${String(i+1).padStart(4)}  ${h}`).join("\n") || "(empty)" });

        r({ name:"windows", description:"List open windows",
            run:() => k.windowManager.list().map(w => `  [${w.id}] ${w.title} (PID ${w.ownerPID})`).join("\n") || "  none" });

        r({ name:"open", description:"Open file explorer at path",
            run:(a, s) => {
                const p = resolvePath(a[0]??s.cwd, s.cwd);
                k.processManager.spawn("files", async (_ctx, k2) => {
                    k2.appManager.openFileExplorer(p);
                }, { ppid:1 });
                return `Opening ${p}...`;
            } });

        r({ name:"settings", description:"Open settings",
            run:() => {
                k.processManager.spawn("settings", async (_ctx, k2) => {
                    k2.appManager.openSettings();
                }, { ppid:1 });
                return "Opening Settings...";
            } });

        r({ name:"status", description:"Kernel status JSON",
            run:() => JSON.stringify(k.getStatus(), null, 2) });

        r({ name:"shutdown", description:"Shutdown system",
            run:() => { setTimeout(() => k.shutdown(0), 500); return "Shutting down..."; } });

        r({ name:"reboot", description:"Reboot system",
            run:() => { setTimeout(() => { k.shutdown(0); }, 500); return "Rebooting..."; } });
    }
}
