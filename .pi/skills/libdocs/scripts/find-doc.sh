#!/usr/bin/env bash
# ==============================================================================
# find-doc.sh: Search indexed library documentation for symbols or patterns
# ==============================================================================
set -euo pipefail

LIB_NAME="${1:-}"
KEYWORD="${2:-}"

if [ -z "$LIB_NAME" ] || [ -z "$KEYWORD" ]; then
    echo "Usage: $0 <library-name> <symbol-or-keyword>" >&2
    exit 1
fi

DOCS_DIR="${SOSHO_DOCS_DIR:-.pi/work/docs}"
TARGET_DIR="${DOCS_DIR}/${LIB_NAME}"

if [ ! -d "$TARGET_DIR" ]; then
    echo "❌ Error: Documentation for '$LIB_NAME' not found in $DOCS_DIR." >&2
    echo "Available libraries:" >&2
    ls -1 "$DOCS_DIR" 2>/dev/null || echo "(none)" >&2
    exit 1
fi

echo "🔍 Searching $LIB_NAME docs for '$KEYWORD'..."
grep -in -C 3 --color=never "$KEYWORD" "$TARGET_DIR"/* | head -n 45 || {
    echo "No matches found for '$KEYWORD' in $LIB_NAME docs."
}
