#!/usr/bin/env bash
# ==============================================================================
# Sosho Hardware Auto-Tuner & Performance Optimizer
# Dynamically benchmarks and detects CPU topology, VRAM, and RAM to configure
# optimal llama.cpp inference, KV cache, and micro-batch settings into .env.
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "⚡ Running Sosho Hardware Auto-Tuner..."
echo "--------------------------------------------------------"

# 1. Detect User ID & Group ID
USER_UID="$(id -u)"
USER_GID="$(id -g)"

# 2. Detect CPU Topology
TOTAL_LOGICAL_CPUS="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 8)"
PHYSICAL_CORES="$(lscpu -p=CORE 2>/dev/null | grep -v '^#' | sort -u | wc -l 2>/dev/null || echo "$TOTAL_LOGICAL_CPUS")"

# Check for Hybrid CPU (Intel Performance / Efficiency cores)
P_CORES=0
E_CORES=0
P_CORE_MASK=""
HAS_HYBRID=0

if [ -d "/sys/devices/system/cpu/cpu0/cpufreq" ]; then
    # Group CPUs by max frequency
    MAX_FREQ="$(cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq 2>/dev/null | sort -nr | head -n 1 || echo 0)"
    MIN_TOP_FREQ="$(cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq 2>/dev/null | sort -nr | tail -n 1 || echo 0)"
    
    if [ "$MAX_FREQ" -gt 0 ] && [ "$MIN_TOP_FREQ" -gt 0 ] && [ "$MAX_FREQ" != "$MIN_TOP_FREQ" ]; then
        HAS_HYBRID=1
        # Build bitmask for P-cores (CPUs with the higher frequency)
        MASK_VAL=0
        CPU_INDEX=0
        for f in /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq; do
            FREQ="$(cat "$f" 2>/dev/null || echo 0)"
            if [ "$FREQ" -eq "$MAX_FREQ" ]; then
                MASK_VAL=$(( MASK_VAL | (1 << CPU_INDEX) ))
                P_CORES=$(( P_CORES + 1 ))
            else
                E_CORES=$(( E_CORES + 1 ))
            fi
            CPU_INDEX=$(( CPU_INDEX + 1 ))
        done
        P_CORE_MASK="$(printf "0x%x" "$MASK_VAL")"
    fi
fi

if [ "$HAS_HYBRID" -eq 1 ]; then
    echo "• CPU Architecture: Hybrid Intel detected ($P_CORES P-cores @ boost, $E_CORES E-cores)"
    echo "  -> P-Core Affinity Mask: $P_CORE_MASK"
    # For generation, use physical P-cores count
    LLM_THREADS="$(( P_CORES / 2 ))"
    [ "$LLM_THREADS" -lt 4 ] && LLM_THREADS="$P_CORES"
    # For batch processing, use all physical cores
    LLM_THREADS_BATCH="$PHYSICAL_CORES"
else
    echo "• CPU Architecture: Symmetric ($PHYSICAL_CORES physical cores, $TOTAL_LOGICAL_CPUS logical threads)"
    if [ "$PHYSICAL_CORES" -le 4 ]; then
        LLM_THREADS="$PHYSICAL_CORES"
        LLM_THREADS_BATCH="$PHYSICAL_CORES"
    elif [ "$PHYSICAL_CORES" -le 8 ]; then
        LLM_THREADS="$(( PHYSICAL_CORES - 1 ))"
        LLM_THREADS_BATCH="$PHYSICAL_CORES"
    else
        LLM_THREADS="$(( PHYSICAL_CORES - 2 ))"
        LLM_THREADS_BATCH="$PHYSICAL_CORES"
    fi
fi

# 3. Detect RAM
TOTAL_RAM_KB="$(grep MemTotal /proc/meminfo | awk '{print $2}' || echo 16000000)"
TOTAL_RAM_GB=$(( TOTAL_RAM_KB / 1024 / 1024 ))
echo "• System RAM: ${TOTAL_RAM_GB} GB detected"

# 4. Detect GPU and VRAM
TOTAL_VRAM_MB=0
GPU_NAME="Unknown"

if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1 || echo "NVIDIA GPU")"
    TOTAL_VRAM_MB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 || echo 0)"
    echo "• GPU Detected: $GPU_NAME (${TOTAL_VRAM_MB} MiB VRAM)"
else
    echo "• No NVIDIA GPU detected (CPU mode)"
fi

# 5. Calculate Optimal Context Window & KV Cache
# Rules:
# - Under 8GB VRAM: CTX=16384, KV=q4_0 (leaves VRAM for model layers)
# - 8GB - 12GB VRAM (e.g. 3060Ti, 3070Ti): CTX=32768, KV=q4_0
# - 16GB - 24GB VRAM (e.g. 3090, 4090): CTX=65536, KV=q8_0
# - 24GB+ VRAM: CTX=65536, KV=f16
if [ "$TOTAL_VRAM_MB" -ge 22000 ]; then
    OPTIMAL_CTX=65536
    OPTIMAL_KV="q8_0"
    UBATCH=2048
    BATCH=4096
elif [ "$TOTAL_VRAM_MB" -ge 15000 ]; then
    OPTIMAL_CTX=65536
    OPTIMAL_KV="q8_0"
    UBATCH=1024
    BATCH=2048
elif [ "$TOTAL_VRAM_MB" -ge 7500 ]; then
    OPTIMAL_CTX=32768
    OPTIMAL_KV="q4_0"
    UBATCH=1024
    BATCH=2048
else
    OPTIMAL_CTX=16384
    OPTIMAL_KV="q4_0"
    UBATCH=512
    BATCH=1024
fi

# If RAM is large (>= 40 GB), enable mlock to lock weights
USE_MLOCK="false"
if [ "$TOTAL_RAM_GB" -ge 40 ]; then
    USE_MLOCK="true"
    echo "• High RAM detected (${TOTAL_RAM_GB} GB) -> Enabling RAM model locking (--mlock)"
fi

echo "--------------------------------------------------------"
echo "Calculated Max-Performance Parameters:"
echo "  • LLM_THREADS (generation)   : $LLM_THREADS"
echo "  • LLM_THREADS_BATCH (caching): $LLM_THREADS_BATCH"
echo "  • LLM_CTX_SIZE               : $OPTIMAL_CTX tokens"
echo "  • LLM_KV_CACHE_TYPE          : $OPTIMAL_KV"
echo "  • Batch / Micro-batch Size   : $BATCH / $UBATCH"
echo "  • RAM Lock (mlock)           : $USE_MLOCK"
if [ -n "$P_CORE_MASK" ]; then
    echo "  • P-Core Affinity Mask       : $P_CORE_MASK"
fi
echo "--------------------------------------------------------"

# 6. Write or Update .env
ENV_FILE=".env"
cat << EOF > "$ENV_FILE"
# ==============================================================================
# Auto-generated by bin/autotune.sh on $(date)
# Hardware: $GPU_NAME (${TOTAL_VRAM_MB}MB VRAM) | ${TOTAL_RAM_GB}GB RAM | ${TOTAL_LOGICAL_CPUS} CPU Threads
# ==============================================================================
UID=$USER_UID
GID=$USER_GID

# CPU Execution Threads
LLM_THREADS=$LLM_THREADS
LLM_THREADS_BATCH=$LLM_THREADS_BATCH

# Context Window & Memory
LLM_CTX_SIZE=$OPTIMAL_CTX
LLM_KV_CACHE_TYPE=$OPTIMAL_KV
LLM_UBATCH=$UBATCH
LLM_BATCH=$BATCH
LLM_MLOCK=$USE_MLOCK
LLM_CPU_MASK=${P_CORE_MASK:-0x0}

# Observability
LANGFUSE_BASE_URL=http://127.0.0.1:3000
LANGFUSE_PUBLIC_KEY=pk-lf-local-pi
LANGFUSE_SECRET_KEY=sk-lf-local-pi

# Music engine integration
YUE2_STOP_LLAMA=true
YUE2_LLAMA_CONTAINER=llama-cpp
EOF

echo "✅ Saved hardware-tailored configuration to $ENV_FILE"
echo "To apply changes to running containers, run: make restart"
