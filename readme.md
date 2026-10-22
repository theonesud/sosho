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

### 1. Start the llama.cpp Server
From this repo (`sosho`):
```bash
docker compose up -d
```
- On the first run, the `model-download` service automatically downloads the GGUF weights into `./models` and exits.
- Then `llama-cpp` boots up with GPU acceleration at `http://127.0.0.1:8080/v1`.
- View logs: `docker compose logs -f llama-cpp`

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

## Customization
Add any custom skills, prompts, or MCP servers to `.pi/` or `.agents/` in this repo or directly in your target workspaces.

