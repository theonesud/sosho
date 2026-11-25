PENDING = "pending"
RUNNING = "running"
WAITING = "waiting"
SUCCEEDED = "succeeded"
FAILED = "failed"
CANCELLED = "cancelled"

STATUS_NAMES = (PENDING, RUNNING, WAITING, SUCCEEDED, FAILED, CANCELLED)
DBOS_STATUSES: dict[str, str] = {
    "ENQUEUED": PENDING,
    "DELAYED": PENDING,
    "PENDING": RUNNING,
    "SUCCESS": SUCCEEDED,
    "ERROR": FAILED,
    "CANCELLED": CANCELLED,
    "MAX_RECOVERY_ATTEMPTS_EXCEEDED": FAILED,
}


def engine_status(dbos_status: str, waiting: bool = False) -> str:
    name = DBOS_STATUSES.get(dbos_status, FAILED)
    return WAITING if waiting and name == RUNNING else name


def dbos_statuses(name: str) -> list[str]:
    target = RUNNING if name == WAITING else name
    return [raw for raw, mapped in DBOS_STATUSES.items() if mapped == target]
