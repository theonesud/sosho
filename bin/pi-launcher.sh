#!/usr/bin/env bash
set -e

# ==============================================================================
# Global Pi CLI launcher (Docker-backed)
# ==============================================================================
IMAGE_NAME="pi-sandbox:latest"
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SCRIPT_SOURCE" ]; do
    SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
    SCRIPT_SOURCE="$(readlink "$SCRIPT_SOURCE")"
    [[ $SCRIPT_SOURCE != /* ]] && SCRIPT_SOURCE="$SCRIPT_DIR/$SCRIPT_SOURCE"
done
RESOLVED_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" 2>/dev/null && pwd)"
SOSHO_ROOT="${SOSHO_ROOT:-$RESOLVED_DIR}"
[ ! -d "$SOSHO_ROOT/.pi" ] && SOSHO_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || echo "$HOME/sosho")"
SOSHO_PI="$SOSHO_ROOT/.pi"

# Filter out our custom launcher flags from arguments
FORWARD_ARGS=()
WARMUP="${PI_WARMUP:-0}"
for arg in "$@"; do
    case "$arg" in
        --warmup)
            WARMUP=1
            ;;
        --no-warmup)
            WARMUP=0
            ;;
        *)
            FORWARD_ARGS+=("$arg")
            ;;
    esac
done

# 0. Ensure Docker image exists; build if missing
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "Image $IMAGE_NAME not found locally. Building from $SOSHO_ROOT..."
    docker build -t "$IMAGE_NAME" -f "$SOSHO_ROOT/docker/Dockerfile.pi" "$SOSHO_ROOT"
fi

WORKSPACE="$(pwd)"

# 1. Ensure target workspace has a local .pi directory and session scratchpad root
TARGET_PI="$WORKSPACE/.pi"
mkdir -p "$TARGET_PI/.cache" "$TARGET_PI/.config" "$TARGET_PI/scratchpad"




# Format argument ordering (subcommands require their options before --approve)
SUBCOMMANDS=("update" "auth" "install" "remove" "list")
IS_SUBCOMMAND=0
for sub in "${SUBCOMMANDS[@]}"; do
    if [ "${FORWARD_ARGS[0]:-}" = "$sub" ]; then
        IS_SUBCOMMAND=1
        break
    fi
done

# 2. Automatic background updater (checks once every 24h or when requested)
#    pi is baked into the Docker image, so its self-updater cannot work inside
#    the ephemeral container. Rebuild the image when a newer release exists.
AUTO_UPDATE_STAMP="$TARGET_PI/.cache/.last_ext_update"
NOW=$(date +%s)
LAST_UPDATE=0
[ -f "$AUTO_UPDATE_STAMP" ] && LAST_UPDATE=$(cat "$AUTO_UPDATE_STAMP" 2>/dev/null || echo 0)
# Update if older than 24 hours (86400s) and not running a sub-command
if [ $((NOW - LAST_UPDATE)) -gt 86400 ] && [ "$IS_SUBCOMMAND" -eq 0 ]; then
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

    docker run --rm \
        --network host \
        --user "$(id -u):$(id -g)" \
        -e "HOME=$HOME" \
        -e "PI_CODING_AGENT_DIR=$TARGET_PI" \
        -e "npm_config_cache=$TARGET_PI/.cache/npm" \
        --tmpfs "$HOME:uid=$(id -u),gid=$(id -g),mode=0755" \
        -v "$WORKSPACE:$WORKSPACE" \
        -w "$WORKSPACE" \
        "$IMAGE_NAME" \
        update --all >/dev/null 2>&1 || true
    echo "$NOW" > "$AUTO_UPDATE_STAMP" 2>/dev/null || true
fi

# 2. If target workspace does NOT have its own configs, provide the defaults
if [ ! -f "$TARGET_PI/models.json" ] && [ -f "$SOSHO_PI/models.json" ]; then
    cp "$SOSHO_PI/models.json" "$TARGET_PI/models.json"
fi
if [ ! -f "$TARGET_PI/settings.json" ] && [ -f "$SOSHO_PI/settings.json" ]; then
    cp "$SOSHO_PI/settings.json" "$TARGET_PI/settings.json"
fi

# 2a. Sync llama.cpp contextWindow in TARGET_PI/models.json with LLM_CTX_SIZE from .env if present
# Only local llama.cpp/Qwen models follow local hardware autotune; remote providers are left unchanged.
WORKSPACE_ENV="$WORKSPACE/.env"
[ ! -f "$WORKSPACE_ENV" ] && [ -f "$SOSHO_ROOT/.env" ] && WORKSPACE_ENV="$SOSHO_ROOT/.env"
if [ -f "$WORKSPACE_ENV" ] && [ -f "$TARGET_PI/models.json" ]; then
    ENV_CTX=$(grep -E '^[[:space:]]*LLM_CTX_SIZE=' "$WORKSPACE_ENV" | tail -n 1 | cut -d= -f2 | tr -d ' "\r\n')
    if [ -n "$ENV_CTX" ] && [ "$ENV_CTX" -gt 0 ] 2>/dev/null; then
        python3 - "$TARGET_PI/models.json" "$ENV_CTX" <<'PY' 2>/dev/null || true
import json, sys
path, ctx = sys.argv[1], int(sys.argv[2])
with open(path, "r") as f:
    data = json.load(f)
changed = False
llama = data.get("providers", {}).get("llama.cpp")
if llama:
    for m in llama.get("models", []):
        if m.get("contextWindow") != ctx:
            m["contextWindow"] = ctx
            m["maxTokens"] = min(m.get("maxTokens", 8192), max(2048, ctx // 4))
            changed = True
if changed:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
PY
    fi
fi

# 2a-2. Sync compaction in TARGET_PI/settings.json with LLM_CTX_SIZE from .env if present
if [ -f "$WORKSPACE_ENV" ] && [ -f "$TARGET_PI/settings.json" ]; then
    ENV_CTX=$(grep -E '^[[:space:]]*LLM_CTX_SIZE=' "$WORKSPACE_ENV" | tail -n 1 | cut -d= -f2 | tr -d ' "\r\n')
    if [ -n "$ENV_CTX" ] && [ "$ENV_CTX" -gt 0 ] 2>/dev/null; then
        python3 - "$TARGET_PI/settings.json" "$ENV_CTX" <<'PY' 2>/dev/null || true
import json, sys
path, ctx = sys.argv[1], int(sys.argv[2])
with open(path, "r") as f:
    data = json.load(f)
compaction = data.setdefault("compaction", {})
reserve = min(8192, max(2048, ctx // 8))
keep_recent = max(4096, int(ctx * 0.25))
compaction["enabled"] = True
compaction["reserveTokens"] = reserve
compaction["keepRecentTokens"] = keep_recent
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PY
    fi
fi



# 3. Optional local model pre-warm (only if explicitly requested via --warmup)
if [ "$WARMUP" = "1" ] && [ -f "$TARGET_PI/models.json" ] && command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    read -r BASE_URL MODEL_ID < <(python3 - "$TARGET_PI/models.json" <<'PY' 2>/dev/null
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
    llama = cfg.get("providers", {}).get("llama.cpp", {})
    if llama:
        print(llama.get("baseUrl", "").rstrip("/"), (llama.get("models") or [{}])[0].get("id", ""))
    else:
        p = next(iter(cfg.get("providers", {}).values()), {})
        print(p.get("baseUrl", "").rstrip("/"), (p.get("models") or [{}])[0].get("id", ""))
except Exception:
    print("")
PY
)
    case "$BASE_URL" in
        http://127.0.0.1:*|http://localhost:*|http://0.0.0.0:*)
            if [ -n "$MODEL_ID" ]; then
                HEALTH_URL="${BASE_URL%/v1}/health"
                # Check if model server is reachable first
                if curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
                    echo "Pre-warming local model $MODEL_ID (press Ctrl+C to skip)..."
WARM_PAYLOAD="$(python3 - "$MODEL_ID" "$SOSHO_PI/SYSTEM.md" "$SOSHO_PI/APPEND_SYSTEM.md" <<'PY'
import json, sys, os
model_id, primary_prompt, fallback_prompt = sys.argv[1], sys.argv[2], sys.argv[3]
content = "You are an autonomous AI coding assistant."
target_path = primary_prompt if os.path.isfile(primary_prompt) else fallback_prompt
if os.path.isfile(target_path):
    try:
        with open(target_path) as f:
            content = f.read()
    except Exception:
        pass
print(json.dumps({
    "model": model_id,
    "messages": [
        {"role": "system", "content": content},
        {"role": "user", "content": "Ready. Acknowledge with OK."}
    ],
    "max_tokens": 1,
    "temperature": 0,
}))
PY
)"
                    if curl -s -m 180 -o /dev/null -H 'Content-Type: application/json' \
                        -X POST "$BASE_URL/chat/completions" --data-binary "$WARM_PAYLOAD"; then
                        echo "Model ready."
                    else
                        echo "Warning: model warm-up timed out or returned error; continuing anyway."
                    fi
                fi
            fi
            ;;
    esac
fi

# 4. Mount list
MOUNTS=(
    -v "$WORKSPACE:$WORKSPACE"
    -v "$TARGET_PI:$TARGET_PI"
)

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

FINAL_ARGS=()
if [ "$IS_SUBCOMMAND" -eq 1 ]; then
    FINAL_ARGS=("${FORWARD_ARGS[@]}" --approve)
else
    FINAL_ARGS=(--approve "${FORWARD_ARGS[@]}")
fi

# 5. Run Pi container attached to current working directory
exec docker run "${DOCKER_INTERACTIVE_FLAGS[@]}" --rm \
    --network host \
    --pid host \
    --user "$(id -u):$(id -g)" \
    -e "HOME=$HOME" \
    -e "LLAMA_BASE_URL=http://127.0.0.1:8080" \
    -e "PI_CODING_AGENT_DIR=$TARGET_PI" \
    -e "XDG_CACHE_HOME=$TARGET_PI/.cache" \
    -e "XDG_CONFIG_HOME=$TARGET_PI/.config" \
    -e "npm_config_cache=$TARGET_PI/.cache/npm" \
    -e "LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL:-http://127.0.0.1:3000}" \
    -e "LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-pk-lf-local-pi}" \
    -e "LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-sk-lf-local-pi}" \
    --tmpfs "$HOME:uid=$(id -u),gid=$(id -g),mode=0755" \
    "${ENV_ARGS[@]}" \
    "${MOUNTS[@]}" \
    -w "$WORKSPACE" \
    "$IMAGE_NAME" \
    "${FINAL_ARGS[@]}"
