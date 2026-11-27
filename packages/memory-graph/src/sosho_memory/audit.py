from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict, Field

from sosho_memory.models import AuditLogEntry


class AuditSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    before_json: str | None = None
    after_json: str | None = None


class RollbackResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    scope: str
    target_id: str
    reverted_entries: int = Field(ge=0)
    reverted_transaction_ids: tuple[str, ...]


def encode_audit_snapshot(*, before_json: str | None, after_json: str | None) -> str:
    snapshot = AuditSnapshot(before_json=before_json, after_json=after_json)
    return snapshot.model_dump_json()


def decode_audit_snapshot(payload_json: str) -> AuditSnapshot:
    return AuditSnapshot.model_validate_json(payload_json)


def _escape_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _format_audit_row(entry: AuditLogEntry) -> str:
    cells = (
        entry.timestamp.isoformat(),
        entry.transaction_id,
        entry.session_id,
        entry.agent_role.value,
        entry.agent_id,
        entry.action.value,
        entry.target_table,
        entry.target_id,
    )
    escaped = (_escape_cell(cell) for cell in cells)
    return "| " + " | ".join(escaped) + " |"


def format_audit_log_report(entries: Sequence[AuditLogEntry]) -> str:
    if not entries:
        return "No audit entries recorded."

    header = (
        "| timestamp | transaction_id | session_id | agent_role | "
        "agent_id | action | target_table | target_id |"
    )
    separator = "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
    rows = [_format_audit_row(entry) for entry in entries]
    return "\n".join([header, separator, *rows])
