import { EventEmitter } from "events";
import type { MemoryAddress, MemoryBlock, MemoryStats, PID } from "../types/index.js";

/**
 * First-fit buddy allocator simulation.
 * Manages a flat address space of `totalSize` bytes divided into fixed-size pages.
 */
export class MemoryManager extends EventEmitter {
    public static readonly PAGE_SIZE = 4096; // 4 KiB

    private readonly totalSize: number;
    private readonly blocks: MemoryBlock[] = [];
    private nextAddress: MemoryAddress = 0;
    private usedBytes: number = 0;

    constructor(totalSize: number) {
        super();
        this.totalSize = totalSize;
        // Bootstrap: one giant free block
        this.blocks.push({
            address: 0,
            size: totalSize,
            pid: null,
            free: true,
            tag: "free",
        });
    }

    /**
     * Allocate `size` bytes for `pid`. Returns the base address or throws on OOM.
     */
    malloc(size: number, pid: PID, tag = "heap"): MemoryAddress {
        const aligned = this.alignUp(size, MemoryManager.PAGE_SIZE);

        for (let i = 0; i < this.blocks.length; i++) {
            const block = this.blocks[i];
            if (!block.free || block.size < aligned) {
                continue;
            }

            const address = block.address;

            // Split the block if there's enough remainder
            if (block.size - aligned >= MemoryManager.PAGE_SIZE) {
                this.blocks.splice(i + 1, 0, {
                    address: address + aligned,
                    size: block.size - aligned,
                    pid: null,
                    free: true,
                    tag: "free",
                });
            }

            block.size = aligned;
            block.free = false;
            block.pid = pid;
            block.tag = tag;

            this.usedBytes += aligned;
            this.nextAddress = Math.max(this.nextAddress, address + aligned);

            this.emit("alloc", { pid, address, size: aligned });
            return address;
        }

        throw new Error(`[MemMgr] OOM: cannot allocate ${size} bytes for PID ${pid}`);
    }

    /**
     * Free the block starting at `address`.
     */
    free(address: MemoryAddress): void {
        const idx = this.blocks.findIndex((b) => b.address === address && !b.free);
        if (idx === -1) {
            throw new Error(`[MemMgr] Invalid free: address 0x${address.toString(16)}`);
        }

        const block = this.blocks[idx];
        this.usedBytes -= block.size;
        block.free = true;
        block.pid = null;
        block.tag = "free";

        this.emit("free", { address, size: block.size });
        this.coalesce(idx);
    }

    /**
     * Release ALL memory held by a process.
     */
    freeByPID(pid: PID): void {
        const owned = this.blocks.filter((b) => !b.free && b.pid === pid);
        for (const block of owned) {
            this.free(block.address);
        }
    }

    getStats(): MemoryStats {
        const freeBlocks = this.blocks.filter((b) => b.free);
        const fragmentation =
            freeBlocks.length > 1
                ? 1 - Math.max(...freeBlocks.map((b) => b.size)) / freeBlocks.reduce((s, b) => s + b.size, 0)
                : 0;

        return {
            total: this.totalSize,
            used: this.usedBytes,
            free: this.totalSize - this.usedBytes,
            blocks: this.blocks.length,
            fragmentation: Math.round(fragmentation * 100) / 100,
        };
    }

    dump(): MemoryBlock[] {
        return [...this.blocks];
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private alignUp(value: number, align: number): number {
        return Math.ceil(value / align) * align;
    }

    /**
     * Merge adjacent free blocks (buddy-coalesce).
     */
    private coalesce(idx: number): void {
        // Merge with next
        while (idx < this.blocks.length - 1 && this.blocks[idx + 1].free) {
            const next = this.blocks.splice(idx + 1, 1)[0];
            this.blocks[idx].size += next.size;
        }
        // Merge with previous
        while (idx > 0 && this.blocks[idx - 1].free) {
            const prev = this.blocks.splice(idx - 1, 1)[0];
            idx--;
            this.blocks[idx].size += prev.size;
            this.blocks[idx].address = prev.address;
        }
    }
}
