<div align="center">

<img src="./assets/logo.png" alt="Sosho Logo" width="160" style="border-radius: 24px; margin-bottom: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);" />


# Sosho (祖書)

**The unified, privacy-first local AI studio & autonomous agent workspace.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Compose v2](https://img.shields.io/badge/Docker%20Compose-v2.0+-2496ED?logo=docker&logoColor=white)](compose.yaml)
[![CUDA Accelerated](https://img.shields.io/badge/CUDA-NVIDIA%20GPU-76B900?logo=nvidia&logoColor=white)](bin/doctor.sh)
[![llama.cpp Powered](https://img.shields.io/badge/Inference-llama.cpp-orange)](compose.yaml)
[![Model: Refusal--Free](https://img.shields.io/badge/Model-Refusal--Free%20MoE-red)](compose.yaml)
[![Observability: Langfuse](https://img.shields.io/badge/Telemetry-Langfuse%20v4-black)](docker/compose.langfuse.yaml)

---

</div>

## 💡 What Can You Do with Sosho?

Sosho turns consumer or workstation GPUs into a full-fledged local AI lab without cloud lock-in, artificial censorship, recurring API bills, or data leakage.

<table>
<tr>
<td width="50%" valign="top">

### 💻 1. Autonomous Coding from Any Terminal
Run state-of-the-art coding agents in any project directory with a single word: `pi`.
- **Works Everywhere**: Navigate to any git repository and run `pi`—mounts cleanly into a sandboxed container.
- **Git & Tool Aware**: Inherits host git identity, shell environment, and project context without manual setup.
- **Zero API Bills**: Offloads reasoning and code editing to local MoE LLMs (`Qwen3.6-35B-A3B`) with zero telemetry leakage.

</td>
<td width="50%" valign="top">

### 🔓 2. Refusal-Free AI & Security Research
Powered by an aggressively uncensored MoE model (`Qwen3.6-35B-A3B`) that never refuses prompts:
- **Zero Preachy Refusals**: Never declines, hedges, or lectures—executes all complex technical and creative instructions directly.
- **Red-Teaming & SecOps**: Unrestricted exploit analysis, malware reversing, vulnerability reproduction, and pentest payload synthesis.
- **Raw Analysis & Forensics**: Deep system diagnostics, memory inspection, and unfiltered creative/lyric writing.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🛠️ 3. Uncensored Agent Skills & MCP Ecosystem
Combines raw, unconstrained intelligence with Pi's extensible tooling stack:
- **MCP Servers Out of the Box**: Connects to Model Context Protocol servers (e.g., `graphify` knowledge graphs, filesystem tools, custom APIs).
- **Custom Skills & Subagents**: Leverage on-demand skills (live web browsing via `dokobot`, multi-file refactoring, autonomous subagent delegation).
- **Unrestricted Tool Execution**: Because the model has zero refusals, your agent runs scripts, tests security vectors, and solves edge-case bugs without false-positive safety halts.

</td>
<td width="50%" valign="top">

### 🎵 4. Full-Track Local AI Music Synthesis
Compose studio-quality music with lyrics, vocals, and musical accompaniment locally via **YuE2-3B**:
- **Natural Language Styles**: Generate tracks in any genre (lo-fi, indie acoustic, synthwave, metal).
- **Vocal & Instrumental Fusion**: Synthesize rich vocals matched with complete instrumentation.
- **Score & FLAC Output**: Emits lossless audio plus musical lead sheets (`.abc`) for live editing and playback.

</td>
</tr>
<tr>
<td colspan="2" valign="top">

### 🎛 5. Smart VRAM Orchestration & Observability (Zero OOM)
Run both a massive 35B MoE LLM and an audio generation engine on a single GPU.
- **Dynamic Handshake**: Submitting a music job seamlessly pauses `llama.cpp` to free GPU memory, auto-resuming once audio generation finishes.
- **Full Langfuse v4 Tracing**: Production-grade local telemetry at `localhost:3000` recording every agent thought, tool execution, latency, and token throughput.

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

### 2. Auto-Tune Hardware & Install CLI
```bash
make autotune      # Benchmarks CPU/GPU/RAM and auto-generates optimal .env
make install-cli   # Links global CLI launchers into ~/.local/bin
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
- **MCP Servers & Tool Extensions**: Built-in integration with Model Context Protocol servers (such as `graphify` for automated code knowledge graph extraction) and project tools.
- **Agent Skills & Subagents**: Automatic discovery of modular skills (`dokobot` for local headless/interactive browser lookups, code refactoring recipes, autonomous subagent delegation).
- **Uncensored Execution**: Zero refusal friction—the agent faithfully investigates low-level system internals, security bugs, and sensitive edge-case behaviors without hallucinating policy warnings.
- **Skip Warmup**: `pi --no-warmup` (bypasses initial server probe).
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
make autotune      # Auto-benchmark & generate max-performance .env
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
| `LLM_THREADS` | `14` | Dedicated CPU threads for MoE matrix operations |
| `LLM_THREADS_BATCH` | `14` | Dedicated CPU threads for prompt ingestion & KV cache generation |
| `LLM_CTX_SIZE` | `32768` | Optimized context window to keep KV cache compact & fast |
| `LLM_KV_CACHE_TYPE` | `q4_0` | KV cache precision (`q4_0`, `q8_0`, `f16`) for 2x memory throughput |
| `YUE2_STOP_LLAMA` | `true` | Automatically pause LLM during music generation to prevent OOM |
| `LANGFUSE_BASE_URL`| `http://127.0.0.1:3000` | Target telemetry endpoint for agent traces |

---

<div align="center">
  <sub>Built for private, high-performance local AI engineering.</sub>
</div>
