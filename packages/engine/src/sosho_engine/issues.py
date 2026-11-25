from dataclasses import dataclass


@dataclass(frozen=True)
class Issue:
    code: str
    message: str
    node: str | None = None
