#!/usr/bin/env bash
# ==============================================================================
# yt-feed.sh: Harvest YouTube liked videos, playlists, or search results via Dokobot
# Output saved to .pi/work/transcripts/queue.md. Compact list to stdout.
# ==============================================================================
set -euo pipefail

TARGET=""
OUT_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out)
            OUT_FILE="$2"
            shift 2
            ;;
        *)
            if [ -z "$TARGET" ]; then
                TARGET="$1"
            fi
            shift
            ;;
    esac
done

[ -z "$TARGET" ] && TARGET="likes"

TRANSCRIPTS_DIR="${SOSHO_TRANSCRIPTS_DIR:-.pi/work/transcripts}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$TRANSCRIPTS_DIR" "$SCRATCH_DIR"

URL=""
case "$TARGET" in
    likes)
        URL="https://www.youtube.com/playlist?list=LL"
        ;;
    http*|https*)
        URL="$TARGET"
        ;;
    *)
        ENCODED="$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$TARGET")"
        URL="https://www.youtube.com/results?search_query=${ENCODED}"
        ;;
esac

RAW_FILE="${SCRATCH_DIR}/yt_feed_raw.md"
[ -z "$OUT_FILE" ] && OUT_FILE="${TRANSCRIPTS_DIR}/queue.md"

echo "📺 Fetching YouTube ($TARGET) via host Chrome..."
sleep 1
dokobot read --local "$URL" --timeout 90 > "$RAW_FILE" 2>/tmp/yt_err.log || {
    echo "❌ Dokobot failed to read YouTube:" >&2
    cat /tmp/yt_err.log >&2
    exit 1
}

# Parse video links and titles
python3 - "$RAW_FILE" "$OUT_FILE" "$TARGET" <<'PY'
import sys, re

raw_path, out_path, target = sys.argv[1], sys.argv[2], sys.argv[3]
with open(raw_path, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

# Match /watch?v=...
video_ids = set()
entries = []

for line in text.splitlines():
    m = re.search(r'watch\?v=([a-zA-Z0-9_-]{11})', line)
    if m:
        vid = m.group(1)
        if vid not in video_ids:
            video_ids.add(vid)
            # Try to grab title text from line if markdown linked
            title_m = re.search(r'\[([^\]]+)\]\(.*watch\?v=' + vid, line)
            title = title_m.group(1) if title_m else f"Video {vid}"
            entries.append((vid, title))

with open(out_path, "w", encoding="utf-8") as f:
    f.write(f"# YouTube Video Queue: {target}\n\n")
    for i, (vid, title) in enumerate(entries[:30], 1):
        f.write(f"{i}. [{title}](https://www.youtube.com/watch?v={vid}) (ID: `{vid}`)\n")
PY

TOTAL="$(wc -l < "$OUT_FILE" | tr -d ' ')"
echo "=== [YOUTUBE FEED QUEUE] ==="
echo "• Saved to: $OUT_FILE ($TOTAL lines)"
echo "------------------------------------------------------------"
head -n 25 "$OUT_FILE"
echo "============================================================"
