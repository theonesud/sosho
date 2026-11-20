#!/usr/bin/env bash
# Tool-agnostic PreToolUse guard. Reads one JSON payload on stdin.
# Exit 2 blocks the action. The reason goes to stderr.
# The Bash check is best-effort. The git pre-commit hook (stage 2) is the final gate.
exec python3 -c '
import json, os, re, sys

try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(0)

ti = p.get("tool_input") or {}
path = str(ti.get("file_path") or ti.get("path") or "")
text = str(ti.get("content") or ti.get("new_string") or "")
cmd = str(ti.get("command") or "")

SAFE_ENV = (".env.example", ".env.sample")
# Matches a protected file name as a whole path token.
PROT = r"(?:\.env(?:\.[\w.-]+)?|[\w./-]*\.(?:pem|key)|(?:[\w./-]*/)?\.pi/(?:models|model-roles)\.json)"

def protected(f):
    b = os.path.basename(f)
    if b.startswith(SAFE_ENV):
        return False
    if b == ".env" or b.startswith(".env.") or b.endswith((".pem", ".key")):
        return True
    n = f.replace("\\\\", "/")
    return n.endswith((".pi/models.json", ".pi/model-roles.json"))

def block(msg):
    print("BLOCKED: " + msg, file=sys.stderr)
    sys.exit(2)

if path:
    if protected(path):
        block("Do not edit protected file " + path + ".")
    b = os.path.basename(path)
    is_docker = b.startswith(("compose", "docker-compose", "Dockerfile")) or b.endswith(".dockerfile")
    if is_docker and "/var/run/docker.sock" in text:
        block("Do not mount /var/run/docker.sock.")

if cmd:
    for m in re.finditer(PROT, cmd):
        tok = m.group(0)
        if not protected(tok):
            continue
        before = cmd[:m.start()]
        after_cmd = before.rstrip()
        seg = re.split(r"[;&|]", before)[-1]
        if re.search(r">>?\s*$", before) or re.search(r"\b(tee|sed\s+(-\w+\s+)*-i\S*|cp|mv|dd)\b", seg):
            block("Bash command writes to protected file " + tok + ".")
        if re.search(r"\b(cat|less|more|head|tail|bat|printenv|source)\b", seg) and tok.startswith(".env"):
            block("Do not print " + tok + ".")
    if "/var/run/docker.sock" in cmd and re.search(r"(-v|--volume|--mount)", cmd):
        block("Do not mount /var/run/docker.sock.")
sys.exit(0)
'
