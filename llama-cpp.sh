#!/bin/bash

# ==========================================
# 1. Configuration & Paths
# ==========================================
MODEL_DIR="$(pwd)/models"
mkdir -p "$MODEL_DIR"

MODEL_FILE="gemma-4-E4B-it-Q4_K_M.gguf"
MMPROJ_FILE="mmproj-F16.gguf"

MODEL_PATH_LOCAL="$MODEL_DIR/$MODEL_FILE"
MMPROJ_PATH_LOCAL="$MODEL_DIR/$MMPROJ_FILE"

# ==========================================
# 2. Download Models (Replaces download_model.sh)
# ==========================================
if [ ! -e "$MODEL_PATH_LOCAL" ] || [ ! -e "$MMPROJ_PATH_LOCAL" ]; then
    echo "Models not found or incomplete. Downloading..."
    if [ ! -e "$MODEL_PATH_LOCAL" ]; then
        HF_HUB_ENABLE_HF_TRANSFER=1 hf download unsloth/gemma-4-E4B-it-GGUF "$MODEL_FILE" --local-dir "$MODEL_DIR"
    fi
    if [ ! -e "$MMPROJ_PATH_LOCAL" ]; then
        HF_HUB_ENABLE_HF_TRANSFER=1 hf download unsloth/gemma-4-E4B-it-GGUF "$MMPROJ_FILE" --local-dir "$MODEL_DIR"
    fi
else
    echo "Models found. Proceeding to start server..."
fi

# ==========================================
# 3. Docker Setup & Cleanup
# ==========================================
# Ensure network exists
docker network inspect webui-net >/dev/null 2>&1 || docker network create webui-net

echo "Stopping and removing existing llama-cpp container if running..."
docker rm -f llama-cpp 2>/dev/null

# ==========================================
# 4. Start Server (Replaces docker-compose.yml & start-server.sh)
# ==========================================
echo "Starting server via docker run..."

# Build llama-server arguments
SERVER_ARGS=(
    "--host" "0.0.0.0"
    "--port" "8080"
    "-c" "131072"
    "-ngl" "99"
    "-fa" "on"
    "-ctk" "q8_0"
    "-ctv" "q8_0"
    "-m" "/models/$MODEL_FILE"
    "-a" "Sosho"
)

if [ -e "$MMPROJ_PATH_LOCAL" ]; then
    SERVER_ARGS+=("--mmproj" "/models/$MMPROJ_FILE")
fi

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

echo "Server is running in the background."
echo "You can view the logs using: docker logs -f llama-cpp"