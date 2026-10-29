#!/usr/bin/env bash
# ==============================================================================
# gh-stars.sh: Fetch starred repos from logged-in GitHub in host Chrome
# Output saved to .pi/work/research/gh_stars.md. Compact list to stdout.
# ==============================================================================
set -euo pipefail

PAGE="1"
OUT_FILE=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out)
            OUT_FILE="$2"
            shift 2
            ;;
        [0-9]*)
            PAGE="$1"
            shift
            ;;
        *)
            EXTRA_ARGS+=("$1")
            shift
            ;;
    esac
done

RESEARCH_DIR="${SOSHO_RESEARCH_DIR:-.pi/work/research}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$RESEARCH_DIR" "$SCRATCH_DIR"

URL="https://github.com/stars?page=${PAGE}"
RAW_FILE="${SCRATCH_DIR}/gh_stars_raw.md"
[ -z "$OUT_FILE" ] && OUT_FILE="${RESEARCH_DIR}/gh_stars.md"

echo "⭐ Fetching GitHub Stars (page $PAGE) via host Chrome..."
sleep 1
dokobot read --local "$URL" --timeout 60 > "$RAW_FILE" 2>/tmp/gh_err.log || {
    echo "❌ Dokobot failed to read GitHub stars:" >&2
    cat /tmp/gh_err.log >&2
    exit 1
}

# Parse repo links and descriptions
python3 - "$RAW_FILE" "$OUT_FILE" "$PAGE" <<'PY'
import sys, re

raw_path, out_path, page = sys.argv[1], sys.argv[2], sys.argv[3]
with open(raw_path, "r", encoding="utf-8", errors="ignore") as f:
    content = f.read()

# Match markdown repo links [owner/repo](url) or header patterns
matches = re.findall(r'\[([a-zA-Z0-9_\-\.]+/[a-zA-Z0-9_\-\.]+)\]\((https://github\.com/[^\)]+)\)', content)

# Fallback: find plain repo paths if not markdown linked
if not matches:
    matches = [(m, f"https://github.com/{m}") for m in re.findall(r'\b([a-zA-Z0-9_\-\.]+/[a-zA-Z0-9_\-\.]+)\b', content) if "/" in m and not m.startswith("http")]

# Deduplicate
seen = set()
unique_repos = []
for name, url in matches:
    if name not in seen and not any(skip in name.lower() for skip in ["features", "pricing", "enterprise", "customer", "login"]):
        seen.add(name)
        unique_repos.append((name, url))

with open(out_path, "w", encoding="utf-8") as f:
    f.write(f"# GitHub Starred Repositories (Page {page})\n\n")
    for i, (name, url) in enumerate(unique_repos, 1):
        f.write(f"{i}. [{name}]({url})\n")

PY

TOTAL="$(wc -l < "$OUT_FILE" | tr -d ' ')"
echo "=== [GITHUB STARS: PAGE $PAGE] ==="
echo "• Saved to: $OUT_FILE ($TOTAL lines)"
echo "------------------------------------------------------------"
head -n 25 "$OUT_FILE"
echo "============================================================"
