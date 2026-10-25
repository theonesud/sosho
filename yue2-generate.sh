#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# YuE2 Music Generator CLI
#
# Preferred path: submit an async job to the yue2-gateway (compose profile
# `music`) and poll for the audio + ABC score. No VRAM juggling, no per-call
# model load.
#
#   docker compose --profile music up -d yue2-engine yue2-gateway
#
# Fallback path: if the gateway is unreachable, run a one-shot audio.cpp
# container. That needs ~7 GB free VRAM, so stop llama-cpp first.
# ==============================================================================

GATEWAY_URL="${YUE2_GATEWAY_URL:-http://127.0.0.1:8021}"
YUE2_API_KEY="${YUE2_API_KEY:-}"
MODELS_DIR="${YUE2_MODELS_DIR:-/mnt/Asteroid/sosho-models/yue2-3b}"
IMAGE="${YUE2_ENGINE_IMAGE:-ghcr.io/0xshug0/audio.cpp:full-cuda12}"
MODEL_GGUF="${YUE2_MODEL_GGUF:-yue2-3b-q4_0.gguf}"

STYLE=""
LYRICS=""
OUT_FILE="song.wav"
SCORE_OUT=""
COT=""            # empty = engine default (full)
SEED=""
STEPS=""          # empty = engine default (32)
OPTIONS=()
WAIT_SECONDS="${YUE2_WAIT_SECONDS:-1800}"
FORCE_LOCAL=0

usage() {
    cat <<'EOF'
Usage: yue2-music --style "<genre/instruments>" --lyrics "<lyrics>" [options]

Options:
  -s, --style       Style, genre, and instrumental description (required)
  -l, --lyrics      Section-tagged lyrics like [Verse]/[Chorus] (required)
  -o, --out         Output audio path (default: song.wav)
      --score-out   Also save the generated ABC score to this path
      --cot         Planning route: melody, full, or off (default: full)
      --steps       NAR ODE steps (default: 32 = best quality)
      --seed        Integer seed for reproducible takes (default: random)
  -O, --option      Any model option as key=value; repeatable
                    e.g. --option guidance_scale=1.1 --option semantic_max_tokens=3000
      --wait        Max seconds to wait for the job (default: 1800)
      --local       Skip the gateway and run a one-shot container
  -h, --help        Show this help
EOF
    exit 1
}

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        -s|--style)      STYLE="$2"; shift 2 ;;
        -l|--lyrics)     LYRICS="$2"; shift 2 ;;
        -o|--out)        OUT_FILE="$2"; shift 2 ;;
        --score-out)     SCORE_OUT="$2"; shift 2 ;;
        --cot)           COT="$2"; shift 2 ;;
        --steps)         STEPS="$2"; shift 2 ;;
        --seed)          SEED="$2"; shift 2 ;;
        -O|--option)     OPTIONS+=("$2"); shift 2 ;;
        --wait)          WAIT_SECONDS="$2"; shift 2 ;;
        --local)         FORCE_LOCAL=1; shift ;;
        -h|--help)       usage ;;
        *) echo "Unknown parameter: $1" >&2; usage ;;
    esac
done

[[ -n "$STYLE" ]]  || { echo "Error: --style is required." >&2; usage; }
[[ -n "$LYRICS" ]] || { echo "Error: --lyrics is required." >&2; usage; }

OUT_DIR="$(cd -P "$(dirname "$OUT_FILE")" 2>/dev/null && pwd || pwd)"
OUT_NAME="$(basename "$OUT_FILE")"

auth_args=()
[[ -n "$YUE2_API_KEY" ]] && auth_args=(-H "Authorization: Bearer $YUE2_API_KEY")

gateway_up() {
    [[ "$FORCE_LOCAL" -eq 1 ]] && return 1
    curl -fsS -m 3 "$GATEWAY_URL/health/ready" >/dev/null 2>&1
}

run_via_gateway() {
    echo "🎵 Generating YuE2 music via gateway ($GATEWAY_URL)"
    echo "   style:  $STYLE"
    echo "   output: $OUT_DIR/$OUT_NAME"

    local body job_id
    body="$(python3 - "$STYLE" "$LYRICS" "$COT" "$SEED" "$STEPS" ${OPTIONS[@]+"${OPTIONS[@]}"} <<'PY'
import json, sys
style, lyrics, cot, seed, steps = sys.argv[1:6]
extras = sys.argv[6:]
req = {"style": style, "lyrics": lyrics, "options": {}}
if cot:
    req["cot"] = cot
if seed:
    req["seed"] = int(seed)
if steps:
    req["options"]["num_inference_steps"] = int(steps)
for item in extras:
    if "=" not in item:
        raise SystemExit(f"bad --option (want key=value): {item}")
    key, value = item.split("=", 1)
    try:
        value = json.loads(value)
    except json.JSONDecodeError:
        pass
    req["options"][key] = value
print(json.dumps(req))
PY
)"

    job_id="$(curl -fsS -m 30 -X POST "$GATEWAY_URL/v1/jobs" \
        -H 'Content-Type: application/json' \
        -H "Idempotency-Key: $(date +%s)-$$" \
        "${auth_args[@]}" \
        --data-binary "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

    echo "   job:    $job_id"

    local deadline=$(( $(date +%s) + WAIT_SECONDS )) status
    while :; do
        status="$(curl -fsS -m 10 "${auth_args[@]}" "$GATEWAY_URL/v1/jobs/$job_id" \
            | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["status"])')"
        case "$status" in
            succeeded|truncated) break ;;
            failed|cancelled)
                echo "❌ Job $status:" >&2
                curl -fsS -m 10 "${auth_args[@]}" "$GATEWAY_URL/v1/jobs/$job_id" \
                    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("error"))' >&2
                exit 1 ;;
        esac
        if (( $(date +%s) > deadline )); then
            echo "❌ Timed out after ${WAIT_SECONDS}s (job $job_id still $status)" >&2
            exit 1
        fi
        printf '.'
        sleep 2
    done
    printf '\n'

    curl -fsS -m 120 "${auth_args[@]}" "$GATEWAY_URL/v1/jobs/$job_id/audio" -o "$OUT_DIR/$OUT_NAME"

    if [[ -n "$SCORE_OUT" ]]; then
        local score_dir
        score_dir="$(cd -P "$(dirname "$SCORE_OUT")" 2>/dev/null && pwd || pwd)"
        curl -fsS -m 60 "${auth_args[@]}" "$GATEWAY_URL/v1/jobs/$job_id/score" \
            -o "$score_dir/$(basename "$SCORE_OUT")"
        echo "   score:  $score_dir/$(basename "$SCORE_OUT")"
    fi

    curl -fsS -m 10 "${auth_args[@]}" "$GATEWAY_URL/v1/jobs/$job_id" \
        | python3 -c 'import json,sys; t=json.load(sys.stdin)["timing"]; print("   audio:  %.1fs  rtf=%s" % (t["audio_duration_ms"]/1000, t["rtf"]))'

    # The gateway restarts llama-cpp after the job; wait for it so the agent
    # does not talk to a dead LLM immediately after generating music.
    if [[ "${YUE2_WAIT_LLM:-1}" != "0" ]]; then
        local llm_deadline=$(( $(date +%s) + ${YUE2_WAIT_LLM_SECONDS:-180} )) llm_state
        printf '   llm:    restoring'
        while :; do
            llm_state="$(curl -fsS -m 5 "$GATEWAY_URL/health/llm" 2>/dev/null \
                | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","unknown"))' 2>/dev/null || echo unknown)"
            case "$llm_state" in
                healthy|unknown) break ;;
            esac
            if (( $(date +%s) > llm_deadline )); then
                echo " (still $llm_state after timeout)"
                break
            fi
            printf '.'
            sleep 3
        done
        [[ "$llm_state" == "healthy" ]] && printf ' ready\n' || printf ' %s\n' "$llm_state"
    fi

    echo "✅ Wrote $OUT_DIR/$OUT_NAME"
}

run_locally() {
    echo "⚠️  Gateway not reachable at $GATEWAY_URL - falling back to a one-shot container."
    echo "    This needs ~7 GB free VRAM. Stop llama-cpp first if it is resident:"
    echo "      docker stop llama-cpp && docker start llama-cpp"
    echo "    Better: docker compose --profile music up -d yue2-engine yue2-gateway"
    echo

    # The image runs as uid 1000; make sure this user can write the output dir.
    if [[ ! -w "$OUT_DIR" ]]; then
        echo "Error: $OUT_DIR is not writable." >&2
        exit 1
    fi

    local opt_args=(--request-option "cot=${COT:-full}" --request-option stop_after=audio
                    --request-option "num_inference_steps=${STEPS:-32}")
    local o
    for o in ${OPTIONS[@]+"${OPTIONS[@]}"}; do opt_args+=(--request-option "$o"); done

    docker run --rm --gpus all --user "$(id -u):$(id -g)" \
        -v "$MODELS_DIR:/models:ro" \
        -v "$OUT_DIR:/output" \
        "$IMAGE" \
        cli --task gen --family yue2 --model "/models/$MODEL_GGUF" \
            "${opt_args[@]}" \
            --request-option style="$STYLE" \
            --request-option lyrics="$LYRICS" \
            --request-option yue2.mem_saver=true \
            ${SEED:+--seed "$SEED"} \
            --backend cuda \
            --metrics \
            --out "/output/$OUT_NAME"
}

if gateway_up; then
    run_via_gateway
else
    run_locally
fi
