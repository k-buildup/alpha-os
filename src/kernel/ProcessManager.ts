import { EventEmitter } from "events";
import type { PID, ProcessInfo, ProcessContext } from "../types/index.js";
import { ProcessState } from "../types/index.js";
import type { Kernel } from "./Kernel.js";

let _pidCounter = 0;
const nextPID = (): PID => ++_pidCounter;

export type ProcessCallback = (ctx: ProcessContext, kernel: Kernel) => void | Promise<void>;

export interface Process {
    info: ProcessInfo;
    ctx: ProcessContext;
    callback: ProcessCallback;
}

export class ProcessManager extends EventEmitter {
    private readonly kernel: Kernel;
    private readonly table = new Map<PID, Process>();

    constructor(kernel: Kernel) {
        super();
        this.kernel = kernel;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Spawn PID 1 (init). Called once at boot.
     */
    spawnInit(): PID {
        return this.spawn(
            "init",
            async (ctx, k) => {
                k.log("info", "[init] PID 1 running — AlphaOS userland started");
                k.processManager.spawn("wm", async (_ctx2, k2) => {
                    k2.windowManager.launchDesktop();
                }, { ppid: ctx.pid, priority: 5 });
                k.processManager.spawn("shell", async (_ctx2, k2) => {
                    k2.shell.start();
                }, { ppid: ctx.pid, priority: 10 });
            },
            { ppid: 0, priority: 0 },
        );
    }

    spawn(
        name: string,
        callback: ProcessCallback,
        opts: { ppid?: PID; priority?: number; nice?: number } = {},
    ): PID {
        const pid = nextPID();
        const memBase = this.kernel.memoryManager.malloc(1 * 1024 * 1024, pid, `proc:${name}`); // 1 MiB default

        const info: ProcessInfo = {
            pid,
            ppid: opts.ppid ?? 0,
            name,
            state: ProcessState.READY,
            priority: opts.priority ?? 10,
            nice: opts.nice ?? 0,
            memBase,
            memSize: 1 * 1024 * 1024,
            createdAt: Date.now(),
            cpuTime: 0,
            exitCode: null,
        };

        const ctx: ProcessContext = {
            pid,
            heap: new ArrayBuffer(info.memSize),
            stack: [],
            registers: { pc: 0, sp: 0, bp: 0 },
            openFDs: [],
        };

        const proc: Process = { info, ctx, callback };
        this.table.set(pid, proc);
        this.emit("spawn", info);

        // Execute asynchronously
        setImmediate(async () => {
            proc.info.state = ProcessState.RUNNING;
            this.emit("state", { pid, state: ProcessState.RUNNING });
            try {
                await callback(ctx, this.kernel);
                this.exit(pid, 0);
            } catch (err) {
                this.kernel.log("error", `[proc:${name}] crashed: ${String(err)}`);
                this.exit(pid, 1);
            }
        });

        return pid;
    }

    exit(pid: PID, code = 0): void {
        const proc = this.table.get(pid);
        if (!proc) {
            return;
        }
        proc.info.state = ProcessState.ZOMBIE;
        proc.info.exitCode = code;
        this.kernel.memoryManager.freeByPID(pid);
        this.emit("exit", { pid, code });
        // Reap after a tick
        setImmediate(() => {
            this.table.delete(pid);
            this.emit("reap", { pid });
        });
    }

    kill(pid: PID, signal = 15): boolean {
        const proc = this.table.get(pid);
        if (!proc || pid === 1) {
            return false;
        }
        this.kernel.log("info", `[kill] PID ${pid} signal ${signal}`);
        this.exit(pid, 128 + signal);
        return true;
    }

    killAll(): void {
        for (const pid of this.table.keys()) {
            if (pid !== 1) {
                this.kill(pid);
            }
        }
        this.exit(1, 0);
    }

    // ─── Query ────────────────────────────────────────────────────────────────

    get(pid: PID): Process | undefined {
        return this.table.get(pid);
    }

    list(): ProcessInfo[] {
        return [...this.table.values()].map((p) => ({ ...p.info }));
    }

    count(): number {
        return this.table.size;
    }
}
