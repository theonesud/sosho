import hashlib
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent


def source_version() -> str:
    digest = hashlib.sha256()
    for path in sorted(PACKAGE_DIR.rglob("*.py")):
        digest.update(path.relative_to(PACKAGE_DIR).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]
