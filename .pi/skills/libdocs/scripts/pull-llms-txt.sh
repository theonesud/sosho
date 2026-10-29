#!/usr/bin/env bash
# ==============================================================================
# pull-llms-txt.sh: Download standardized llms.txt or llms-full.txt for a library
# Output saved to .pi/work/docs/<name>/llms.txt.
# ==============================================================================
set -euo pipefail

TARGET="${1:-}"
NAME="${2:-}"

if [ -z "$TARGET" ]; then
    echo "Usage: $0 <domain-or-url> [library-name]" >&2
    exit 1
fi

DOCS_DIR="${SOSHO_DOCS_DIR:-.pi/work/docs}"
mkdir -p "$DOCS_DIR"

# Clean target URL
[[ "$TARGET" != http* ]] && TARGET="https://$TARGET"
TARGET="$(echo "$TARGET" | sed -e 's|/$||')"

if [ -z "$NAME" ]; then
    NAME="$(echo "$TARGET" | sed -e 's|https://||' -e 's|http://||' -e 's|www\.||' | cut -d/ -f1 | cut -d. -f1)"
fi

TARGET_LIB_DIR="${DOCS_DIR}/${NAME}"
mkdir -p "$TARGET_LIB_DIR"

echo "📚 Probing for llms.txt on $TARGET..."

# Try llms-full.txt first, then llms.txt
CANDIDATES=(
    "${TARGET}/llms-full.txt"
    "${TARGET}/llms.txt"
    "${TARGET}/.well-known/llms.txt"
)

SUCCESS=0
for cand in "${CANDIDATES[@]}"; do
    echo "• Checking $cand..."
    if curl -fsSL -m 10 "$cand" -o "${TARGET_LIB_DIR}/llms.txt" 2>/dev/null; then
        # Verify it is not an HTML 404 page
        if head -n 5 "${TARGET_LIB_DIR}/llms.txt" | grep -qi -E '<html|<!DOCTYPE'; then
            rm -f "${TARGET_LIB_DIR}/llms.txt"
            continue
        fi
        SUCCESS=1
        echo "✅ Downloaded llms.txt from $cand"
        break
    fi
done

if [ "$SUCCESS" -eq 1 ]; then
    LINES="$(wc -l < "${TARGET_LIB_DIR}/llms.txt" | tr -d ' ')"
    echo "=== [LLMS.TXT SAVED] ==="
    echo "• Library: $NAME"
    echo "• File: ${TARGET_LIB_DIR}/llms.txt ($LINES lines)"
    echo "------------------------------------------------------------"
    head -n 25 "${TARGET_LIB_DIR}/llms.txt"
    echo "============================================================"
else
    echo "⚠️ No llms.txt found at $TARGET. Use .pi/skills/libdocs/scripts/scrape-docs.sh instead."
    exit 2
fi
