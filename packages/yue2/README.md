# YuE2 Music & Audio Generation (Standalone)

This directory contains the standalone YuE2-3B music generation stack, powered by the `audio.cpp` CUDA engine (`yue2-engine`) and an asynchronous job API (`yue2-gateway`).

---

## 1. Starting the Service

Start the music generation services via Docker Compose:

```bash
# From repository root:
docker compose --profile music up -d yue2-engine yue2-gateway

# Check gateway readiness
curl -fsS http://127.0.0.1:8021/health/ready
```

To stop the services and release RAM/VRAM:
```bash
docker compose stop yue2-gateway yue2-engine
```

> **VRAM Coordination**: The engine is lazy-loaded. The gateway automatically pauses `llama-cpp` when generation starts, generates audio, and unloads/resumes `llama-cpp` once complete.

---

## 2. CLI Generation (`generate.sh`)

Use `./generate.sh` to submit a generation request and wait for results:

```bash
cd yue2
./generate.sh \
  --style "acoustic indie pop, soft acoustic guitar, warm female vocal, 95 BPM" \
  --lyrics $'[Verse]\nWalking down the quiet street\n[Chorus]\nStars begin to shine' \
  --out song.flac \
  --score-out song.abc
```

### Key CLI Options
- `-s, --style`: Genre, instruments, vocal timbre, mood, BPM (required).
- `-l, --lyrics`: Section-tagged lyrics (`[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]` on separate lines, required).
- `-o, --out`: Destination audio file (default `song.wav`, served as FLAC).
- `--score-out`: Save generated ABC musical score.
- `--cot`: Planning route: `melody`, `full`, or `off` (default: `full`).
- `--steps`: Inference steps (default: `32` for optimal quality).
- `--seed`: Integer seed for reproducibility.
- `--option k=v`: Extra model options (e.g. `--option guidance_scale=1.1`).
- `--wait`: Max wait timeout in seconds (default: `1800`).
- `--local`: Run container directly (bypasses gateway).

---

## 3. Direct REST API

You can submit jobs directly over HTTP:

```bash
# Submit generation job
curl -X POST http://127.0.0.1:8021/v1/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "style": "synthwave, retro 80s drums, neon synths, male vocals",
    "lyrics": "[Verse]\nDriving in the neon night\n[Chorus]\nElectric sky",
    "cot": "melody",
    "seed": 42
  }'

# Response returns {"id": "<job_id>", "status": "queued"}
```

### Endpoints Reference
| Endpoint | Method | Purpose |
|:---|:---|:---|
| `/health/ready` | `GET` | Gateway liveness & engine readiness |
| `/v1/jobs` | `POST` | Submit generation job (`202 Accepted` + job id) |
| `/v1/jobs/{id}` | `GET` | Status: `queued` → `running` → `succeeded` / `failed` |
| `/v1/jobs/{id}/audio` | `GET` | Download FLAC audio output |
| `/v1/jobs/{id}/score` | `GET` | Download ABC musical score |
| `/v1/jobs/{id}/cancel` | `POST` | Cancel running or queued job |

---

## 4. Configuration

- Engine parameters reside in `server.json`.
- When updating `server.json`, recreate the container:
  ```bash
  docker compose --profile music up -d --force-recreate yue2-engine
  ```
