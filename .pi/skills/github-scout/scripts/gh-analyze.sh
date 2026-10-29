#!/usr/bin/env bash
# ==============================================================================
# gh-analyze.sh: Analyze a GitHub repository for capabilities and feasibility
# Output saved to .pi/work/research/gh_<repo>.md. Compact brief to stdout.
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

if [ -z "$TARGET" ]; then
    echo "Usage: $0 <owner/repo or https://github.com/owner/repo> [--out <file>]" >&2
    exit 1
fi

RESEARCH_DIR="${SOSHO_RESEARCH_DIR:-.pi/work/research}"
SCRATCH_DIR="${SOSHO_SCRATCH_DIR:-.pi/work/scratch}"
mkdir -p "$RESEARCH_DIR" "$SCRATCH_DIR"

URL="$TARGET"
[[ "$URL" != http* ]] && URL="https://github.com/$TARGET"

REPO_SLUG="$(echo "$URL" | sed -e 's|https://github.com/||' -e 's|/$||' | tr '/' '_')"
RAW_FILE="${SCRATCH_DIR}/gh_${REPO_SLUG}_raw.md"
[ -z "$OUT_FILE" ] && OUT_FILE="${RESEARCH_DIR}/gh_${REPO_SLUG}.md"

echo "🔍 Scouting GitHub repo via host Chrome: $URL..."
sleep 1
dokobot read --local "$URL" --timeout 90 > "$RAW_FILE" 2>/tmp/gh_err.log || {
    echo "❌ Dokobot failed to read repo page:" >&2
    cat /tmp/gh_err.log >&2
    exit 1
}

# Distill repo structure, README overview, dependencies, and license
python3 - "$RAW_FILE" "$OUT_FILE" "$URL" <<'PY'
import sys, re

raw_path, out_path, source_url = sys.argv[1], sys.argv[2], sys.argv[3]
with open(raw_path, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

lines = text.splitlines()
readme_lines = []
in_readme = False

# Capture README section
for line in lines:
    if "readme.md" in line.lower() or "readme" in line.lower():
        in_readme = True
    if in_readme:
        readme_lines.append(line)

readme_content = "\n".join(readme_lines[:150]) if readme_lines else "\n".join(lines[:100])

with open(out_path, "w", encoding="utf-8") as f:
    f.write(f"# Repository Analysis: {source_url}\n\n")
    f.write(f"## README & Overview\n")
    f.write(readme_content + "\n\n")
PY

TOTAL_LINES="$(wc -l < "$OUT_FILE" | tr -d ' ')"
echo "=== [GITHUB REPO SCOUTED] ==="
echo "• URL: $URL"
echo "• Dossier: $OUT_FILE ($TOTAL_LINES lines)"
echo "------------------------------------------------------------"
echo "• Preview (first 25 lines):"
head -n 25 "$OUT_FILE"
echo "============================================================"
