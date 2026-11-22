#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-}"
if [ -z "$OUT_DIR" ] || [ "$#" -lt 2 ]; then
  echo "Usage: pi-container-config.sh OUT_DIR SOURCE_FILE..." >&2
  exit 1
fi
shift
mkdir -p "$OUT_DIR"

rewrite_file() {
  local src="$1" dst="$2"
  sed -E \
    -e 's#http://127\.0\.0\.1:4000([/"])#http://litellm:4000\1#g' \
    -e 's#http://127\.0\.0\.1:808[012]([/"])#http://llama-cpp:8080\1#g' \
    -e 's#http://127\.0\.0\.1:3001([/"])#http://langfuse-web:3000\1#g' \
    -e 's#http://127\.0\.0\.1:4101([/"])#http://host.docker.internal:4101\1#g' \
    -e 's#http://127\.0\.0\.1:8021([/"])#http://yue2-gateway:8000\1#g' \
    "$src" >"$dst"
  chmod 600 "$dst"
}

for src in "$@"; do
  if [ ! -f "$src" ]; then
    echo "Error: source file not found: $(basename "$src")" >&2
    exit 1
  fi
  dst="$OUT_DIR/$(basename "$src")"
  rewrite_file "$src" "$dst"
  echo "$dst"
done
