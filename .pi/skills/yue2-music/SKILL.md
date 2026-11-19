---
name: yue2-music
description: Generate full songs and ABC scores with local YuE2 music services via CLI or HTTP gateway.
---

# YuE2 Music Generation

Use `yue2/generate.sh` or the `yue2-music` command to submit music generation jobs to the local gateway at `http://127.0.0.1:8021`.

## Start the Services

```bash
make music-up
```

## Command Line Usage

```bash
# Submit a job through the gateway and save audio plus ABC score
yue2-music \
  --style "upbeat synthwave, warm analog pads, punchy drums" \
  --lyrics "[Verse]\nCity lights glow in the rain\n[Chorus]\nDrive into the midnight lane" \
  --out "$SOSHO_PERMANENT_DIR/song.flac" \
  --score-out "$SOSHO_PERMANENT_DIR/song.abc"

# Run the repository script directly
./yue2/generate.sh \
  --style "acoustic folk guitar, soft male vocal" \
  --lyrics "[Verse]\nQuiet morning on the hill" \
  --out "$SOSHO_PERMANENT_DIR/folk.wav" \
  --seed 42 \
  --steps 32
```

## Gateway HTTP API

Base URL: `http://127.0.0.1:8021`

- `GET /health/live`: Check gateway liveness.
- `POST /v1/jobs`: Submit a generation job with `style`, `lyrics`, `cot`, `steps`, and `seed`.
- `GET /v1/jobs/{job_id}`: Check job status and progress.
- `GET /v1/jobs/{job_id}/audio`: Download the generated audio file.
- `GET /v1/jobs/{job_id}/score`: Download the generated ABC score.

## Notes

1. The gateway pauses `llama-cpp` automatically when a job starts to free graphics card memory.
2. If `YUE2_API_KEY` is set, pass `Authorization: Bearer <key>` on HTTP requests.
