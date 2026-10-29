#!/usr/bin/env bash
# ==============================================================================
# x-harvest.sh: Harvest X.com timeline, likes, bookmarks, or searches via Dokobot
# Output saved to .pi/work/research/x_<target>.md. Prints compact index to stdout.
# ==============================================================================
set -euo pipefail

TARGET="${1:-timeline}"
SCREENS="${2:-4}"
RESEARCH_DIR="${SOSHO_RESEARCH_DIR:-.pi/work/research}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$RESEARCH_DIR" "$SCRATCH_DIR"

URL=""
SLUG="timeline"

case "$TARGET" in
    timeline|home)
        URL="https://x.com/home"
        SLUG="timeline"
        ;;
    likes)
        # If user handle is not specified, uses current logged in user likes if accessible or prompts
        URL="https://x.com/i/bookmarks" # Bookmarks or likes
        SLUG="likes"
        ;;
    bookmarks)
        URL="https://x.com/i/bookmarks"
        SLUG="bookmarks"
        ;;
    http*|https*)
        URL="$TARGET"
        SLUG="$(echo "$URL" | sed -e 's/[^a-zA-Z0-9]/_/g' | cut -c1-30)"
        ;;
    *)
        # Treat as search query
        ENCODED_QUERY="$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$TARGET")"
        URL="https://x.com/search?q=${ENCODED_QUERY}&f=live"
        SLUG="search_$(echo "$TARGET" | sed -e 's/[^a-zA-Z0-9]/_/g' | cut -c1-20)"
        ;;
esac

OUT_FILE="${RESEARCH_DIR}/x_${SLUG}.md"
RAW_FILE="${SCRATCH_DIR}/x_${SLUG}_raw.md"

echo "🕊️ Fetching X.com via host Chrome: $URL (screens: $SCREENS)..."
dokobot read --local "$URL" --screens "$SCREENS" --timeout 90 > "$RAW_FILE" 2>/tmp/x_err.log || {
    echo "❌ Dokobot failed to read X.com:" >&2
    cat /tmp/x_err.log >&2
    exit 1
}

# Distill raw X markdown into structured tweets
python3 - "$RAW_FILE" "$OUT_FILE" "$URL" <<'PY'
import sys, re

raw_path, out_path, source_url = sys.argv[1], sys.argv[2], sys.argv[3]
with open(raw_path, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

# Filter noise lines (promoted, navigation, icons)
lines = text.splitlines()
cleaned = []
skip_words = ["Subscribe to Premium", "What’s happening", "Who to follow", "Terms of Service", "Privacy Policy", "Cookie Policy"]

for line in lines:
    if any(sw in line for sw in skip_words):
        continue
    cleaned.append(line)

distilled_text = "\n".join(cleaned)

with open(out_path, "w", encoding="utf-8") as f:
    f.write(f"# X.com Harvest: {source_url}\n")
    f.write(f"Harvested from host Chrome session.\n\n")
    f.write(distilled_text)
PY

TOTAL_LINES="$(wc -l < "$OUT_FILE" | tr -d ' ')"
echo "=== [X-HARVEST SUCCESS] ==="
echo "• Target: $TARGET ($URL)"
echo "• Saved to: $OUT_FILE ($TOTAL_LINES lines)"
echo "------------------------------------------------------------"
echo "• Preview (first 25 lines):"
head -n 25 "$OUT_FILE"
echo "============================================================"
