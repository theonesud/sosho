import asyncio
import base64
import json
import os
import time
from pathlib import Path

import httpx
import pytest

import app as gw


def test_prune_artifacts_recursive_dir_size(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gw, "DATA_DIR", tmp_path)
    monkeypatch.setattr(gw, "RETENTION_SECONDS", 86400)
    # Limit to ~20 KiB so two 15 KiB directories exceed the cap and oldest is deleted
    monkeypatch.setattr(gw, "MAX_GIB", 20_000 / (1024**3))
    monkeypatch.setattr(gw, "_db", None)
    gw.init_db()

    jobs_dir = tmp_path / "jobs"
    j1 = jobs_dir / "job-old"
    j2 = jobs_dir / "job-new"
    j1.mkdir(parents=True)
    j2.mkdir(parents=True)
    (j1 / "audio.flac").write_bytes(b"a" * 15_000)
    (j2 / "audio.flac").write_bytes(b"b" * 15_000)

    now = time.time()
    os.utime(j1, (now - 100, now - 100))
    os.utime(j2, (now, now))

    gw.prune_artifacts()

    assert not j1.exists(), "Oldest job directory must be deleted when recursive bytes exceed MAX_GIB"
    assert j2.exists(), "Newest job directory must remain under MAX_GIB"


def test_to_flac_does_not_block_event_loop(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        monkeypatch.setattr(gw, "DATA_DIR", tmp_path)
        monkeypatch.setattr(gw, "STOP_LLAMA", False)
        monkeypatch.setattr(gw, "UNLOAD_AFTER_JOB", False)
        monkeypatch.setattr(gw, "_db", None)
        gw.init_db()

        job_id = "job-async-flac"
        gw.db_exec(
            "INSERT INTO jobs (id, status, stage, created_at, request) VALUES (?, 'queued', 'pending', ?, ?)",
            (job_id, time.time(), json.dumps({"style": "ambient", "lyrics": ""})),
        )

        class FakeResp:
            status_code = 200
            text = ""

            def json(self):
                return {"audio": base64.b64encode(b"RIFFmockwav").decode("ascii"), "artifacts": [], "timing": {}}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, *args, **kwargs):
                return FakeResp()

        started_flac = asyncio.Event()
        loop = asyncio.get_running_loop()

        def slow_to_flac(wav: bytes, dest: Path) -> Path:
            loop.call_soon_threadsafe(started_flac.set)
            time.sleep(0.25)
            dest.write_bytes(wav)
            return dest

        real_async_client = httpx.AsyncClient
        monkeypatch.setattr(gw.httpx, "AsyncClient", FakeClient)
        monkeypatch.setattr(gw, "to_flac", slow_to_flac)

        job_task = asyncio.create_task(gw.run_job(job_id))
        await asyncio.wait_for(started_flac.wait(), timeout=2.0)

        t0 = time.perf_counter()
        transport = httpx.ASGITransport(app=gw.app)
        async with real_async_client(transport=transport, base_url="http://test") as client:
            r = await client.get("/health/live")
        elapsed_ms = (time.perf_counter() - t0) * 1000

        await job_task
        assert r.status_code == 200
        assert elapsed_ms < 50.0, f"/health/live blocked during to_flac: {elapsed_ms:.1f}ms"

    asyncio.run(_run())
