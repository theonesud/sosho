from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

from sosho_memory.audit import RollbackResult
from sosho_memory.conceptnet_filter import ConceptNetFilterConfig
from sosho_memory.conceptnet_loader import ConceptNetLoadResult, load_conceptnet_from_lines
from sosho_memory.config import MemorySettings, load_memory_settings
from sosho_memory.errors import MemoryValidationError
from sosho_memory.maintenance import GraphMaintenanceService
from sosho_memory.maintenance_models import GraphHealthSummary
from sosho_memory.store import SurrealMemoryStore
from sosho_memory.write_service import MemoryWriteService


class CliInitResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    surreal_url: str
    namespace: str
    user_database: str
    project_database: str | None
    databases: tuple[str, ...]


def _add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--surreal-url", dest="surreal_url", default=None)
    parser.add_argument("--project", dest="project_id", default=None)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sosho-memory")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init")
    _add_common_args(init_parser)

    preload_parser = subparsers.add_parser("preload-conceptnet")
    _add_common_args(preload_parser)
    preload_parser.add_argument("--input", dest="input_path", required=True)
    preload_parser.add_argument("--min-degree", dest="min_degree", type=int, default=5)
    preload_parser.add_argument(
        "--session-id",
        dest="session_id",
        default="cli-conceptnet-preload",
    )

    audit_parser = subparsers.add_parser("audit")
    _add_common_args(audit_parser)
    audit_parser.add_argument("--session-id", dest="session_id", default=None)
    audit_parser.add_argument("--transaction-id", dest="transaction_id", default=None)

    rollback_parser = subparsers.add_parser("rollback")
    _add_common_args(rollback_parser)
    rollback_group = rollback_parser.add_mutually_exclusive_group(required=True)
    rollback_group.add_argument("--transaction-id", dest="transaction_id", default=None)
    rollback_group.add_argument("--session-id", dest="session_id", default=None)

    health_parser = subparsers.add_parser("health")
    _add_common_args(health_parser)
    return parser


def _read_opt_str(ns: argparse.Namespace, attr: str) -> str | None:
    value: object = getattr(ns, attr, None)
    if value is None:
        return None
    if not isinstance(value, str):
        raise MemoryValidationError(f"Expected string for {attr}.")
    return value


def _read_req_str(ns: argparse.Namespace, attr: str) -> str:
    value = _read_opt_str(ns, attr)
    if value is None or not value.strip():
        raise MemoryValidationError(f"{attr} must not be empty.")
    return value


def _read_req_int(ns: argparse.Namespace, attr: str) -> int:
    value: object = getattr(ns, attr, None)
    if isinstance(value, bool) or not isinstance(value, int):
        raise MemoryValidationError(f"Expected integer for {attr}.")
    return value


def _read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


async def _resolve_database(store: SurrealMemoryStore, project_id: str | None) -> str:
    if project_id is not None:
        return await store.ensure_project_scope(project_id)
    return await store.ensure_user_scope()


async def _handle_init(settings: MemorySettings, project_id: str | None) -> str:
    async with SurrealMemoryStore(settings) as store:
        user_db = await store.ensure_user_scope()
        project_db: str | None = None
        databases: list[str] = [user_db]
        if project_id is not None:
            project_db = await store.ensure_project_scope(project_id)
            databases.append(project_db)
        result = CliInitResult(
            surreal_url=settings.surreal_url,
            namespace=settings.namespace,
            user_database=user_db,
            project_database=project_db,
            databases=tuple(databases),
        )
        return result.model_dump_json()


async def _handle_preload(
    settings: MemorySettings,
    args: argparse.Namespace,
) -> str:
    project_id = _read_opt_str(args, "project_id")
    input_path = Path(_read_req_str(args, "input_path"))
    min_degree = _read_req_int(args, "min_degree")
    session_id = _read_req_str(args, "session_id")
    try:
        config = ConceptNetFilterConfig(min_degree=min_degree)
    except ValidationError as error:
        raise MemoryValidationError(f"Invalid ConceptNet filter options: {error}") from error
    lines = await asyncio.to_thread(_read_lines, input_path)
    async with SurrealMemoryStore(settings) as store:
        database = await _resolve_database(store, project_id)
        result: ConceptNetLoadResult = await load_conceptnet_from_lines(
            store,
            database,
            lines,
            config,
            timestamp=datetime.now(UTC),
            session_id=session_id,
        )
        return result.model_dump_json()


async def _handle_audit(
    settings: MemorySettings,
    args: argparse.Namespace,
) -> str:
    project_id = _read_opt_str(args, "project_id")
    session_id = _read_opt_str(args, "session_id")
    transaction_id = _read_opt_str(args, "transaction_id")
    async with SurrealMemoryStore(settings) as store:
        database = await _resolve_database(store, project_id)
        write_service = MemoryWriteService(store)
        return await write_service.export_audit_log(
            database,
            session_id=session_id,
            transaction_id=transaction_id,
        )


async def _handle_rollback(
    settings: MemorySettings,
    args: argparse.Namespace,
) -> str:
    project_id = _read_opt_str(args, "project_id")
    transaction_id = _read_opt_str(args, "transaction_id")
    session_id = _read_opt_str(args, "session_id")
    async with SurrealMemoryStore(settings) as store:
        database = await _resolve_database(store, project_id)
        write_service = MemoryWriteService(store)
        result: RollbackResult
        if transaction_id is not None and session_id is None:
            result = await write_service.rollback_transaction(database, transaction_id)
        elif session_id is not None and transaction_id is None:
            result = await write_service.rollback_session(database, session_id)
        else:
            raise MemoryValidationError("Provide exactly one of transaction_id or session_id.")
        return result.model_dump_json()


async def _handle_health(settings: MemorySettings, project_id: str | None) -> str:
    async with SurrealMemoryStore(settings) as store:
        database = await _resolve_database(store, project_id)
        write_service = MemoryWriteService(store)
        maintenance = GraphMaintenanceService(store, write_service)
        summary: GraphHealthSummary = await maintenance.graph_health(database)
        return summary.model_dump_json()


async def _dispatch(args: argparse.Namespace) -> str:
    command = _read_req_str(args, "command")
    surreal_url = _read_opt_str(args, "surreal_url")
    project_id = _read_opt_str(args, "project_id")
    settings = load_memory_settings(surreal_url=surreal_url)
    if command == "init":
        return await _handle_init(settings, project_id)
    if command == "preload-conceptnet":
        return await _handle_preload(settings, args)
    if command == "audit":
        return await _handle_audit(settings, args)
    if command == "rollback":
        return await _handle_rollback(settings, args)
    if command == "health":
        return await _handle_health(settings, project_id)
    raise MemoryValidationError(f"Unsupported command: {command}")


def run_cli(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    output = asyncio.run(_dispatch(args))
    if output and not output.endswith("\n"):
        output = f"{output}\n"
    sys.stdout.write(output)
    return 0


def main() -> None:
    raise SystemExit(run_cli())


if __name__ == "__main__":
    main()
