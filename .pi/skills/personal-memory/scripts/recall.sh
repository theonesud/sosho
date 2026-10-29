#!/usr/bin/env bash
# ==============================================================================
# recall.sh: Search personal memory files in .pi/work/memory/
# ==============================================================================
set -euo pipefail

QUERY="${1:-}"
MEM_DIR="${SOSHO_MEMORY_DIR:-.pi/work/memory}"
mkdir -p "$MEM_DIR"

if [ -z "$QUERY" ]; then
    echo "=== [PERSONAL MEMORY FILES] ==="
    ls -lh "$MEM_DIR"
    exit 0
fi

echo "🧠 Searching personal memory for '$QUERY'..."
grep -in -C 2 --color=never "$QUERY" "$MEM_DIR"/* 2>/dev/null | head -n 35 || {
    echo "No direct matches found for '$QUERY' in personal memory files."
}
