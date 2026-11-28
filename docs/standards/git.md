# Git Standard

Purpose: Rules for commits, branches, and hooks.

Read when: You commit.

## 1 Commit Format

1.1 Use the Conventional Commits format: `type(scope): subject`. The scope is optional.
1.2 Use only these types:

| Type | Use |
| :--- | :--- |
| `feat` | New behavior |
| `fix` | Defect repair |
| `docs` | Documentation only |
| `refactor` | Change with no behavior change |
| `test` | Test only |
| `chore` | Tool or housekeeping |
| `build` | Build or dependency change |
| `perf` | Speed change |
| `style` | Format only |

1.3 Limit the subject to 72 characters. Use the imperative mood. Write it in ASD-STE100.
1.4 Use the body to explain why. Do not repeat the diff.
1.5 Put one logical change in each commit.

## 2 Forbidden Content

WARNING: A committed secret stays in the history.

2.1 Never commit secrets or `.env` files.
2.2 Never commit model weights.
2.3 Never commit generated build output.
2.4 Commit lockfiles.

## 3 Hooks

3.1 The `lefthook` hooks are mandatory.
3.2 Never use `--no-verify`.
3.3 If a hook fails, fix the cause. Run the hook again.

| Hook | Action |
| :--- | :--- |
| pre-commit | Fix and re-stage staged files, scan them with `gitleaks`, and warn on prose |
| commit-msg | Conventional Commits check |
| pre-push | `make test-fast`, which runs all checks and the fast tests |

## 4 Branches

4.1 Name a branch `type/short-name`. Use the types from 1.2.
4.2 Use lowercase letters and hyphens in `short-name`.

## 5 Push

CAUTION: A push is hard to undo.

5.1 Ask the owner before you push.
