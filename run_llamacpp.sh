#!/bin/bash

# ==========================================
# 1. Configuration & Paths
# ==========================================
MODEL_DIR="$(pwd)/models"
MODEL_NAME="gemma-4-E4B-it-Q4_K_M"
MODEL_SUBDIR="$MODEL_DIR/$MODEL_NAME"
mkdir -p "$MODEL_SUBDIR"

MODEL_FILE="gemma-4-E4B-it-Q4_K_M.gguf"
MMPROJ_FILE="mmproj-F16.gguf"

MODEL_PATH_LOCAL="$MODEL_SUBDIR/$MODEL_FILE"
MMPROJ_PATH_LOCAL="$MODEL_SUBDIR/$MMPROJ_FILE"

# ==========================================
# 2. Download Models
# ==========================================
if [ ! -e "$MODEL_PATH_LOCAL" ] || [ ! -e "$MMPROJ_PATH_LOCAL" ]; then
    echo "Models not found or incomplete. Downloading..."
    if [ ! -e "$MODEL_PATH_LOCAL" ]; then
        HF_HUB_ENABLE_HF_TRANSFER=1 hf download unsloth/gemma-4-E4B-it-GGUF "$MODEL_FILE" --local-dir "$MODEL_SUBDIR"
    fi
    if [ ! -e "$MMPROJ_PATH_LOCAL" ]; then
        HF_HUB_ENABLE_HF_TRANSFER=1 hf download unsloth/gemma-4-E4B-it-GGUF "$MMPROJ_FILE" --local-dir "$MODEL_SUBDIR"
    fi
else
    echo "Models found in $MODEL_SUBDIR. Proceeding to start server..."
fi

# ==========================================
# 3. Docker Setup & Cleanup
# ==========================================
# Ensure network exists
docker network inspect webui-net >/dev/null 2>&1 || docker network create webui-net

echo "Stopping and removing existing llama-cpp container if running..."
docker rm -f llama-cpp 2>/dev/null

# ==========================================
# 4. Start Server in Router Mode
# ==========================================
echo "Starting server via docker run..."

# Build llama-server arguments
# Added --jinja for tool calling and chat template support in Pi
# Added --models-autoload to enable router mode!
SERVER_ARGS=(
    "--host" "0.0.0.0"
    "--port" "8080"
    "-c" "32768"
    "-np" "1"
    "-ngl" "99"
    "-fa" "on"
    "-ctk" "q8_0"
    "-ctv" "q8_0"
    "-b" "2048"
    "--ubatch-size" "512"
    "--cache-reuse" "256"
    "--jinja"
    "--models-autoload"
    "--models-dir" "/models"
)

# Run docker container
docker run -d \
    --name llama-cpp \
    --restart always \
    --gpus all \
    -p "8080:8080" \
    --network webui-net \
    -v "$MODEL_DIR:/models" \
    --entrypoint /app/llama-server \
    ghcr.io/ggml-org/llama.cpp:server-cuda \
    "${SERVER_ARGS[@]}"

echo "Server is running in router mode in the background."
echo "You can view the logs using: docker logs -f llama-cpp"
