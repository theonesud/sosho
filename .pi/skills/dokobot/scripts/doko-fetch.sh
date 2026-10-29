#!/usr/bin/env bash
# ==============================================================================
# doko-fetch: Context-safe Dokobot web scraper and extractor
# Pipes full web reads to .pi/work/scratch/ and returns only a compact excerpt to stdout.
# Protects LLM context window from token exhaustion.
# ==============================================================================
set -euo pipefail

SCRATCH_DIR="${DOKO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$SCRATCH_DIR"

URL=""
OUTPUT_FILE=""
MAX_LINES=60
GREP_PATTERN=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --max-lines)
            MAX_LINES="$2"
            shift 2
            ;;
        --grep)
            GREP_PATTERN="$2"
            shift 2
            ;;
        --out)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        http*|https*)
            URL="$1"
            shift
            ;;
        *)
            EXTRA_ARGS+=("$1")
            shift
            ;;
    esac
done

if [ -z "$URL" ]; then
    echo "Usage: bin/doko-fetch.sh <URL> [--out <file>] [--max-lines <N>] [--grep <pattern>] [dokobot flags...]" >&2
    exit 1
fi

# Generate filename slug if not provided
if [ -z "$OUTPUT_FILE" ]; then
    SLUG="$(echo "$URL" | sed -e 's/[^a-zA-Z0-9._-]/_/g' | cut -c1-60)"
    OUTPUT_FILE="${SCRATCH_DIR}/${SLUG}.md"
fi

# Execute dokobot read and capture directly to disk
dokobot read --local "$URL" "${EXTRA_ARGS[@]}" > "$OUTPUT_FILE" 2>/tmp/doko_err.log || {
    EXIT_CODE=$?
    echo "❌ dokobot read failed (exit $EXIT_CODE):" >&2
    cat /tmp/doko_err.log >&2
    exit $EXIT_CODE
}

TOTAL_LINES="$(wc -l < "$OUTPUT_FILE" | tr -d ' ')"
FILE_SIZE="$(du -h "$OUTPUT_FILE" | awk '{print $1}')"

echo "=== [DOKO-FETCH SUCCESS] ==="
echo "• URL: $URL"
echo "• Saved to: $OUTPUT_FILE ($TOTAL_LINES lines, $FILE_SIZE)"
echo "------------------------------------------------------------"

if [ -n "$GREP_PATTERN" ]; then
    echo "• Matching lines for '$GREP_PATTERN':"
    grep -in -C 2 "$GREP_PATTERN" "$OUTPUT_FILE" | head -n "$MAX_LINES" || echo "(No matches found)"
else
    echo "• Preview (first $MAX_LINES lines):"
    head -n "$MAX_LINES" "$OUTPUT_FILE"
    if [ "$TOTAL_LINES" -gt "$MAX_LINES" ]; then
        echo ""
        echo "[... Truncated for context safety. Total $TOTAL_LINES lines in $OUTPUT_FILE ...]"
        echo "[Hint: Use 'grep -in \"term\" $OUTPUT_FILE' or 'sed -n \"${MAX_LINES},+50p\" $OUTPUT_FILE' to read further without token blowup]"
    fi
fi
echo "============================================================"
