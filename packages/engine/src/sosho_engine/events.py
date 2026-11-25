import json
from dataclasses import dataclass

from dbos import DBOS
from pydantic import JsonValue

LOG_STREAM = "log"
PROGRESS_EVENT = "progress"
PREVIEW_LIMIT = 4000


def preview(value: JsonValue) -> JsonValue:
    text = json.dumps(value, sort_keys=True)
    if len(text) <= PREVIEW_LIMIT:
        return value
    return {"truncated": text[:PREVIEW_LIMIT]}


@dataclass
class Telemetry:
    seq: int = 0

    async def log(self, event_type: str, fields: dict[str, JsonValue]) -> None:
        self.seq += 1
        entry: dict[str, JsonValue] = {"seq": self.seq, "type": event_type, **fields}
        await DBOS.write_stream_async(LOG_STREAM, entry)

    async def progress(self, snapshot: dict[str, JsonValue]) -> None:
        await DBOS.set_event_async(PROGRESS_EVENT, snapshot)

    async def close(self) -> None:
        await DBOS.close_stream_async(LOG_STREAM)
