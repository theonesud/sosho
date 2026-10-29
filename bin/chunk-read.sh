#!/usr/bin/env bash
# ==============================================================================
# chunk-read: Bounded, context-safe file reader for large files and logs
# Reads files in 50-80 line sliding windows to avoid context window blowup.
# ==============================================================================
set -euo pipefail

FILE="${1:-}"
START_LINE="${2:-1}"
NUM_LINES="${3:-60}"

if [ -z "$FILE" ]; then
    echo "Usage: bin/chunk-read.sh <file> [start_line=1] [num_lines=60]" >&2
    exit 1
fi

if [ ! -f "$FILE" ]; then
    echo "❌ Error: File not found: '$FILE'" >&2
    exit 1
fi

TOTAL_LINES="$(wc -l < "$FILE" | tr -d ' ')"
if [ "$TOTAL_LINES" -eq 0 ]; then
    echo "=== [CHUNK-READ: $FILE] (0 lines - Empty File) ==="
    exit 0
fi

if [ "$START_LINE" -lt 1 ]; then
    START_LINE=1
fi

END_LINE=$(( START_LINE + NUM_LINES - 1 ))
[ "$END_LINE" -gt "$TOTAL_LINES" ] && END_LINE="$TOTAL_LINES"

echo "=== [CHUNK-READ: $FILE] Lines $START_LINE–$END_LINE of $TOTAL_LINES ==="
sed -n "${START_LINE},${END_LINE}p" "$FILE" | awk -v start="$START_LINE" '{printf "%4d | %s\n", start + NR - 1, $0}'
echo "------------------------------------------------------------"

if [ "$END_LINE" -lt "$TOTAL_LINES" ]; then
    NEXT_START=$(( END_LINE + 1 ))
    REMAINING=$(( TOTAL_LINES - END_LINE ))
    echo "• Status: $REMAINING lines remaining."
    echo "• Next window: bin/chunk-read.sh \"$FILE\" $NEXT_START $NUM_LINES"
else
    echo "• Status: End of file reached ($TOTAL_LINES lines total)."
fi
echo "============================================================"
