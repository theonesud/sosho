from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic import BaseModel, JsonValue

JsonDict = dict[str, JsonValue]
ToolRun = Callable[[JsonDict], Awaitable[JsonDict]]


class UnknownToolError(KeyError):
    pass


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    schema: JsonDict
    run: ToolRun
    side_effect: bool


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register[P: BaseModel](
        self,
        name: str,
        description: str,
        params: type[P],
        run: Callable[[P], Awaitable[JsonDict]],
        *,
        side_effect: bool = False,
    ) -> None:
        async def call(args: JsonDict) -> JsonDict:
            return await run(params.model_validate(args))

        schema: JsonDict = params.model_json_schema()
        self._tools[name] = ToolSpec(name, description, schema, call, side_effect)

    def get(self, name: str) -> ToolSpec:
        try:
            return self._tools[name]
        except KeyError as error:
            raise UnknownToolError(name) from error

    def names(self) -> set[str]:
        return set(self._tools)

    def specs(self) -> list[ToolSpec]:
        return [self._tools[name] for name in sorted(self._tools)]


class EchoParams(BaseModel):
    value: JsonValue = None


class JoinParams(BaseModel):
    parts: list[str]
    separator: str = ""


async def _echo(params: EchoParams) -> JsonDict:
    return {"value": params.value}


async def _text_join(params: JoinParams) -> JsonDict:
    return {"text": params.separator.join(params.parts)}


def builtin_tools() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register("echo", "Return the value unchanged.", EchoParams, _echo)
    registry.register("text_join", "Join text parts with a separator.", JoinParams, _text_join)
    return registry
