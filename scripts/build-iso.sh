#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  build-iso.sh  — AlphaOS ISO builder
#  Produces: iso/output.iso  (x86_64, BIOS+UEFI hybrid, GRUB2 bootloader)
#
#  Requirements (install once):
#    sudo apt install grub-pc-bin grub-efi-amd64-bin xorriso mtools nodejs
#    npm install -g pkg            # bundles Node.js app into native binary
#
#  The resulting ISO boots into a minimal Linux initramfs that immediately
#  launches the AlphaOS kernel runtime using a statically-linked Node binary.
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ISO_DIR="$ROOT/iso"
ROOTFS="$ISO_DIR/rootfs"
OUTPUT="$ISO_DIR/output.iso"

KERNEL_ENTRY="$ROOT/dist/src/kernel/Kernel.js"
BOOT_SCRIPT="$ROOT/dist/iso-boot/boot.js"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${CYAN}[build-iso]${NC} $*"; }
ok()    { echo -e "${GREEN}[build-iso]${NC} $*"; }
error() { echo -e "${RED}[build-iso] ERROR:${NC} $*"; exit 1; }

# ── Preflight ─────────────────────────────────────────────────────────────────

check_dep() { command -v "$1" &>/dev/null || error "Missing: $1  →  $2"; }
check_dep xorriso    "sudo apt install xorriso"
check_dep grub-mkrescue "sudo apt install grub-pc-bin grub-efi-amd64-bin"
check_dep node       "https://nodejs.org"

info "AlphaOS ISO Builder"
info "Root: $ROOT"

# ── Step 1: TypeScript build ──────────────────────────────────────────────────

info "Building TypeScript..."
cd "$ROOT"
npm run build || error "TypeScript build failed"
ok "TypeScript build complete"

# ── Step 2: Bundle Node.js app with pkg ───────────────────────────────────────

info "Bundling Node.js runtime with pkg..."
if ! command -v pkg &>/dev/null; then
    info "Installing pkg globally..."
    npm install -g pkg
fi

mkdir -p "$ISO_DIR/bin"

# Create ISO boot entry point
mkdir -p "$ROOT/dist/iso-boot"
cat > "$ROOT/iso-boot/boot.ts" << 'TSEOF'
// AlphaOS bare-metal boot entry
// This runs inside the ISO, headless (no Electron).
// Uses a framebuffer /dev/fb0 driver instead of Canvas.
import { Kernel } from "../src/kernel/Kernel.js";
import { FramebufferBackend } from "../src/drivers/FramebufferBackend.js";

process.on("uncaughtException", (err) => {
    process.stderr.write(`[PANIC] ${err.message}\n${err.stack}\n`);
    process.exit(1);
});

process.on("SIGINT",  () => kernel.shutdown(0));
process.on("SIGTERM", () => kernel.shutdown(0));

const kernel = new Kernel({
    displayWidth:  1024,
    displayHeight: 768,
    memorySize:    256 * 1024 * 1024,
    tickRate:      30,
    debug:         process.env.DEBUG === "1",
});

const fb = new FramebufferBackend(kernel);
await fb.initialize("/dev/fb0");

kernel.on("shutdown", ({ exitCode }: { exitCode: number }) => {
    fb.destroy();
    process.exit(exitCode);
});

await kernel.boot();
process.stderr.write("[boot] AlphaOS kernel running in bare-metal mode\n");
TSEOF

# Compile boot entry
npx tsc --outDir "$ROOT/dist/iso-boot" \
    --module CommonJS --target ES2022 \
    --skipLibCheck --esModuleInterop \
    "$ROOT/iso-boot/boot.ts" 2>/dev/null || true

# Package into a single executable
pkg "$ROOT/dist/iso-boot/boot.js" \
    --target node20-linux-x64 \
    --output "$ISO_DIR/bin/alphaos" \
    --compress Brotli \
    || error "pkg failed — try: npm install -g pkg && pkg ."

ok "Binary packaged: $ISO_DIR/bin/alphaos ($(du -sh "$ISO_DIR/bin/alphaos" | cut -f1))"

# ── Step 3: Build rootfs ──────────────────────────────────────────────────────

info "Building rootfs..."
rm -rf "$ROOTFS"
mkdir -p "$ROOTFS"/{boot/grub,etc,proc,sys,dev,tmp,bin,sbin,usr/bin,root}

# Copy binary
cp "$ISO_DIR/bin/alphaos" "$ROOTFS/bin/alphaos"
chmod +x "$ROOTFS/bin/alphaos"

# Minimal /init script (runs as PID 1 in initramfs)
cat > "$ROOTFS/init" << 'INITEOF'
#!/bin/sh
# AlphaOS initramfs /init
export PATH=/bin:/sbin:/usr/bin

# Mount essential pseudo-filesystems
mount -t proc     proc     /proc
mount -t sysfs    sysfs    /sys
mount -t devtmpfs devtmpfs /dev || mdev -s

# Set up framebuffer
[ -f /sys/class/graphics/fb0/virtual_size ] && \
    echo "1024,768" > /sys/class/graphics/fb0/virtual_size 2>/dev/null || true

# Set hostname
echo "alphaos" > /proc/sys/kernel/hostname

# Welcome banner
clear
cat << 'BANNER'
   _    _      _            ___  ____
  / \  | |_ __| |__   __ _/ _ \/ ___|
 / _ \ | | '_ \ '_ \ / _` | | | \___ \
/ ___ \| | |_) | | | | (_| | |_| |___) |
/_/   \_\_| .__/|_| |_|\__,_|\___/|____/
          |_|   TypeScript OS Framework v0.1.0
BANNER

echo ""
echo "[init] Starting AlphaOS kernel..."
sleep 0.5

exec /bin/alphaos
INITEOF
chmod +x "$ROOTFS/init"

# Busybox-style minimal shell fallback
cat > "$ROOTFS/bin/sh" << 'SHEOF'
#!/bin/alphaos
// This file intentionally left empty; sh is not used in normal boot
SHEOF

# /etc/motd
cat > "$ROOTFS/etc/motd" << 'MOTDEOF'
AlphaOS 0.1.0 - TypeScript Operating System Framework
MOTDEOF

# ── Step 4: GRUB config ───────────────────────────────────────────────────────

info "Writing GRUB config..."
cat > "$ROOTFS/boot/grub/grub.cfg" << 'GRUBEOF'
set default=0
set timeout=3
set gfxmode=1024x768x32
set gfxpayload=keep

loadfont unicode
insmod all_video
insmod gfxterm
insmod png

terminal_output gfxterm
background_color black

menuentry "AlphaOS 0.1.0" {
    linux /boot/vmlinuz quiet console=tty0 vga=0x341 \
        init=/init rootfstype=ramfs
    initrd /boot/initrd.img
}

menuentry "AlphaOS (debug)" {
    linux /boot/vmlinuz console=ttyS0,115200 console=tty0 \
        vga=0x341 init=/init DEBUG=1 rootfstype=ramfs
    initrd /boot/initrd.img
}

menuentry "AlphaOS (VESA 1280x720)" {
    linux /boot/vmlinuz quiet console=tty0 vga=0x365 \
        init=/init rootfstype=ramfs
    initrd /boot/initrd.img
}
GRUBEOF

# ── Step 5: Download minimal kernel + create initrd ───────────────────────────

VMLINUZ="$ROOTFS/boot/vmlinuz"
INITRD="$ROOTFS/boot/initrd.img"

# Try to reuse existing kernel image
if [ ! -f "$VMLINUZ" ]; then
    info "Fetching minimal Linux kernel..."
    # Use the host kernel as a fallback for QEMU testing
    HOST_VMLINUZ=$(find /boot -name "vmlinuz*" | sort -r | head -1 2>/dev/null || true)
    if [ -n "$HOST_VMLINUZ" ]; then
        cp "$HOST_VMLINUZ" "$VMLINUZ"
        ok "Using host kernel: $HOST_VMLINUZ"
    else
        error "No kernel found. Place a vmlinuz at $VMLINUZ"
    fi
fi

# Build initrd from rootfs
info "Building initrd..."
(cd "$ROOTFS" && find . | cpio -H newc -o | gzip -9) > "$INITRD"
ok "initrd: $(du -sh "$INITRD" | cut -f1)"

# ── Step 6: Build ISO ─────────────────────────────────────────────────────────

info "Building ISO with grub-mkrescue..."
mkdir -p "$ISO_DIR/esp/EFI/BOOT"

grub-mkrescue \
    --output="$OUTPUT" \
    "$ROOTFS" \
    -- \
    -volid "ALPHAOS" \
    -joliet \
    -rock \
    2>&1 | grep -v "^$" || error "grub-mkrescue failed"

ISO_SIZE=$(du -sh "$OUTPUT" | cut -f1)
ok "ISO built: $OUTPUT ($ISO_SIZE)"
echo ""
echo -e "  ${GREEN}Run with QEMU:${NC}  bash scripts/run-qemu.sh"
echo ""
