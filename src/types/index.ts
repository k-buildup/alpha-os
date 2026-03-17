// ─── Process ─────────────────────────────────────────────────────────────────

export type PID = number;
export type MemoryAddress = number;

export enum ProcessState {
    READY = "READY",
    RUNNING = "RUNNING",
    BLOCKED = "BLOCKED",
    SLEEPING = "SLEEPING",
    ZOMBIE = "ZOMBIE",
}

export interface ProcessInfo {
    pid: PID;
    ppid: PID;
    name: string;
    state: ProcessState;
    priority: number;
    nice: number;
    memBase: MemoryAddress;
    memSize: number;
    createdAt: number;
    cpuTime: number;
    exitCode: number | null;
}

export interface ProcessContext {
    pid: PID;
    heap: ArrayBuffer;
    stack: number[];
    registers: Record<string, number>;
    openFDs: number[];
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export interface MemoryBlock {
    address: MemoryAddress;
    size: number;
    pid: PID | null;
    free: boolean;
    tag: string;
}

export interface MemoryStats {
    total: number;
    used: number;
    free: number;
    blocks: number;
    fragmentation: number;
}

// ─── Syscall ──────────────────────────────────────────────────────────────────

export enum SyscallType {
    FORK = 0,
    EXEC = 1,
    EXIT = 2,
    WRITE = 3,
    READ = 4,
    OPEN = 5,
    CLOSE = 6,
    MALLOC = 7,
    FREE = 8,
    DRAW = 9,
    GETPID = 10,
    GETPPID = 11,
    SLEEP = 12,
    KILL = 13,
    YIELD = 14,
    WINDOW_CREATE = 15,
    WINDOW_DESTROY = 16,
    WINDOW_DRAW = 17,
    STAT = 18,
    MKDIR = 19,
    UNLINK = 20,
}

export interface SyscallArgs {
    call: SyscallType;
    args: unknown[];
}

export type SyscallResult = { ok: true; value: unknown } | { ok: false; errno: number; message: string };

// ─── Display & Geometry ───────────────────────────────────────────────────────

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

export type ColorHex = `#${string}`;

export interface FrameBuffer {
    width: number;
    height: number;
    data: Uint8ClampedArray; // RGBA
}

export interface DrawCommand {
    type: "rect" | "text" | "line" | "circle" | "image" | "clear";
    x: number;
    y: number;
    width?: number;
    height?: number;
    color?: ColorHex;
    text?: string;
    font?: string;
    fontSize?: number;
    imageData?: Uint8ClampedArray;
    radius?: number;
    x2?: number;
    y2?: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type InputEventType = "keydown" | "keyup" | "mousedown" | "mouseup" | "mousemove" | "wheel" | "focus" | "blur";

export interface KeyboardEventData {
    key: string;
    code: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    repeat: boolean;
}

export interface MouseEventData {
    x: number;
    y: number;
    button: number;
    buttons: number;
    deltaX?: number;
    deltaY?: number;
}

export interface InputEvent {
    type: InputEventType;
    timestamp: number;
    data: KeyboardEventData | MouseEventData;
}

// ─── Window ───────────────────────────────────────────────────────────────────

export enum WindowState {
    NORMAL = "NORMAL",
    MINIMIZED = "MINIMIZED",
    MAXIMIZED = "MAXIMIZED",
    FULLSCREEN = "FULLSCREEN",
}

export interface WindowDescriptor {
    id: number;
    title: string;
    bounds: Rect;
    zIndex: number;
    state: WindowState;
    focused: boolean;
    ownerPID: PID;
    resizable: boolean;
    decorations: boolean;
    opacity: number;
    backgroundColor: ColorHex;
}

export interface WindowEvent {
    type: "close" | "resize" | "move" | "focus" | "blur" | "minimize" | "maximize" | "restore";
    windowId: number;
    data?: unknown;
}

// ─── VFS ─────────────────────────────────────────────────────────────────────

export enum FileType {
    REGULAR = "REGULAR",
    DIRECTORY = "DIRECTORY",
    SYMLINK = "SYMLINK",
    DEVICE = "DEVICE",
    PIPE = "PIPE",
}

export interface Inode {
    ino: number;
    type: FileType;
    mode: number;
    uid: number;
    gid: number;
    size: number;
    atime: number;
    mtime: number;
    ctime: number;
    nlink: number;
}

export interface DirEntry {
    name: string;
    ino: number;
    type: FileType;
}

export interface FileHandle {
    fd: number;
    path: string;
    flags: number;
    position: number;
    ino: number;
}

// ─── IPC (Simulator ↔ Kernel Bridge) ─────────────────────────────────────────

export interface IpcMessage {
    channel: string;
    payload: unknown;
}

export type KernelToRenderer =
    | { type: "frame"; buffer: ArrayBuffer; width: number; height: number }
    | { type: "log"; level: "info" | "warn" | "error"; message: string }
    | { type: "boot_complete" }
    | { type: "shutdown" }
    | { type: "panic"; message: string };

export type RendererToKernel =
    | { type: "input_event"; event: InputEvent }
    | { type: "resize"; width: number; height: number }
    | { type: "shutdown_request" };
