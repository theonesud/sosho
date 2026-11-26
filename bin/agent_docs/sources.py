import glob
import json
import os
import re

from .common import (
    JSON_FILES,
    REQUIRED,
    RULE_FILES,
    expand,
    fail,
    read,
)


def check_required_files() -> None:
    for f in REQUIRED:
        if not os.path.isfile(f):
            fail(f"missing file {f}")
    for f in ["CLAUDE.md", "GEMINI.md", ".codex", ".pi/skills", ".pi/SYSTEM.md"]:
        if os.path.exists(f):
            fail(f"{f} must not exist")
    for f in [*sorted(glob.glob("bin/agent-*.sh")), "bin/check-agent-docs.sh"]:
        if os.path.isfile(f) and not os.access(f, os.X_OK):
            fail(f"{f} must be executable")


def check_claude_md() -> None:
    if os.path.isfile("AGENTS.md") and len(read("AGENTS.md").splitlines()) > 1000:
        fail("AGENTS.md has more than 1000 lines")
    if os.path.isfile(".claude/CLAUDE.md"):
        body = [x.strip() for x in read(".claude/CLAUDE.md").splitlines() if x.strip()]
        if len(body) > 1000:
            fail(".claude/CLAUDE.md has more than 1000 lines")
        if not body or body[0] != "@../AGENTS.md":
            fail(".claude/CLAUDE.md first line must be @../AGENTS.md")


def check_rule_files() -> None:
    link = ".claude/skills"
    if not os.path.islink(link) or os.path.realpath(link) != os.path.realpath(".agents/skills"):
        fail(".claude/skills must be a symlink to .agents/skills")
    for f in RULE_FILES:
        if len(read(f).splitlines()) > 1000:
            fail(f"{f} has more than 1000 lines")
    for f in sorted(glob.glob(".agents/rules/*.md")):
        head = read(f).splitlines()[:4]
        if (
            len(head) < 4
            or head[0] != "---"
            or head[1] != "trigger: glob"
            or not head[2].startswith("globs: ")
            or head[3] != "---"
        ):
            fail(f"{f} must start with trigger: glob and globs: lines")


def check_files_and_sizes() -> None:
    check_required_files()
    check_claude_md()
    check_rule_files()


def check_json_and_links() -> None:
    for f in JSON_FILES:
        try:
            json.loads(read(f))
        except (OSError, ValueError) as e:
            fail(f"{f} is not valid JSON: {e}")
    docs = [
        "AGENTS.md",
        ".claude/CLAUDE.md",
        *sorted(glob.glob("docs/standards/*.md")),
        *RULE_FILES,
    ]
    for f in docs:
        if os.path.isfile(f):
            check_links(f)


def check_links(f: str) -> None:
    text = read(f)
    refs = re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", text) + re.findall(
        r"^@(\S+)\s*$", text, re.MULTILINE
    )
    for target in refs:
        if re.match(r"^[a-z]+:", target):
            continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), target))):
            fail(f"{f} has a broken link {target}")


def claude_globs(text: str) -> list[str]:
    block = text.split("---", 2)[1] if text.startswith("---") else ""
    return re.findall(r'^\s+-\s+"?([^"\n]+?)"?\s*$', block, re.MULTILINE)


def antigravity_globs(text: str) -> list[str]:
    m = re.search(r"^globs:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip().strip('"').split(",") if m else []


def normal_globs(globs: list[str]) -> set[str]:
    return {p.strip() for g in globs for p in expand(g.strip()) if p.strip()}


def rule_names(directory: str) -> set[str]:
    return {os.path.basename(p) for p in glob.glob(directory + "/*.md")}


def check_rule_parity() -> None:
    claude, antigravity = rule_names(".claude/rules"), rule_names(".agents/rules")
    if claude != antigravity:
        fail(f"rule file names differ: {sorted(claude ^ antigravity)}")
    for n in sorted(claude & antigravity):
        c = normal_globs(claude_globs(read(".claude/rules/" + n)))
        a = normal_globs(antigravity_globs(read(".agents/rules/" + n)))
        if c != a:
            fail(f"rule {n} globs differ: Claude {sorted(c)} vs Antigravity {sorted(a)}")


def frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)
    pairs = (re.match(r"^([A-Za-z_-]+):\s*(.*)$", x) for x in lines[1:end])
    return {m.group(1): m.group(2).strip().strip('"') for m in pairs if m}


def check_skills() -> None:
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


def check_append_and_compose() -> None:
    if os.path.isfile(".pi/APPEND_SYSTEM.md") and "ASD-STE100" in read(".pi/APPEND_SYSTEM.md"):
        fail(".pi/APPEND_SYSTEM.md repeats the style rules. Keep them in AGENTS.md only")
    for d, dirs, files in os.walk("."):
        dirs[:] = [x for x in dirs if x not in {"node_modules", "models", ".git"}]
        for n in files:
            path = os.path.join(d, n)
            if re.match(r"(docker-)?compose.*\.ya?ml$", n) and "/var/run/docker.sock" in read(path):
                fail(f"{path} mounts /var/run/docker.sock")
