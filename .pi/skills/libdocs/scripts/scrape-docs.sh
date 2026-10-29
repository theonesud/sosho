#!/usr/bin/env bash
# ==============================================================================
# scrape-docs.sh: Scrape library documentation page via Dokobot
# Output saved to .pi/work/docs/<lib_name>/<page_slug>.md
# ==============================================================================
set -euo pipefail

URL="${1:-}"
LIB_NAME="${2:-}"

if [ -z "$URL" ] || [ -z "$LIB_NAME" ]; then
    echo "Usage: $0 <documentation-url> <library-name>" >&2
    exit 1
fi

DOCS_DIR="${SOSHO_DOCS_DIR:-.pi/work/docs}"
TARGET_DIR="${DOCS_DIR}/${LIB_NAME}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$TARGET_DIR" "$SCRATCH_DIR"

SLUG="$(echo "$URL" | sed -e 's|https://||' -e 's|http://||' -e 's|[^a-zA-Z0-9]|_|g' | cut -c1-40)"
RAW_FILE="${SCRATCH_DIR}/doc_${LIB_NAME}_raw.md"
OUT_FILE="${TARGET_DIR}/${SLUG}.md"

echo "📖 Scraping docs for $LIB_NAME via Dokobot: $URL..."
dokobot read --local "$URL" --timeout 90 > "$RAW_FILE" 2>/tmp/doc_err.log || {
    echo "❌ Dokobot failed to read docs:" >&2
    cat /tmp/doc_err.log >&2
    exit 1
}

# Clean and store
cp "$RAW_FILE" "$OUT_FILE"
LINES="$(wc -l < "$OUT_FILE" | tr -d ' ')"

echo "=== [DOCS SCRAPED] ==="
echo "• Library: $LIB_NAME"
echo "• Saved to: $OUT_FILE ($LINES lines)"
echo "------------------------------------------------------------"
head -n 25 "$OUT_FILE"
echo "============================================================"
