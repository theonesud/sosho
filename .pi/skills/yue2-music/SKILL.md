---
name: yue2-music
description: Compose music, songs, vocal tracks, or instrumentals via local YuE2-3B (`yue2-gateway` API on audio.cpp CUDA engine).
---

# YuE2 Music Generation

Generates 48 kHz stereo audio via `audio.cpp` CUDA engine (`yue2-engine`) & async job API (`yue2-gateway`).

## Stack Control
```bash
docker compose --profile music up -d             # Start engine & gateway (downloads weights if missing)
curl -fsS http://127.0.0.1:8021/health/ready     # 200 when ready
```
*VRAM Handshake*: The engine is lazy-loaded. The gateway automatically pauses `llama-cpp`, executes generation, unloads the model, and restarts `llama-cpp`. (Set `YUE2_STOP_LLAMA=false` to manage manually).

## CLI Generation
```bash
./yue2-generate.sh \
  --style "acoustic indie pop, soft acoustic guitar, warm female vocal, 95 BPM" \
  --lyrics $'[Verse]\nWalking down the quiet street\n[Chorus]\nStars begin to shine' \
  --out song.flac \
  --score-out song.abc
```

### Options
- `--style`: Genre, instruments, vocal timbre, mood, BPM (required).
- `--lyrics`: Section-tagged lyrics (`[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]` on separate lines, required).
- `--out`: Destination audio file (default `song.wav`, served as FLAC).
- `--score-out`: Save generated ABC score.
- `--cot`: `full` (default), `melody`, or `off`.
- `--steps`: Inference steps (default `32`).
- `--seed`: Integer seed for reproducibility.
- `--option k=v`: Extra request options (e.g. `--option guidance_scale=1.1`).
- `--wait`: Max wait seconds (default `1800`).
- `--local`: Run container directly (bypasses gateway).

## Direct API
```bash
curl -X POST http://127.0.0.1:8021/v1/jobs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: song-0001' \
  -d '{"style":"acoustic pop, warm vocal","lyrics":"[Verse]\nMorning sun","cot":"melody","seed":42}'
```

| Endpoint | Purpose |
|:---|:---|
| `GET /health/live`, `/health/ready` | Gateway liveness & engine readiness |
| `POST /v1/jobs` | Submit job (`202` + job id) |
| `GET /v1/jobs/{id}` | Status: `queued → running → succeeded/truncated/failed/cancelled` |
| `GET /v1/jobs/{id}/audio` | Download FLAC audio |
| `GET /v1/jobs/{id}/score` | Download ABC score |
| `POST /v1/jobs/{id}/cancel` | Cancel queued/running job |

## Notes
- Performance: ~60s song takes ~35–50s on RTX 3070 Ti (RTF ≈ 0.6). First run pays ~20s model load.
- Song length is driven by lyrics length (no duration parameter).
- Status `truncated` indicates token limit reached: shorten or split lyrics.
- Engine config resides in `yue2/server.json`. Recreate engine via `docker compose --profile music up -d --force-recreate yue2-engine`.
