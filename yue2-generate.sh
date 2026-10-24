#!/usr/bin/env bash
set -e

# ==============================================================================
# YuE2 Music Generator CLI (via audio.cpp Docker on GPU)
# ==============================================================================
IMAGE="ghcr.io/0xshug0/audio.cpp:full-cuda12"
MODELS_DIR="/mnt/Asteroid/sosho-models/yue2-3b"
OUT_DIR="$(pwd)"

STYLE=""
LYRICS=""
OUT_FILE="song.wav"
COT="melody"
STOP_AFTER="audio"

usage() {
    echo "Usage: yue2-music --style \"<genre/instruments>\" --lyrics \"<lyrics>\" [--out <output.wav>]"
    echo ""
    echo "Options:"
    echo "  -s, --style       Style, genre, and instrumental description (required)"
    echo "  -l, --lyrics      Song lyrics formatted with section tags like [Verse], [Chorus] (required)"
    echo "  -o, --out         Output audio file path (default: song.wav)"
    echo "  --cot             CoT route: melody (default), full, or off"
    echo "  --stop-after      Stop after: audio (default), abc, semantic"
    exit 1
}

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        -s|--style) STYLE="$2"; shift 2 ;;
        -l|--lyrics) LYRICS="$2"; shift 2 ;;
        -o|--out) OUT_FILE="$2"; shift 2 ;;
        --cot) COT="$2"; shift 2 ;;
        --stop-after) STOP_AFTER="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown parameter: $1"; usage ;;
    esac
done

if [ -z "$STYLE" ] || [ -z "$LYRICS" ]; then
    echo "Error: Both --style and --lyrics are required."
    usage
fi

OUT_FILENAME="$(basename "$OUT_FILE")"
OUT_DIR_ABS="$(cd -P "$(dirname "$OUT_FILE")" 2>/dev/null && pwd || pwd)"

echo "🎵 Generating YuE2 music..."
echo "  Style: $STYLE"
echo "  Lyrics: $LYRICS"
echo "  Output: $OUT_DIR_ABS/$OUT_FILENAME"

# Temporarily sleep or coordinate if llama.cpp is consuming high VRAM
exec docker run --rm \
    --gpus all \
    -v "$MODELS_DIR:/models:ro" \
    -v "$OUT_DIR_ABS:/output" \
    "$IMAGE" \
    cli --task gen --family yue2 --model /models/yue2-3b-q8_0.gguf \
        --request-option cot="$COT" \
        --request-option stop_after="$STOP_AFTER" \
        --request-option style="$STYLE" \
        --request-option lyrics="$LYRICS" \
        --request-option yue2.mem_saver=true \
        --backend cuda \
        --out "/output/$OUT_FILENAME"
