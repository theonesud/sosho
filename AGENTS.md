# Agent Standard

## 1 Scope

1.1 This file is the single standard for Claude Code, pi, OpenCode, and Antigravity on this repository.

1.2 Tool adapter files add tool facts only. Adapter files never copy rules from this file.

## 2 Output Standard

2.1 Write all prose in ASD-STE100 Simplified Technical English. This covers replies, plans, reports, commit messages, documents, and code comments.

2.2 Language rules:

- Limit an instruction sentence to 20 words. Limit a descriptive sentence to 25 words.
- Write one instruction in each sentence. Start it with an imperative verb.
- Put the condition before the command.
- Use the active voice. Use simple tenses only.
- Do not use "-ing" forms as verbs or nouns.
- Use one term for one meaning. Do not use synonyms for variety.
- Write an abbreviation in full at its first use.
- Do not use idioms, slang, or contractions.
- Use a vertical list for three or more items.
- Do not put necessary information in parentheses.
- Do not use a dash or a slash to join ideas. Write "or".

2.3 Quality rules:

- Give the answer or the result first.
- State only verified facts. Write "not verified" for all other facts.
- Report failures and skipped steps plainly.
- Do not use filler or praise.
- Quote exact error text.
- Write a code reference as `path:line`.

2.4 NOTE: Code, identifiers, commands, paths, and quoted text are exempt from section 2.

## 3 Safety Rules

WARNING: Do not read or edit `.env`. Do not print secrets.

3.1 Do not commit secrets.

WARNING: Do not mount `/var/run/docker.sock` into a container.

3.2 Do not edit `.pi/models.json` or `.pi/model-roles.json` unless the owner asks.

CAUTION: A weak test hides a defect.

3.3 Do not weaken a test, an assertion, or a type to pass a check. Do not add `@ts-ignore`, `@ts-expect-error`, `as any`, or `# type: ignore`.

3.4 Do not claim that a check passes unless you ran it in this session and saw exit code 0.

CAUTION: Destructive and outward-facing actions are hard to undo.

3.5 Ask the owner before you push, publish, or delete files outside the task scope.

## 4 Work Procedure

4.1 Orient. Read each file in section 6 whose "Read when" entry matches the task.

4.2 Plan. List the files to change, the invariants to keep, and the checks to run.

4.3 Implement. Make small diffs that stay on the task.

4.4 Verify. Run the checks from section 5 and from each standard that applies.

4.5 Legacy paths are reference only. Do not extend legacy code. Build new code to the standards in section 6.

4.6 Record. Update `docs/context/NOW.md` when the state changes. Update `docs/context/DECISIONS.md` when the architecture changes.

## 5 Verification

5.1 Run `make check` after any change. Run it also after any change to agent files.
5.2 Use these commands. Make is the entry point.

| Command | Purpose |
| :--- | :--- |
| `make setup` | Install tools, dependencies, and git hooks. Run it one time on each machine. |
| `make check` | Run all checks and tests. It does not change files. |
| `make fix` | Format and fix files. |

5.3 These actions run automatically:

- After an agent edit, `bin/agent-format.sh` formats the edited file.
- At pre-commit, the hook fixes and re-stages staged files. It also scans for secrets and warns on prose.
- At commit-msg, the hook checks the Conventional Commits format.
- At pre-push, the hook runs `make check`.

5.4 The hooks must pass. Never use `--no-verify`.

5.5 NOTE: Each later standard adds its own check commands to this section.

## 6 Reference Index

| Read when | File |
| :--- | :--- |
| You plan any structural work | [REFACTOR_PLAN.md](REFACTOR_PLAN.md) |
| You need the present state | [docs/context/NOW.md](docs/context/NOW.md) |
| You change architecture, ports, schemas, or security | [docs/context/DECISIONS.md](docs/context/DECISIONS.md) |
| You need product scope | [PRODUCT.md](PRODUCT.md) |
| You do UI work | [DESIGN.md](DESIGN.md) |
| You write or change any code | [docs/standards/code.md](docs/standards/code.md) |
| You edit a `.ts` or `.tsx` file | [docs/standards/typescript.md](docs/standards/typescript.md) |
| You edit a `.py` file | [docs/standards/python.md](docs/standards/python.md) |
| You write or change a test | [docs/standards/testing.md](docs/standards/testing.md) |
| You commit | [docs/standards/git.md](docs/standards/git.md) |

NOTE: Later stages add rows for documentation, architecture, and structure.

## 7 Tool Adapters

| Tool | Files it reads |
| :--- | :--- |
| Claude Code | `.claude/CLAUDE.md`, `.claude/settings.json` |
| pi | `AGENTS.md` natively |
| OpenCode | `AGENTS.md` natively, `opencode.json` |
| Antigravity | `AGENTS.md` natively |

7.1 Put only tool-specific facts in adapter files.
