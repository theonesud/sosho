---
name: yue2-music
description: Generate complete AI music, songs, vocal tracks, and instrumentals using the local YuE2-3B model through the yue2-gateway job API (audio.cpp CUDA engine). Use whenever the user asks to compose music, generate a song, create a soundtrack, or synthesize vocals from lyrics.
---

# YuE2 Music Generation Skill

Generate 48 kHz stereo songs locally with YuE2-3B. The stack is two Compose
services under the `music` profile:

| Service | Role |
|---|---|
| `yue2-engine` | `audio.cpp` server, one resident GGUF model, GPU |
| `yue2-gateway` | async job API: `202` + job id, poll, FLAC/ABC download |

The gateway owns the queue, artifacts, and VRAM release, so callers never touch
Docker or the GPU directly.

## Start the stack

One command downloads the weights (first run only), starts the engine, and
starts the gateway:

```bash
docker compose --profile music up -d
curl -fsS http://127.0.0.1:8021/health/ready    # 200 when the gateway is up
```

`yue2-model-download` fetches `yue2-3b-q4_0.gguf`, `yue2-vae-f16.gguf`, and the
sidecars from `audio-cpp/Yue2-3B-GGUF` into `./models/yue2-3b`. It exits
immediately when those files already exist.

A plain `docker compose up -d` does **not** include this stack. Either use the
profile flag or set `COMPOSE_PROFILES=music` in `.env`.

The engine is lazy-loaded, so it holds no VRAM until a job arrives. The gateway
handles the GPU handshake automatically: it stops `llama-cpp`, runs the job,
unloads the YuE2 model, then starts `llama-cpp` again and waits for it to be
healthy. No manual stopping is needed.

Set `YUE2_STOP_LLAMA=false` to coordinate VRAM by hand instead.

## Generate

```bash
./yue2-generate.sh \
  --style "acoustic indie pop, soft acoustic guitar, warm female vocal, 95 BPM" \
  --lyrics $'[Verse]\nWalking down the quiet street\n[Chorus]\nStars begin to shine' \
  --out song.flac \
  --score-out song.abc
```

The script submits a job, polls until it finishes, downloads the audio, and
optionally the ABC score. Add `--seed 42` for a reproducible take.

## Options

- **`--style` (required)**: genre, instruments, vocal timbre, mood, BPM.
  - `"90s grunge rock, distorted electric guitars, heavy drums, raspy male vocals, 120 BPM"`
  - `"ambient synthwave, dreamy female vocal, analog synths, 95 BPM"`
- **`--lyrics` (required)**: section-tagged lyrics — `[Verse]`, `[Chorus]`,
  `[Bridge]`, `[Outro]`. Keep tags on their own lines.
- **`--out`**: audio path (default `song.wav`; the gateway serves FLAC).
- **`--score-out`**: also save the generated ABC score.
- **`--cot`**: symbolic planning — `full` (default), `melody`, or `off`.
- **`--steps`**: NAR ODE steps (default `32`, the official YuE2 recipe).
- **`--seed`**: integer seed; a random one is chosen and recorded per job by default.
- **`--option key=value`**: any other YuE2 request option, repeatable.
  Example: `--option guidance_scale=1.1 --option semantic_max_tokens=3000`.
- **`--wait`**: max seconds to wait (default 1800).
- **`--local`**: bypass the gateway and run a one-shot container (last resort).

## Quality defaults

Tuned on an 8 GB RTX 3070 Ti: official quality, still ~2.5× realtime.

| Setting | Default | Why |
|---|---|---|
| `cot` | `full` | Plans melody + structure before audio |
| `num_inference_steps` | `32` | Official recipe; 8 is the engine default but rougher |
| `guidance_scale` | unset (1.0) | Anything else forces a slower host-K/V path |
| `seed` | random, recorded | Variety, still reproducible from the job record |
| `mem_saver` | `true` | Required to fit 8 GB |
| `perf_mode` | `off` | `cuda_perf` changes numerics and drops mem saving |

Measured on one 44 s take: 8 steps 12.3 s, 16 → 13.9 s, 24 → 15.7 s, 32 → 17.4 s.
Quality is nearly free here, so 32 is the default.

Session-level knobs (`model_gguf`, `weight_type`, `vae_tile_frames`, LoRAs,
graph arenas) live in `yue2/server.json`; after editing, recreate the engine:

```bash
docker compose --profile music up -d --force-recreate yue2-engine
```

## Direct API

```bash
curl -X POST http://127.0.0.1:8021/v1/jobs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: song-0001' \
  -d '{"style":"English, acoustic pop, warm vocals","lyrics":"[Verse]\nMorning sunlight fills the sky","cot":"melody","seed":42}'
```

| Endpoint | Purpose |
|---|---|
| `GET /health/live`, `GET /health/ready` | Gateway liveness / engine readiness |
| `POST /v1/jobs` | Submit; `202` + job id, honours `Idempotency-Key` |
| `GET /v1/jobs/{id}` | `queued → running → succeeded/truncated/failed/cancelled` |
| `GET /v1/jobs/{id}/audio` | FLAC download |
| `GET /v1/jobs/{id}/score` | ABC download |
| `POST /v1/jobs/{id}/cancel` | Cancel queued jobs; running ones discard results |

Queue full returns `429` with `Retry-After`. Set `YUE2_API_KEY` in `.env` to
require `Authorization: Bearer <key>`.

## Expectations

- A 60 s song takes roughly 35–50 s of compute on an RTX 3070 Ti (RTF ≈ 0.6).
- Longer lyrics produce longer songs; there is no duration parameter.
- The first request after an unload pays ~20 s of model loading.
- `truncated` means the model hit its token limit: shorten the lyrics or split
  the song.

## ABC score

The score has two voices (`Vocal Melody`, `Inst. Melody`) with `% intro`,
`% verse`, `% chorus`, `% outro` markers. To iterate on a melody, generate once
with `--score-out`, edit the ABC, then feed it back through a direct engine call
(`request.abc`) rather than regenerating blindly.
