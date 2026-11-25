from dbos import DBOS
from pydantic import JsonValue

from sosho_engine.children import run_node_job


@DBOS.workflow()
async def node_workflow(payload: dict[str, JsonValue]) -> dict[str, JsonValue]:
    return await run_node_job(payload)
