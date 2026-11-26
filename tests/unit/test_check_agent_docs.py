import importlib
import importlib.util
import json
import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from tests.conftest import ROOT

BIN = ROOT / "bin"
ENV_FILE = "." + "env"


def _import_package() -> None:
    sys.path.insert(0, str(BIN))
    cwd = Path.cwd()
    os.chdir(ROOT)
    try:
        importlib.import_module("agent_docs")
    finally:
        os.chdir(cwd)
        sys.path.remove(str(BIN))


_import_package()

from agent_docs import common, run, settings, sources  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_state() -> Iterator[None]:
    common.fails.clear()
    common.notes.clear()
    yield
    common.fails.clear()
    common.notes.clear()


@pytest.fixture
def tree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sources, "RULE_FILES", [])
    monkeypatch.setattr(settings, "RULE_FILES", [])
    return tmp_path


@pytest.fixture
def repo(monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(ROOT)
    return ROOT


def _put(name: str, text: str = "") -> None:
    path = Path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def _put_json(name: str, data: object) -> None:
    _put(name, json.dumps(data))


def _failed(*parts: str) -> bool:
    return any(all(p in line for p in parts) for line in common.fails)


def test_real_repo_passes(repo: Path) -> None:
    del repo
    code, lines = run()
    assert code == 0, lines
    assert "PASS: agent configuration is valid" in lines[-1]


def test_main_changes_to_the_repo_root(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    spec = importlib.util.spec_from_file_location(
        "check_agent_docs_main", BIN / "check-agent-docs.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setattr(sys, "path", [str(BIN), *sys.path])
    spec.loader.exec_module(module)
    monkeypatch.chdir(tmp_path)
    assert module.main() == 0
    assert "PASS" in capsys.readouterr().out
    assert Path.cwd() == ROOT


def test_run_reports_failures_in_an_empty_tree(tree: Path) -> None:
    del tree
    code, lines = run()
    assert code == 1
    assert "FAIL: missing file AGENTS.md" in lines[-1]


def test_required_files_and_forbidden_files(tree: Path) -> None:
    del tree
    _put("GEMINI.md")
    _put("bin/agent-format.sh")
    sources.check_required_files()
    assert _failed("missing file .claude/CLAUDE.md")
    assert _failed("GEMINI.md must not exist")
    assert _failed("bin/agent-format.sh must be executable")


def test_claude_md_must_import_agents_md(tree: Path) -> None:
    del tree
    _put(".claude/CLAUDE.md", "# Title\n")
    sources.check_claude_md()
    assert _failed("first line must be @../AGENTS.md")


def test_claude_md_and_agents_md_have_a_line_limit(tree: Path) -> None:
    del tree
    _put(".claude/CLAUDE.md", "@../AGENTS.md\n" + "x\n" * 1001)
    _put("AGENTS.md", "x\n" * 1001)
    sources.check_claude_md()
    assert _failed("AGENTS.md has more than 1000 lines")
    assert _failed(".claude/CLAUDE.md has more than 1000 lines")


def test_rule_files_need_a_skills_link_and_a_header(tree: Path) -> None:
    del tree
    _put(".agents/rules/a.md", "---\ntrigger: always\n---\n")
    sources.check_rule_files()
    assert _failed(".claude/skills must be a symlink")
    assert _failed(".agents/rules/a.md must start with trigger: glob")


def test_rule_files_accept_a_good_header_and_link(tree: Path) -> None:
    _put(".agents/rules/a.md", '---\ntrigger: glob\nglobs: "*.py"\n---\nbody\n')
    (tree / ".agents/skills").mkdir()
    (tree / ".claude").mkdir()
    (tree / ".claude/skills").symlink_to("../.agents/skills")
    sources.check_rule_files()
    assert common.fails == []


def test_json_files_and_broken_links_fail(tree: Path) -> None:
    del tree
    _put(".mcp.json", "{not json")
    _put("AGENTS.md", "See [a](docs/a.md) and [b](https://x.test) and [c](#top).\n")
    _put(".claude/CLAUDE.md", "@../missing.md\n")
    _put("docs/a.md")
    _put("docs/standards/code.md", "[gone](nowhere.md#h)\n")
    sources.check_json_and_links()
    assert _failed(".mcp.json is not valid JSON")
    assert _failed(".claude/CLAUDE.md has a broken link ../missing.md")
    assert _failed("docs/standards/code.md has a broken link nowhere.md")
    assert not _failed("AGENTS.md has a broken link")


def test_rule_parity_detects_name_differences_and_accepts_brace_globs(tree: Path) -> None:
    del tree
    _put(".claude/rules/a.md", '---\npaths:\n  - "**/*.{ts,tsx}"\n---\n')
    _put(".agents/rules/a.md", "---\ntrigger: glob\nglobs: **/*.ts,**/*.tsx\n---\n")
    _put(".claude/rules/b.md", '---\npaths:\n  - "x"\n---\n')
    _put(".agents/rules/c.md", "---\ntrigger: glob\nglobs: x\n---\n")
    sources.check_rule_parity()
    assert _failed("rule file names differ")
    assert not _failed("rule a.md globs differ")


def test_rule_parity_reports_a_glob_mismatch(tree: Path) -> None:
    del tree
    _put(".claude/rules/a.md", '---\npaths:\n  - "x"\n---\n')
    _put(".agents/rules/a.md", "---\ntrigger: glob\nglobs: y\n---\n")
    sources.check_rule_parity()
    assert _failed("rule a.md globs differ")


def test_skills_need_a_matching_name_and_a_description(tree: Path) -> None:
    del tree
    _put(".agents/skills/good/SKILL.md", "---\nname: good\ndescription: ok\n---\n")
    _put(".agents/skills/bad/SKILL.md", "---\nname: other\ndescription:\n---\n")
    Path(".agents/skills/empty").mkdir(parents=True)
    sources.check_skills()
    assert _failed(".agents/skills/bad/SKILL.md frontmatter name must be bad")
    assert _failed("bad/SKILL.md frontmatter needs a non-empty description")
    assert _failed(".agents/skills/empty/ has no SKILL.md")
    assert not _failed("good")


def test_append_file_and_compose_files_are_checked(tree: Path) -> None:
    del tree
    _put(".pi/APPEND_SYSTEM.md", "Use ASD-STE100.\n")
    _put("docker/compose.yaml", "volumes:\n  - /var/run/docker.sock:/s\n")
    _put("models/compose.yaml", "/var/run/docker.sock\n")
    sources.check_append_and_compose()
    assert _failed(".pi/APPEND_SYSTEM.md repeats the style rules")
    assert _failed("docker/compose.yaml mounts /var/run/docker.sock")
    assert not _failed("models/compose.yaml")


def test_hooks_must_call_the_shared_scripts(tree: Path) -> None:
    del tree
    _put_json(".claude/settings.json", {"hooks": {"PreToolUse": [{"matcher": "Read|Edit"}]}})
    _put(".opencode/plugins/guard.ts", "agent-guard.py")
    settings.check_hooks()
    assert _failed(".claude/settings.json hooks do not call agent-post-edit.sh")
    assert _failed("PreToolUse matcher lacks Bash")
    assert _failed("OpenCode adapter .opencode/plugins/guard.ts does not call agent-format.sh")
    assert _failed(".agents/hooks.json PostToolUse does not call agent-hook-antigravity.sh")


def test_hooks_pass_with_a_complete_setup(tree: Path) -> None:
    del tree
    commands = [{"hooks": [{"command": f"bin/{s}"}]} for s in common.SCRIPTS]
    _put_json(
        ".claude/settings.json",
        {"hooks": {"PreToolUse": [{"matcher": "Read|Edit|Write|Bash", "hooks": commands}]}},
    )
    entry = {"command": "bin/agent-hook-antigravity.sh"}
    _put_json(".agents/hooks.json", {"PreToolUse": [entry], "PostToolUse": [entry]})
    settings.check_hooks()
    assert common.fails == []


def test_guard_smoke_cases_run_the_real_guard(repo: Path) -> None:
    del repo
    settings.check_guard_smoke()
    assert common.fails == []


def test_guard_smoke_fails_when_the_guard_is_missing(
    monkeypatch: pytest.MonkeyPatch, tree: Path
) -> None:
    monkeypatch.setattr(settings, "GUARD", str(tree / "no-guard"))
    settings.check_guard_smoke()
    assert _failed("smoke case 1 did not run")


def test_guard_smoke_fails_on_a_wrong_exit_code(
    monkeypatch: pytest.MonkeyPatch, tree: Path
) -> None:
    guard = tree / "guard.sh"
    guard.write_text("#!/bin/sh\nexit 0\n")
    guard.chmod(0o755)
    monkeypatch.setattr(settings, "GUARD", str(guard))
    settings.check_guard_smoke()
    assert _failed("smoke case 1 exit 0, expected 2")


def test_pi_paths_must_resolve(tree: Path) -> None:
    del tree
    _put_json(
        ".pi/settings.json",
        {"extensions": ["./here", "../gone", "npm:pkg", 3], "skills": ["./nope"]},
    )
    Path(".pi/here").mkdir(parents=True)
    settings.check_pi_paths()
    assert _failed("extensions entry ../gone does not resolve")
    assert _failed("skills entry ./nope does not resolve")
    assert not _failed("./here")


def test_mcp_servers_must_match_across_tools(tree: Path) -> None:
    del tree
    _put_json(".mcp.json", {"mcpServers": {"a": {"command": "x", "args": ["1"]}, "b": {}}})
    _put_json(".pi/mcp.json", {"mcpServers": {"a": {"command": "x", "args": ["2"]}, "b": {}}})
    _put_json(".agents/mcp_config.json", {"mcpServers": {"a": {"command": "x", "args": ["1"]}}})
    _put_json("opencode.json", {"mcp": {"a": {"command": ["x", "1"]}, "b": {"command": []}}})
    settings.check_mcp()
    assert _failed("MCP server a in .pi/mcp.json differs")
    assert _failed(".agents/mcp_config.json differ from .mcp.json: ['b']")
    assert not _failed("opencode.json")


def test_secret_rules_must_deny_env_and_model_configs(tree: Path) -> None:
    del tree
    _put_json(".claude/settings.json", {"permissions": {"deny": [f"Read(./{ENV_FILE})"]}})
    _put_json(
        "opencode.json",
        {"permission": {"read": "allow", "edit": {"*": "allow", ".pi/models.json": "deny"}}},
    )
    settings.check_secrets()
    assert _failed(f"permissions.deny lacks Edit(./{ENV_FILE})")
    assert _failed("permissions.deny lacks Edit(./.pi/model-roles.json)")
    assert _failed(f"opencode.json does not deny edit of {ENV_FILE}")
    assert _failed(f"opencode.json does not deny read of {ENV_FILE}")
    assert _failed("opencode.json does not deny edit of .pi/model-roles.json")
    assert not _failed("does not deny edit of .pi/models.json")


def test_secret_rules_accept_a_list_form_permission_set(tree: Path) -> None:
    del tree
    configs = [".pi/models.json", ".pi/model-roles.json"]
    deny = [f"Read(./{ENV_FILE})", f"Edit(./{ENV_FILE})", *[f"Edit(./{c})" for c in configs]]
    _put_json(".claude/settings.json", {"permissions": {"deny": deny}})
    rules = [{"action": "edit", "resource": r, "effect": "deny"} for r in [ENV_FILE, *configs]]
    _put_json("opencode.json", {"permissions": rules})
    settings.check_secrets()
    assert common.fails == []


def test_legacy_terms_are_found_in_agent_files(tree: Path) -> None:
    del tree
    _put("AGENTS.md", "Read REFACTOR_PLAN.md first.\n")
    _put(".agents/skills/s/SKILL.md", "See .pi/skills/x.\n")
    _put(".agents/skills/impeccable/a.md", "PRODUCT.md\n")
    _put(".pi/notes.md", "legacy/ path\n")
    _put(".pi/models.json", "legacy/\n")
    settings.check_legacy_refs()
    assert _failed("AGENTS.md refers to REFACTOR_PLAN.md")
    assert _failed(".pi/notes.md refers to legacy/")
    assert _failed("SKILL.md refers to .pi/skills/")
    assert not _failed("impeccable")
    assert not _failed(".pi/models.json refers")


def test_model_tiers_must_exist_and_have_roles(tree: Path) -> None:
    del tree
    roles = {
        "roles": {
            "decision": {"provider": "litellm", "model": "m1"},
            "chat": {"provider": "litellm", "model": "m1", "fallback": {"model": "zz"}},
        }
    }
    models = {"providers": {"litellm": {"models": [{"id": "m1"}, {"id": "orphan"}]}}}
    _put_json(".pi/model-roles.json", roles)
    _put_json(".pi/models.json", models)
    _put(".pi/model-roles.next.json", "{}")
    settings.check_model_tiers()
    assert _failed("model role chat fallback uses None zz")
    assert _failed("litellm model orphan has no role")
    assert not _failed("model role decision")
    assert any("model-roles.next.json" in n for n in common.notes)


@pytest.mark.parametrize(
    ("pattern", "expected"),
    [
        ("a", ["a"]),
        ("*.{ts,tsx}", ["*.ts", "*.tsx"]),
        ("{a,b}/{c,d}", ["a/c", "a/d", "b/c", "b/d"]),
    ],
)
def test_expand_handles_brace_groups(pattern: str, expected: list[str]) -> None:
    assert sorted(common.expand(pattern)) == sorted(expected)


def test_helpers_tolerate_bad_input(tree: Path) -> None:
    del tree
    _put("bad.json", "[1]")
    assert common.jload("bad.json") == {}
    assert common.jload("absent.json") == {}
    assert common.as_obj(None) == {}
    assert common.as_list("x") == []
    assert common.files_under("absent") == []
    _put("d/e/f.txt")
    assert common.files_under("d") == [str(Path("d/e/f.txt"))]
    paths = [p for p, _ in common.walk({"a": [{"b": 1}, 2], "c": 3})]
    assert paths == [("a", "b"), ("a",), ("c",)]


def test_frontmatter_argv_and_effect_helpers() -> None:
    assert sources.frontmatter('---\nname: "x"\nlist: a: b\n---\nbody: no\n') == {
        "name": "x",
        "list": "a: b",
    }
    assert sources.frontmatter("no header") == {}
    assert settings.argv({"command": "x", "args": ["1"]}) == ["x", "1"]
    assert settings.argv({"command": ["x", "1"]}) == ["x", "1"]
    rules: list[settings.Rule] = [("edit", "*.md", "allow"), ("edit", "a.md", "deny")]
    assert settings.effect(rules, "edit", "a.md") == "deny"
    assert settings.effect(rules, "edit", "b.md") == "allow"
    assert settings.effect(rules, "edit", "b.py") is None
