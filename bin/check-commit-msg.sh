#!/bin/sh
# Check a commit message against the Conventional Commits rules in docs/standards/git.md.
# Usage: check-commit-msg.sh <message-file>
# Exit 0 if the message is valid. Exit 1 and print the reason if it is not.

set -eu

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "check-commit-msg: message file missing" >&2
  exit 1
fi

# Skip merge, revert, fixup, and squash messages that Git creates.
first=$(sed -n '1p' "$file")
case "$first" in
  "Merge "* | "Revert \""* | "fixup! "* | "squash! "*) exit 0 ;;
esac

fail() {
  echo "check-commit-msg: $1" >&2
  echo "Expected: type(scope)?: subject" >&2
  echo "Types: feat fix docs style refactor perf test build ci chore revert" >&2
  exit 1
}

pattern='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .+$'
if ! printf '%s\n' "$first" | grep -Eq "$pattern"; then
  fail "first line does not match the Conventional Commits format"
fi

if [ "${#first}" -gt 72 ]; then
  fail "first line has ${#first} characters. The limit is 72"
fi

case "$first" in
  *.) fail "subject ends with a period" ;;
esac

# Line 2 must be blank when a body exists. Ignore comment lines from Git.
second=$(sed -n '2p' "$file")
if [ -n "$second" ] && [ "${second#\#}" = "$second" ]; then
  fail "line 2 must be blank before the body"
fi

exit 0
