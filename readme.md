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
cp pi-launcher.sh ~/.local/bin/pi
chmod +x ~/.local/bin/pi
```

---

## Usage

### 1. Start llama.cpp Server and Langfuse Stack
From this repo (`sosho`):
```bash
docker compose up -d
```
- On the first run, the `model-download` service automatically downloads the GGUF weights into `./models` and exits.
- `llama-cpp` boots up with GPU acceleration at `http://127.0.0.1:8080/v1`.
- The **Langfuse v4 stack** boots up alongside it at `http://localhost:3000`.
- View logs: `docker compose logs -f llama-cpp` or `docker compose logs -f langfuse-web`

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

## Observability (Langfuse)

A lightweight self-hosted Langfuse v4 stack (Web UI, Worker, ClickHouse, MinIO, Postgres, Redis) is included with headless zero-click initialization.

### 1. Start Langfuse Stack
```bash
docker compose -f compose.langfuse.yaml up -d
```
- Web UI: [http://localhost:3000](http://localhost:3000)
- Pre-seeded Admin: `admin@local.dev` / `password123`
- Pre-seeded Project: `Pi-Agent` (`pk-lf-local-pi` / `sk-lf-local-pi`)

### 2. Tracing Pi Agent
Tracing is enabled by default in `pi-launcher.sh` and `compose.yaml` pointing to `http://127.0.0.1:3000`. Every prompt, turn, tool invocation, token count, and reasoning block will automatically stream to Langfuse.

To temporarily disable tracing for a session:
```bash
LANGFUSE_TRACING_ENABLED=false pi
```

---

## Customization
Add any custom skills, prompts, or MCP servers to `.pi/` or `.agents/` in this repo or directly in your target workspaces.

