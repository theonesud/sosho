#!/usr/bin/env bash
exec python3 -c '
import json, os, re, sys

try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if not isinstance(p, dict):
    sys.exit(0)

def first_str(d, keys):
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v:
            return v
    return ""

tool = first_str(p, ("tool_name", "toolName", "tool")).lower()
ti = p
for k in ("tool_input", "toolInput", "input", "args", "arguments"):
    if isinstance(p.get(k), dict):
        ti = p[k]
        break
path = first_str(ti, ("file_path", "filePath", "path", "TargetFile", "target_file", "AbsolutePath"))
text = first_str(ti, ("content", "new_string", "newString", "newText", "CodeContent", "code_content"))
cmd = first_str(ti, ("command", "cmd", "CommandLine", "command_line"))

READ_TOOLS = ("read", "view", "view_file", "read_file", "readfile")
SAFE_ENV = (".env.example", ".env.sample")
PROT = r"(?:\.env(?:\.[\w.-]+)?|[\w./-]*\.(?:pem|key)|(?:[\w./-]*/)?\.pi/(?:models|model-roles)\.json)"

def secret(f):
    b = os.path.basename(f)
    if b.startswith(SAFE_ENV):
        return False
    return b == ".env" or b.startswith(".env.") or b.endswith((".pem", ".key"))

def model_config(f):
    return f.replace("\\", "/").endswith((".pi/models.json", ".pi/model-roles.json"))

def protected(f):
    return secret(f) or model_config(f)

def block(msg):
    print("BLOCKED: " + msg, file=sys.stderr)
    sys.exit(2)

if tool in READ_TOOLS:
    if path and secret(path):
        block("Do not read protected file " + path + ".")
    sys.exit(0)

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
        seg = re.split(r"[;&|]", before)[-1]
        if re.search(r">>?\s*$", before) or re.search(r"\b(tee|sed\s+(-\w+\s+)*-i\S*|cp|mv|dd)\b", seg):
            block("Bash command writes to protected file " + tok + ".")
        if re.search(r"\b(cat|less|more|head|tail|bat|printenv|source)\b", seg) and tok.startswith(".env"):
            block("Do not print " + tok + ".")
    if "/var/run/docker.sock" in cmd and re.search(r"(-v|--volume|--mount)", cmd):
        block("Do not mount /var/run/docker.sock.")
sys.exit(0)
'
