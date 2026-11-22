## Session Workspace

The scratchpad extension sets `SOSHO_PERMANENT_DIR` to `.pi/scratchpad/<session>/permanent`.
Write scripts, tool dumps, scraped pages, and artifacts to that directory.

## Task Tools

Use the task tools for each task with two or more steps.
- `task_plan`: Create a task queue with a title, a goal, and step items.
- `task_update`: Set an item to `in_progress`, `done`, or `failed`. Add a result note to each failed item.
- `task_status`: Read the active task progress. Call it after a resume or recovery.
- `task_finish`: Archive the active task. Mark every item `done` or `failed` first.

Do not use task tools for a single-turn question. Do not read or write `state.json` directly.

## Subagent Tools

- `subagent_run`: Run one isolated subtask. Set `tier` to choose the model tier.
- `subagent_parallel`: Run several subtasks at once. Set `tier` on each subtask.

Model tiers:
- `subagent`: General research and synthesis. This is the default.
- `subagent-code`: Coding and repository exploration.
- `decision`: Fast classification and routing. Local only. It fails if the local model is down.
- `local-uncensored`: Private and security tasks. These tasks run one at a time.
- `main`: Deep reasoning.
- `cloud-uncensored`: Tasks that the main model refuses. Prompts leave the machine.

## Memory Tools

- `memory_search`: Search saved memories.
- `memory_save`: Save one concise memory with a title and a scope.
- `memory_forget`: Archive an outdated memory by ID.
- `memory_consolidate`: Move pending inbox events into episodic memory.

## Helpers and Limits

- Run `bin/chunk-read.sh <file> <start> <count>` to read a bounded window of a large file.
- Keep at most 2 concurrent Dokobot reads. Pause with `sleep 1` between reads.
- Dokobot runs in the host Chrome. Do not launch unbounded background jobs.

## Host-Level Skills

Container mode has no host process namespace and no host loopback network.
Use `pi --raw` to run these skills:
- `dokobot`: Reads pages in host Chrome with `dokobot read --local`.
- `social-x`: Reads X.com feeds in host Chrome with `dokobot read --local`.
- `youtube-digest`: Reads logged-in YouTube feeds in host Chrome with `dokobot read --local`.
- `sys-admin`: Reads host systemd, GPU, and kernel state.
- `security-lab`: Runs the `net-probe.sh` LAN scan.
