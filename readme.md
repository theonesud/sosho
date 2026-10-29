<div align="center">

<img src="./assets/logo.png" alt="Sosho Logo" width="160" style="border-radius: 24px; margin-bottom: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);" />

# Sosho

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
- **Red-Teaming & SecOps**: Unrestricted exploit analysis, local device pentesting, and binary reverse engineering.
- **Raw Analysis & Forensics**: Deep system diagnostics, memory inspection, and unfiltered creative writing.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🛠️ 3. Capability-First Skills & Logged-In Web
Integrates your real authenticated Chrome session and deterministic helper scripts:
- **Authenticated Chrome Access**: Live access to your real X.com timeline/likes, GitHub stars, and YouTube playlists via Dokobot.
- **Sub-Second Media Ingestion**: Direct YouTube transcript extraction with timestamps via caption APIs.
- **Version-Pinned Docs**: Pulls modern `llms.txt` documentation for Three.js, Next.js, and FastAPI to eliminate API hallucinations.

</td>
<td width="50%" valign="top">

### 📊 4. Disk-First Persistence & Observability
Engineered to operate reliably within bounded local context windows (32K–64K):
- **Structured Persistent Workspaces**: Dedicated subdirectories in `.pi/work/` for memory, research, transcripts, and docs.
- **Full Langfuse v4 Tracing**: Local telemetry at `localhost:3000` recording token usage, latency, tool calls, and trajectories.
- **Automatic Compaction Recovery**: Checkpoint snapshots survive context truncation and compaction seamlessly.

</td>
</tr>
</table>

> *Looking for local AI music generation? YuE2 has been moved to a dedicated standalone module in [`yue2/`](yue2/README.md).*

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
make install-cli   # Links global CLI launcher into ~/.local/bin
```
> **Tip**: This links `pi` into your `~/.local/bin` so you can call it from anywhere.

### 3. Launch Services
```bash
make up
```
*✨ Done! The model downloader auto-provisions weights on first boot, spinning up `llama.cpp` (`:8080`) and Langfuse (`:3000`).*

---

## 🧰 Modular Capabilities & Skills (`.pi/skills/`)

Every capability is self-contained with its own deterministic helper scripts in `scripts/`, preventing token bloat on small context windows:

| Capability Skill | Embedded Scripts | What It Does |
|---|---|---|
| **`social-x`** | `scripts/x-harvest.sh` | Extracts X.com timeline, likes, bookmarks, and search feeds using your logged-in Chrome session. |
| **`github-scout`** | `scripts/gh-stars.sh`, `scripts/gh-analyze.sh` | Browses your starred repositories and produces feasibility & architecture briefs. |
| **`youtube-digest`**| `scripts/yt-feed.sh`, `scripts/yt-transcribe.py` | Extracts video queues and pulls full timestamped transcripts sub-second without downloading media. |
| **`libdocs`** | `scripts/pull-llms-txt.sh`, `scripts/find-doc.sh` | Downloads standardized `llms.txt` and searches API signatures to prevent version hallucinations. |
| **`data-lab`** | `scripts/eda.py`, `scripts/quick-plot.py` | Fast exploratory data analysis (<35 lines) and zero-boilerplate plotting saved to `.pi/work/plots/`. |
| **`creative-canvas`**| `scripts/preview.sh`, `scripts/kill-preview.sh` | Builds and serves Three.js 3D scenes, generative canvas art, and HTML5/Pygame simulations locally. |
| **`web-craft`** | `scripts/dev.sh`, `scripts/stop.sh`, `scripts/test-api.sh` | Background dev servers for Next.js, FastAPI, and interactive website presentations (Reveal.js). |
| **`security-lab`** | `scripts/net-probe.sh`, `scripts/bin-triage.sh` | Safe local subnet device probes, binary reverse engineering triage, and steganography scans. |
| **`lean-proofs`** | `scripts/verify.sh` | Formal theorem verification in Lean 4 with concise error reporting. |
| **`sys-admin`** | `scripts/host-status.sh` | Single-command health snapshot of CPU, RAM, disk, RTX GPU thermals, and failed systemd units. |
| **`personal-memory`**| `scripts/recall.sh` | Organic long-term memory stored in `.pi/work/memory/` for personal assistant conversations. |
| **`dokobot`** | `scripts/doko-fetch.sh` | Core web browser bridge using host Chrome with output redirection to disk. |

---

## 📁 Persistent Working Space (`.pi/work/`)

To keep the agent's context clean and prevent memory loss during auto-compaction, all outputs are written directly to structured disk directories:

```
.pi/work/
├── memory/          # Permanent user memory (life history, goals, preferences, personality)
├── research/        # Research dossiers, trend analyses, myth checks, X.com & GitHub scouts
├── transcripts/     # Full YouTube transcripts with timestamp markers & queue indices
├── docs/            # Version-pinned library references & llms.txt cheatsheets
├── plots/           # Output charts and visualizations from data-lab
├── security/        # Network probe logs and binary triage reports
├── scratch/         # One-off execution scripts and temporary tool dumps
└── state.json       # Task queue tracking & auto-compaction checkpoint recovery
```

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
- **Context-Lean Execution**: Built-in sliding-chunk inspection (`bin/chunk-read.sh`) and UNIX pipelines prevent context bloat.
- **Targeted Skills**: Modular on-demand capabilities without context-heavy agent swarms.
- **Uncensored Execution**: Zero refusal friction—the agent faithfully investigates low-level system internals, security bugs, and sensitive edge cases without hallucinating policy warnings.
- **Skip Warmup**: `pi --no-warmup` (bypasses initial server probe).
- **Hybrid APIs**: Drop a `.env` with `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in any folder to temporarily route queries to cloud models.
</details>

<details open>
<summary><b>📈 Workflow B: Real-Time Tracing (Langfuse)</b></summary>
<br>

Open **[http://127.0.0.1:3000](http://127.0.0.1:3000)** in your browser:
- **Default Login**: `admin@local.dev` / `password123`
- **Pre-configured Project**: `Pi-Agent`
</details>

---

## 🏛️ Tech Stack & Architecture

```
                      Host Terminal & Global CLI
                                  │
                                  ▼
                           pi (pi-sandbox)
                                  │
                     ┌────────────┴────────────┐
        OpenAI API   │                         │ Telemetry
        :8080        ▼                         ▼ :3000
              ┌──────────────┐          ┌──────────────┐
              │  llama.cpp   │          │   Langfuse   │
              │ (MoE / GGUF) │          │ (ClickHouse) │
              └──────────────┘          └──────────────┘
```

| Layer | Technology | Key Capabilities |
|---|---|---|
| **Inference Engine** | [llama.cpp](https://github.com/ggerganov/llama.cpp) | CUDA-accelerated MoE GGUF execution, KV cache quantization (`q8_0`/`q4_0`), low-latency C++ server |
| **Agent Environment** | [Pi Agent](docker/Dockerfile.pi) | Ephemeral Docker sandbox, host git pass-through, centralized cache (`~/.local/share/sosho`) |
| **Observability** | [Langfuse v4](docker/compose.langfuse.yaml) | ClickHouse analytical store, token tracking, tool latency tracing, session replay |
| **Orchestration** | Docker Compose v2 + Make | Localhost (`127.0.0.1`) security isolation, disk-first task persistence |

---

## 🧰 Make Commands

Sosho uses a streamlined `Makefile` for zero-friction control:

```bash
# Core Lifecycle
make up            # Start llama.cpp inference + Langfuse stack
make down          # Stop all containers across all profiles
make status        # Inspect health status and ports
make restart       # Quick restart of LLM inference service

# Diagnostics & Logs
make autotune      # Auto-benchmark & generate max-performance .env
make doctor        # Run hardware, GPU, driver & port diagnostics
make test          # Execute automated integration & unit tests
make logs-llm      # Stream llama.cpp logs
make logs-langfuse # Stream telemetry logs

# Tooling
make install-cli   # Symlink global CLI launcher into ~/.local/bin
make clean-cache   # Flush stale agent cache & sessions
```

---

## ⚙️ Key Configuration Options

All inference, runtime, and agent settings are configurable via `.env` (generated automatically with `make autotune`):

| Category | Variable | Default | Description |
|---|---|---|---|
| **Context & Memory** | `LLM_CTX_SIZE` | `32768` | Active context window (32K/64K). Automatically synced with `.pi` compaction settings. |
| | `LLM_KV_CACHE_TYPE` | `q4_0` | KV cache quantization (`q4_0`, `q8_0`, `f16`). `q4_0` halves VRAM consumption. |
| **Compute & Batching**| `LLM_THREADS` | `Auto` | Dedicated CPU threads for MoE matrix evaluation (tuned to physical core count). |
| | `LLM_THREADS_BATCH` | `Auto` | Dedicated CPU threads for prompt ingestion & KV cache generation. |
| | `LLM_BATCH` | `2048` | Logical batch size for prompt evaluation and token prefill. |
| | `LLM_UBATCH` | `512` | Physical compute micro-batch size to keep GPU utilization saturated. |
| **Observability** | `LANGFUSE_BASE_URL` | `http://127.0.0.1:3000` | Local telemetry endpoint recording agent thoughts, tool calls, and latencies. |
| **Cloud & Downloads** | `HF_TOKEN` | *(optional)* | Hugging Face user access token for high-bandwidth model weights downloading. |
| | `OPENAI_API_KEY` | *(optional)* | Drop in `.env` inside any project folder to temporarily route queries to OpenAI models. |
| | `ANTHROPIC_API_KEY` | *(optional)* | Drop in `.env` inside any project folder to route queries to Claude models. |

---

<div align="center">
  <sub>Built for private, high-performance local AI engineering.</sub>
</div>
