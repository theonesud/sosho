#!/usr/bin/env bash
cd -P "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

exec python3 bin/check-agent-docs.py
