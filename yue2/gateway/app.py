"""YuE2 job gateway.

Turns the synchronous audio.cpp `/v1/tasks/run` endpoint into an async job API
with the contract we borrowed from YuE2-Turbo:

    POST /v1/jobs              -> 202 + job id (Idempotency-Key supported)
    GET  /v1/jobs/{id}         -> status, stage, timings
    GET  /v1/jobs/{id}/audio   -> FLAC
    GET  /v1/jobs/{id}/score   -> ABC
    POST /v1/jobs/{id}/cancel

The engine runs one inference at a time on a single GPU, so this process owns a
single-worker queue. It also handles artifact retention and (optionally) unloads
the engine model after each job so the VRAM goes back to llama.cpp.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

LOG = logging.getLogger("yue2.gateway")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

ENGINE_URL = os.environ.get("YUE2_ENGINE_URL", "http://127.0.0.1:8020").rstrip("/")
MODEL_ID = os.environ.get("YUE2_MODEL_ID", "yue2")
DATA_DIR = Path(os.environ.get("YUE2_DATA_DIR", "./yue2-data")).resolve()
API_KEY = os.environ.get("YUE2_API_KEY", "").strip()
ENGINE_TIMEOUT = float(os.environ.get("YUE2_ENGINE_TIMEOUT_SECONDS", "1800"))
MAX_PENDING = int(os.environ.get("YUE2_MAX_PENDING", "4"))
UNLOAD_AFTER_JOB = os.environ.get("YUE2_UNLOAD_AFTER_JOB", "true").lower() in ("1", "true", "yes")
RETENTION_SECONDS = int(os.environ.get("YUE2_RETENTION_SECONDS", "86400"))
MAX_GIB = float(os.environ.get("YUE2_MAX_GIB", "5"))
DEFAULT_FORMAT = os.environ.get("YUE2_AUDIO_FORMAT", "flac")

# VRAM handshake: pause the LLM container while YuE2 runs, then bring it back.
DOCKER_SOCKET = os.environ.get("YUE2_DOCKER_SOCKET", "/var/run/docker.sock")
LLAMA_CONTAINER = os.environ.get("YUE2_LLAMA_CONTAINER", "llama-cpp")
STOP_LLAMA = os.environ.get("YUE2_STOP_LLAMA", "true").lower() in ("1", "true", "yes")
LLAMA_READY_TIMEOUT = float(os.environ.get("YUE2_LLAMA_READY_TIMEOUT_SECONDS", "180"))

TERMINAL = ("succeeded", "failed", "cancelled", "truncated")

_db_lock = threading.Lock()
_db: sqlite3.Connection | None = None
_queue: asyncio.Queue[str] | None = None
_worker: asyncio.Task | None = None


# ---------------------------------------------------------------- persistence


def db() -> sqlite3.Connection:
    assert _db is not None
    return _db


def init_db() -> None:
    global _db
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _db = sqlite3.connect(DATA_DIR / "jobs.db", timeout=30.0, check_same_thread=False)
    _db.row_factory = sqlite3.Row
    _db.execute("PRAGMA journal_mode=WAL")
    _db.execute("PRAGMA busy_timeout=30000")
    _db.executescript(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            stage TEXT,
            created_at REAL NOT NULL,
            started_at REAL,
            finished_at REAL,
            request TEXT NOT NULL,
            idempotency_key TEXT,
            error TEXT,
            audio_path TEXT,
            score_path TEXT,
            audio_bytes INTEGER,
            duration_ms REAL,
            wall_ms REAL,
            rtf REAL,
            cancel_requested INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS jobs_idem
            ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
        """
    )
    _db.commit()


def db_exec(sql: str, params: tuple = ()) -> None:
    with _db_lock:
        db().execute(sql, params)
        db().commit()


def db_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    with _db_lock:
        return db().execute(sql, params).fetchone()


def db_all(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with _db_lock:
        return db().execute(sql, params).fetchall()


def job_json(row: sqlite3.Row) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row["id"],
        "status": row["status"],
        "stage": row["stage"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "request": json.loads(row["request"]),
        "error": row["error"],
        "cancel_requested": bool(row["cancel_requested"]),
        "timing": {"wall_ms": row["wall_ms"], "audio_duration_ms": row["duration_ms"], "rtf": row["rtf"]},
        "artifacts": {},
    }
    if row["audio_path"]:
        out["artifacts"]["audio"] = {
            "url": f"/v1/jobs/{row['id']}/audio",
            "bytes": row["audio_bytes"],
            "format": "flac" if row["audio_path"].endswith(".flac") else "wav",
        }
    if row["score_path"]:
        out["artifacts"]["score"] = {"url": f"/v1/jobs/{row['id']}/score", "format": "abc"}
    return out


# ---------------------------------------------------------------- engine calls


def engine_headers() -> dict[str, str]:
    return {"Content-Type": "application/json"}


async def engine_ready(client: httpx.AsyncClient) -> tuple[bool, str]:
    try:
        r = await client.get(f"{ENGINE_URL}/health", timeout=5)
        if r.status_code != 200:
            return False, f"engine health {r.status_code}"
        r = await client.get(f"{ENGINE_URL}/v1/models", timeout=5)
        if r.status_code == 200:
            ids = {m.get("id") for m in r.json().get("data", r.json() if isinstance(r.json(), list) else [])}
            if ids and MODEL_ID not in ids:
                return False, f"model '{MODEL_ID}' not configured (have {sorted(ids)})"
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, f"engine unreachable: {exc.__class__.__name__}"


async def unload_engine_model() -> None:
    if not UNLOAD_AFTER_JOB:
        return
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(f"{ENGINE_URL}/v1/tasks/unload_all_models", json={})
        LOG.info("engine model unloaded (VRAM released)")
    except Exception as exc:  # noqa: BLE001
        LOG.warning("unload failed: %s", exc)


class DockerCtl:
    """Minimal Docker Engine API client over the mounted unix socket.

    Used only to pause/restart the LLM container so YuE2 gets the whole GPU.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return STOP_LLAMA and Path(DOCKER_SOCKET).exists()

    def _client(self) -> httpx.AsyncClient:
        transport = httpx.AsyncHTTPTransport(uds=DOCKER_SOCKET)
        return httpx.AsyncClient(transport=transport, base_url="http://docker", timeout=60)

    async def _running(self) -> bool:
        async with self._client() as client:
            r = await client.get(f"/containers/{LLAMA_CONTAINER}/json")
            if r.status_code == 404:
                return False
            r.raise_for_status()
            return bool(r.json().get("State", {}).get("Running"))

    async def state(self) -> str:
        """Return stopped | starting | healthy | unknown."""
        if not STOP_LLAMA:
            return "unknown"
        if not Path(DOCKER_SOCKET).exists():
            return "unknown"
        try:
            async with self._client() as client:
                r = await client.get(f"/containers/{LLAMA_CONTAINER}/json")
                if r.status_code == 404:
                    return "unknown"
                r.raise_for_status()
                state = r.json().get("State", {})
            if not state.get("Running"):
                return "stopped"
            health = (state.get("Health") or {}).get("Status")
            return "healthy" if health in (None, "healthy") else "starting"
        except Exception:  # noqa: BLE001
            return "unknown"

    async def pause(self) -> bool:
        """Stop the LLM container. Returns True only if we actually stopped it."""
        if not self.enabled:
            return False
        async with self._lock:
            try:
                if not await self._running():
                    LOG.info("%s not running; GPU already free", LLAMA_CONTAINER)
                    return False
                LOG.info("stopping %s to free VRAM for YuE2", LLAMA_CONTAINER)
                async with self._client() as client:
                    r = await client.post(f"/containers/{LLAMA_CONTAINER}/stop?t=30")
                    if r.status_code not in (204, 304):
                        r.raise_for_status()
                await asyncio.sleep(2)  # let the driver reclaim memory
                return True
            except Exception as exc:  # noqa: BLE001
                LOG.warning("could not stop %s: %s", LLAMA_CONTAINER, exc)
                return False

    async def resume(self) -> None:
        async with self._lock:
            try:
                LOG.info("starting %s again", LLAMA_CONTAINER)
                async with self._client() as client:
                    r = await client.post(f"/containers/{LLAMA_CONTAINER}/start")
                    if r.status_code not in (204, 304):
                        r.raise_for_status()
                await self._wait_healthy()
            except Exception as exc:  # noqa: BLE001
                LOG.error("could not restart %s: %s", LLAMA_CONTAINER, exc)

    async def _wait_healthy(self) -> None:
        deadline = time.time() + LLAMA_READY_TIMEOUT
        while time.time() < deadline:
            try:
                async with self._client() as client:
                    r = await client.get(f"/containers/{LLAMA_CONTAINER}/json")
                    state = r.json().get("State", {})
                health_obj = state.get("Health")
                if state.get("Running"):
                    if health_obj is not None:
                        if health_obj.get("Status") == "healthy":
                            LOG.info("%s is back up and healthy", LLAMA_CONTAINER)
                            return
                    else:
                        # Fallback for unmonitored containers
                        LOG.info("%s is running (no container healthcheck configured)", LLAMA_CONTAINER)
                        return
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(2)
        LOG.warning("%s did not report healthy within %.0fs", LLAMA_CONTAINER, LLAMA_READY_TIMEOUT)


docker_ctl = DockerCtl()


def decode_audio(payload: str) -> bytes:
    return base64.b64decode(payload)


def decode_score(artifacts: list[dict[str, Any]]) -> str | None:
    for art in artifacts or []:
        meta = art.get("meta") or {}
        if art.get("id") == "score" or meta.get("format") == "abc" or meta.get("extension") == "abc":
            raw = art.get("payload") or ""
            try:
                return base64.b64decode(raw).decode("utf-8", "replace")
            except Exception:  # noqa: BLE001
                return raw
    return None


def to_flac(wav: bytes, dest: Path) -> Path:
    """Convert WAV bytes to FLAC when ffmpeg exists; otherwise keep the WAV."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        out = dest.with_suffix(".wav")
        out.write_bytes(wav)
        return out
    tmp = dest.with_suffix(".src.wav")
    tmp.write_bytes(wav)
    try:
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", str(tmp), "-c:a", "flac", str(dest)],
            check=True,
        )
        return dest
    finally:
        tmp.unlink(missing_ok=True)


# ---------------------------------------------------------------------- worker


async def run_job(job_id: str) -> None:
    row = db_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if row is None or row["status"] in TERMINAL:
        return
    if row["cancel_requested"]:
        db_exec("UPDATE jobs SET status='cancelled', finished_at=? WHERE id=?", (time.time(), job_id))
        return

    req = json.loads(row["request"])
    db_exec(
        "UPDATE jobs SET status='running', stage='generating', started_at=? WHERE id=?",
        (time.time(), job_id),
    )
    started = time.time()

    # Engine defaults (cot=full, 32 ODE steps) apply unless the caller overrides.
    options: dict[str, Any] = dict(req.get("options") or {})
    options["style"] = req["style"]
    if req.get("cot"):
        options["cot"] = req["cot"]
    if req.get("seed") is not None:
        options["seed"] = req["seed"]
    body = {"model": MODEL_ID, "request": {"text": req.get("lyrics", ""), "options": options}}

    paused = False
    try:
        paused = await docker_ctl.pause()
        async with httpx.AsyncClient(timeout=ENGINE_TIMEOUT) as client:
            resp = await client.post(f"{ENGINE_URL}/v1/tasks/run", json=body)
        if resp.status_code != 200:
            raise RuntimeError(f"engine {resp.status_code}: {resp.text[:400]}")

        result = resp.json()
        if "audio" not in result:
            raise RuntimeError(f"engine returned no audio: {sorted(result)}")

        wav = decode_audio(result["audio"])
        job_dir = DATA_DIR / "jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        audio_path = to_flac(wav, job_dir / ("audio.flac" if DEFAULT_FORMAT == "flac" else "audio.wav"))

        score = decode_score(result.get("artifacts", []))
        score_path = None
        if score:
            sp = job_dir / "score.abc"
            sp.write_text(score, encoding="utf-8")
            score_path = str(sp)

        timing = result.get("timing") or {}
        cancelled = db_one("SELECT cancel_requested FROM jobs WHERE id=?", (job_id,))["cancel_requested"]
        if cancelled:
            shutil.rmtree(job_dir, ignore_errors=True)
            db_exec("UPDATE jobs SET status='cancelled', finished_at=?, wall_ms=? WHERE id=?",
                    (time.time(), (time.time() - started) * 1000, job_id))
            return

        truncated = any(
            (a.get("meta") or {}).get("truncated") == "true" for a in result.get("artifacts", [])
        )
        db_exec(
            """UPDATE jobs SET status=?, stage='done', finished_at=?, audio_path=?, score_path=?,
                   audio_bytes=?, duration_ms=?, wall_ms=?, rtf=? WHERE id=?""",
            (
                "truncated" if truncated else "succeeded",
                time.time(),
                str(audio_path),
                score_path,
                audio_path.stat().st_size,
                timing.get("audio_duration_ms"),
                timing.get("wall_ms") or (time.time() - started) * 1000,
                timing.get("rtf"),
                job_id,
            ),
        )
        LOG.info("job %s %s in %.1fs (rtf=%s)", job_id, "truncated" if truncated else "ok",
                 (time.time() - started), timing.get("rtf"))
    except Exception as exc:  # noqa: BLE001
        LOG.exception("job %s failed", job_id)
        db_exec(
            "UPDATE jobs SET status='failed', stage='error', finished_at=?, error=?, wall_ms=? WHERE id=?",
            (time.time(), str(exc)[:1000], (time.time() - started) * 1000, job_id),
        )
    finally:
        prune_artifacts()
        await unload_engine_model()
        if paused:
            await docker_ctl.resume()


def prune_artifacts() -> None:
    cutoff = time.time() - RETENTION_SECONDS
    old = db_all("SELECT id FROM jobs WHERE finished_at IS NOT NULL AND finished_at < ?", (cutoff,))
    for row in old:
        shutil.rmtree(DATA_DIR / "jobs" / row["id"], ignore_errors=True)
    if old:
        db_exec(
            f"UPDATE jobs SET audio_path=NULL, score_path=NULL WHERE id IN ({','.join('?' * len(old))})",
            tuple(r["id"] for r in old),
        )

    jobs_root = DATA_DIR / "jobs"
    if not jobs_root.exists():
        return
    entries = sorted(
        ((p.stat().st_size, p) for p in jobs_root.iterdir() if p.is_dir()),
        key=lambda t: t[1].stat().st_mtime,
    )
    total = sum(size for size, _ in entries)
    limit = MAX_GIB * 1024**3
    for size, path in entries:
        if total <= limit:
            break
        shutil.rmtree(path, ignore_errors=True)
        db_exec("UPDATE jobs SET audio_path=NULL, score_path=NULL WHERE id=?", (path.name,))
        total -= size


async def worker_loop() -> None:
    assert _queue is not None
    while True:
        job_id = await _queue.get()
        try:
            await run_job(job_id)
        finally:
            _queue.task_done()


# ------------------------------------------------------------------------ auth


async def require_key(request: Request) -> None:
    if not API_KEY:
        return
    header = request.headers.get("authorization", "")
    if header != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


# ----------------------------------------------------------------------- models


class JobRequest(BaseModel):
    style: str = Field(..., min_length=1, description="Genre, instruments, vocal timbre, BPM")
    lyrics: str = Field("", description="Section-tagged lyrics")
    cot: str | None = Field(None, pattern="^(melody|full|off)$",
                            description="Planning route; engine default (full) when omitted")
    seed: int | None = Field(None, ge=0, description="Random when omitted")
    options: dict[str, Any] = Field(
        default_factory=dict,
        description="Any YuE2 request option, e.g. num_inference_steps, guidance_scale",
    )


# Request options accepted by the YuE2 spec (model_specs/yue2.json).
REQUEST_OPTIONS = {
    "style", "lyrics", "cot", "stop_after", "abc", "abc_file",
    "semantic_prefix", "semantic_prefix_file", "nar_noise_file", "export_semantic",
    "guidance_scale", "seed", "num_inference_steps",
    "abc_temperature", "abc_top_p", "abc_top_k", "abc_repetition_penalty",
    "abc_penalty_window", "abc_min_tokens", "abc_max_tokens",
    "semantic_temperature", "semantic_top_p", "semantic_top_k",
    "semantic_repetition_penalty", "semantic_penalty_window",
    "semantic_min_tokens", "semantic_max_tokens",
}


# ------------------------------------------------------------------------- app


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _queue, _worker
    init_db()
    # A job left "running" when the gateway died has lost its engine call.
    db_exec(
        "UPDATE jobs SET status='failed', error='gateway restarted mid-job', finished_at=? "
        "WHERE status IN ('running')",
        (time.time(),),
    )
    # If gateway crashed while llama-cpp was stopped, ensure it is resumed
    if STOP_LLAMA:
        try:
            state = await docker_ctl.state()
            if state == "stopped":
                LOG.info("Reconciling stopped LLM container on startup; resuming %s...", LLAMA_CONTAINER)
                await docker_ctl.resume()
        except Exception as exc:  # noqa: BLE001
            LOG.warning("Failed to check/resume LLM container on startup: %s", exc)
    _queue = asyncio.Queue()
    _worker = asyncio.create_task(worker_loop())
    for row in db_all("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at"):
        _queue.put_nowait(row["id"])
    LOG.info("gateway ready: engine=%s data=%s unload_after_job=%s", ENGINE_URL, DATA_DIR, UNLOAD_AFTER_JOB)
    try:
        yield
    finally:
        _worker.cancel()


app = FastAPI(title="YuE2 Job Gateway", version="0.1.0", lifespan=lifespan)


@app.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready() -> JSONResponse:
    async with httpx.AsyncClient() as client:
        ok, detail = await engine_ready(client)
    return JSONResponse({"status": "ready" if ok else "not_ready", "engine": detail},
                        status_code=200 if ok else 503)


@app.get("/health/llm")
async def health_llm() -> dict[str, str]:
    """State of the LLM container the gateway pauses during generation."""
    return {"status": await docker_ctl.state(), "container": LLAMA_CONTAINER}


@app.get("/v1/models", dependencies=[Depends(require_key)])
async def models() -> Response:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{ENGINE_URL}/v1/models")
    return Response(content=r.content, media_type="application/json", status_code=r.status_code)


@app.post("/v1/jobs", status_code=202, dependencies=[Depends(require_key)])
async def create_job(body: JobRequest, request: Request) -> JSONResponse:
    idem = request.headers.get("idempotency-key")
    if idem:
        existing = db_one("SELECT * FROM jobs WHERE idempotency_key = ?", (idem,))
        if existing:
            return JSONResponse(job_json(existing), status_code=202,
                                headers={"Idempotent-Replay": "true"})

    queued = db_one("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')")["n"]
    if queued >= MAX_PENDING:
        raise HTTPException(status_code=429, detail="queue full",
                            headers={"Retry-After": "30"})

    unknown = sorted(set(body.options) - REQUEST_OPTIONS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown model option(s): {unknown}")
    if {"style", "lyrics"} & set(body.options):
        raise HTTPException(status_code=422, detail="send style/lyrics as top-level fields")

    job_id = uuid.uuid4().hex
    payload = body.model_dump()
    if payload.get("seed") is None:
        # Variety by default, while keeping the chosen seed in the job record.
        payload["seed"] = secrets.randbelow(2**31)
    try:
        db_exec(
            "INSERT INTO jobs (id, status, stage, created_at, request, idempotency_key) "
            "VALUES (?, 'queued', 'pending', ?, ?, ?)",
            (job_id, time.time(), json.dumps(payload), idem),
        )
    except sqlite3.IntegrityError:
        existing = db_one("SELECT * FROM jobs WHERE idempotency_key = ?", (idem,))
        return JSONResponse(job_json(existing), status_code=202,
                            headers={"Idempotent-Replay": "true"})

    assert _queue is not None
    _queue.put_nowait(job_id)
    row = db_one("SELECT * FROM jobs WHERE id=?", (job_id,))
    return JSONResponse(job_json(row), status_code=202,
                        headers={"Location": f"/v1/jobs/{job_id}"})


@app.get("/v1/jobs", dependencies=[Depends(require_key)])
async def list_jobs(limit: int = 20) -> dict[str, Any]:
    rows = db_all("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (max(1, min(limit, 100)),))
    return {"jobs": [job_json(r) for r in rows]}


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(require_key)])
async def get_job(job_id: str) -> dict[str, Any]:
    row = db_one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if row is None:
        raise HTTPException(404, "job not found")
    return job_json(row)


@app.get("/v1/jobs/{job_id}/audio", dependencies=[Depends(require_key)])
async def get_audio(job_id: str):
    row = db_one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if row is None:
        raise HTTPException(404, "job not found")
    if not row["audio_path"] or not Path(row["audio_path"]).exists():
        raise HTTPException(409, f"audio not available (status={row['status']})")
    media = "audio/flac" if row["audio_path"].endswith(".flac") else "audio/wav"
    return FileResponse(row["audio_path"], media_type=media,
                        filename=f"{job_id}.{Path(row['audio_path']).suffix.lstrip('.')}")


@app.get("/v1/jobs/{job_id}/score", dependencies=[Depends(require_key)])
async def get_score(job_id: str):
    row = db_one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if row is None:
        raise HTTPException(404, "job not found")
    if not row["score_path"] or not Path(row["score_path"]).exists():
        raise HTTPException(409, f"score not available (status={row['status']})")
    return FileResponse(row["score_path"], media_type="text/vnd.abc", filename=f"{job_id}.abc")


@app.post("/v1/jobs/{job_id}/cancel", dependencies=[Depends(require_key)])
async def cancel_job(job_id: str) -> dict[str, Any]:
    row = db_one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if row is None:
        raise HTTPException(404, "job not found")
    if row["status"] in TERMINAL:
        return {"id": job_id, "status": row["status"], "detail": "already finished"}
    if row["status"] == "queued":
        db_exec("UPDATE jobs SET status='cancelled', finished_at=? WHERE id=?", (time.time(), job_id))
        return {"id": job_id, "status": "cancelled"}
    db_exec("UPDATE jobs SET cancel_requested=1 WHERE id=?", (job_id,))
    return {"id": job_id, "status": "cancel_requested",
            "detail": "engine runs synchronously; results will be discarded"}
