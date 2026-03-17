import { SyscallType, ProcessState } from "../types/index.js";
import type { SyscallArgs, SyscallResult, PID } from "../types/index.js";
import type { Kernel } from "./Kernel.js";

export class SyscallHandler {
    private readonly kernel: Kernel;

    constructor(kernel: Kernel) {
        this.kernel = kernel;
    }

    dispatch(pid: PID, args: SyscallArgs): SyscallResult {
        try {
            const result = this.handle(pid, args);
            return { ok: true, value: result };
        } catch (err) {
            return { ok: false, errno: 1, message: String(err) };
        }
    }

    private handle(pid: PID, { call, args }: SyscallArgs): unknown {
        const k = this.kernel;

        switch (call) {
            case SyscallType.GETPID:
                return pid;

            case SyscallType.GETPPID: {
                const proc = k.processManager.get(pid);
                return proc?.info.ppid ?? 0;
            }

            case SyscallType.FORK: {
                const parentProc = k.processManager.get(pid);
                if (!parentProc) {
                    throw new Error("fork: process not found");
                }
                const childName = `${parentProc.info.name}:child`;
                const childPID = k.processManager.spawn(
                    childName,
                    parentProc.callback,
                    { ppid: pid, priority: parentProc.info.priority },
                );
                return childPID;
            }

            case SyscallType.EXIT: {
                const code = (args[0] as number) ?? 0;
                k.processManager.exit(pid, code);
                return 0;
            }

            case SyscallType.KILL: {
                const targetPID = args[0] as PID;
                const signal = (args[1] as number) ?? 15;
                return k.processManager.kill(targetPID, signal) ? 0 : -1;
            }

            case SyscallType.SLEEP: {
                // Non-blocking sleep — just records intent
                const ms = (args[0] as number) ?? 0;
                setTimeout(() => {
                    const proc = k.processManager.get(pid);
                    if (proc) {
                        proc.info.state = ProcessState.READY;
                    }
                }, ms);
                return 0;
            }

            case SyscallType.MALLOC: {
                const size = args[0] as number;
                const tag = (args[1] as string) ?? "heap";
                return k.memoryManager.malloc(size, pid, tag);
            }

            case SyscallType.FREE: {
                const address = args[0] as number;
                k.memoryManager.free(address);
                return 0;
            }

            case SyscallType.WRITE: {
                const fd = args[0] as number;
                const data = args[1] as string;
                if (fd === 1 || fd === 2) {
                    k.log(fd === 1 ? "info" : "warn", data);
                    return data.length;
                }
                return k.vfs.write(fd, Buffer.from(data));
            }

            case SyscallType.READ: {
                const fd = args[0] as number;
                const size = args[1] as number;
                return k.vfs.read(fd, size);
            }

            case SyscallType.OPEN: {
                const path = args[0] as string;
                const flags = (args[1] as number) ?? 0;
                return k.vfs.open(path, flags, pid);
            }

            case SyscallType.CLOSE: {
                const fd = args[0] as number;
                k.vfs.close(fd);
                return 0;
            }

            case SyscallType.STAT: {
                const path = args[0] as string;
                return k.vfs.stat(path);
            }

            case SyscallType.MKDIR: {
                const path = args[0] as string;
                k.vfs.mkdir(path);
                return 0;
            }

            case SyscallType.UNLINK: {
                const path = args[0] as string;
                k.vfs.unlink(path);
                return 0;
            }

            case SyscallType.WINDOW_CREATE: {
                const title = args[0] as string;
                const x = args[1] as number;
                const y = args[2] as number;
                const w = args[3] as number;
                const h = args[4] as number;
                return k.windowManager.createWindow({ title, x, y, width: w, height: h, ownerPID: pid });
            }

            case SyscallType.WINDOW_DESTROY: {
                const winId = args[0] as number;
                k.windowManager.destroyWindow(winId);
                return 0;
            }

            case SyscallType.WINDOW_DRAW: {
                const winId = args[0] as number;
                const commands = args[1] as import("../types/index.js").DrawCommand[];
                k.windowManager.submitDrawCommands(winId, commands);
                return 0;
            }

            case SyscallType.DRAW: {
                // Direct framebuffer draw (privileged)
                const commands = args[0] as import("../types/index.js").DrawCommand[];
                k.display.submitCommands(commands);
                return 0;
            }

            case SyscallType.YIELD:
                return 0;

            case SyscallType.EXEC:
                throw new Error("exec: not implemented");

            default:
                throw new Error(`Unknown syscall: ${call}`);
        }
    }
}
