#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  run-qemu.sh — Launch AlphaOS in QEMU
#
#  Usage:
#    bash scripts/run-qemu.sh              # default 1024×768, KVM if available
#    bash scripts/run-qemu.sh --debug      # serial output to terminal
#    bash scripts/run-qemu.sh --no-kvm     # force TCG (software emulation)
#    bash scripts/run-qemu.sh --vnc        # headless VNC mode (port 5900)
#    bash scripts/run-qemu.sh --efi        # UEFI boot (requires ovmf)
#    bash scripts/run-qemu.sh --snapshot   # discard disk changes on exit
#
#  Requirements:
#    sudo apt install qemu-system-x86 ovmf
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ISO="$ROOT/iso/output.iso"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${CYAN}[qemu]${NC} $*"; }
ok()    { echo -e "${GREEN}[qemu]${NC} $*"; }
warn()  { echo -e "${YELLOW}[qemu]${NC} $*"; }
error() { echo -e "${RED}[qemu] ERROR:${NC} $*"; exit 1; }

# ── Parse flags ───────────────────────────────────────────────────────────────

DEBUG=0
NO_KVM=0
VNC_MODE=0
EFI_MODE=0
SNAPSHOT=0
DISPLAY_W=1024
DISPLAY_H=768
MEMORY=512
CPUS=2

for arg in "$@"; do
    case "$arg" in
        --debug)    DEBUG=1 ;;
        --no-kvm)   NO_KVM=1 ;;
        --vnc)      VNC_MODE=1 ;;
        --efi)      EFI_MODE=1 ;;
        --snapshot) SNAPSHOT=1 ;;
        --hd)       DISPLAY_W=1280; DISPLAY_H=720 ;;
        --4k)       DISPLAY_W=3840; DISPLAY_H=2160 ;;
        --mem=*)    MEMORY="${arg#--mem=}" ;;
        --cpus=*)   CPUS="${arg#--cpus=}" ;;
        --help)
            echo "Usage: $0 [--debug] [--no-kvm] [--vnc] [--efi] [--snapshot]"
            echo "          [--hd] [--4k] [--mem=N] [--cpus=N]"
            exit 0
            ;;
    esac
done

# ── Preflight ─────────────────────────────────────────────────────────────────

command -v qemu-system-x86_64 &>/dev/null || error "QEMU not found: sudo apt install qemu-system-x86"

[ -f "$ISO" ] || error "ISO not found: $ISO\n  Run: bash scripts/build-iso.sh"

info "AlphaOS QEMU Launcher"
info "ISO:    $ISO ($(du -sh "$ISO" | cut -f1))"
info "RAM:    ${MEMORY}M  CPUs: $CPUS"
info "Screen: ${DISPLAY_W}×${DISPLAY_H}"

# ── KVM detection ─────────────────────────────────────────────────────────────

ACCEL_FLAGS=()
if [ $NO_KVM -eq 0 ] && [ -e /dev/kvm ] && [ -r /dev/kvm ]; then
    ACCEL_FLAGS=(-enable-kvm -cpu host)
    ok "KVM acceleration enabled"
else
    warn "KVM not available — using TCG (slower)"
    ACCEL_FLAGS=(-cpu qemu64)
fi

# ── Machine flags ─────────────────────────────────────────────────────────────

MACHINE_FLAGS=(
    -machine   q35,accel=$([ ${#ACCEL_FLAGS[@]} -gt 0 ] && echo kvm || echo tcg)
    -m         "${MEMORY}M"
    -smp       "$CPUS"
    -rtc       base=utc
    "${ACCEL_FLAGS[@]}"
)

# ── Display flags ─────────────────────────────────────────────────────────────

if [ $VNC_MODE -eq 1 ]; then
    DISPLAY_FLAGS=(-display vnc=:0 -vga std)
    ok "VNC mode: connect to localhost:5900"
else
    DISPLAY_FLAGS=(
        -display gtk,zoom-to-fit=on,show-cursor=on
        -vga     virtio
        -device  virtio-vga,xres=$DISPLAY_W,yres=$DISPLAY_H
    )
fi

# ── Serial / debug flags ──────────────────────────────────────────────────────

if [ $DEBUG -eq 1 ]; then
    SERIAL_FLAGS=(-serial stdio -monitor none)
    info "Debug mode: serial output on stdout"
else
    SERIAL_FLAGS=(-serial none -monitor none)
fi

# ── EFI firmware ─────────────────────────────────────────────────────────────

EFI_FLAGS=()
if [ $EFI_MODE -eq 1 ]; then
    OVMF_CODE=$(find /usr/share -name "OVMF_CODE*.fd" 2>/dev/null | head -1 || true)
    OVMF_VARS=$(find /usr/share -name "OVMF_VARS*.fd" 2>/dev/null | head -1 || true)
    if [ -z "$OVMF_CODE" ]; then
        warn "OVMF not found: sudo apt install ovmf  — falling back to BIOS"
    else
        cp "$OVMF_VARS" /tmp/alphaos_ovmf_vars.fd 2>/dev/null || true
        EFI_FLAGS=(
            -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE"
            -drive if=pflash,format=raw,file=/tmp/alphaos_ovmf_vars.fd
        )
        ok "UEFI mode: $OVMF_CODE"
    fi
fi

# ── Snapshot flag ─────────────────────────────────────────────────────────────

SNAP_FLAGS=()
[ $SNAPSHOT -eq 1 ] && SNAP_FLAGS=(-snapshot)

# ── Network (user-mode) ───────────────────────────────────────────────────────

NET_FLAGS=(
    -netdev user,id=net0
    -device virtio-net-pci,netdev=net0
)

# ── Drive ─────────────────────────────────────────────────────────────────────

DRIVE_FLAGS=(
    -drive  file="$ISO",format=raw,media=cdrom,readonly=on
    -boot   d
)

# ── Launch ────────────────────────────────────────────────────────────────────

echo ""
info "Launching QEMU..."
echo ""

set -x
exec qemu-system-x86_64 \
    "${MACHINE_FLAGS[@]}" \
    "${DRIVE_FLAGS[@]}" \
    "${DISPLAY_FLAGS[@]}" \
    "${SERIAL_FLAGS[@]}" \
    "${EFI_FLAGS[@]}" \
    "${NET_FLAGS[@]}" \
    "${SNAP_FLAGS[@]}" \
    -name "AlphaOS Simulator,process=alphaos-qemu" \
    -no-reboot \
    "$@"
