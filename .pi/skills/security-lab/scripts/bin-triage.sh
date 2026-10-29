#!/usr/bin/env bash
# ==============================================================================
# bin-triage.sh: Reverse engineering triage for target binaries
# ==============================================================================
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
    echo "Usage: $0 <binary_path>" >&2
    exit 1
fi

SEC_DIR="${SOSHO_SECURITY_DIR:-.pi/work/security}"
mkdir -p "$SEC_DIR"
SLUG="$(basename "$TARGET" | sed -e 's/[^a-zA-Z0-9]/_/g')"
OUT_FILE="${SEC_DIR}/triage_${SLUG}.md"

echo "🔬 Triaging binary: $TARGET..."
{
    echo "# Binary Triage: $(basename "$TARGET")"
    echo "Path: $TARGET"
    echo ""
    echo "## File Identification"
    file "$TARGET"
    echo ""
    echo "## Architecture & Headers"
    if command -v readelf >/dev/null 2>&1; then
        readelf -h "$TARGET" 2>/dev/null | head -n 20 || true
    fi
    echo ""
    echo "## Security Mitigations (checksec)"
    if command -v checksec >/dev/null 2>&1; then
        checksec --file="$TARGET" 2>/dev/null || true
    fi
    echo ""
    echo "## Interesting Strings (Sample)"
    strings -n 8 "$TARGET" | grep -iE 'http|pass|key|root|admin|secret|flag|token' | head -n 25 || strings -n 8 "$TARGET" | head -n 25
} > "$OUT_FILE"

echo "=== [BINARY TRIAGE COMPLETE] ==="
echo "• Saved to: $OUT_FILE"
echo "------------------------------------------------------------"
head -n 30 "$OUT_FILE"
echo "============================================================"
