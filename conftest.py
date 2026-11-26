import re

import pytest
from coverage import CoverageData

SHORT_LIMIT = 60
SLOW_COUNT = 40
OUTSIDE_ALL = 80
_durations: dict[str, float] = {}
type Line = tuple[str, int]
type Row = tuple[str, float, int]


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    _durations[report.nodeid] = _durations.get(report.nodeid, 0.0) + report.duration


def _per_test_lines(data: CoverageData) -> dict[str, set[tuple[str, int]]]:
    found: dict[str, set[tuple[str, int]]] = {}
    for context in data.measured_contexts():
        nodeid = context.split("|", 1)[0]
        if not nodeid:
            continue
        data.set_query_contexts([f"^{re.escape(context)}$"])
        lines = found.setdefault(nodeid, set())
        for path in data.measured_files():
            lines.update((path, line) for line in data.lines(path) or [])
    data.set_query_contexts(None)
    return found


MIN_SECONDS = 0.01


def _set_cover(found: dict[str, set[Line]], seconds: dict[str, float]) -> list[Row]:
    covered: set[Line] = set()
    remaining = {nodeid: lines for nodeid, lines in found.items() if lines}
    cover: list[Row] = []
    while remaining:
        best = max(
            remaining,
            key=lambda n: (len(remaining[n] - covered) / max(seconds[n], MIN_SECONDS), n),
        )
        gain = len(remaining.pop(best) - covered)
        if gain == 0:
            break
        covered |= found[best]
        cover.append((best, seconds[best], gain))
    return cover


def _write_cover(
    terminalreporter: pytest.TerminalReporter,
    found: dict[str, set[Line]],
    seconds: dict[str, float],
) -> None:
    cover = _set_cover(found, seconds)
    chosen = {nodeid for nodeid, _, _ in cover}
    blind = sorted(n for n in seconds if not found.get(n))
    outside = sorted(
        (n for n in seconds if n not in chosen and n not in blind), key=lambda n: -seconds[n]
    )
    terminalreporter.section("per-test set cover")
    terminalreporter.write_line(
        "Greedy cover: the largest gain of new lines per second comes first."
    )
    terminalreporter.write_line("seconds  new lines  test (in the cover)")
    for nodeid, duration, gain in cover:
        terminalreporter.write_line(f"{duration:7.2f}  {gain:9d}  {nodeid}")
    total = sum(seconds[n] for n in outside)
    terminalreporter.write_line(
        f"Outside the cover: {len(outside)} tests, {total:.2f} seconds in total."
    )
    all_shown = len(outside) <= OUTSIDE_ALL
    if outside:
        label = "all" if all_shown else f"the {SLOW_COUNT} slowest"
        terminalreporter.write_line(f"Tests outside the cover ({label}):")
        for nodeid in outside if all_shown else outside[:SLOW_COUNT]:
            terminalreporter.write_line(f"{seconds[nodeid]:7.2f}  {nodeid}")
    if blind:
        names = ", ".join(blind) if len(blind) <= SLOW_COUNT else f"{len(blind)} tests"
        terminalreporter.write_line(f"No per-test data (work in a child process): {names}")


@pytest.hookimpl(trylast=True)
def pytest_terminal_summary(
    terminalreporter: pytest.TerminalReporter, config: pytest.Config
) -> None:
    plugin = config.pluginmanager.get_plugin("_cov")
    controller = getattr(plugin, "cov_controller", None)
    cov = getattr(controller, "cov", None)
    if not _durations:
        return
    found: dict[str, set[Line]] = {}
    if cov is not None:
        try:
            found = _per_test_lines(cov.get_data())
        except Exception:
            found = {}
    if found:
        _write_cover(terminalreporter, found, _durations)
        return
    rows = sorted(_durations.items(), key=lambda row: row[1], reverse=True)
    if len(rows) > SHORT_LIMIT:
        rows = rows[:SLOW_COUNT]
    terminalreporter.section("per-test time")
    terminalreporter.write_line("seconds  test")
    for nodeid, duration in rows:
        terminalreporter.write_line(f"{duration:7.2f}  {nodeid}")
