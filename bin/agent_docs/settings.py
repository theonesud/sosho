import fnmatch
import glob
import json
import os
import subprocess

from .common import (
    ADAPTERS,
    GUARD_CASES,
    LEGACY_TERMS,
    MODEL_CONFIGS,
    RULE_FILES,
    SCRIPTS,
    Obj,
    as_list,
    as_obj,
    fail,
    files_under,
    jload,
    notes,
    read,
    walk,
)

GUARD = os.path.abspath("bin/agent-guard.py")

type Rule = tuple[object, object, object]


def is_command(path: tuple[str, ...]) -> bool:
    return path[-1:] == ("command",)


def check_hooks() -> None:
    hooks = as_obj(jload(".claude/settings.json").get("hooks"))
    commands = " ".join(v for p, v in walk(hooks) if is_command(p) and isinstance(v, str))
    for s in SCRIPTS:
        if s not in commands:
            fail(f".claude/settings.json hooks do not call {s}")
    matcher = {
        t
        for entry in as_list(hooks.get("PreToolUse"))
        for t in str(as_obj(entry).get("matcher", "")).split("|")
    }
    for tool in ["Read", "Edit", "Write", "Bash"]:
        if tool not in matcher:
            fail(f".claude/settings.json PreToolUse matcher lacks {tool}")
    for path, name in ADAPTERS.items():
        for s in [*SCRIPTS, "agent-guard.py"]:
            if os.path.isfile(path) and s not in read(path):
                fail(f"{name} adapter {path} does not call {s}")
    hook_json = jload(".agents/hooks.json")
    for event in ["PreToolUse", "PostToolUse"]:
        if not any(
            is_command(p) and event in p and "agent-hook-antigravity.sh" in str(v)
            for p, v in walk(hook_json)
        ):
            fail(f".agents/hooks.json {event} does not call agent-hook-antigravity.sh")


def check_guard_smoke() -> None:
    for i, (payload, want) in enumerate(GUARD_CASES, 1):
        try:
            r = subprocess.run(  # noqa: S603
                [GUARD],
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as e:
            fail(f"bin/agent-guard.py smoke case {i} did not run: {e}")
            continue
        if r.returncode != want:
            fail(f"bin/agent-guard.py smoke case {i} exit {r.returncode}, expected {want}")


def check_pi_paths() -> None:
    cfg = jload(".pi/settings.json")
    for key in ["extensions", "skills"]:
        for e in as_list(cfg.get(key)):
            if not isinstance(e, str) or not e.startswith(("./", "../")):
                continue
            if not os.path.exists(os.path.normpath(os.path.join(".pi", e))):
                fail(f".pi/settings.json {key} entry {e} does not resolve from .pi/")


def argv(server: object) -> list[object]:
    data = as_obj(server)
    cmd = data.get("command", [])
    if isinstance(cmd, str):
        return [cmd, *as_list(data.get("args", []))]
    return as_list(cmd)


def server_map(servers: object) -> dict[str, list[object]]:
    return {n: argv(s) for n, s in as_obj(servers).items()}


def check_mcp() -> None:
    oc = as_obj(jload("opencode.json").get("mcp"))
    maps = {
        f: server_map(jload(f).get("mcpServers"))
        for f in [".mcp.json", ".pi/mcp.json", ".agents/mcp_config.json"]
    }
    maps["opencode.json"] = server_map(oc.get("servers", oc))
    base = maps[".mcp.json"]
    for f, m in maps.items():
        if set(m) != set(base):
            fail(f"MCP server names in {f} differ from .mcp.json: {sorted(set(m) ^ set(base))}")
        for n in sorted(set(m) & set(base)):
            if m[n] != base[n]:
                fail(f"MCP server {n} in {f} differs from .mcp.json: {m[n]} vs {base[n]}")


def opencode_rules() -> list[Rule]:
    cfg = jload("opencode.json")
    rules: list[Rule] = []
    for action, value in as_obj(cfg.get("permission")).items():
        if isinstance(value, str):
            rules.append((action, "*", value))
        else:
            rules += [(action, pattern, eff) for pattern, eff in as_obj(value).items()]
    for r in as_list(cfg.get("permissions")):
        item = as_obj(r)
        rules.append((item.get("action"), item.get("resource"), item.get("effect")))
    return rules


def effect(rules: list[Rule], action: str, path: str) -> object:
    result = None
    for act, pattern, eff in rules:
        if (
            act == action
            and isinstance(pattern, str)
            and pattern
            and fnmatch.fnmatchcase(path, pattern)
        ):
            result = eff
    return result


def check_secrets() -> None:
    deny = as_list(as_obj(jload(".claude/settings.json").get("permissions")).get("deny"))
    for rule in ["Read(./.env)", "Edit(./.env)", *[f"Edit(./{f})" for f in MODEL_CONFIGS]]:
        if rule not in deny:
            fail(f".claude/settings.json permissions.deny lacks {rule}")
    rules = opencode_rules()
    if effect(rules, "edit", ".env") != "deny":
        fail("opencode.json does not deny edit of .env")
    if any(act == "read" for act, _, _ in rules) and effect(rules, "read", ".env") != "deny":
        fail("opencode.json does not deny read of .env")
    for f in MODEL_CONFIGS:
        if effect(rules, "edit", f) != "deny":
            fail(f"opencode.json does not deny edit of {f}")


def legacy_scope() -> list[str]:
    files = [
        "AGENTS.md",
        ".claude/CLAUDE.md",
        ".claude/settings.json",
        ".agents/hooks.json",
        ".agents/mcp_config.json",
        ".mcp.json",
        "opencode.json",
        *RULE_FILES,
    ]
    files += files_under(".opencode") + glob.glob(".pi/*.md") + files_under(".agents/skills")
    skipped = ["models*.json", "model-roles*.json", "auth.json"]
    files += [
        p
        for p in glob.glob(".pi/*.json")
        if not any(fnmatch.fnmatch(os.path.basename(p), x) for x in skipped)
    ]
    for d in glob.glob(".pi/extensions/*/src"):
        files += files_under(d)
    return files


def check_legacy_refs() -> None:
    for f in sorted(set(legacy_scope())):
        if not os.path.isfile(f) or f.startswith(".agents/skills/impeccable/"):
            continue
        for term in LEGACY_TERMS:
            if term in read(f):
                fail(f"{f} refers to {term}")
    for f in files_under(".agents/skills"):
        if ".pi/skills/" in read(f):
            fail(f"{f} refers to .pi/skills/")


def known_model(providers: Obj, provider: object, model: object) -> bool:
    models = as_list(as_obj(providers.get(str(provider))).get("models"))
    return model in [as_obj(x).get("id") for x in models]


def check_model_tiers() -> None:
    roles = as_obj(jload(".pi/model-roles.json").get("roles"))
    providers = as_obj(jload(".pi/models.json").get("providers"))
    for name, role in roles.items():
        data = as_obj(role)
        targets = [(name, data)]
        if "fallback" in data:
            targets.append((name + " fallback", as_obj(data["fallback"])))
        for label, t in targets:
            if not known_model(providers, t.get("provider"), t.get("model")):
                fail(
                    f"model role {label} uses {t.get('provider')} {t.get('model')},"
                    " not in .pi/models.json"
                )
    for x in as_list(as_obj(providers.get("litellm")).get("models")):
        if as_obj(x).get("id") not in roles:
            fail(f"litellm model {as_obj(x).get('id')} has no role in .pi/model-roles.json")
    if os.path.isfile(".pi/model-roles.next.json"):
        notes.append(
            "NOTE: .pi/model-roles.next.json holds a proposed tier change. It waits for the owner."
        )
