#!/bin/bash
# Usage: ./run.sh [start|stop|status|logs|build]
set -euo pipefail

cd "$(dirname "$0")"

ENGINE_PORT="${SOSHO_ENGINE_PORT:-8123}"
WEB_PORT="${SOSHO_WEB_PORT:-5173}"
ENGINE_URL="http://127.0.0.1:${ENGINE_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
STATE_DIR=/tmp/sosho-web
LOG="${STATE_DIR}/vite.log"
PIDFILE="${STATE_DIR}/vite.pid"

die() {
  echo "run.sh: $*" >&2
  exit 1
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" || true
}

# Never print the token.
load_token() {
  if [ -z "${SOSHO_ENGINE_API_TOKEN:-}" ]; then
    SOSHO_ENGINE_API_TOKEN="$(docker exec engine printenv SOSHO_ENGINE_API_TOKEN 2>/dev/null || true)"
  fi
  [ -n "${SOSHO_ENGINE_API_TOKEN}" ] ||
    die "SOSHO_ENGINE_API_TOKEN is not set and the engine container does not give it. Set the variable and run again."
  export SOSHO_ENGINE_API_TOKEN
}

nodes_code_with_token() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    -H "@-" "$1/nodes" <<<"Authorization: Bearer ${SOSHO_ENGINE_API_TOKEN}" || true
}

web_port_listener_pid() {
  lsof -t -iTCP:"${WEB_PORT}" -sTCP:LISTEN 2>/dev/null | head -n1 || true
}

wait_for_200() {
  local url=$1 seconds=$2
  local i
  for ((i = 0; i < seconds; i++)); do
    [ "$(http_code "${url}")" = 200 ] && return 0
    sleep 1
  done
  return 1
}

stop_server() {
  local pid=""
  [ -f "${PIDFILE}" ] && pid="$(cat "${PIDFILE}")"
  if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
    kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
  fi
  rm -f "${PIDFILE}"
  sleep 1
  pid="$(web_port_listener_pid)"
  if [ -n "${pid}" ]; then
    kill "${pid}" 2>/dev/null || true
    sleep 1
  fi
}

start() {
  command -v pnpm >/dev/null || die "pnpm is not installed."
  command -v curl >/dev/null || die "curl is not installed."

  local modules=node_modules/.modules.yaml
  if [ ! -f "${modules}" ] || [ pnpm-lock.yaml -nt "${modules}" ]; then
    pnpm install --frozen-lockfile
  fi

  if [ "$(http_code "${ENGINE_URL}/health")" != 200 ]; then
    echo "Engine is down. Start it with docker compose."
    command -v docker >/dev/null || die "docker is not installed."
    docker compose -p sosho up -d engine
    wait_for_200 "${ENGINE_URL}/health" 120 || die "Engine health did not pass in 120 seconds."
  fi
  echo "Engine health: 200"

  load_token
  local status
  status="$(nodes_code_with_token "${ENGINE_URL}")"
  [ "${status}" = 200 ] || die "Token check failed. GET /nodes returned ${status}."
  echo "Token check: ${status}"

  stop_server
  mkdir -p "${STATE_DIR}"
  setsid pnpm --filter @sosho/web dev --host 127.0.0.1 --port "${WEB_PORT}" --strictPort \
    >"${LOG}" 2>&1 </dev/null &
  echo "$!" >"${PIDFILE}"

  wait_for_200 "${WEB_URL}/" 60 || die "Dev server did not answer. Read ${LOG}."
  status="$(nodes_code_with_token "${WEB_URL}")"
  [ "${status}" = 200 ] || die "Proxy check failed. GET /nodes returned ${status}."
  echo "Proxy check: ${status}"
  echo "URL: ${WEB_URL}/"
  echo "Log: ${LOG}"
}

status() {
  echo "Engine health: $(http_code "${ENGINE_URL}/health")"
  local web
  web="$(http_code "${WEB_URL}/")"
  if [ "${web}" = 200 ]; then echo "Dev server: running"; else echo "Dev server: down"; fi
  echo "URL: ${WEB_URL}/ (${web})"
  if [ -f packages/web/dist/index.html ]; then echo "Build: dist exists"; else echo "Build: no dist. Run ./run.sh build"; fi
  if load_token 2>/dev/null; then
    echo "Proxy auth: $(nodes_code_with_token "${WEB_URL}")"
  else
    echo "Proxy auth: no token"
  fi
}

build() {
  make web-build
}

case "${1:-start}" in
  start) start ;;
  stop) stop_server ;;
  status) status ;;
  logs) tail -f "${LOG}" ;;
  build) build ;;
  *) die "Usage: ./run.sh [start|stop|status|logs|build]" ;;
esac
