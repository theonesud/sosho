---
name: yue2-music
description: Generate full songs and ABC scores with the local YuE2 music service. Use the yue2-music command. The command starts the service on demand. The first start downloads the model and can take many minutes.
---

# YuE2 Music Generation

Use the `yue2-music` command to generate songs. The command is `packages/yue2/generate.sh` in this repository. The command starts the YuE2 services on demand. You do not start them yourself.

The first start can take many minutes. The service downloads the model during the first start. Later starts take less time.

A music job waits until the `strata` service has freed the `local-uncensored` model. This happens after 900 idle seconds, so a job can wait up to 16 minutes. The `local-uncensored` tier is not available during the job. A request loads the model again after the job.

## Command Line Usage

```bash
# Generate audio and save the ABC score
yue2-music \
  --style "upbeat synthwave, warm analog pads, punchy drums" \
  --lyrics "[Verse]\nCity lights glow in the rain\n[Chorus]\nDrive into the midnight lane" \
  --out "$SOSHO_PERMANENT_DIR/song.flac" \
  --score-out "$SOSHO_PERMANENT_DIR/song.abc"

# Second job with a fixed seed
yue2-music \
  --style "acoustic folk guitar, soft male vocal" \
  --lyrics "[Verse]\nQuiet morning on the hill" \
  --out "$SOSHO_PERMANENT_DIR/folk.wav" \
  --seed 42 \
  --steps 32
```

The command waits for the job to finish. Set `--wait` to change the maximum wait time in seconds.

## Gateway HTTP API

Use the HTTP API only when the command cannot run. Start the services first with `packages/yue2/ensure-up.sh`. The gateway is at `http://127.0.0.1:8021`.

- `GET /health/ready`: Check that the gateway and the engine are ready. Returns 200 when ready.
- `POST /v1/jobs`: Submit a generation job with `style`, `lyrics`, `cot`, `options`, and `seed`.
- `GET /v1/jobs/{job_id}`: Check job status and progress.
- `GET /v1/jobs/{job_id}/audio`: Download the generated audio file.
- `GET /v1/jobs/{job_id}/score`: Download the generated ABC score.

## Notes

1. The command starts the services when they are not ready. The first start downloads the model. Allow many minutes.
2. The gateway waits until `strata` has freed its model. This frees graphics card memory for YuE2.
3. If `YUE2_API_KEY` is set, pass `Authorization: Bearer <key>` on HTTP requests.
4. If the start times out, the command prints the logs command. Run that command and read the error text.
