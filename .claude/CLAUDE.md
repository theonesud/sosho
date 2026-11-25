@../AGENTS.md

# Claude Code Adapter

1. Hooks in `.claude/settings.json` call the shared scripts. The guard runs before each Read, Edit, Write, or Bash call. The post-edit scripts run after each edit or write.
2. If a hook blocks an action, read the reason. Do not try to bypass the hook.
3. `.mcp.json` at the repository root defines the MCP servers.
4. Skills come from `.claude/skills`. This path is a symlink to `.agents/skills`.
5. Use subagents for broad searches.
6. The main Claude Code session acts as a coordinator only.
   Give all coding work to a subagent with the model `sonnet`.
   Coding work covers these tasks:
   - Write or change code.
   - Write or change tests.
   - Write or change configs.
   Give all other work to a subagent with the model `haiku`.
   Other work covers these tasks:
   - Search for code or text.
   - Read files.
   - Edit docs.
   - Make mechanical moves.
   - Write reports.
