# Sosho

A lightweight containerized local AI workspace powered by **llama.cpp** and **Pi Coding Agent**.

---

## Initial Setup (New Machine)

### 1. Prerequisites
- Docker & Docker Compose (v2) with NVIDIA Container Toolkit (`--gpus all` support)
- Bash, Git, and `~/.local/bin` added to your `$PATH`

### 2. Configure Environment
Copy the example env file and adjust if necessary (UID/GID and threads):
```bash
cp .env.example .env
```
*(Optionally auto-fill values: `printf "UID=%s\nGID=%s\nLLM_THREADS=%s\n" $(id -u) $(id -g) $(( $(lscpu -b -p=Core,Socket | grep -v '^#' | sort -u | wc -l) - 2 )) >> .env`)*

### 3. Install Global `pi` Launcher
Install the global launcher to your `~/.local/bin` so you can run `pi` from any folder on your machine:
```bash
make install-cli
# Or manually:
cp bin/pi-launcher.sh ~/.local/bin/pi
chmod +x ~/.local/bin/pi
```

---

## Usage

### 1. Start llama.cpp Server and Langfuse Stack
From this repo (`sosho`):
```bash
make up
# Or: docker compose up -d
```
- On the first run, the `model-download` service automatically downloads the GGUF weights into `./models` and exits.
- `llama-cpp` boots up with GPU acceleration at `http://127.0.0.1:8080/v1`.
- The **Langfuse v4 stack** boots up alongside it at `http://localhost:3000`.
- View logs: `make logs-llm` or `make logs-langfuse`

### 2. Run Pi Agent (From Anywhere)
You can now run `pi` in **any** workspace or directory on your system:
```bash
cd /path/to/any-project
pi
```
- **Local Model (Default)**: Automatically uses the centralized `llama-cpp` model from this repo without re-downloading or creating any `models` folder in your project.
- **Custom / Online Models**: If your project has its own `.pi/models.json` or `.env` with API keys (OpenAI, Anthropic, OpenRouter, Groq, etc.), it will automatically use those instead.
- Extra arguments are forwarded directly (e.g. `pi -p "explain this codebase"`).

---

## Music Generation (YuE2)

YuE2-3B local music generation stack runs via CUDA with automated VRAM coordination (pauses `llama-cpp` during inference and resumes it automatically).

### 1. Start YuE2 Stack
```bash
make music-up
# Or: docker compose --profile music up -d
```

### 2. Generate Songs
```bash
bin/yue2-generate.sh --style "acoustic indie folk, emotive female vocals" \
                     --lyrics "[Verse]\nMorning sun through the glass...\n[Chorus]\nFly away..." \
                     --out "folk_song.flac"
```

---

## Observability (Langfuse)

A lightweight self-hosted Langfuse v4 stack (Web UI, Worker, ClickHouse, MinIO, Postgres, Redis) is included with headless zero-click initialization.

### 1. Start Langfuse Stack
```bash
docker compose -f docker/compose.langfuse.yaml up -d
```
- Web UI: [http://localhost:3000](http://localhost:3000)
- Pre-seeded Admin: `admin@local.dev` / `password123`
- Pre-seeded Project: `Pi-Agent` (`pk-lf-local-pi` / `sk-lf-local-pi`)

### 2. Tracing Pi Agent
Tracing is enabled by default in `bin/pi-launcher.sh` and `compose.yaml` pointing to `http://127.0.0.1:3000`. Every prompt, turn, tool invocation, token count, and reasoning block will automatically stream to Langfuse.

To temporarily disable tracing for a session:
```bash
LANGFUSE_TRACING_ENABLED=false pi
```

To skip the pre-warm check:
```bash
pi --no-warmup
# Or via environment variable:
PI_SKIP_WARMUP=1 pi
```

---

---

## Diagnostics & Health
Run system diagnostics to check Docker, NVIDIA Container Toolkit, ports, disk space, and CLI tools:
```bash
make doctor
```

---

## Make Commands Reference
- `make doctor`: Run system health & hardware diagnostics
- `make test`: Run integration and unit test suite
- `make up`: Start `llama-cpp` and Langfuse stack
- `make music-up`: Start YuE2 music services
- `make down`: Stop all running containers
- `make restart`: Restart `llama-cpp` inference server
- `make status`: View running container health and status
- `make logs-llm`: View `llama-cpp` streaming logs
- `make logs-music`: View `yue2-engine` and gateway logs
- `make logs-langfuse`: View Langfuse stack logs
- `make clean-cache`: Clear local agent cache and temporary logs
- `make prune`: Clean dangling Docker images and containers
- `make install-cli`: Symlink/copy `pi` and `yue2-music` to `~/.local/bin`

---

## Repository Structure
```
sosho/
├── bin/                          # CLI scripts and launchers
│   ├── doctor.sh                 # System and hardware diagnostic script
│   ├── pi-launcher.sh            # Global Pi CLI launcher (Docker-backed)
│   └── yue2-generate.sh          # Music generation CLI
├── docker/                       # Container definitions & compose sub-stacks
│   ├── compose.langfuse.yaml     # Self-hosted Langfuse v4 stack
│   ├── Dockerfile.pi             # Pi agent execution sandbox
│   └── Dockerfile.yue2-gateway   # YuE2 async job gateway
├── tests/                        # Automated test suite
├── yue2/                         # Audio engine assets & gateway application
│   ├── gateway/                  # FastAPI async job server
│   │   ├── app.py
│   │   └── requirements.txt
│   └── server.json               # audio.cpp CUDA engine configuration
├── compose.yaml                  # Root Compose entrypoint (llama-cpp + langfuse include)
├── Makefile                      # Standard task runner
└── .env.example                  # Environment configuration template
```

---

## Customization
Add any custom skills, prompts, or MCP servers to `.pi/` or `.agents/` in this repo or directly in your target workspaces.


