#!/usr/bin/env bash
# Check the agent configuration files. Print one PASS line or one FAIL line per problem.
cd -P "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

python3 - <<'PY'
import fnmatch, glob, json, os, re, subprocess, sys

fails, notes = [], []
STD = ["code", "typescript", "python", "testing", "git"]
ADAPTERS = {".pi/extensions/guard/src/index.ts": "pi", ".opencode/plugins/guard.ts": "OpenCode",
            "bin/agent-hook-antigravity.sh": "Antigravity"}
REQUIRED = ["AGENTS.md", ".claude/CLAUDE.md", ".claude/settings.json", "opencode.json", ".mcp.json",
            ".pi/settings.json", ".pi/mcp.json", ".pi/models.json", ".pi/model-roles.json",
            ".agents/hooks.json", ".agents/mcp_config.json", "bin/agent-guard.sh",
            "bin/agent-post-edit.sh", "bin/agent-format.sh"] + list(ADAPTERS) + [f"docs/standards/{n}.md" for n in STD]
JSON_FILES = [f for f in REQUIRED if f.endswith(".json")]
SCRIPTS = ["agent-guard.sh", "agent-post-edit.sh", "agent-format.sh"]
MODEL_CONFIGS = [".pi/models.json", ".pi/model-roles.json"]
LEGACY_TERMS = ["legacy/", "docs/context", "REFACTOR_PLAN.md", "PRODUCT.md", "DESIGN.md"]
GUARD_CASES = [
    ({"tool_name": "Edit", "tool_input": {"file_path": ".env", "new_string": "x"}}, 2),
    ({"tool_name": "Read", "tool_input": {"file_path": ".env"}}, 2),
    ({"tool_name": "Read", "tool_input": {"file_path": ".pi/models.json"}}, 0),
    ({"toolName": "write", "input": {"path": ".pi/model-roles.json", "content": "x"}}, 2),
    ({"tool": "bash", "args": {"command": "cat " + ".env"}}, 2),
    ({"tool_name": "Edit", "tool_input": {"file_path": "README.md", "new_string": "x"}}, 0),
]
RULE_FILES = sorted(glob.glob(".claude/rules/*.md")) + sorted(glob.glob(".agents/rules/*.md"))


def fail(msg):
    fails.append("FAIL: " + msg)


def read(path):
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


def jload(path):
    try:
        return json.loads(read(path))
    except (OSError, ValueError):
        return None


def walk(node, path=()):
    if isinstance(node, dict):
        for key, value in node.items():
            yield from walk(value, path + (key,))
    elif isinstance(node, list):
        for value in node:
            yield from walk(value, path)
    else:
        yield path, node


def expand(pattern):
    m = re.search(r"\{([^{}]*)\}", pattern)
    if not m:
        return [pattern]
    return [x for alt in m.group(1).split(",")
            for x in expand(pattern[:m.start()] + alt + pattern[m.end():])]


def files_under(directory):
    return [os.path.join(r, n) for r, _, names in os.walk(directory) for n in names] \
        if os.path.isdir(directory) else []


def check_files_and_sizes():
    for f in REQUIRED:
        if not os.path.isfile(f):
            fail(f"missing file {f}")
    for f in ["CLAUDE.md", "GEMINI.md", ".codex", ".pi/skills", ".pi/SYSTEM.md"]:
        if os.path.exists(f):
            fail(f"{f} must not exist")
    for f in sorted(glob.glob("bin/agent-*.sh")) + ["bin/check-agent-docs.sh"]:
        if os.path.isfile(f) and not os.access(f, os.X_OK):
            fail(f"{f} must be executable")
    if os.path.isfile("AGENTS.md") and len(read("AGENTS.md").splitlines()) > 120:
        fail("AGENTS.md has more than 120 lines")
    if os.path.isfile(".claude/CLAUDE.md"):
        body = [x.strip() for x in read(".claude/CLAUDE.md").splitlines() if x.strip()]
        if len(body) > 25:
            fail(".claude/CLAUDE.md has more than 25 lines")
        if not body or body[0] != "@../AGENTS.md":
            fail(".claude/CLAUDE.md first line must be @../AGENTS.md")
    link = ".claude/skills"
    if not os.path.islink(link) or os.path.realpath(link) != os.path.realpath(".agents/skills"):
        fail(".claude/skills must be a symlink to .agents/skills")
    for f in RULE_FILES:
        if len(read(f).splitlines()) > 15:
            fail(f"{f} has more than 15 lines")
    for f in sorted(glob.glob(".agents/rules/*.md")):
        head = read(f).splitlines()[:4]
        if len(head) < 4 or head[0] != "---" or head[1] != "trigger: glob" \
                or not head[2].startswith("globs: ") or head[3] != "---":
            fail(f"{f} must start with trigger: glob and globs: lines")


def check_json_and_links():
    for f in JSON_FILES:
        try:
            json.loads(read(f))
        except (OSError, ValueError) as e:
            fail(f"{f} is not valid JSON: {e}")
    docs = ["AGENTS.md", ".claude/CLAUDE.md"] + sorted(glob.glob("docs/standards/*.md")) + RULE_FILES
    for f in docs:
        if not os.path.isfile(f):
            continue
        text = read(f)
        refs = re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", text) + re.findall(r"^@(\S+)\s*$", text, re.M)
        for target in refs:
            if re.match(r"^[a-z]+:", target):
                continue
            if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), target))):
                fail(f"{f} has a broken link {target}")


def claude_globs(text):
    block = text.split("---", 2)[1] if text.startswith("---") else ""
    return re.findall(r'^\s+-\s+"?([^"\n]+?)"?\s*$', block, re.M)


def antigravity_globs(text):
    m = re.search(r"^globs:\s*(.+)$", text, re.M)
    return m.group(1).strip().strip('"').split(",") if m else []


def normal_globs(globs):
    return {p.strip() for g in globs for p in expand(g.strip()) if p.strip()}


def check_rule_parity():
    def names(directory):
        return {os.path.basename(p) for p in glob.glob(directory + "/*.md")}
    claude, antigravity = names(".claude/rules"), names(".agents/rules")
    if claude != antigravity:
        fail(f"rule file names differ: {sorted(claude ^ antigravity)}")
    for n in sorted(claude & antigravity):
        c = normal_globs(claude_globs(read(".claude/rules/" + n)))
        a = normal_globs(antigravity_globs(read(".agents/rules/" + n)))
        if c != a:
            fail(f"rule {n} globs differ: Claude {sorted(c)} vs Antigravity {sorted(a)}")


def check_hooks():
    hooks = (jload(".claude/settings.json") or {}).get("hooks", {})
    commands = " ".join(v for p, v in walk(hooks) if p[-1:] == ("command",) and isinstance(v, str))
    for s in SCRIPTS:
        if s not in commands:
            fail(f".claude/settings.json hooks do not call {s}")
    matcher = {t for entry in hooks.get("PreToolUse", []) for t in entry.get("matcher", "").split("|")}
    for tool in ["Read", "Edit", "Write", "Bash"]:
        if tool not in matcher:
            fail(f".claude/settings.json PreToolUse matcher lacks {tool}")
    for path, name in ADAPTERS.items():
        for s in SCRIPTS + ["agent-guard.sh"]:
            if os.path.isfile(path) and s not in read(path):
                fail(f"{name} adapter {path} does not call {s}")
    hook_json = jload(".agents/hooks.json") or {}
    for event in ["PreToolUse", "PostToolUse"]:
        if not any(p[-1:] == ("command",) and event in p and "agent-hook-antigravity.sh" in str(v)
                   for p, v in walk(hook_json)):
            fail(f".agents/hooks.json {event} does not call agent-hook-antigravity.sh")


def check_guard_smoke():
    for i, (payload, want) in enumerate(GUARD_CASES, 1):
        try:
            r = subprocess.run(["bin/agent-guard.sh"], input=json.dumps(payload),
                               capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired) as e:
            fail(f"bin/agent-guard.sh smoke case {i} did not run: {e}")
            continue
        if r.returncode != want:
            fail(f"bin/agent-guard.sh smoke case {i} exit {r.returncode}, expected {want}")


def check_pi_paths():
    cfg = jload(".pi/settings.json") or {}
    for key in ["extensions", "skills"]:
        for e in cfg.get(key, []):
            if e.startswith(("./", "../")) and not os.path.exists(os.path.normpath(os.path.join(".pi", e))):
                fail(f".pi/settings.json {key} entry {e} does not resolve from .pi/")


def frontmatter(text):
    lines = text.splitlines()
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)
    return {m.group(1): m.group(2).strip().strip('"')
            for m in (re.match(r"^([A-Za-z_-]+):\s*(.*)$", x) for x in lines[1:end]) if m}


def check_skills():
    for d in sorted(glob.glob(".agents/skills/*/")):
        name = os.path.basename(d.rstrip("/"))
        path = os.path.join(d, "SKILL.md")
        if not os.path.isfile(path):
            fail(f"{d} has no SKILL.md")
            continue
        fm = frontmatter(read(path))
        if fm.get("name") != name:
            fail(f"{path} frontmatter name must be {name}")
        if not fm.get("description"):
            fail(f"{path} frontmatter needs a non-empty description")


def argv(server):
    cmd = server.get("command", [])
    return [cmd] + list(server.get("args", [])) if isinstance(cmd, str) else list(cmd)


def check_mcp():
    oc = (jload("opencode.json") or {}).get("mcp", {})
    raw = {f: (jload(f) or {}).get("mcpServers", {}) for f in [".mcp.json", ".pi/mcp.json", ".agents/mcp_config.json"]}
    # The deprecated form puts server names at the top level of "mcp".
    raw["opencode.json"] = oc.get("servers", oc)
    maps = {f: {n: argv(s) for n, s in servers.items()} for f, servers in raw.items()}
    base = maps[".mcp.json"]
    for f, m in maps.items():
        if set(m) != set(base):
            fail(f"MCP server names in {f} differ from .mcp.json: {sorted(set(m) ^ set(base))}")
        for n in sorted(set(m) & set(base)):
            if m[n] != base[n]:
                fail(f"MCP server {n} in {f} differs from .mcp.json: {m[n]} vs {base[n]}")


def opencode_rules():
    cfg = jload("opencode.json") or {}
    rules, perm = [], cfg.get("permission", {})
    for action, value in (perm.items() if isinstance(perm, dict) else []):
        if isinstance(value, str):
            rules.append((action, "*", value))
        elif isinstance(value, dict):
            rules += [(action, pattern, eff) for pattern, eff in value.items()]
    if isinstance(cfg.get("permissions"), list):
        rules += [(r.get("action"), r.get("resource"), r.get("effect")) for r in cfg["permissions"]]
    return rules


def effect(rules, action, path):
    result = None
    for act, pattern, eff in rules:
        if act == action and pattern and fnmatch.fnmatchcase(path, pattern):
            result = eff  # The last matching rule wins.
    return result


def check_secrets():
    deny = ((jload(".claude/settings.json") or {}).get("permissions") or {}).get("deny", [])
    for rule in ["Read(./.env)", "Edit(./.env)"] + [f"Edit(./{f})" for f in MODEL_CONFIGS]:
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


def legacy_scope():
    files = ["AGENTS.md", ".claude/CLAUDE.md", ".claude/settings.json", ".agents/hooks.json",
             ".agents/mcp_config.json", ".mcp.json", "opencode.json"] + RULE_FILES
    files += files_under(".opencode") + glob.glob(".pi/*.md") + files_under(".agents/skills")
    files += [p for p in glob.glob(".pi/*.json") if not any(
        fnmatch.fnmatch(os.path.basename(p), x) for x in ["models*.json", "model-roles*.json", "auth.json"])]
    for d in glob.glob(".pi/extensions/*/src"):
        files += files_under(d)
    return files


def check_legacy_refs():
    for f in sorted(set(legacy_scope())):
        if not os.path.isfile(f) or f.startswith(".agents/skills/impeccable/"):
            continue
        for term in LEGACY_TERMS:
            if term in read(f):
                fail(f"{f} refers to {term}")
    for f in files_under(".agents/skills"):
        if ".pi/skills/" in read(f):
            fail(f"{f} refers to .pi/skills/")


def check_model_tiers():
    roles = (jload(".pi/model-roles.json") or {}).get("roles", {})
    providers = (jload(".pi/models.json") or {}).get("providers", {})

    def known(provider, model):
        return model in [x.get("id") for x in providers.get(provider, {}).get("models", [])]

    for name, role in roles.items():
        targets = [(name, role)]
        if "fallback" in role:
            targets.append((name + " fallback", role["fallback"]))
        for label, t in targets:
            if not known(t.get("provider"), t.get("model")):
                fail(f"model role {label} uses {t.get('provider')} {t.get('model')}, not in .pi/models.json")
    for x in providers.get("litellm", {}).get("models", []):
        if x.get("id") not in roles:
            fail(f"litellm model {x.get('id')} has no role in .pi/model-roles.json")
    if os.path.isfile(".pi/model-roles.next.json"):
        notes.append("NOTE: .pi/model-roles.next.json holds a proposed tier change. It waits for the owner.")


def check_append_and_compose():
    if os.path.isfile(".pi/APPEND_SYSTEM.md") and "ASD-STE100" in read(".pi/APPEND_SYSTEM.md"):
        fail(".pi/APPEND_SYSTEM.md repeats the style rules. Keep them in AGENTS.md only")
    for d, dirs, files in os.walk("."):
        dirs[:] = [x for x in dirs if x not in {"node_modules", "models", ".git"}]
        for n in files:
            if re.match(r"(docker-)?compose.*\.ya?ml$", n) and "/var/run/docker.sock" in read(os.path.join(d, n)):
                fail(f"{os.path.join(d, n)} mounts /var/run/docker.sock")


CHECKS = [check_files_and_sizes, check_json_and_links, check_rule_parity, check_hooks,
          check_guard_smoke, check_pi_paths, check_skills, check_mcp, check_secrets,
          check_legacy_refs, check_model_tiers, check_append_and_compose]
for check in CHECKS:
    check()
for note in notes:
    print(note)
print("\n".join(fails) if fails else "PASS: agent configuration is valid")
sys.exit(1 if fails else 0)
PY
