#!/usr/bin/env bash

sync_llama_context() {
  local target_pi="$1" env_file="$2" ctx
  if [ ! -f "$env_file" ] || [ ! -f "$target_pi/models.json" ]; then
    return 0
  fi
  ctx=$(grep -E '^[[:space:]]*LLM_CTX_SIZE=' "$env_file" | tail -n 1 | cut -d= -f2 | tr -d ' "\r\n')
  if [ -n "$ctx" ] && [ "$ctx" -gt 0 ] 2>/dev/null; then
    python3 - "$target_pi/models.json" "$ctx" <<'PY' 2>/dev/null || true
import json, sys
path, ctx = sys.argv[1], int(sys.argv[2])
with open(path, "r") as f:
    data = json.load(f)
changed = False
llama = data.get("providers", {}).get("litellm")
if llama:
    for m in llama.get("models", []):
        if m.get("id") == "local-uncensored" and m.get("contextWindow") != ctx:
            m["contextWindow"] = ctx
            m["maxTokens"] = min(m.get("maxTokens", 8192), max(2048, ctx // 4))
            changed = True
if changed:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
PY
  fi
}

sync_compaction() {
  local target_pi="$1"
  if [ ! -f "$target_pi/settings.json" ] || [ ! -f "$target_pi/models.json" ]; then
    return 0
  fi
  python3 - "$target_pi/settings.json" "$target_pi/models.json" <<'PY' 2>/dev/null || true
import json, sys
settings_path, models_path = sys.argv[1], sys.argv[2]
with open(settings_path, "r") as f:
    settings = json.load(f)
with open(models_path, "r") as f:
    models_cfg = json.load(f)

provider_name = settings.get("defaultProvider")
model_id = settings.get("defaultModel")
ctx = None
providers = models_cfg.get("providers", {})
if provider_name and provider_name in providers:
    for m in providers[provider_name].get("models", []):
        if m.get("id") == model_id and isinstance(m.get("contextWindow"), int):
            ctx = m["contextWindow"]
            break
    if ctx is None:
        models_list = providers[provider_name].get("models", [])
        if models_list and isinstance(models_list[0].get("contextWindow"), int):
            ctx = models_list[0]["contextWindow"]

if ctx and ctx > 0:
    compaction = settings.setdefault("compaction", {})
    reserve = min(16384, max(2048, ctx // 8))
    keep_recent = min(32768, max(4096, int(ctx * 0.25)))
    if (
        compaction.get("enabled") is not True
        or compaction.get("reserveTokens") != reserve
        or compaction.get("keepRecentTokens") != keep_recent
    ):
        compaction["enabled"] = True
        compaction["reserveTokens"] = reserve
        compaction["keepRecentTokens"] = keep_recent
        with open(settings_path, "w") as f:
            json.dump(settings, f, indent=2)
PY
}

warm_local_model() {
  local target_pi="$1" sosho_pi="$2" skip="$3" api_key="${4:-}" BASE_URL MODEL_ID WARM_PAYLOAD
  if [ "$skip" = "1" ] || [ ! -f "$target_pi/models.json" ]; then return 0; fi
  if ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then return 0; fi
  BASE_URL="$(
    python3 - "$target_pi/models.json" <<'PY' 2>/dev/null
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
    print(cfg["providers"]["litellm"]["baseUrl"].rstrip("/"))
except Exception:
    print("")
PY
  )"
  MODEL_ID="local-uncensored"
  case "$BASE_URL" in
    http://127.0.0.1:* | http://localhost:* | http://0.0.0.0:*)
      if ! curl -fsS -m 2 "${BASE_URL%/v1}/health/liveliness" >/dev/null 2>&1; then return 0; fi
      echo "Pre-warming local model $MODEL_ID through LiteLLM (press Ctrl+C to skip, or use --no-warmup)..."
      WARM_PAYLOAD="$(
        python3 - "$MODEL_ID" "$sosho_pi/SYSTEM.md" "$sosho_pi/APPEND_SYSTEM.md" <<'PY'
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
        -H "Authorization: Bearer ${api_key:-sk-sosho-local}" \
        -X POST "$BASE_URL/chat/completions" --data-binary "$WARM_PAYLOAD"; then
        echo "Model ready."
      else
        echo "Warning: model warm-up timed out or returned error; continuing anyway."
      fi
      ;;
  esac
}
