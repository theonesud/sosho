#!/usr/bin/env bash
# ==============================================================================
# stego-scan.sh: Quick steganography & anomaly scan for target media
# ==============================================================================
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
    echo "Usage: $0 <media_file>" >&2
    exit 1
fi

echo "🔍 Stego & Metadata Scan: $TARGET..."
echo "=== [FILE METADATA] ==="
file "$TARGET"

if command -v exiftool >/dev/null 2>&1; then
    echo ""
    echo "=== [EXIF METADATA] ==="
    exiftool "$TARGET" | grep -iE 'comment|artist|copyright|description|warning|history' || echo "No suspicious EXIF fields."
fi

if command -v binwalk >/dev/null 2>&1; then
    echo ""
    echo "=== [EMBEDDED SIGNATURES (binwalk)] ==="
    binwalk -B "$TARGET" | head -n 20 || true
fi

echo ""
echo "=== [TRAILING STRINGS CHECK] ==="
tail -c 2048 "$TARGET" | strings -n 6 | head -n 15 || echo "No trailing plaintext strings."
