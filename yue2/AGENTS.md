# YuE2 Music Gateway Scoped Agent Guide

Read root [AGENTS.md](../AGENTS.md) and [docs/context/DECISIONS.md](../docs/context/DECISIONS.md) before you edit `yue2/`.

## Architecture and Invariants

- **Single-GPU VRAM Handoff:** Unload `llama-cpp` models through `POST http://llama-cpp:8080/models/unload`. Never mount `/var/run/docker.sock` or control Docker containers directly.
- **Queue Discipline:** Keep `llama-cpp` unloaded across consecutive queued music jobs until the queue empties. Enforce `MAX_PENDING` atomically inside one SQLite lock transaction.
- **Non-Blocking Audio Work:** Run `ffmpeg` FLAC conversion off the FastAPI event loop through `asyncio.to_thread`.
- **Security and Disk Limits:** Use `secrets.compare_digest` for bearer authentication. Require `YUE2_API_KEY` whenever `YUE2_BIND_HOST` is outside loopback. Compute recursive directory bytes in `prune_artifacts`.

## Mandatory Verification

Run the gateway pytest suite after any change:

```bash
if [ -x yue2/gateway/.venv/bin/pytest ]; then
  (cd yue2/gateway && ./.venv/bin/pytest -q test_gateway.py)
else
  (cd yue2/gateway && pytest -q test_gateway.py)
fi
```
