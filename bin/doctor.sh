#!/usr/bin/env bash
set -e

# ==============================================================================
# Sosho Environment & System Diagnostic (Doctor)
# ==============================================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "  [${GREEN}OK${NC}] $1"; }
fail() { echo -e "  [${RED}FAIL${NC}] $1"; }
warn() { echo -e "  [${YELLOW}WARN${NC}] $1"; }

echo "Running Sosho System Diagnostics..."
echo "-----------------------------------"

# 1. Docker Daemon Check
echo "1. Checking Docker Engine..."
if docker info >/dev/null 2>&1; then
    pass "Docker daemon is running and accessible"
else
    fail "Cannot communicate with Docker daemon. Is Docker running?"
fi

# 2. NVIDIA GPU and Container Toolkit
echo "2. Checking NVIDIA Container Toolkit..."
if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_NAME="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -n1)"
    pass "Host GPU detected: $GPU_NAME"
    if docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
        pass "NVIDIA Container Toolkit is working properly with Docker (--gpus all)"
    else
        fail "NVIDIA Container Toolkit test failed. Docker cannot allocate GPUs."
    fi
else
    warn "nvidia-smi not found on host. GPU acceleration will not be available."
fi

# 3. Port Availabilities
echo "3. Checking Port Availabilities..."
check_port() {
    local port=$1
    local name=$2
    if nc -z 127.0.0.1 "$port" 2>/dev/null || ss -tulpn 2>/dev/null | grep -q ":$port "; then
        warn "Port $port ($name) is currently bound or in use"
    else
        pass "Port $port ($name) is available"
    fi
}

check_port 8080 "llama.cpp"
check_port 3000 "Langfuse Web"
check_port 8021 "YuE2 Gateway"

# 4. Disk Space for Models
echo "4. Checking Disk Space for Models..."
MODELS_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models"
mkdir -p "$MODELS_DIR"
FREE_GB="$(df -BG "$MODELS_DIR" | awk 'NR==2 {gsub("G",""); print $4}')"
if [ "$FREE_GB" -lt 30 ]; then
    warn "Low disk space in $MODELS_DIR ($FREE_GB GB available). Models require ~25-35 GB."
else
    pass "Sufficient disk space available ($FREE_GB GB free in $MODELS_DIR)"
fi

# 5. Local pi launcher binary check
echo "5. Checking CLI Tool Installation..."
if command -v pi >/dev/null 2>&1; then
    pass "Global 'pi' binary is installed at $(which pi)"
else
    warn "'pi' binary not found in PATH. Run 'make install-cli' to install."
fi

echo "-----------------------------------"
echo "Diagnostics complete."
