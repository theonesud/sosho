#!/usr/bin/env python3
import os
import sys
from pathlib import Path

from agent_docs import run


def main() -> int:
    os.chdir(Path(__file__).resolve().parent.parent)
    code, lines = run()
    sys.stdout.write("\n".join(lines) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
