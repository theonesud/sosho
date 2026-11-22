import ast
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

import tree_sitter_language_pack as tslp
from pydantic import BaseModel, Field, ValidationError

ALLOW_FILE = Path("comments-allow.toml")
LANG_BY_SUFFIX = {
    ".py": "python",
    ".ts": "typescript",
    ".mts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".sh": "bash",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".json": "json",
    ".jsonc": "json",
    ".ini": "ini",
    ".css": "css",
    ".mk": "make",
}
LINE_COMMENT_NAMES = {".gitignore", ".dockerignore", ".gitattributes", ".npmrc", ".env.example"}
SKIP_NAMES = {"pnpm-lock.yaml", "uv.lock", "package-lock.json"}
DIRECTIVE = re.compile(
    r"^(#\s*(noqa\b|ruff:|pyright:|shellcheck\s|hadolint\s|gitleaks:allow|syntax=|escape=)"
    r"|#:schema\s|//\s*biome-ignore|///\s*<reference\s)"
)


@dataclass(frozen=True)
class Comment:
    path: str
    line: int
    text: str


class AllowEntry(BaseModel):
    path: str
    text: str
    reason: str = Field(min_length=20)


class AllowFile(BaseModel):
    comment: list[AllowEntry] = []


def language_of(path: Path) -> str | None:
    if path.name in SKIP_NAMES:
        return None
    if path.name.startswith("Dockerfile") or path.suffix == ".Dockerfile":
        return "dockerfile"
    if path.name == "Makefile":
        return "make"
    if path.name in LINE_COMMENT_NAMES or path.name.endswith("requirements.txt"):
        return "lines"
    return LANG_BY_SUFFIX.get(path.suffix)


def tree_comments(source: str, language: str) -> list[tuple[int, str]]:
    raw = source.encode()
    found: list[tuple[int, str]] = []
    tree = tslp.get_parser(language).parse(source)
    if tree is None:
        raise ValueError(f"tree-sitter could not parse the source as {language}")
    stack: list[tslp.Node | None] = [tree.root_node()]
    while stack:
        node = stack.pop()
        if node is None:
            continue
        if "comment" in node.kind():
            text = raw[node.start_byte() : node.end_byte()].decode().strip()
            found.append((node.start_position().row + 1, text))
        stack.extend(node.child(i) for i in range(node.child_count()))
    return found


def line_comments(source: str) -> list[tuple[int, str]]:
    lines = enumerate(source.splitlines(), start=1)
    return [(number, line.strip()) for number, line in lines if line.lstrip().startswith("#")]


def docstrings(source: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        first = node.body[0] if node.body else None
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            segment = ast.get_source_segment(source, first.value) or ""
            found.append((first.lineno, segment.strip()))
    return found


def comments_in(path: Path) -> list[Comment]:
    language = language_of(path)
    if language is None:
        return []
    source = path.read_text(encoding="utf-8")
    found = line_comments(source) if language == "lines" else tree_comments(source, language)
    if language == "python":
        found += docstrings(source)
    return [
        Comment(str(path), line, text)
        for line, text in found
        if not DIRECTIVE.match(text) and not (line == 1 and text.startswith("#!"))
    ]


def load_allow(path: Path) -> list[AllowEntry]:
    if not path.exists():
        return []
    return AllowFile.model_validate(tomllib.loads(path.read_text(encoding="utf-8"))).comment


def check(paths: list[Path], allow: list[AllowEntry]) -> list[str]:
    allowed = {(entry.path, entry.text) for entry in allow}
    used: set[tuple[str, str]] = set()
    errors: list[str] = []
    for path in paths:
        for comment in comments_in(path):
            key = (comment.path, comment.text)
            if key in allowed:
                used.add(key)
            else:
                errors.append(f"{comment.path}:{comment.line}: {comment.text.splitlines()[0]}")
    checked = {str(path) for path in paths}
    errors.extend(
        f"{ALLOW_FILE}: stale entry for {entry.path}: {entry.text.splitlines()[0]}"
        for entry in allow
        if entry.path in checked and (entry.path, entry.text) not in used
    )
    return errors


def main(argv: list[str]) -> int:
    paths = [Path(arg) for arg in argv if Path(arg).is_file()]
    try:
        allow = load_allow(ALLOW_FILE)
    except ValidationError as error:
        sys.stderr.write(
            f"{ALLOW_FILE} is not valid. Each entry needs path, text, and a reason "
            f"of 20 or more characters.\n{error}\n"
        )
        return 1
    errors = check(paths, allow)
    for error in errors:
        sys.stderr.write(error + "\n")
    if errors:
        sys.stderr.write(
            f"{len(errors)} comment problem(s). Remove each comment. If a comment is necessary, "
            f"add its path, exact text, and reason to {ALLOW_FILE}. "
            "See docs/standards/code.md section 7.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
