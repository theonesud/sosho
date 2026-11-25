from pydantic import BaseModel

from sosho_engine.store_tables import WorkerBeat


class WorkerHealth(BaseModel):
    alive: bool
    version: str | None
    version_mismatch: bool


def worker_health(
    beats: list[WorkerBeat], app_version: str, now_ms: int, alive_seconds: float
) -> WorkerHealth:
    fresh = [beat for beat in beats if now_ms - beat.seen_ms <= alive_seconds * 1000]
    current = [beat for beat in fresh if beat.app_version == app_version]
    if current:
        return WorkerHealth(alive=True, version=app_version, version_mismatch=False)
    newest = max(fresh, key=lambda beat: beat.seen_ms, default=None)
    return WorkerHealth(
        alive=False,
        version=newest.app_version if newest else None,
        version_mismatch=newest is not None,
    )
