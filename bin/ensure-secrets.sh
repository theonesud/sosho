#!/bin/sh
set -eu

file="${1:-.env}"
if [ ! -f "$file" ]; then
  (umask 077 && : >"$file")
fi

has_volume() {
  command -v docker >/dev/null 2>&1 && docker volume inspect "$1" >/dev/null 2>&1
}

set_key() {
  key="$1"
  value="$2"
  tmp="$(mktemp)"
  grep -Ev "^${key}=[[:space:]]*(#.*)?$" "$file" >"$tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
  echo "Added $key to $file"
}

ensure_key() {
  key="$1"
  volume="$2"
  legacy="$3"
  if grep -Eq "^${key}=[^[:space:]#]" "$file"; then
    return 0
  fi
  if [ -n "$volume" ] && has_volume "$volume"; then
    set_key "$key" "$legacy"
  else
    set_key "$key" "$(openssl rand -hex 32)"
  fi
}

for key in LITELLM_MASTER_KEY SOSHO_ENGINE_API_TOKEN; do
  ensure_key "$key" "" ""
done

ensure_key SOSHO_PG_PASSWORD sosho_postgres postgres
