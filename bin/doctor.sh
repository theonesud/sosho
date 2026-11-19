#!/usr/bin/env bash

# ==============================================================================
# Sosho Environment & System Diagnostic (Doctor)
# ==============================================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAIL_COUNT=0

pass() { echo -e "  [${GREEN}OK${NC}] $1"; }
fail() { echo -e "  [${RED}FAIL${NC}] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
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

# 2. Host Node.js Runtime Check
echo "2. Checking Host Node.js Runtime..."
if command -v node >/dev/null 2>&1; then
    NODE_VER="$(node -v 2>/dev/null || echo 'unknown')"
    NODE_MAJOR="$(echo "$NODE_VER" | sed -E 's/^v([0-9]+).*/\1/')"
    if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
        pass "Host Node.js detected: $NODE_VER (>= v20 required)"
    else
        fail "Host Node.js $NODE_VER is below minimum v20.18.0"
    fi
else
    fail "node not found on host. Install Node.js v20.18.0 or newer."
fi

# 3. NVIDIA GPU, Container Toolkit & Hardware Unlock
echo "3. Checking NVIDIA GPU, Container Toolkit & Hardware Unlock..."
if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_NAME="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -n1)"
    pass "Host GPU detected: $GPU_NAME"

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^llama-cpp$" && \
       docker inspect --format '{{.HostConfig.DeviceRequests}}' llama-cpp 2>/dev/null | grep -q "gpu"; then
        pass "NVIDIA Container Toolkit verified via running GPU container 'llama-cpp'"
    elif docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
        pass "NVIDIA Container Toolkit is working properly with Docker (--gpus all)"
    else
        fail "NVIDIA Container Toolkit test failed. Docker cannot allocate GPUs."
    fi

    if journalctl -k -b 2>/dev/null | grep -q "gpu_unlock: unlocked"; then
        pass "gpu-unlock active: Ampere/Ada/Turing full tensor core throughput unlocked"
    else
        warn "gpu-unlock not detected in current boot log. Check /etc/default/grub or dkms status if installed."
    fi
else
    warn "nvidia-smi not found on host. GPU acceleration will not be available."
fi

# 4. Port & Service Health
echo "4. Checking Port & Service Health..."
check_port_service() {
    local port=$1
    local name=$2
    local container=$3
    local is_open=0
    if (exec 3<>/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
        exec 3<&- 3>&-
        is_open=1
    elif ss -tln 2>/dev/null | grep -q ":${port} "; then
        is_open=1
    fi

    if [ "$is_open" -eq 1 ]; then
        if [ -z "$container" ]; then
            pass "Port $port ($name) is active"
        elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
            pass "Port $port ($name) is active and served by healthy container '$container'"
        else
            warn "Port $port ($name) is bound by an external process or container"
        fi
    else
        pass "Port $port ($name) is available (ready to start)"
    fi
}

check_port_service 8080 "llama.cpp" "llama-cpp"
check_port_service 8081 "llama-decision" "llama-decision"
check_port_service 8082 "llama-embed" "llama-embed"
check_port_service 3001 "Langfuse Web" "sosho-langfuse-web-1"
check_port_service 8021 "YuE2 Gateway" "yue2-gateway"
check_port_service 3000 "Sosho Studio UI" ""
check_port_service 4101 "Sosho Studio API" ""

# 5. Disk Space for Models
echo "5. Checking Disk Space for Models..."
MODELS_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models"
mkdir -p "$MODELS_DIR"
FREE_GB="$(df -BG "$MODELS_DIR" | awk 'NR==2 {gsub("G",""); print $4}')"
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -lt 30 ] 2>/dev/null; then
    warn "Low disk space in $MODELS_DIR ($FREE_GB GB available). Models require ~25-35 GB."
else
    pass "Sufficient disk space available (${FREE_GB:-unknown} GB free in $MODELS_DIR)"
fi

# 6. Local CLI tool installation check
echo "6. Checking CLI Tool Installation..."
if command -v pi >/dev/null 2>&1 || [ -x "$HOME/.local/bin/pi" ]; then
    pass "Global 'pi' binary is installed at $(command -v pi 2>/dev/null || echo "$HOME/.local/bin/pi")"
else
    warn "'pi' binary not found in PATH. Run 'make install-cli' to install."
fi
if command -v yue2-music >/dev/null 2>&1 || [ -x "$HOME/.local/bin/yue2-music" ]; then
    pass "Global 'yue2-music' binary is installed at $(command -v yue2-music 2>/dev/null || echo "$HOME/.local/bin/yue2-music")"
else
    warn "'yue2-music' binary not found in PATH. Run 'make install-cli' to install."
fi

echo "-----------------------------------"
if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "Diagnostics complete with $FAIL_COUNT failure(s)."
    exit 1
fi
echo "Diagnostics complete. All checks passed."
