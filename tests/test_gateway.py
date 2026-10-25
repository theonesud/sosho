"""Unit and integration tests for YuE2 gateway components."""

import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

# Add yue2/gateway to path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "yue2" / "gateway"))

import app


class TestGatewayLogic(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        app.DATA_DIR = Path(self.tmpdir.name)
        app.init_db()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_database_initialization_and_pragma(self):
        db = app.db()
        cur = db.execute("PRAGMA journal_mode")
        mode = cur.fetchone()[0]
        self.assertEqual(mode.lower(), "wal")

    def test_job_persistence_and_retrieval(self):
        job_id = "test-job-123"
        payload = {"style": "jazz", "lyrics": "[Verse] Hello"}
        now = time.time()
        app.db_exec(
            "INSERT INTO jobs (id, status, stage, created_at, request, idempotency_key) "
            "VALUES (?, 'queued', 'pending', ?, ?, ?)",
            (job_id, now, json.dumps(payload), "idem-key-1"),
        )
        row = app.db_one("SELECT * FROM jobs WHERE id=?", (job_id,))
        self.assertIsNotNone(row)
        self.assertEqual(row["status"], "queued")
        self.assertEqual(row["idempotency_key"], "idem-key-1")

    def test_score_decode(self):
        raw_abc = "X:1\nT:Test Melody\nM:4/4\nK:C\nC D E F|G A B c|"
        import base64
        encoded = base64.b64encode(raw_abc.encode("utf-8")).decode("utf-8")
        artifacts = [{"id": "score", "meta": {"format": "abc"}, "payload": encoded}]
        decoded = app.decode_score(artifacts)
        self.assertEqual(decoded, raw_abc)


if __name__ == "__main__":
    unittest.main()
