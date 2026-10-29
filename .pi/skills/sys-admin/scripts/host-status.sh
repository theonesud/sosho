#!/usr/bin/env bash
# ==============================================================================
# host-status.sh: Quick diagnostic snapshot of host Linux system
# ==============================================================================
set -euo pipefail

echo "=== [HOST SYSTEM HEALTH] ==="

# CPU & Load
echo "• CPU & Load: $(uptime | awk -F'load average:' '{print $2}')"

# Memory
echo "• Memory:"
free -h | awk 'NR<=2{print "  " $0}'

# Disk Space
echo "• Root Disk:"
df -h / | awk 'NR<=2{print "  " $0}'

# GPU Status (if nvidia)
if command -v nvidia-smi >/dev/null 2>&1; then
    echo "• NVIDIA GPU:"
    nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader | awk '{print "  " $0}'
fi

# Failed Services
echo "• Failed Systemd Services:"
FAILED="$(systemctl --failed --no-legend --no-pager 2>/dev/null || true)"
if [ -n "$FAILED" ]; then
    echo "$FAILED" | head -n 10 | awk '{print "  " $0}'
else
    echo "  (None - All units healthy)"
fi

# Kernel Errors in dmesg (last 5)
echo "• Recent dmesg Warnings/Errors:"
dmesg -T -l err,warn 2>/dev/null | tail -n 5 | awk '{print "  " $0}' || echo "  (dmesg restricted or clean)"

echo "============================================================"
