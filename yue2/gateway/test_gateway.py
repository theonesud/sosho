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


def test_worker_loop_pauses_and_resumes_once_across_queued_jobs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _run() -> None:
        monkeypatch.setattr(gw, "DATA_DIR", tmp_path)
        monkeypatch.setattr(gw, "UNLOAD_AFTER_JOB", False)
        monkeypatch.setattr(gw, "_db", None)
        gw.init_db()

        for jid in ("job-1", "job-2"):
            gw.db_exec(
                "INSERT INTO jobs (id, status, stage, created_at, request) VALUES (?, 'queued', 'pending', ?, ?)",
                (jid, time.time(), json.dumps({"style": "synthwave", "lyrics": ""})),
            )

        pause_calls = 0
        resume_calls = 0
        ran_jobs: list[str] = []

        async def fake_pause() -> bool:
            nonlocal pause_calls
            pause_calls += 1
            return True

        async def fake_resume() -> None:
            nonlocal resume_calls
            resume_calls += 1

        async def fake_run_job(job_id: str, *, manage_llm: bool = True) -> None:
            assert manage_llm is False
            ran_jobs.append(job_id)
            gw.db_exec("UPDATE jobs SET status='succeeded', finished_at=? WHERE id=?", (time.time(), job_id))

        monkeypatch.setattr(gw.docker_ctl, "pause", fake_pause)
        monkeypatch.setattr(gw.docker_ctl, "resume", fake_resume)
        monkeypatch.setattr(gw, "run_job", fake_run_job)

        q: asyncio.Queue[str] = asyncio.Queue()
        q.put_nowait("job-1")
        q.put_nowait("job-2")
        monkeypatch.setattr(gw, "_queue", q)

        worker = asyncio.create_task(gw.worker_loop())
        await asyncio.wait_for(q.join(), timeout=2.0)
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass

        assert ran_jobs == ["job-1", "job-2"]
        assert pause_calls == 1, f"Expected single pause across queued jobs, got {pause_calls}"
        assert resume_calls == 1, f"Expected single resume after queue drains, got {resume_calls}"

    asyncio.run(_run())


def test_require_key_and_atomic_max_pending(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        monkeypatch.setattr(gw, "DATA_DIR", tmp_path)
        monkeypatch.setattr(gw, "API_KEY", "super-secret-key")
        monkeypatch.setattr(gw, "MAX_PENDING", 3)
        monkeypatch.setattr(gw, "_db", None)
        gw.init_db()
        monkeypatch.setattr(gw, "_queue", asyncio.Queue())

        transport = httpx.ASGITransport(app=gw.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # Wrong token rejected with 401
            bad = await client.post(
                "/v1/jobs",
                json={"style": "jazz", "lyrics": ""},
                headers={"Authorization": "Bearer wrong-key"},
            )
            assert bad.status_code == 401

            # Concurrent MAX_PENDING + 4 requests enforce exact 429 cap
            headers = {"Authorization": "Bearer super-secret-key"}
            resps = await asyncio.gather(
                *[
                    client.post("/v1/jobs", json={"style": f"jazz {i}", "lyrics": ""}, headers=headers)
                    for i in range(gw.MAX_PENDING + 4)
                ]
            )
            codes = sorted(r.status_code for r in resps)
            assert codes.count(202) == gw.MAX_PENDING
            assert codes.count(429) == 4

    asyncio.run(_run())
