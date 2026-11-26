#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${SOSHO_SECRETS_FILE:-$ROOT/.env}"
UNIT_NAME="sosho-worker.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/$UNIT_NAME"
PYTHON="$ROOT/.venv/bin/python"

need_systemd() {
  command -v systemctl >/dev/null 2>&1 || {
    echo "Error: systemctl not found. The worker service needs systemd on Linux." >&2
    exit 1
  }
}

load_secrets() {
  local line key attrs
  [ -f "$SECRETS_FILE" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '' | '#'*) continue ;;
    esac
    key="${line%%=*}"
    [ "$key" != "$line" ] || continue
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    attrs="$(declare -p "$key" 2>/dev/null || true)"
    attrs="${attrs#declare }"
    attrs="${attrs%% *}"
    case "$attrs" in
      -*r*) continue ;;
    esac
    export "${line?}"
  done <"$SECRETS_FILE"
}

write_unit() {
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT_PATH" <<EOF
[Unit]
Description=Sosho host worker for pi sessions

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=-$SECRETS_FILE
Environment=SOSHO_ROOT=$ROOT
Environment=PYTHONUNBUFFERED=1
Environment=PATH=$PATH
ExecStart=$PYTHON -m sosho_engine worker
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF
}

case "${1:-}" in
  run)
    load_secrets
    export SOSHO_ROOT="$ROOT"
    exec "$PYTHON" -m sosho_engine worker
    ;;
  install)
    need_systemd
    [ -x "$PYTHON" ] || {
      echo "Error: $PYTHON not found. Run make setup first." >&2
      exit 1
    }
    write_unit
    systemctl --user daemon-reload
    systemctl --user enable --now "$UNIT_NAME"
    echo "Installed and started $UNIT_PATH"
    ;;
  uninstall)
    need_systemd
    systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
    rm -f "$UNIT_PATH"
    systemctl --user daemon-reload
    echo "Removed $UNIT_PATH"
    ;;
  restart)
    command -v systemctl >/dev/null 2>&1 || exit 0
    [ -f "$UNIT_PATH" ] || exit 0
    if systemctl --user restart "$UNIT_NAME"; then
      echo "Restarted $UNIT_NAME"
    fi
    ;;
  logs)
    need_systemd
    exec journalctl --user -u "$UNIT_NAME" -f
    ;;
  *)
    echo "Usage: worker-service.sh run|install|uninstall|restart|logs" >&2
    exit 2
    ;;
esac
