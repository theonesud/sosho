from .common import fails, notes
from .settings import (
    check_guard_smoke,
    check_hooks,
    check_legacy_refs,
    check_mcp,
    check_model_tiers,
    check_pi_paths,
    check_secrets,
)
from .sources import (
    check_append_and_compose,
    check_files_and_sizes,
    check_json_and_links,
    check_rule_parity,
    check_skills,
)

CHECKS = [
    check_files_and_sizes,
    check_json_and_links,
    check_rule_parity,
    check_hooks,
    check_guard_smoke,
    check_pi_paths,
    check_skills,
    check_mcp,
    check_secrets,
    check_legacy_refs,
    check_model_tiers,
    check_append_and_compose,
]


def run() -> tuple[int, list[str]]:
    for check in CHECKS:
        check()
    lines = [*notes, "\n".join(fails) if fails else "PASS: agent configuration is valid"]
    return (1 if fails else 0), lines
