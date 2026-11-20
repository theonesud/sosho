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

4.5 Record. Update `docs/context/NOW.md` when the state changes. Update `docs/context/DECISIONS.md` when the architecture changes.

## 5 Verification

5.1 Run `make check-agents` after any change to agent files.

5.2 NOTE: Each later standard adds its own check commands to this section.

## 6 Reference Index

| Read when | File |
| :--- | :--- |
| You plan any structural work | [REFACTOR_PLAN.md](REFACTOR_PLAN.md) |
| You need the present state | [docs/context/NOW.md](docs/context/NOW.md) |
| You change architecture, ports, schemas, or security | [docs/context/DECISIONS.md](docs/context/DECISIONS.md) |
| You need product scope | [PRODUCT.md](PRODUCT.md) |
| You do UI work | [DESIGN.md](DESIGN.md) |

NOTE: Later stages add rows for coding standards, documentation, architecture, and structure.

## 7 Tool Adapters

| Tool | Files it reads |
| :--- | :--- |
| Claude Code | `.claude/CLAUDE.md`, `.claude/settings.json` |
| pi | `AGENTS.md` natively |
| OpenCode | `AGENTS.md` natively, `opencode.json` |
| Antigravity | `AGENTS.md` natively |

7.1 Put only tool-specific facts in adapter files.
