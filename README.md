# α AlphaOS

> TypeScript Operating System Framework  
> Runtime: Node.js · Language: TypeScript · Builder: tsgo

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Simulator (Electron)                │
│  ┌─────────────────┐   IPC   ┌─────────────────────┐ │
│  │  Renderer (DOM) │ ◄─────► │   Main (Node.js)    │ │
│  │  canvas 2D ctx  │         │   Kernel instance   │ │
│  └─────────────────┘         └─────────────────────┘ │
└──────────────────────────────────────────────────────┘
         ▲ same kernel code, different backends ▼
┌──────────────────────────────────────────────────────┐
│                   Bare-metal ISO                      │
│  Linux initramfs  →  /init  →  pkg-bundled binary    │
│  FramebufferBackend writes to /dev/fb0               │
└──────────────────────────────────────────────────────┘
```

### Kernel Subsystems

| Subsystem | File | Description |
|---|---|---|
| `Kernel` | `src/kernel/Kernel.ts` | Master orchestrator, tick loop, logging |
| `MemoryManager` | `src/kernel/MemoryManager.ts` | First-fit buddy allocator (256 MiB virtual) |
| `ProcessManager` | `src/kernel/ProcessManager.ts` | Process table, spawn/exit/kill, PID allocation |
| `Scheduler` | `src/kernel/Scheduler.ts` | MLFQ round-robin, priority quantum |
| `SyscallHandler` | `src/kernel/Syscall.ts` | 20+ syscalls (fork, exec, malloc, draw, …) |
| `DisplayDriver` | `src/drivers/DisplayDriver.ts` | RGBA framebuffer, DrawCommand queue |
| `KeyboardDriver` | `src/drivers/KeyboardDriver.ts` | Key state, event injection |
| `MouseDriver` | `src/drivers/MouseDriver.ts` | Cursor, button state |
| `VirtualFS` | `src/vfs/VirtualFS.ts` | In-memory inode VFS, open/read/write/stat |
| `WindowManager` | `src/window/WindowManager.ts` | Z-order compositor, focus, taskbar |
| `OsWindow` | `src/window/OsWindow.ts` | Per-window surface, drag/resize, hit test |
| `Shell` | `src/shell/Shell.ts` | Interactive terminal, 15 builtin commands |

---

## Quick Start

### Prerequisites

```bash
# Node.js 20+, then:
npm install
```

### Run simulator (Electron window)

```bash
npm run sim
# or with debug logging:
npm run sim -- --debug
```

**Hotkeys inside the simulator:**

| Key | Action |
|---|---|
| `Ctrl+Alt+T` | Open new terminal window |
| Click window title bar | Drag window |
| Drag bottom-right corner | Resize window |
| Click ● red dot | Close window |

### Shell commands

```
help        — list commands
ps          — process list
mem         — memory stats
ls [path]   — list directory
cd <path>   — change directory
cat <file>  — print file
mkdir <dir> — create directory
kill <pid>  — kill process
windows     — list windows
status      — kernel JSON status
uptime      — system uptime
uname       — kernel info
clear       — clear terminal
shutdown    — halt system
```

---

## Build ISO

> Requires: `grub-mkrescue`, `xorriso`, `pkg`

```bash
# Install deps (Debian/Ubuntu)
sudo apt install grub-pc-bin grub-efi-amd64-bin xorriso
npm install -g pkg

# Build
npm run build:iso
# → iso/output.iso
```

## Run in QEMU

```bash
npm run qemu                       # default
bash scripts/run-qemu.sh --debug   # serial console
bash scripts/run-qemu.sh --no-kvm  # software emulation
bash scripts/run-qemu.sh --efi     # UEFI boot
bash scripts/run-qemu.sh --vnc     # headless VNC :5900
bash scripts/run-qemu.sh --hd      # 1280×720
bash scripts/run-qemu.sh --snapshot   # discard changes
bash scripts/run-qemu.sh --mem=1024   # 1 GiB RAM
bash scripts/run-qemu.sh --cpus=4     # 4 vCPUs
```

---

## Project Structure

```
alpha-os/
├── src/
│   ├── types/          ← Core type definitions (OS primitives)
│   ├── kernel/         ← Kernel, ProcessManager, Scheduler, Syscall
│   ├── drivers/        ← Display, Keyboard, Mouse, Framebuffer
│   ├── vfs/            ← Virtual File System
│   ├── window/         ← Window manager & OsWindow
│   └── shell/          ← Interactive shell
├── simulator/
│   ├── main.ts         ← Electron main process
│   ├── preload.ts      ← IPC bridge
│   ├── index.html      ← Simulator UI
│   └── renderer.js     ← Canvas compositor
├── iso-boot/
│   └── boot.ts         ← Bare-metal entry point
├── scripts/
│   ├── build-iso.sh    ← ISO builder
│   └── run-qemu.sh     ← QEMU launcher
├── tsconfig.json
├── package.json
└── .prettierrc         ← 4-space tabs, 120 cols
```

---

## Extending AlphaOS

### Add a new syscall

```typescript
// 1. src/types/index.ts
export enum SyscallType { ..., MY_CALL = 21 }

// 2. src/kernel/Syscall.ts
case SyscallType.MY_CALL: {
    const arg = args[0] as string;
    return doSomething(arg);
}
```

### Add a new shell command

```typescript
// src/shell/Shell.ts
register({
    name: "mycommand",
    description: "Does something cool",
    run: (args) => `Result: ${args.join(" ")}`,
});
```

### Spawn a custom process

```typescript
kernel.processManager.spawn("myapp", async (ctx, k) => {
    const winId = k.windowManager.createWindow({
        title: "My App",
        x: 100, y: 100, width: 400, height: 300,
        ownerPID: ctx.pid,
    });
    k.windowManager.submitDrawCommands(winId, [
        { type: "rect",  x: 0, y: 0, width: 400, height: 300, color: "#313244" },
        { type: "text",  x: 20, y: 30, text: "Hello from myapp!", font: "16px monospace", color: "#cdd6f4" },
    ]);
});
```
