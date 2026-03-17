import { EventEmitter } from "events";
import type { Inode, DirEntry, FileHandle } from "../types/index.js";
import { FileType } from "../types/index.js";

interface VNode {
    inode: Inode;
    data: Buffer | null;
    children: Map<string, number>; // name → ino
    symlink: string | null;
}

let _inoCounter = 1;
const nextIno = (): number => _inoCounter++;

export class VirtualFS extends EventEmitter {
    private readonly _vnodes = new Map<number, VNode>();
    private readonly _handles = new Map<number, FileHandle>();
    private _fdCounter = 3; // 0=stdin 1=stdout 2=stderr

    async initialize(): Promise<void> {
        // Root inode
        this._mkVNode(FileType.DIRECTORY, null);
        // Bootstrap directory tree
        this.mkdir("/bin");
        this.mkdir("/dev");
        this.mkdir("/proc");
        this.mkdir("/tmp");
        this.mkdir("/home");
        this.mkdir("/var");
        this.mkdir("/var/log");
        // Seed /proc/version
        this._writeFile("/proc/version", Buffer.from("AlphaOS 0.1.0 (TypeScript)\n"));
        this.emit("ready");
    }

    // ─── Directory ops ────────────────────────────────────────────────────────

    mkdir(path: string): void {
        const parts = this._splitPath(path);
        const name = parts.pop()!;
        const parentIno = this._resolvePath(parts);
        if (parentIno === null) {
            throw new Error(`mkdir: parent not found: /${parts.join("/")}`);
        }
        if (this._resolveInDir(parentIno, name) !== null) {
            return; // already exists — idempotent
        }
        const ino = this._mkVNode(FileType.DIRECTORY, null);
        this._vnodes.get(parentIno)!.children.set(name, ino);
    }

    readdir(path: string): DirEntry[] {
        const ino = this._resolvePathStr(path);
        if (ino === null) {
            throw new Error(`readdir: not found: ${path}`);
        }
        const vnode = this._vnodes.get(ino)!;
        const entries: DirEntry[] = [
            { name: ".", ino, type: FileType.DIRECTORY },
            { name: "..", ino, type: FileType.DIRECTORY },
        ];
        for (const [name, childIno] of vnode.children) {
            const child = this._vnodes.get(childIno)!;
            entries.push({ name, ino: childIno, type: child.inode.type });
        }
        return entries;
    }

    // ─── File ops ─────────────────────────────────────────────────────────────

    open(path: string, flags: number, _pid: number): number {
        let ino = this._resolvePathStr(path);
        const O_CREAT = 0x40;
        if (ino === null) {
            if (flags & O_CREAT) {
                const parts = this._splitPath(path);
                const name = parts.pop()!;
                const parentIno = this._resolvePath(parts);
                if (parentIno === null) {
                    throw new Error(`open: parent not found: ${path}`);
                }
                ino = this._mkVNode(FileType.REGULAR, null);
                this._vnodes.get(parentIno)!.children.set(name, ino);
            } else {
                throw new Error(`open: not found: ${path}`);
            }
        }
        const fd = this._fdCounter++;
        this._handles.set(fd, { fd, path, flags, position: 0, ino });
        return fd;
    }

    close(fd: number): void {
        if (!this._handles.has(fd)) {
            throw new Error(`close: bad fd ${fd}`);
        }
        this._handles.delete(fd);
    }

    read(fd: number, size: number): Buffer {
        const handle = this._handles.get(fd);
        if (!handle) {
            throw new Error(`read: bad fd ${fd}`);
        }
        const vnode = this._vnodes.get(handle.ino)!;
        const data = vnode.data ?? Buffer.alloc(0);
        const slice = data.slice(handle.position, handle.position + size);
        handle.position += slice.length;
        return slice;
    }

    write(fd: number, data: Buffer): number {
        const handle = this._handles.get(fd);
        if (!handle) {
            throw new Error(`write: bad fd ${fd}`);
        }
        const vnode = this._vnodes.get(handle.ino)!;
        const existing = vnode.data ?? Buffer.alloc(0);
        const newData = Buffer.concat([existing.slice(0, handle.position), data]);
        vnode.data = newData;
        vnode.inode.size = newData.length;
        vnode.inode.mtime = Date.now();
        handle.position += data.length;
        return data.length;
    }

    readFile(path: string): Buffer {
        const ino = this._resolvePathStr(path);
        if (ino === null) {
            throw new Error(`readFile: not found: ${path}`);
        }
        return this._vnodes.get(ino)!.data ?? Buffer.alloc(0);
    }

    stat(path: string): Inode {
        const ino = this._resolvePathStr(path);
        if (ino === null) {
            throw new Error(`stat: not found: ${path}`);
        }
        return { ...this._vnodes.get(ino)!.inode };
    }

    unlink(path: string): void {
        const parts = this._splitPath(path);
        const name = parts.pop()!;
        const parentIno = this._resolvePath(parts);
        if (parentIno === null) {
            throw new Error(`unlink: parent not found`);
        }
        const parent = this._vnodes.get(parentIno)!;
        if (!parent.children.has(name)) {
            throw new Error(`unlink: not found: ${path}`);
        }
        const ino = parent.children.get(name)!;
        parent.children.delete(name);
        const vnode = this._vnodes.get(ino)!;
        vnode.inode.nlink--;
        if (vnode.inode.nlink <= 0) {
            this._vnodes.delete(ino);
        }
    }

    exists(path: string): boolean {
        return this._resolvePathStr(path) !== null;
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private _mkVNode(type: FileType, data: Buffer | null): number {
        const ino = nextIno();
        this._vnodes.set(ino, {
            inode: {
                ino,
                type,
                mode: type === FileType.DIRECTORY ? 0o755 : 0o644,
                uid: 0,
                gid: 0,
                size: data?.length ?? 0,
                atime: Date.now(),
                mtime: Date.now(),
                ctime: Date.now(),
                nlink: 1,
            },
            data,
            children: new Map(),
            symlink: null,
        });
        return ino;
    }

    private _writeFile(path: string, data: Buffer): void {
        const parts = this._splitPath(path);
        const name = parts.pop()!;
        const parentIno = this._resolvePath(parts);
        if (parentIno === null) {
            return;
        }
        let ino = this._resolveInDir(parentIno, name);
        if (ino === null) {
            ino = this._mkVNode(FileType.REGULAR, data);
            this._vnodes.get(parentIno)!.children.set(name, ino);
        } else {
            const vnode = this._vnodes.get(ino)!;
            vnode.data = data;
            vnode.inode.size = data.length;
        }
    }

    private _splitPath(path: string): string[] {
        return path.replace(/^\//, "").split("/").filter(Boolean);
    }

    private _resolvePathStr(path: string): number | null {
        return this._resolvePath(this._splitPath(path));
    }

    private _resolvePath(parts: string[]): number | null {
        let ino = 1; // root inode
        for (const part of parts) {
            const child = this._resolveInDir(ino, part);
            if (child === null) {
                return null;
            }
            ino = child;
        }
        return ino;
    }

    private _resolveInDir(dirIno: number, name: string): number | null {
        return this._vnodes.get(dirIno)?.children.get(name) ?? null;
    }
}
