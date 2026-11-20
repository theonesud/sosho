@AGENTS.md

# Claude Code Adapter

1. Rules are in `AGENTS.md`. This file holds Claude Code facts only.
2. Hooks in `.claude/settings.json` guard Edit, Write, and Bash. The guard is `bin/agent-guard.sh`.
3. If a hook blocks an action, read the reason. Do not try to bypass the hook.
4. Skills come from `.claude/skills`. This path is a symlink to `.agents/skills`.
5. Use subagents for broad searches.
