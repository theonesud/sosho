#!/bin/sh
set -eu

file="${1:-.env}"
if [ ! -f "$file" ]; then
  (umask 077 && : >"$file")
fi

for key in LANGFUSE_NEXTAUTH_SECRET LANGFUSE_SALT LANGFUSE_ENCRYPTION_KEY; do
  if grep -Eq "^${key}=[^[:space:]#]" "$file"; then
    continue
  fi
  value="$(openssl rand -hex 32)"
  tmp="$(mktemp)"
  grep -Ev "^${key}=[[:space:]]*(#.*)?$" "$file" >"$tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
  echo "Added $key to $file"
done
