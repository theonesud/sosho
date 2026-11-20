#!/usr/bin/env bash
# Check the agent configuration files. Print one PASS line or a list of FAIL lines.
cd -P "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

python3 - <<'PY'
import glob, json, os, re, sys

fails = []
def fail(msg): fails.append("FAIL: " + msg)
def lines(p): return open(p).read().splitlines()

for f in ["AGENTS.md", ".claude/CLAUDE.md", ".claude/settings.json", "opencode.json", "bin/agent-guard.sh"]:
    if not os.path.isfile(f): fail(f"missing file {f}")
for f in ["CLAUDE.md", "GEMINI.md", ".codex"]:
    if os.path.exists(f): fail(f"{f} must not exist")

if os.path.isfile("AGENTS.md") and len(lines("AGENTS.md")) > 120:
    fail("AGENTS.md has more than 120 lines")
if os.path.isfile(".claude/CLAUDE.md"):
    body = lines(".claude/CLAUDE.md")
    if len(body) > 25: fail(".claude/CLAUDE.md has more than 25 lines")
    first = next((l for l in body if l.strip()), "")
    if first.strip() != "@../AGENTS.md": fail(".claude/CLAUDE.md first line must be @../AGENTS.md")

link = ".claude/skills"
if not os.path.islink(link) or os.path.realpath(link) != os.path.realpath(".agents/skills"):
    fail(".claude/skills must be a symlink to .agents/skills")

for f in [".claude/settings.json", "opencode.json"]:
    if os.path.isfile(f):
        try: json.load(open(f))
        except Exception as e: fail(f"{f} is not valid JSON: {e}")

STD = ["code", "typescript", "python", "testing", "git"]
for n in STD:
    if not os.path.isfile(f"docs/standards/{n}.md"): fail(f"missing file docs/standards/{n}.md")

docs = ["AGENTS.md", ".claude/CLAUDE.md"] + sorted(glob.glob("docs/standards/*.md"))
rules = sorted(glob.glob(".claude/rules/*.md")) + sorted(glob.glob(".agents/rules/*.md"))
for f in docs + rules:
    if not os.path.isfile(f): continue
    text = open(f).read()
    refs = re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", text)
    refs += re.findall(r"^@(\S+)\s*$", text, re.M)
    for t in refs:
        if re.match(r"^[a-z]+:", t): continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), t))):
            fail(f"{f} has a broken link {t}")

for f in rules:
    if len(lines(f)) > 15: fail(f"{f} has more than 15 lines")
for f in glob.glob(".agents/rules/*.md"):
    head = lines(f)[:4]
    if head[0] != "---" or head[1] != "trigger: glob" or not head[2].startswith("globs: ") or head[3] != "---":
        fail(f"{f} must start with trigger: glob and globs: lines")

skip = {"node_modules", "models", ".git"}
for d, dirs, files in os.walk("."):
    dirs[:] = [x for x in dirs if x not in skip]
    for n in files:
        if re.match(r"(docker-)?compose.*\.ya?ml$", n):
            p = os.path.join(d, n)
            if "/var/run/docker.sock" in open(p, errors="ignore").read():
                fail(f"{p} mounts /var/run/docker.sock")

print("\n".join(fails) if fails else "PASS: agent configuration is valid")
sys.exit(1 if fails else 0)
PY
