#!/usr/bin/env bash
# ==============================================================================
# verify.sh: Check Lean 4 proofs and isolate tactic failures/unsolved goals
# ==============================================================================
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
    echo "Usage: $0 <proof.lean>" >&2
    exit 1
fi

echo "📐 Verifying Lean 4 proof: $TARGET..."

LEAN_CMD="lean"
if command -v lake >/dev/null 2>&1 && [ -f "lakefile.lean" ]; then
    LEAN_CMD="lake env lean"
elif ! command -v lean >/dev/null 2>&1; then
    echo "❌ Error: 'lean' command not found. Ensure Lean 4 / elan is installed in PATH." >&2
    exit 1
fi

OUTPUT="$($LEAN_CMD "$TARGET" 2>&1 || true)"

if [ -z "$OUTPUT" ]; then
    echo "✅ [LEAN SUCCESS] All theorems in $TARGET verified without errors."
else
    echo "⚠️ [LEAN ERRORS / UNRESOLVED GOALS]"
    echo "$OUTPUT" | grep -A 4 -E 'error:|unsolved goals|tactic.*failed' | head -n 30 || echo "$OUTPUT" | head -n 30
fi
