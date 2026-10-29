#!/usr/bin/env bash
# ==============================================================================
# net-probe.sh: Safe local network discovery for owned devices
# Output saved to .pi/work/security/net_probe.md. Compact table to stdout.
# ==============================================================================
set -euo pipefail

TARGET="${1:-192.168.1.0/24}"
SEC_DIR="${SOSHO_SECURITY_DIR:-.pi/work/security}"
mkdir -p "$SEC_DIR"
OUT_FILE="${SEC_DIR}/net_probe.md"

echo "📡 Probing target: $TARGET..."

if command -v nmap >/dev/null 2>&1; then
    nmap -sn "$TARGET" -oG - | awk '/Up$/{print $2, $3}' > "$OUT_FILE"
elif command -v arp-scan >/dev/null 2>&1; then
    sudo arp-scan -l > "$OUT_FILE" 2>/dev/null || arp -a > "$OUT_FILE"
else
    # Simple ping sweep
    PREFIX="$(echo "$TARGET" | cut -d/ -f1 | cut -d. -f1-3)"
    echo "Running quick ping sweep on ${PREFIX}.1-30..."
    > "$OUT_FILE"
    for i in {1..30}; do
        (ping -c 1 -W 1 "${PREFIX}.${i}" >/dev/null 2>&1 && echo "${PREFIX}.${i} is UP" >> "$OUT_FILE") &
    done
    wait
fi

LINES="$(wc -l < "$OUT_FILE" | tr -d ' ')"
echo "=== [NETWORK PROBE COMPLETE] ==="
echo "• Target: $TARGET"
echo "• Active Hosts: $LINES found (Saved to $OUT_FILE)"
echo "------------------------------------------------------------"
head -n 25 "$OUT_FILE"
echo "============================================================"
