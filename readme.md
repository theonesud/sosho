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

### 🛠️ 3. Context-Lean Tooling & Disk-First Workflows
Combines raw, unconstrained intelligence with a token-efficient UNIX and scripting harness:
- **Lean Tool Architecture**: Pre-filtered streaming pipelines (`jq`, `grep`, `awk`) and bounded slice inspection (`chunk-read.sh`) to eliminate context blowup.
- **Targeted Skills**: Focused, on-demand skills (e.g. headless web retrieval via `dokobot`) that fetch only essential data.
- **Unrestricted Execution**: Because the model has zero refusals, your agent runs scripts, tests security vectors, and solves edge cases directly.

</td>
<td width="50%" valign="top">

### 📊 4. Full Observability & State Persistence
Production-grade local telemetry and compaction resilience:
- **Full Langfuse v4 Tracing**: Local telemetry at `localhost:3000` recording token usage, latency, tool calls, and session trajectories.
- **Automatic Compaction Recovery**: Disk-backed state snapshots (`.pi/work/checkpoint_last.json`) survive context truncation and compaction seamlessly.
- **Zero Cloud Leakage**: Completely self-contained within your local environment.

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

## 🚀 Interactive Workflows

<details open>
<summary><b>🛠️ Workflow A: Terminal Coding Agent (<code>pi</code>)</b></summary>
<br>

Invoke `pi` inside **any directory or code repository**:
```bash
cd ~/projects/my-app
pi
```
- **Context-Lean Execution**: Built-in sliding-chunk inspection and UNIX pipelines to prevent context bloat on small local context windows.
- **Targeted Skills**: Modular on-demand capabilities (such as `dokobot` for lightweight web retrieval) without context-heavy agent swarms.
- **Uncensored Execution**: Zero refusal friction—the agent faithfully investigates low-level system internals, security bugs, and sensitive edge-case behaviors without hallucinating policy warnings.
- **Skip Warmup**: `pi --no-warmup` (bypasses initial server probe).
- **Hybrid APIs**: Drop a `.env` with `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in any folder to temporarily route queries to cloud models.
</details>

<details open>
<summary><b>📈 Workflow B: Real-Time Tracing (Langfuse)</b></summary>
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

Configure options via `.env` without modifying compose files:

| Variable | Default | Description |
|---|---|---|
| `LLM_THREADS` | `14` | Dedicated CPU threads for MoE matrix operations |
| `LLM_THREADS_BATCH` | `14` | Dedicated CPU threads for prompt ingestion & KV cache generation |
| `LLM_CTX_SIZE` | `32768` | Optimized context window to keep KV cache compact & fast |
| `LLM_KV_CACHE_TYPE` | `q4_0` | KV cache precision (`q4_0`, `q8_0`, `f16`) for 2x memory throughput |
| `LANGFUSE_BASE_URL`| `http://127.0.0.1:3000` | Target telemetry endpoint for agent traces |

---

<div align="center">
  <sub>Built for private, high-performance local AI engineering.</sub>
</div>
