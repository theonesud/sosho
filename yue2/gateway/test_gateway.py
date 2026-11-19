import os
import time
from pathlib import Path

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
