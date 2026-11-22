#!/usr/bin/env python3
import fnmatch
import glob
import itertools
import json
import os
import re
import shlex
import sys
from typing import TypeGuard

type Obj = dict[str, object]

TOOL_KEYS = ("tool_name", "toolName", "tool")
INPUT_KEYS = ("tool_input", "toolInput", "input", "args", "arguments")
PATH_KEYS = (
    "file_path",
    "filePath",
    "path",
    "TargetFile",
    "target_file",
    "AbsolutePath",
    "SearchPath",
    "notebook_path",
)
TEXT_KEYS = ("content", "new_string", "newString", "newText", "CodeContent", "code_content")
CMD_KEYS = ("command", "cmd", "CommandLine", "command_line")
FILTER_KEYS = ("glob", "include", "Includes", "includes")
READ_ONLY_TOOLS = frozenset(
    {"read", "view", "view_file", "read_file", "readfile", "grep", "grep_search", "glob"}
    | {"find", "ls", "list", "list_dir", "find_by_name"}
)

SAFE_NAMES = (".env.example", ".env.sample")
SECRET_NAMES = frozenset(
    {".env", ".netrc", ".pgpass", ".git-credentials", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"}
)
SECRET_SUFFIXES = (".pem", ".key", ".p12", ".pfx")
SECRET_PATH_ENDS = ("/.aws/credentials", "/.docker/config.json", "/.kube/config")
SECRET_SAMPLES = (".env", ".env.local", ".netrc", ".pgpass", ".git-credentials", "id_rsa")
SUFFIX_SAMPLES = tuple("x" + s for s in SECRET_SUFFIXES)
MODEL_CONFIG_ENDS = (".pi/models.json", ".pi/model-roles.json")
DOCKER_SOCKET = "/var/run/docker.sock"
MAX_EXPANSIONS = 256

FRAGMENT = re.compile(r"[\w./~@+-]+")
EMPTY_QUOTES = re.compile(r"\$''|\$\"\"|\$\(\s*\)|``|\$\{\}")
QUOTE_CHARS = re.compile(r"[\"'\\]")
GLOB_CHARS = re.compile(r"[*?\[{]")
BRACE = re.compile(r"\{([^{}]*,[^{}]*)\}")
SEPARATOR = re.compile(r"[;&|()<>]+")
MODEL_CONFIG = re.compile(r"(?:[\w./-]*/)?\.pi/(?:models|model-roles)\.json")
WRITE_VERB = re.compile(r"\b(tee|sed\s+(-\w+\s+)*-i\S*|cp|mv|dd)\b")


def is_obj(value: object) -> TypeGuard[Obj]:
    return isinstance(value, dict)


def is_list(value: object) -> TypeGuard[list[object]]:
    return isinstance(value, list)


def first_str(data: Obj, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def all_strs(data: Obj, keys: tuple[str, ...]) -> list[str]:
    found: list[str] = []
    for key in keys:
        value = data.get(key)
        if isinstance(value, str):
            found.append(value)
        elif is_list(value):
            found.extend(item for item in value if isinstance(item, str))
    return found


def tool_input(payload: Obj) -> Obj:
    for key in INPUT_KEYS:
        value = payload.get(key)
        if is_obj(value):
            return value
    return payload


def is_secret(path: str) -> bool:
    norm = "/" + path.replace("\\", "/").rstrip("/")
    base = norm.rsplit("/", 1)[-1]
    if base.startswith(SAFE_NAMES):
        return False
    if base in SECRET_NAMES or base.startswith(".env."):
        return True
    if any(base.endswith(s) and len(base) > len(s) for s in SECRET_SUFFIXES):
        return True
    return norm.endswith(SECRET_PATH_ENDS)


def is_model_config(path: str) -> bool:
    return path.replace("\\", "/").endswith(MODEL_CONFIG_ENDS)


def expand_braces(word: str) -> list[str]:
    match = BRACE.search(word)
    if match is None:
        return [word]
    head, tail = word[: match.start()], word[match.end() :]
    out: list[str] = []
    for part in match.group(1).split(","):
        out.extend(expand_braces(head + part + tail))
        if len(out) >= MAX_EXPANSIONS:
            break
    return out[:MAX_EXPANSIONS]


def pattern_matches_secret(pattern: str) -> bool:
    base = os.path.basename(pattern)
    if base.startswith(".") and any(fnmatch.fnmatchcase(s, base) for s in SECRET_SAMPLES):
        return True
    has_suffix = "." in base.lstrip(".")
    return has_suffix and any(fnmatch.fnmatchcase(s, base) for s in SUFFIX_SAMPLES)


def glob_hits_secret(pattern: str, cwd: str) -> bool:
    if pattern_matches_secret(pattern):
        return True
    full = os.path.join(cwd, os.path.expanduser(pattern))
    return any(is_secret(p) for p in itertools.islice(glob.iglob(full), MAX_EXPANSIONS))


def words_of(cmd: str) -> list[str]:
    lexer = shlex.shlex(cmd, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        return list(lexer)
    except ValueError:
        return cmd.split()


def secret_reference(cmd: str, words: list[str], cwd: str) -> str | None:
    plain = QUOTE_CHARS.sub("", EMPTY_QUOTES.sub("", cmd))
    for fragment in FRAGMENT.findall(cmd) + FRAGMENT.findall(plain):
        if is_secret(fragment):
            return fragment
    for word in words:
        for expanded in expand_braces(word):
            for cand in re.split(r"[=:,]", expanded):
                if is_secret(cand) or (GLOB_CHARS.search(cand) and glob_hits_secret(cand, cwd)):
                    return cand
    return None


def simple_commands(words: list[str]) -> list[list[str]]:
    groups: list[list[str]] = [[]]
    for word in words:
        if SEPARATOR.fullmatch(word):
            groups.append([])
        else:
            groups[-1].append(word)
    return [g for g in groups if g]


def is_recursive_grep_flag(arg: str) -> bool:
    long_flags = ("--recursive", "--dereference-recursive", "--directories=recurse", "-drecurse")
    return arg in long_flags or re.fullmatch(r"-[A-Za-z]*[rR][A-Za-z]*", arg) is not None


def is_unrestricted_rg_flag(arg: str) -> bool:
    if arg.startswith("--no-ignore") or arg == "--unrestricted":
        return True
    return re.fullmatch(r"-[A-Za-z]*u[A-Za-z]*", arg) is not None


def risky_reader(words: list[str]) -> str | None:
    for args in simple_commands(words):
        names = {os.path.basename(a) for a in args}
        if names & {"grep", "egrep", "fgrep"} and (
            any(is_recursive_grep_flag(a) for a in args) or {"-d", "recurse"} <= set(args)
        ):
            return "Recursive grep reads ignored secret files. Use rg or git grep."
        if "rg" in names and any(is_unrestricted_rg_flag(a) for a in args):
            return "rg without ignore rules reads secret files."
        if ("docker-compose" in names or "compose" in args) and {"config", "convert"} & set(args):
            return "docker compose config prints values from env files."
    return None


def model_config_write(cmd: str) -> str | None:
    for match in MODEL_CONFIG.finditer(cmd):
        before = cmd[: match.start()]
        segment = re.split(r"[;&|]", before)[-1]
        if re.search(r">>?\s*$", before) or WRITE_VERB.search(segment):
            return "Bash command writes to protected file " + match.group(0) + "."
    return None


def check_command(cmd: str, cwd: str) -> str | None:
    if not cmd:
        return None
    words = words_of(cmd)
    ref = secret_reference(cmd, words, cwd)
    if ref is not None:
        return "Bash command refers to protected file " + ref + "."
    reason = risky_reader(words) or model_config_write(cmd)
    if reason is None and DOCKER_SOCKET in cmd and re.search(r"(-v|--volume|--mount)", cmd):
        reason = "Do not mount " + DOCKER_SOCKET + "."
    return reason


def check_tool(tool: str, data: Obj) -> str | None:
    path = first_str(data, PATH_KEYS)
    if path and is_secret(path):
        return "Do not access protected file " + path + "."
    for pattern in all_strs(data, FILTER_KEYS):
        if any(is_secret(c) or pattern_matches_secret(c) for c in expand_braces(pattern)):
            return "Search filter " + pattern + " includes protected files."
    if tool in READ_ONLY_TOOLS:
        return None
    if path and is_model_config(path):
        return "Do not edit protected file " + path + "."
    base = os.path.basename(path)
    is_docker = base.startswith(("compose", "docker-compose", "Dockerfile"))
    if (is_docker or base.endswith(".dockerfile")) and DOCKER_SOCKET in first_str(data, TEXT_KEYS):
        return "Do not mount " + DOCKER_SOCKET + "."
    return None


def main() -> int:
    try:
        payload: object = json.load(sys.stdin)
    except (ValueError, UnicodeDecodeError):
        return 0
    if not is_obj(payload):
        return 0
    data = tool_input(payload)
    tool = first_str(payload, TOOL_KEYS).lower()
    cwd = first_str(payload, ("cwd",)) or os.getcwd()
    reason = check_tool(tool, data) or check_command(first_str(data, CMD_KEYS), cwd)
    if reason is None:
        return 0
    sys.stderr.write("BLOCKED: " + reason + "\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
