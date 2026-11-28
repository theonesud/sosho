import type { IconName } from "./components/icon-paths";
import type { NodeKind, RunStatus } from "./types";

export const statusMeta: Readonly<Record<RunStatus, { label: string; icon: IconName }>> = {
  pending: { label: "Pending", icon: "ring" },
  running: { label: "Running", icon: "dot" },
  waiting: { label: "Waiting for input", icon: "pause" },
  succeeded: { label: "Succeeded", icon: "success" },
  failed: { label: "Failed", icon: "danger" },
  cancelled: { label: "Cancelled", icon: "ban" },
};

export const kindMeta: Readonly<Record<NodeKind, { label: string; icon: IconName }>> = {
  trigger: { label: "Trigger", icon: "bolt" },
  llm: { label: "LLM", icon: "sparkle" },
  agent: { label: "Agent", icon: "bot" },
  skill: { label: "Skill", icon: "puzzle" },
  tool: { label: "Tool", icon: "wrench" },
  router: { label: "Router", icon: "branch" },
  map: { label: "Map", icon: "map" },
  join: { label: "Join", icon: "join" },
  human: { label: "Human", icon: "user" },
  subworkflow: { label: "Subworkflow", icon: "nested" },
  wait: { label: "Wait", icon: "hourglass" },
};
