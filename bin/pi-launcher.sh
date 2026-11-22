#!/usr/bin/env bash
# ==============================================================================
# Pi CLI launcher. Runs pi in a Docker container by default.
# Run it as `pi` through the symlink ~/.local/bin/pi. Run --help for the modes.
# ==============================================================================
set -e

IMAGE_NAME="pi-sandbox:latest"
COMPOSE_NETWORK="sosho-net"
SELF_REAL="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SELF_REAL")"
SOSHO_ROOT="${SOSHO_ROOT:-$(dirname "$SCRIPT_DIR")}"
SOSHO_PI="$SOSHO_ROOT/.pi"
# shellcheck source-path=SCRIPTDIR source=pi-model-prep.sh
. "$SCRIPT_DIR/pi-model-prep.sh"

print_help() {
  cat <<'EOF'
Usage: pi [launcher options] [pi arguments]

Modes:
  container (default)  Run pi in the pi-sandbox:latest Docker container.
                       The workspace mounts at the same path. The container
                       joins the sosho-net network and has no host PID namespace.
                       Config URLs point at compose services. Run make up first.
  raw                  Run pi directly on the host, with host URLs. Use raw mode
                       for host-level skills: dokobot, social-x, youtube-digest
                       feeds, sys-admin, and the security-lab network probe.

Launcher options:
  --raw                Select raw mode. The option is not passed to pi.
  --no-warmup          Skip the local model warm-up.
  -h, --help           Show this help and exit.

Environment:
  PI_MODE              container or raw. Default: container.
  PI_SKIP_WARMUP       1 skips the local model warm-up.
  PI_VERSION           Raw mode only. The pi version for the npx fallback.
  SOSHO_ROOT           Repository root. Default: parent of the script directory.
  LANGFUSE_BASE_URL    Raw mode only. Default: http://127.0.0.1:3001.
                       Container mode uses http://langfuse-web:3000.
EOF
}

# Load KEY=VALUE lines from a file into the environment. Skip comments and invalid lines.
load_env_file() {
  local file="$1" line key
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '' | '#'*) continue ;;
    esac
    key="${line%%=*}"
    [ "$key" != "$line" ] || continue
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "${line?}"
  done <"$file"
}

# Find a host pi binary that is not this launcher. Print its path on success.
find_host_pi() {
  local found
  found="$(type -P pi 2>/dev/null || true)"
  if [ -n "$found" ] && [ "$(readlink -f "$found")" != "$SELF_REAL" ]; then
    printf '%s\n' "$found"
    return 0
  fi
  return 1
}

# Filter out our custom launcher flags from arguments
FORWARD_ARGS=()
SKIP_WARMUP="${PI_SKIP_WARMUP:-0}"
MODE="${PI_MODE:-container}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      print_help
      exit 0
      ;;
    --raw)
      MODE=raw
      shift
      ;;
    --no-warmup)
      SKIP_WARMUP=1
      shift
      ;;
    *)
      FORWARD_ARGS+=("$1")
      shift
      ;;
  esac
done

case "$MODE" in
  container | raw) ;;
  *)
    echo "Error: unknown mode '$MODE' (expected container or raw)." >&2
    exit 1
    ;;
esac

# Format argument ordering (subcommands require their options before --approve)
SUBCOMMANDS=("update" "auth" "install" "remove" "list")
IS_SUBCOMMAND=0
for sub in "${SUBCOMMANDS[@]}"; do
  if [ "${FORWARD_ARGS[0]:-}" = "$sub" ]; then
    IS_SUBCOMMAND=1
    break
  fi
done
FINAL_ARGS=()
if [ "$IS_SUBCOMMAND" -eq 1 ]; then
  FINAL_ARGS=("${FORWARD_ARGS[@]}" --approve)
else
  FINAL_ARGS=(--approve "${FORWARD_ARGS[@]}")
fi

WORKSPACE="$(pwd)"
WORKSPACE_ENV="$WORKSPACE/.env"
[ ! -f "$WORKSPACE_ENV" ] && [ -f "$SOSHO_ROOT/.env" ] && WORKSPACE_ENV="$SOSHO_ROOT/.env"

# 0. Ensure Docker image exists when running in container mode
if [ "$MODE" = "container" ] && ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Image $IMAGE_NAME not found locally. Building from $SOSHO_ROOT..."
  docker build -t "$IMAGE_NAME" -f "$SOSHO_ROOT/docker/Dockerfile.pi" "$SOSHO_ROOT"
fi

# 0b. Container mode joins the compose network. Stop early when it is missing.
if [ "$MODE" = "container" ] && ! docker network inspect "$COMPOSE_NETWORK" >/dev/null 2>&1; then
  echo "Error: Docker network $COMPOSE_NETWORK not found. Run make up first, or use pi --raw." >&2
  exit 1
fi

# 1. Ensure target workspace has a local .pi directory and session scratchpad root
TARGET_PI="$WORKSPACE/.pi"
mkdir -p "$TARGET_PI/.cache" "$TARGET_PI/.config" "$TARGET_PI/scratchpad"

# 2. Automatic background updater (checks once every 24h or when requested)
#    pi is baked into the Docker image, so its self-updater cannot work inside
#    the ephemeral container. Rebuild the image when a newer release exists.
AUTO_UPDATE_STAMP="$TARGET_PI/.cache/.last_ext_update"
NOW=$(date +%s)
LAST_UPDATE=0
[ -f "$AUTO_UPDATE_STAMP" ] && LAST_UPDATE=$(cat "$AUTO_UPDATE_STAMP" 2>/dev/null || echo 0)
# Update if older than 24 hours (86400s) and not running a sub-command
if [ "$MODE" = "container" ] && [ $((NOW - LAST_UPDATE)) -gt 86400 ] && [ "$SKIP_WARMUP" != "1" ]; then
  echo "Checking and updating Pi packages & extensions..."

  # Rebuild the sandbox image if the baked-in pi is older than the npm latest.
  if command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    IMAGE_PI_VERSION="$(docker run --rm "$IMAGE_NAME" --version 2>/dev/null | head -n1 | tr -d '[:space:]' || true)"
    LATEST_PI_VERSION="$(curl -fsS -m 15 "https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/latest" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)"
    if [ -n "$IMAGE_PI_VERSION" ] && [ -n "$LATEST_PI_VERSION" ] && [ "$IMAGE_PI_VERSION" != "$LATEST_PI_VERSION" ]; then
      echo "New pi version available ($IMAGE_PI_VERSION -> $LATEST_PI_VERSION). Rebuilding $IMAGE_NAME..."
      docker build --no-cache --pull -t "$IMAGE_NAME" -f "$SOSHO_ROOT/docker/Dockerfile.pi" "$SOSHO_ROOT" || true
    fi
  fi

  # Default bridge network: the update needs internet only, not the compose services.
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e "HOME=$HOME" \
    -e "PI_CODING_AGENT_DIR=$TARGET_PI" \
    -e "npm_config_cache=$TARGET_PI/.cache/npm" \
    --tmpfs "$HOME:uid=$(id -u),gid=$(id -g),mode=0755" \
    -v "$WORKSPACE:$WORKSPACE" \
    -w "$WORKSPACE" \
    "$IMAGE_NAME" \
    update --all >/dev/null 2>&1 || true
  echo "$NOW" >"$AUTO_UPDATE_STAMP" 2>/dev/null || true
fi

# 2b. If target workspace does NOT have its own models.json, provide the default
if [ ! -f "$TARGET_PI/models.json" ] && [ -f "$SOSHO_PI/models.json" ]; then
  cp "$SOSHO_PI/models.json" "$TARGET_PI/models.json"
fi

# 2c. Sync the llama.cpp context window and compaction settings in TARGET_PI.
sync_llama_context "$TARGET_PI" "$WORKSPACE_ENV"
sync_compaction "$TARGET_PI"

# 3. Local model pre-warm (skipped with --no-warmup or PI_SKIP_WARMUP=1)
warm_local_model "$TARGET_PI" "$SOSHO_PI" "$SKIP_WARMUP"

LANGFUSE_URL="${LANGFUSE_BASE_URL:-http://127.0.0.1:3001}"
LANGFUSE_PK="${LANGFUSE_PUBLIC_KEY:-pk-lf-local-pi}"
LANGFUSE_SK="${LANGFUSE_SECRET_KEY:-sk-lf-local-pi}"

# 4. Raw mode: run the host pi binary directly. No container is used.
if [ "$MODE" = "raw" ]; then
  if [ -f "$WORKSPACE_ENV" ]; then
    load_env_file "$WORKSPACE_ENV"
  fi
  export SOSHO_ROOT
  export HOME
  export LLAMA_BASE_URL="http://127.0.0.1:8080"
  export LITELLM_BASE_URL="http://127.0.0.1:4000/v1"
  export SOSHO_EMBED_URL="http://127.0.0.1:8080/v1/embeddings"
  export PI_CODING_AGENT_DIR="$TARGET_PI"
  export XDG_CACHE_HOME="$TARGET_PI/.cache"
  export XDG_CONFIG_HOME="$TARGET_PI/.config"
  export npm_config_cache="$TARGET_PI/.cache/npm"
  export LANGFUSE_BASE_URL="$LANGFUSE_URL"
  export LANGFUSE_PUBLIC_KEY="$LANGFUSE_PK"
  export LANGFUSE_SECRET_KEY="$LANGFUSE_SK"

  if HOST_PI="$(find_host_pi)"; then
    exec "$HOST_PI" "${FINAL_ARGS[@]}"
  fi

  # No host binary: run the pinned npm package through npx.
  PI_PKG="@earendil-works/pi-coding-agent"
  RAW_VERSION="${PI_VERSION:-}"
  if [ -z "$RAW_VERSION" ] && docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    RAW_VERSION="$(docker run --rm "$IMAGE_NAME" --version 2>/dev/null | head -n1 | tr -d '[:space:]' || true)"
  fi
  if [ -z "$RAW_VERSION" ]; then
    echo "Error: no host pi binary and no pi version found. Set PI_VERSION or build $IMAGE_NAME." >&2
    exit 1
  fi
  command -v npx >/dev/null 2>&1 || {
    echo "Error: npx is required for raw mode without a host pi binary." >&2
    exit 1
  }
  exec npx -y "$PI_PKG@$RAW_VERSION" "${FINAL_ARGS[@]}"
fi

# 5. Container mode: mount list
MOUNTS=(
  -v "$WORKSPACE:$WORKSPACE"
  -v "$TARGET_PI:$TARGET_PI"
)

# Container view of the config files: host URLs become compose URLs.
# The rewritten copies live in .pi/run/ (git-ignored). They replace the host files
# inside the container only. The repository files do not change.
CONFIG_DIR="$SOSHO_PI/run/container"
CONFIG_SRCS=()
for name in models.json langfuse.json model-roles.json; do
  if [ -f "$TARGET_PI/$name" ]; then CONFIG_SRCS+=("$TARGET_PI/$name"); fi
done
CONFIG_MOUNTS=()
if [ "${#CONFIG_SRCS[@]}" -gt 0 ]; then
  "$SCRIPT_DIR/pi-container-config.sh" "$CONFIG_DIR" "${CONFIG_SRCS[@]}" >/dev/null
  for src in "${CONFIG_SRCS[@]}"; do
    CONFIG_MOUNTS+=(-v "$CONFIG_DIR/$(basename "$src"):$src:ro")
  done
fi

# Mount user git config if present (so commits have author name/email)
[ -f "$HOME/.gitconfig" ] && MOUNTS+=(-v "$HOME/.gitconfig:$HOME/.gitconfig:ro")

# Optional worktrees dir
WORKTREES_DIR="$(realpath "$WORKSPACE/../worktrees" 2>/dev/null || echo "$(dirname "$WORKSPACE")/worktrees")"
mkdir -p "$WORKTREES_DIR" 2>/dev/null || true
[ -d "$WORKTREES_DIR" ] && MOUNTS+=(-v "$WORKTREES_DIR:$WORKTREES_DIR")

# Mount Dokobot & Skills if they exist
[ -d "$HOME/.dokobot" ] && MOUNTS+=(-v "$HOME/.dokobot:$HOME/.dokobot")
[ -d "$HOME/skills" ] && MOUNTS+=(-v "$HOME/skills:$HOME/skills:ro")

# Pass any API keys from .env (workspace .env or fallback to SOSHO_ROOT/.env)
ENV_ARGS=()
if [ -f "$WORKSPACE_ENV" ]; then
  ENV_ARGS+=(--env-file "$WORKSPACE_ENV")
fi

# TTY flags
DOCKER_INTERACTIVE_FLAGS=()
if [ -t 0 ] && [ -t 1 ]; then
  DOCKER_INTERACTIVE_FLAGS+=("-it")
fi

# Run pi container on the compose network, attached to the current working directory.
exec docker run "${DOCKER_INTERACTIVE_FLAGS[@]}" --rm \
  --network "$COMPOSE_NETWORK" \
  --add-host host.docker.internal:host-gateway \
  --user "$(id -u):$(id -g)" \
  -e "HOME=$HOME" \
  -e "LLAMA_BASE_URL=http://llama-cpp:8080" \
  -e "LITELLM_BASE_URL=http://litellm:4000/v1" \
  -e "SOSHO_EMBED_URL=http://llama-cpp:8080/v1/embeddings" \
  -e "PI_CODING_AGENT_DIR=$TARGET_PI" \
  -e "XDG_CACHE_HOME=$TARGET_PI/.cache" \
  -e "XDG_CONFIG_HOME=$TARGET_PI/.config" \
  -e "npm_config_cache=$TARGET_PI/.cache/npm" \
  -e "LANGFUSE_BASE_URL=http://langfuse-web:3000" \
  -e "LANGFUSE_PUBLIC_KEY=$LANGFUSE_PK" \
  -e "LANGFUSE_SECRET_KEY=$LANGFUSE_SK" \
  --tmpfs "$HOME:uid=$(id -u),gid=$(id -g),mode=0755" \
  "${ENV_ARGS[@]}" \
  "${MOUNTS[@]}" \
  "${CONFIG_MOUNTS[@]}" \
  -w "$WORKSPACE" \
  "$IMAGE_NAME" \
  "${FINAL_ARGS[@]}"
