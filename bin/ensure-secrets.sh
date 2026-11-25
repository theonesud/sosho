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

for key in LANGFUSE_NEXTAUTH_SECRET LANGFUSE_SALT LANGFUSE_ENCRYPTION_KEY LITELLM_MASTER_KEY LANGFUSE_REDIS_AUTH; do
  ensure_key "$key" "" ""
done

ensure_key LANGFUSE_PG_PASSWORD sosho_langfuse_postgres postgres
ensure_key LANGFUSE_CLICKHOUSE_PASSWORD sosho_langfuse_clickhouse clickhouse
ensure_key LANGFUSE_MINIO_PASSWORD sosho_langfuse_minio miniosecret
ensure_key LANGFUSE_INIT_USER_PASSWORD sosho_langfuse_postgres password123
ensure_key LANGFLOW_SUPERUSER_PASSWORD sosho_langflow-data sosho-local

if ! grep -Eq "^LANGFUSE_PUBLIC_KEY=[^[:space:]#]" "$file"; then
  if has_volume sosho_langfuse_postgres; then
    set_key LANGFUSE_PUBLIC_KEY pk-lf-local-pi
    set_key LANGFUSE_SECRET_KEY sk-lf-local-pi
  else
    set_key LANGFUSE_PUBLIC_KEY "pk-lf-$(openssl rand -hex 16)"
    set_key LANGFUSE_SECRET_KEY "sk-lf-$(openssl rand -hex 16)"
  fi
fi
