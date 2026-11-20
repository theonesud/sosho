@AGENTS.md
@.pi/APPEND_SYSTEM.md

# Claude Code Adapter

Follow all rules in [AGENTS.md](AGENTS.md) and [.pi/APPEND_SYSTEM.md](.pi/APPEND_SYSTEM.md).

## Claude-Specific Rules

- Read the scoped `AGENTS.md` file inside `apps/studio/`, `packages/workflow-engine/`, `packages/memory/`, `packages/llm/`, or `yue2/` before you edit files in that folder.
- Respect the governance hooks configured in `.claude/settings.json`.
- Run `make check-agents` after any change to agent rules, adapters, or `docs/context/`.
