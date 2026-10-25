<div align="center">

<img src="./assets/logo.png" alt="Sosho Logo" width="160" style="border-radius: 24px; margin-bottom: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);" />

# Sosho (祖書)

**The unified, privacy-first local AI studio & autonomous agent workspace.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Compose v2](https://img.shields.io/badge/Docker%20Compose-v2.0+-2496ED?logo=docker&logoColor=white)](compose.yaml)
[![CUDA Accelerated](https://img.shields.io/badge/CUDA-NVIDIA%20GPU-76B900?logo=nvidia&logoColor=white)](bin/doctor.sh)
[![llama.cpp Powered](https://img.shields.io/badge/Inference-llama.cpp-orange)](compose.yaml)
[![Observability: Langfuse](https://img.shields.io/badge/Telemetry-Langfuse%20v4-black)](docker/compose.langfuse.yaml)

---

</div>

## 💡 What Can You Do with Sosho?

Sosho turns consumer or workstation GPUs into a full-fledged local AI lab without cloud lock-in, recurring API bills, or data leakage.

<table>
<tr>
<td width="50%" valign="top">

### 💻 1. Autonomous Coding from Any Terminal
Run state-of-the-art coding agents in any project directory with a single word: `pi`.
- **Works Everywhere**: Navigate to any git repository and run `pi`—it mounts cleanly into a sandboxed container.
- **Git & Tool Aware**: Automatically carries your host git identity, bash environment, and shared MCP tools.
- **Zero API Bills**: Offloads reasoning and code editing to local MoE LLMs (`Qwen3.6-35B-A3B`) with zero telemetry leakage.

</td>
<td width="50%" valign="top">

### 🎵 2. Full-Track Local AI Music Synthesis
Compose studio-quality music with lyrics, vocals, and musical accompaniment locally via **YuE2-3B**:
- **Natural Language Styles**: Generate tracks in any genre (lo-fi, indie acoustic, synthwave, metal).
- **Vocal & Instrumental Fusion**: Synthesize rich vocals matched with complete instrumentation.
- **Score & FLAC Output**: Emits lossless audio plus musical lead sheets (`.abc`) for live editing and playback.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🎛 3. Smart VRAM Orchestration (Zero OOM)
Run both a massive coding LLM and an audio generation pipeline on a single GPU.
- **Dynamic Handshake**: Submitting a music job seamlessly pauses the `llama.cpp` container to reclaim GPU memory.
- **Auto-Resume**: As soon as audio rendering finishes, your LLM wakes up and resumes instant responses.

</td>
<td width="50%" valign="top">

### 📊 4. Deep Agent Tracing & Observability
Self-hosted, production-grade telemetry for every model generation and agent task.
- **Langfuse v4 Dashboard**: Trace agent tool calls, prompt iterations, latency, and token throughput at `localhost:3000`.
- **Zero Configuration**: Comes pre-wired with Postgres, ClickHouse, and MinIO out of the box.

</td>
</tr>
</table>

---

## ⚡ Quick Start (30 Seconds)

### 1. Check Hardware & Dependencies
Sosho includes a built-in diagnostic suite that tests GPU capabilities, drivers, port availability, and container runtimes:
```bash
git clone https://github.com/theonesud/sosho.git && cd sosho
make doctor
```

### 2. Configure Environment & Install CLI
```bash
cp .env.example .env
make install-cli
```
> **Tip**: This links `pi` and `yue2-music` into your `~/.local/bin` so you can call them from anywhere.

### 3. Launch Services
```bash
make up
```
*✨ Done! The model downloader auto-provisions weights on first boot, spinning up `llama.cpp` (`:8080`) and Langfuse (`:3000`).*

---

## 🚀 Interactive Workflows

<details open>
<summary><b>🛠️ Workflow A: Terminal Coding Agent (<code>pi</code>)</b></summary>
<br>

Invoke `pi` inside **any directory or code repository**:
```bash
cd ~/projects/my-app
pi
```
- **Skip warmup**: `pi --no-warmup` (bypasses initial server probe)
- **Hybrid APIs**: Drop a `.env` with `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in any folder to temporarily route queries to cloud models.
</details>

<details>
<summary><b>🎼 Workflow B: Music & Vocal Generation (<code>YuE2</code>)</b></summary>
<br>

1. **Activate the music engine**:
   ```bash
   make music-up
   ```
2. **Synthesize a track**:
   ```bash
   bin/yue2-generate.sh \
     --style "acoustic indie folk, emotive female vocals, warm acoustic guitar" \
     --lyrics "[Verse]\nMorning sun hits the glass...\n[Chorus]\nFly away..." \
     --out "song.flac" \
     --score-out "score.abc"
   ```
3. **Monitor progress**: `make logs-music`
</details>

<details>
<summary><b>📈 Workflow C: Real-Time Tracing (Langfuse)</b></summary>
<br>

Open **[http://127.0.0.1:3000](http://127.0.0.1:3000)** in your browser:
- **Default Login**: `admin@local.dev` / `password123`
- **Pre-configured Project**: `Pi-Agent`
- *To run a session without tracing*: `LANGFUSE_TRACING_ENABLED=false pi`
</details>

---

## 🏛️ Tech Stack & Architecture

```
                          Host Terminal & Global CLI
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
             pi (pi-sandbox)                  yue2-music (CLI)
                    │                                   │
       OpenAI API   │                                   │  Async Jobs
       :8080        ▼                                   ▼  :8021
             ┌──────────────┐   VRAM Handshake    ┌────────────────┐
             │  llama.cpp   │◄................... │  YuE2 Gateway  │
             │ (MoE / GGUF) │  (Pause / Resume)   │  (FastAPI/WAL) │
             └──────┬───────┘                     └───────┬────────┘
                    │                                     │
          Telemetry │ :3000                               ▼
                    ▼                             ┌────────────────┐
             ┌──────────────┐                     │  YuE2 Engine   │
             │   Langfuse   │                     │  (audio.cpp)   │
             │  (ClickHouse)│                     └────────────────┘
             └──────────────┘
```

| Layer | Technology | Key Capabilities |
|---|---|---|
| **Inference Engine** | [llama.cpp](https://github.com/ggerganov/llama.cpp) | CUDA-accelerated MoE GGUF execution, KV cache quantization (`q8_0`/`q4_0`), low-latency C++ server |
| **Agent Environment** | [Pi Agent](docker/Dockerfile.pi) | Ephemeral Docker sandbox, host git pass-through, centralized cache (`~/.local/share/sosho`) |
| **Audio Engine** | [YuE2](yue2/server.json) + `audio.cpp` | Full-song vocal/instrumental synthesis, ABC notation generation, asynchronous queue |
| **Observability** | [Langfuse v4](docker/compose.langfuse.yaml) | ClickHouse analytical store, token tracking, tool latency tracing, session replay |
| **Orchestration** | Docker Compose v2 + Make | Localhost (`127.0.0.1`) security isolation, VRAM coordination handshake |

---

## 🧰 Make Commands

Sosho uses a streamlined `Makefile` for zero-friction control:

```bash
# Core Lifecycle
make up            # Start llama.cpp inference + Langfuse stack
make down          # Stop all containers across all profiles
make status        # Inspect health status and ports
make restart       # Quick restart of LLM inference service

# Music Engine (YuE2)
make music-up      # Boot YuE2 async gateway & audio engine
make music-down    # Teardown music services to reclaim RAM

# Diagnostics & Logs
make doctor        # Run hardware, GPU, driver & port diagnostics
make test          # Execute automated integration & unit tests
make logs-llm      # Stream llama.cpp logs
make logs-music    # Stream YuE2 generation logs
make logs-langfuse # Stream telemetry logs

# Tooling
make install-cli   # Symlink global CLI launchers into ~/.local/bin
make clean-cache   # Flush stale agent cache & sessions
```

---

## ⚙️ Key Configuration Options

Configure options via `.env` without modifying compose files:

| Variable | Default | Description |
|---|---|---|
| `LLM_THREADS` | `8` | Dedicated CPU threads for MoE matrix operations |
| `LLM_CTX_SIZE` | `65536` | Inference context window (tokens) |
| `LLM_KV_CACHE_TYPE` | `q8_0` | KV cache precision (`q8_0`, `q4_0`, `f16`) |
| `YUE2_STOP_LLAMA` | `true` | Automatically pause LLM during music generation to prevent OOM |
| `LANGFUSE_BASE_URL`| `http://127.0.0.1:3000` | Target telemetry endpoint for agent traces |

---

<div align="center">
  <sub>Built for private, high-performance local AI engineering.</sub>
</div>
