# Legacy

This folder holds old, incomplete, or wrong code and docs from before the rebuild.

1. Legacy code is reference only.
2. Do not extend legacy code.
3. Review an item before you move it out.
4. Move an item out with `git mv`. Bring it to the standards in `docs/standards/`.
5. The checks in `make check` do not cover this folder.

The `make up`, `make down`, and `make logs` targets use `legacy/compose.yaml`. The Docker project name is `sosho`.
