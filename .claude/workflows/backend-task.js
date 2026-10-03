/**
 * Workflow to delegate a task to the backend engineer agent.
 * Run this via `/backend-task` in Claude Code.
 */
export default async function backendTask(ctx) {
  // Take the user's input as the task
  const task = ctx.args.join(" ");
  if (!task) {
    ctx.log("Please provide a task. Usage: /backend-task <your task>");
    return;
  }

  ctx.log(`Delegating task to backend-engineer: ${task}`);
  
  // Spawn the backend-engineer subagent
  const result = await ctx.agent("backend-engineer", task);
  
  ctx.log("Backend task completed!");
  return result;
}
