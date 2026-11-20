#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 - "$ROOT_DIR" <<'PY'
import json
import os
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
errors: list[str] = []

def fail(msg: str) -> None:
    errors.append(msg)

required_files = [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "opencode.json",
    ".pi/SYSTEM.md",
    ".pi/APPEND_SYSTEM.md",
    ".claude/settings.json",
    "bin/agent-guard.sh",
    "bin/agent-post-edit.sh",
    "docs/context/NOW.md",
    "docs/context/DECISIONS.md",
    "docs/context/HISTORY.md",
    "docs/context/ROADMAP.md",
    "apps/studio/AGENTS.md",
    "packages/workflow-engine/AGENTS.md",
    "packages/memory/AGENTS.md",
    "packages/llm/AGENTS.md",
    "yue2/AGENTS.md",
]

for rel in required_files:
    p = root / rel
    if not p.is_file():
        fail(f"Missing required governance file: {rel}")
    elif p.stat().st_size == 0:
        fail(f"Governance file is empty: {rel}")

if errors:
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)

# 1. Verify ASD-STE100 exact sync across Pi (.pi/APPEND_SYSTEM.md) and Antigravity (GEMINI.md)
ste_canonical = (root / ".pi/APPEND_SYSTEM.md").read_text(encoding="utf-8").strip()
gemini_text = (root / "GEMINI.md").read_text(encoding="utf-8").strip()
if not gemini_text.startswith(ste_canonical):
    fail("GEMINI.md drifted from canonical ASD-STE100 rules in .pi/APPEND_SYSTEM.md")
if "AGENTS.md" not in gemini_text:
    fail("GEMINI.md must reference AGENTS.md")

# 2. Verify Claude adapter imports both canonical files
claude_text = (root / "CLAUDE.md").read_text(encoding="utf-8")
for required_import in ("@AGENTS.md", "@.pi/APPEND_SYSTEM.md"):
    if required_import not in claude_text:
        fail(f"CLAUDE.md must import {required_import}")

# 3. Verify OpenCode config includes canonical instructions
try:
    opencode = json.loads((root / "opencode.json").read_text(encoding="utf-8"))
    instr = opencode.get("instructions", [])
    for item in ("AGENTS.md", ".pi/APPEND_SYSTEM.md", "docs/context/NOW.md"):
        if item not in instr:
            fail(f"opencode.json instructions must include {item}")
except Exception as exc:
    fail(f"opencode.json is invalid JSON: {exc}")

# 4. Verify Pi SYSTEM.md references AGENTS.md and check-agent-docs.sh
pi_system = (root / ".pi/SYSTEM.md").read_text(encoding="utf-8")
if "AGENTS.md" not in pi_system:
    fail(".pi/SYSTEM.md must reference AGENTS.md")
if "bin/check-agent-docs.sh" not in pi_system:
    fail(".pi/SYSTEM.md must reference bin/check-agent-docs.sh")

# 5. Verify Claude settings.json is valid JSON
try:
    claude_settings = json.loads((root / ".claude/settings.json").read_text(encoding="utf-8"))
    if "hooks" not in claude_settings:
        fail(".claude/settings.json must define governance hooks")
except Exception as exc:
    fail(f".claude/settings.json is invalid JSON: {exc}")

# 6. Verify all relative markdown links in governance files resolve to real files
md_files = [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "docs/context/NOW.md",
    "docs/context/DECISIONS.md",
    "docs/context/HISTORY.md",
    "docs/context/ROADMAP.md",
    "apps/studio/AGENTS.md",
    "packages/workflow-engine/AGENTS.md",
    "packages/memory/AGENTS.md",
    "packages/llm/AGENTS.md",
    "yue2/AGENTS.md",
]
link_re = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
for rel in md_files:
    fp = root / rel
    text = fp.read_text(encoding="utf-8")
    for match in link_re.finditer(text):
        target = match.group(1).strip()
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        target_path = target.split("#", 1)[0]
        if not target_path:
            continue
        resolved = (fp.parent / target_path).resolve()
        if not resolved.exists():
            fail(f"Broken link in {rel}: {target}")

# 7. Verify ground-truth invariants against runtime code
agents_text = (root / "AGENTS.md").read_text(encoding="utf-8")

studio_pkg = json.loads((root / "apps/studio/package.json").read_text(encoding="utf-8"))
dev_script = studio_pkg.get("scripts", {}).get("dev:ui", "")
m_ui = re.search(r"-p\s+(\d+)", dev_script)
if m_ui:
    ui_port = m_ui.group(1)
    if f"| `{ui_port}` |" not in agents_text:
        fail(f"AGENTS.md port table does not match apps/studio/package.json UI port {ui_port}")

server_ts = (root / "apps/studio/server/index.ts").read_text(encoding="utf-8")
m_api = re.search(r'STUDIO_API_PORT\s*\|\|\s*"(\d+)"', server_ts)
if m_api:
    api_port = m_api.group(1)
    if f"| `{api_port}` |" not in agents_text:
        fail(f"AGENTS.md port table does not match apps/studio/server/index.ts API port {api_port}")

langfuse_yaml = (root / "docker/compose.langfuse.yaml").read_text(encoding="utf-8")
m_lf = re.search(r"127\.0\.0\.1:(\d+):3000", langfuse_yaml)
if m_lf:
    lf_port = m_lf.group(1)
    if f"| `{lf_port}` |" not in agents_text:
        fail(f"AGENTS.md port table does not match docker/compose.langfuse.yaml Langfuse port {lf_port}")

compose_yaml = (root / "compose.yaml").read_text(encoding="utf-8")
if "/var/run/docker.sock" in compose_yaml:
    fail("Security violation: compose.yaml must never mount /var/run/docker.sock")

if errors:
    for e in errors:
        print(f"GOVERNANCE ERROR: {e}", file=sys.stderr)
    sys.exit(1)

print("Agent governance check passed (18 files, ASD-STE100 sync, links, and runtime invariants verified).")
PY
