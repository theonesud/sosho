import sys
from pathlib import Path

LIMIT = 1000
CHECKED_SUFFIXES = {".py", ".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".sh"}
SKIPPED_DIRS = {"node_modules", "vendor", "vendored", "dist", "build", ".venv"}
SKIPPED_SUFFIXES = (".d.ts", ".min.js")


def limit_of(path: Path) -> int | None:
    if path.suffix not in CHECKED_SUFFIXES:
        return None
    if path.name.endswith(SKIPPED_SUFFIXES):
        return None
    if SKIPPED_DIRS.intersection(path.parts):
        return None
    return LIMIT


def count_lines(path: Path) -> int:
    with path.open("rb") as handle:
        return sum(1 for _ in handle)


def violations(names: list[str]) -> list[str]:
    found: list[str] = []
    for name in names:
        path = Path(name)
        limit = limit_of(path)
        if limit is None or not path.is_file():
            continue
        lines = count_lines(path)
        if lines > limit:
            found.append(f"{name}:{lines} (limit {limit})")
    return found


def main() -> int:
    found = violations(sys.argv[1:])
    for entry in found:
        sys.stdout.write(f"{entry}\n")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
