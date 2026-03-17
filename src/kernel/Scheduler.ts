import { EventEmitter } from "events";
import { ProcessState } from "../types/index.js";
import type { PID } from "../types/index.js";
import type { ProcessManager } from "./ProcessManager.js";

interface SchedulerStats {
    ticks: number;
    contextSwitches: number;
    idleTicks: number;
    runQueue: number;
}

/**
 * Multi-level feedback queue scheduler.
 * Priority 0 = highest, 19 = lowest (Linux-style nice values).
 */
export class Scheduler extends EventEmitter {
    private readonly pm: ProcessManager;
    private runQueue: PID[] = [];
    private currentPID: PID | null = null;
    private stats: SchedulerStats = { ticks: 0, contextSwitches: 0, idleTicks: 0, runQueue: 0 };

    // Quantum table: higher priority = more ticks
    private static readonly QUANTUM: Record<number, number> = {
        0: 20,
        1: 18,
        2: 16,
        3: 14,
        4: 12,
        5: 10,
        10: 5,
        15: 3,
        19: 1,
    };

    private ticksRemaining = 0;

    constructor(pm: ProcessManager) {
        super();
        this.pm = pm;

        pm.on("spawn", ({ pid }: { pid: PID }) => {
            this.enqueue(pid);
        });

        pm.on("exit", ({ pid }: { pid: PID }) => {
            this.dequeue(pid);
            if (this.currentPID === pid) {
                this.currentPID = null;
                this.ticksRemaining = 0;
            }
        });
    }

    tick(): void {
        this.stats.ticks++;

        // Rebuild ready queue from process table each tick
        this.runQueue = this.pm
            .list()
            .filter((p) => p.state === ProcessState.READY || p.state === ProcessState.RUNNING)
            .sort((a, b) => a.priority + a.nice - (b.priority + b.nice))
            .map((p) => p.pid);

        this.stats.runQueue = this.runQueue.length;

        if (this.runQueue.length === 0) {
            this.stats.idleTicks++;
            this.currentPID = null;
            this.emit("idle");
            return;
        }

        // Decrement remaining quantum
        if (this.currentPID !== null && this.ticksRemaining > 0) {
            this.ticksRemaining--;
            const proc = this.pm.get(this.currentPID);
            if (proc) {
                proc.info.cpuTime++;
            }
            return;
        }

        // Context switch: pick next runnable process
        const nextPID = this.runQueue[0];
        if (nextPID !== this.currentPID) {
            this.stats.contextSwitches++;
            this.emit("context_switch", { from: this.currentPID, to: nextPID });
        }

        this.currentPID = nextPID;
        const proc = this.pm.get(nextPID);
        if (proc) {
            const priority = Math.min(19, Math.max(0, proc.info.priority + proc.info.nice));
            this.ticksRemaining = this.quantumFor(priority);
            proc.info.state = ProcessState.RUNNING;
        }
    }

    getCurrentPID(): PID | null {
        return this.currentPID;
    }

    getStats(): SchedulerStats {
        return { ...this.stats };
    }

    private enqueue(pid: PID): void {
        if (!this.runQueue.includes(pid)) {
            this.runQueue.push(pid);
        }
    }

    private dequeue(pid: PID): void {
        this.runQueue = this.runQueue.filter((p) => p !== pid);
    }

    private quantumFor(priority: number): number {
        // Find closest entry
        const keys = Object.keys(Scheduler.QUANTUM)
            .map(Number)
            .sort((a, b) => a - b);
        for (let i = keys.length - 1; i >= 0; i--) {
            if (priority >= keys[i]) {
                return Scheduler.QUANTUM[keys[i]];
            }
        }
        return 5;
    }
}
