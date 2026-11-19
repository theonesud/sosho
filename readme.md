<div align="center">

<img src="./assets/logo.png" alt="Sosho Logo" width="160" style="border-radius: 24px; margin-bottom: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);" />

# Sosho

**Local-first AI studio, durable graph workflow engine, self-evolving two-tier memory, and multi-model autonomous agent workspace.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Compose v2](https://img.shields.io/badge/Docker%20Compose-v2.0+-2496ED?logo=docker&logoColor=white)](compose.yaml)
[![SQLite WAL Workflows](https://img.shields.io/badge/Workflows-SQLite%20WAL%20DAG-6366f1)](packages/workflow-engine/src/schema.ts)
[![React Flow Studio](https://img.shields.io/badge/Canvas-Sosho%20Studio-0ea5e9)](apps/studio/src/App.tsx)
[![Observability: Langfuse](https://img.shields.io/badge/Telemetry-Langfuse%20v4-black)](docker/compose.langfuse.yaml)
[![CUDA Accelerated](https://img.shields.io/badge/CUDA-NVIDIA%20GPU-76B900?logo=nvidia&logoColor=white)](bin/doctor.sh)

</div>

---

## How Sosho Works

<p align="center">
  <img src="./assets/architecture.svg" alt="How Sosho Works" width="100%" />
</p>

---

## Core Capabilities

### 1. Durable Graph Workflows & Visual Canvas (`Sosho Studio`)
* **Typed Graph Engine (`packages/workflow-engine/`):** Define workflows as versioned JSON (`workflows/*.graph.json`) with `agent`, `subagent`, `decision`, `tool`, `skill`, `checkpoint`, and `memory` nodes.
* **SQLite WAL Durability (`packages/workflow-engine/`):** Persists workflow runs, step logs, state payloads, and paused Human-in-the-Loop (HITL) checkpoints inside `.pi/workflows/runs.sqlite` in Write-Ahead Log mode inside the Studio server process. Supports crash recovery, retries, and parallel Directed Acyclic Graph branch joins with zero extra containers.
* **VRAM-Aware Resource Queues:** Automatically serializes `llama-cpp` and `yue2-gateway` on `local-gpu` (concurrency `1`), caps Chrome/Dokobot on `host-browser` (concurrency `2`), and runs cloud steps on `cloud-io` (concurrency `8`).
* **Visual Canvas (`apps/studio/`):** React Flow editor on `:4100` with live SSE node status badges, inline HITL approval drawer, Memory Explorer, and direct link to Langfuse (`:3000`).

### 2. Self-Evolving Two-Tier Memory (`packages/memory/` & `.pi/extensions/memory/`)
* **Global Memory (`~/.sosho/memory/`):** Personal profile, preferences, cross-project habits, and playbooks (mounted into `pi` automatically with automatic secret redaction).
* **Project Memory (`<repo>/.pi/memory/`):** Repo architecture, decisions, recurring fixes, and distilled session episodes.
* **Merged with Session Scratchpad:** Your existing `.pi/scratchpad/<session-id>/{ephemeral,permanent}` remains your **session working memory** (task queues + artifact sandbox) and automatically feeds completed task summaries into `.pi/memory/inbox/` on `session_shutdown`.
* **Hybrid Search & Bi-Temporal History:** Combines BM25 lexical matching, dense vector cosine similarity, and 1-hop entity graph boosts via Reciprocal Rank Fusion (RRF) with type-aware time decay. Updating a fact via `supersedes_id` archives the old version with `valid_to` and `superseded_by` instead of destroying history, with every change logged to `audit.jsonl`.

### 3. Multi-Model Tiering & Native Pi Subagents (`.pi/extensions/subagents/`)
Configured in `.pi/models.json` and `.pi/model-roles.json`:

| Role Tier | Model | Where It Runs | Purpose |
| :--- | :--- | :--- | :--- |
| **`main`** | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | DeepInfra (Cloud) | Primary orchestrator, 1M context, complex synthesis |
| **`subagent`** | `Qwen/Qwen3-32B` | DeepInfra (Cloud) | Bang-for-the-buck parallel research & summarization |
| **`subagent-code`** | `Qwen/Qwen3-Coder-30B-A3B-Instruct` | DeepInfra (Cloud) | Fast MoE coding & repo exploration subagents |
| **`decision`** | `Qwen3-1.7B` (Q4_K_M) | Local CPU (`:8081`, 0 VRAM) | Ultra-fast routing/classification with automatic cloud fallback |
| **`local-uncensored`** | `Qwen3.6-35B-A3B` | Local GPU (`:8080`, `-np 1`) | Private personal chats, security lab, refusal-free local inference |

* **`subagent_run` & `subagent_parallel`:** Spawns isolated `pi --print` child processes with tier-based model routing, concurrency caps (`3` cloud / `1` local GPU), isolated logs in `$SOSHO_PERMANENT_DIR/subagents/`, and automatic `LANGFUSE_PI_PARENT_*` trace nesting.

### 4. Modular Capability Skills (`.pi/skills/`)
Self-contained skills with deterministic scripts (`scripts/`) to prevent context bloat:
`social-x`, `github-scout`, `youtube-digest`, `libdocs`, `data-lab`, `creative-canvas`, `web-craft`, `security-lab`, `lean-proofs`, `sys-admin`, `dokobot`, and `yue2-music`.

---

## Quick Start

### Prerequisites
* **Node.js:** Version `20.18.0` or newer (Node 20 and Node 24 are both supported via `tsx`).
* **Docker:** Docker Engine with Compose v2.

### 1. Core Stack (`llama.cpp` + Langfuse + CLI)
```bash
make doctor        # Verify GPU, drivers, Docker, ports
make autotune      # Generate hardware-tuned .env
make install-cli   # Install global `pi` launcher into ~/.local/bin
make up            # Start llama-cpp (:8080) and Langfuse (:3000)
```

### 2. Workflow Engine, Local Decision Router & Visual Canvas
```bash
# Optional: start local CPU decision model (:8081) and embeddinggemma (:8082) with 0 GPU VRAM
make decision-up
make embed-up

# Install Node dependencies once
(cd packages/llm && npm install)
(cd packages/memory && npm install)
(cd packages/workflow-engine && npm install)
(cd apps/studio && npm install)

# Launch Studio API + embedded SQLite DAG engine (:4101) and Studio Canvas (:4100)
make studio-api
make studio-ui
```

### 3. Interactive Terminal Agent (`pi`)
Run `pi` inside any project directory:
```bash
cd ~/projects/my-app
pi
```
* **Langfuse UI:** `http://127.0.0.1:3000` (`admin@local.dev` / `password123`)
* **Sosho Studio Canvas:** `http://127.0.0.1:4100`

---

## Make Commands

| Command | Description |
| :--- | :--- |
| `make up` | Start `llama-cpp` (`:8080`) and Langfuse v4 (`:3000`) |
| `make decision-up` | Start local CPU `Qwen3-1.7B` decision router (`:8081`, 0 GPU VRAM) |
| `make embed-up` | Start local CPU `embeddinggemma` memory vector server (`:8082`, 0 GPU VRAM) |
| `make studio-api` | Run Sosho Studio API, SQLite DAG engine & SSE gateway (`:4101`) |
| `make studio-ui` | Run Sosho Studio React Flow visual canvas (`:4100`) |
| `make music-up` | Start YuE2 local music generation (`:8021`) |
| `make test-memory` | Run two-tier memory unit tests |
| `make test` | Run full automated test suite |
| `make down` | Stop all containers across all profiles |
| `make install-cli` | Install `pi` and `yue2-music` symlinks into `~/.local/bin` |
