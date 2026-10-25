# Sosho (祖書)

> **High-performance, containerized local AI workspace powered by llama.cpp, Pi Coding Agent, YuE2 Audio Generation, and Langfuse Observability.**

Sosho provides a production-grade local AI engineering environment with automated VRAM orchestration, hardware self-diagnostics, centralized agent caching, and zero-configuration telemetry.

---

## 📑 Table of Contents
- [Architecture Overview](#-architecture-overview)
- [Quick Start](#-quick-start)
  - [Prerequisites](#1-prerequisites)
  - [Hardware Diagnostic (`make doctor`)](#2-run-system-diagnostics)
  - [Environment Setup](#3-configure-environment)
  - [Install Global CLI Launchers](#4-install-global-cli-launchers)
- [Daily Workflows](#-daily-workflows)
  - [1. Starting the Core LLM & Telemetry Stack](#1-start-the-core-llm--telemetry-stack)
  - [2. Running the Pi Coding Agent](#2-run-pi-agent-from-anywhere)
  - [3. Local Music Generation (YuE2-3B)](#3-music-generation-yue2-3b)
  - [4. Observability & Tracing (Langfuse)](#4-observability--tracing-langfuse)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Make Commands Cheatsheet](#-make-commands-cheatsheet)
- [Repository Structure](#-repository-structure)
- [Configuration Reference](#-configuration-reference)

---

## 🏛 Architecture Overview

```
                      +---------------------------------------+
                      |         Host Machine / Terminal       |
                      |  • pi (bin/pi-launcher.sh)            |
                      |  • yue2-music (bin/yue2-generate.sh)  |
                      |  • make doctor / make test            |
                      +-------------------+-------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
        v                                 v                                 v
+------------------+             +------------------+             +------------------+
|    Pi Agent      |             |    llama.cpp     |             |   YuE2 Gateway   |
|   (pi-sandbox)   |             | (Qwen3.6-35B-A3B)|             |  (CUDA / Audio)  |
|                  |             |                  |             |                  |
| • Sandboxed node |  HTTP :8080 | • GPU / CPU MoE  | Handshake   | • Async Job API  |
| • Shared venv    +------------>+ • 127.0.0.1 bound|  via socket | • VRAM Manager   |
| • Host gitconfig |             | • Healthchecked  |<............+ • Pauses LLM     |
+--------+---------+             +------------------+             +--------+---------+
         |                                                                 |
         | Telemetry :3000                                                 v
         v                                                        +------------------+
+-------------------------------------------------------+         |   YuE2 Engine    |
| Langfuse v4 Stack (docker/compose.langfuse.yaml)      |         |   (audio.cpp)    |
| • Web UI (127.0.0.1:3000)   • Worker                  |         +------------------+
| • PostgreSQL • ClickHouse • MinIO • Redis             |
+-------------------------------------------------------+
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Linux (x86_64)**
- **Docker & Docker Compose (v2)**
- **NVIDIA GPU** with **NVIDIA Container Toolkit** (`--gpus all` working)
- **Bash**, **Git**, and `~/.local/bin` added to your `$PATH`

### 2. Run System Diagnostics
Before booting containers, verify your GPU drivers, container runtime, available ports, and disk space:
```bash
make doctor
```

### 3. Configure Environment
Copy and customize `.env`:
```bash
cp .env.example .env
```
*(Tip: Set `LLM_THREADS` to physical CPU cores minus 2, and tune `LLM_CTX_SIZE` / `LLM_KV_CACHE_TYPE` based on available GPU VRAM).*

### 4. Install Global CLI Launchers
Install `pi` and `yue2-music` directly into `~/.local/bin`:
```bash
make install-cli
```

---

## 💻 Daily Workflows

### 1. Start the Core LLM & Telemetry Stack
From the `sosho` directory:
```bash
make up
```
- **Automated GGUF Download**: On first launch, the `model-download` job fetches weights into `./models` and exits.
- **llama.cpp Server**: Starts GPU-accelerated inference at `http://127.0.0.1:8080/v1`.
- **Langfuse Stack**: Starts the full telemetry stack at `http://127.0.0.1:3000`.
- **Logs**:
  ```bash
  make logs-llm        # Stream llama.cpp logs
  make logs-langfuse   # Stream Langfuse logs
  ```

---

### 2. Run Pi Agent (From Anywhere)
Run `pi` in **any directory or Git repository** on your system:
```bash
cd /path/to/any-project
pi
```

#### Key Capabilities:
- **Zero Duplication**: Shared tools and Python environments (e.g., Graphify MCP) are cached centrally in `~/.local/share/sosho/`, preventing disk bloat.
- **Host Git Integration**: Automatically mounts host `~/.gitconfig` into the sandbox so commits retain your name and email.
- **Warmup Control**:
  ```bash
  # Skip the model pre-warm test if the server is already active:
  pi --no-warmup

  # Or via environment variable:
  PI_SKIP_WARMUP=1 pi
  ```
- **Online / API Key Models**: Place a `.pi/models.json` or `.env` (with `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) in any project to automatically override the local LLM.

---

### 3. Music Generation (YuE2-3B)
YuE2 generates complete songs (vocals + instrumentals) from lyrics and musical styles.

#### 1. Start the Music Stack
```bash
make music-up
```
*(Uses Docker Compose profile `music`. The gateway manages VRAM by automatically pausing `llama-cpp` during synthesis and resuming it once finished).*

#### 2. Submit a Generation Job
```bash
bin/yue2-generate.sh \
  --style "acoustic indie folk, emotive female vocals, warm acoustic guitar" \
  --lyrics "[Verse]\nMorning sun hits the glass...\n[Chorus]\nFly away..." \
  --out "song.flac" \
  --score-out "score.abc"
```

#### 3. Monitor Music Engine
```bash
make logs-music
```

---

### 4. Observability & Tracing (Langfuse)
Every prompt, tool execution, reasoning step, and token count from `pi` automatically logs to Langfuse.

- **Web Dashboard**: [http://127.0.0.1:3000](http://127.0.0.1:3000)
- **Pre-seeded Admin**: `admin@local.dev` / `password123`
- **Pre-seeded Project**: `Pi-Agent` (`pk-lf-local-pi` / `sk-lf-local-pi`)

To temporarily disable tracing for a session:
```bash
LANGFUSE_TRACING_ENABLED=false pi
```

---

## 🧪 Testing & Quality Assurance

Run the comprehensive test suite:
```bash
make test
```
The test runner validates:
1. **Shell Script Integrity**: Syntax checking across all `bin/*.sh` scripts.
2. **Container Security & Networking**: Verifies `127.0.0.1` localhost binding for `llama.cpp` and `langfuse-web`.
3. **Healthcheck Contracts**: Validates `llama-cpp` service healthcheck definitions.
4. **Gateway Unit Tests**: Verifies SQLite WAL mode, `busy_timeout` handling, and ABC musical score decoding.
5. **Launcher Argument Parsing**: Tests flag filtering (`--no-warmup`).

---

## 🛠 Make Commands Cheatsheet

| Command | Action |
|---|---|
| `make up` | Start core stack (`llama-cpp` + Langfuse) |
| `make down` | Stop all running containers across all profiles |
| `make status` | View container status and healthcheck states |
| `make restart` | Restart the `llama-cpp` inference service |
| `make doctor` | Run hardware and environment self-diagnostics |
| `make test` | Run the full test suite |
| `make music-up` | Start YuE2 music generation engine and async gateway |
| `make music-down` | Stop YuE2 music containers |
| `make logs-llm` | Tail streaming logs from `llama-cpp` |
| `make logs-music` | Tail streaming logs from `yue2-gateway` and `yue2-engine` |
| `make logs-langfuse`| Tail streaming logs from Langfuse services |
| `make install-cli` | Install `pi` and `yue2-music` into `~/.local/bin` |
| `make clean-cache` | Clear temporary cache and session history in `.pi` |
| `make prune` | Remove unused Docker containers and images |

---

## 📂 Repository Structure

```
sosho/
├── bin/                          # CLI scripts and launchers
│   ├── doctor.sh                 # Hardware and environment healthcheck
│   ├── pi-launcher.sh            # Global Pi CLI launcher (Docker-backed)
│   └── yue2-generate.sh          # Music generation CLI
├── docker/                       # Subsystem configurations & Dockerfiles
│   ├── compose.langfuse.yaml     # Self-hosted Langfuse v4 stack
│   ├── Dockerfile.pi             # Pi coding agent container sandbox
│   └── Dockerfile.yue2-gateway   # YuE2 async job gateway
├── tests/                        # Automated test suite
│   ├── run_tests.sh              # Test runner
│   └── test_gateway.py           # Unit tests for gateway logic
├── yue2/                         # Audio engine assets & gateway application
│   ├── gateway/                  # FastAPI async job server
│   │   ├── app.py                # Job queue, SQLite persistence & VRAM handshake
│   │   └── requirements.txt
│   └── server.json               # audio.cpp CUDA engine configuration
├── compose.yaml                  # Root Docker Compose entrypoint
├── Makefile                      # Standardized project task runner
├── readme.md                     # Project documentation
└── .env.example                  # Environment configuration template
```

---

## ⚙️ Configuration Reference

Key variables configurable in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_THREADS` | `8` | Number of CPU threads dedicated to MoE computation |
| `LLM_CTX_SIZE` | `65536` | Context window size (tokens) for `llama.cpp` |
| `LLM_KV_CACHE_TYPE` | `q8_0` | Quantization for KV cache (`q8_0`, `q4_0`, `f16`) |
| `PI_SKIP_WARMUP` | `0` | Set to `1` to bypass model pre-warm on agent boot |
| `LANGFUSE_BASE_URL` | `http://127.0.0.1:3000` | Target telemetry endpoint |
| `YUE2_GATEWAY_PORT` | `8021` | Host port for YuE2 async job gateway |
| `YUE2_STOP_LLAMA` | `true` | Automatically pause `llama.cpp` during music generation to free VRAM |
