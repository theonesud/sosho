import type { Catalog } from "../api/types";

export const NONE = "__none__";

export function choicesFor(key: string, catalog: Catalog | null): readonly string[] | null {
  if (catalog === null) return null;
  switch (key) {
    case "tool":
      return catalog.tools.map((tool) => tool.name);
    case "skill":
    case "skills":
      return catalog.skills;
    case "queue":
      return Object.keys(catalog.queues);
    case "role":
    case "model":
      return catalog.pi_roles;
    default:
      return null;
  }
}

export function cronHint(value: string): string {
  const parts = value.trim().split(/\s+/);
  if (value.trim() === "") return "Six fields: second, minute, hour, day, month, weekday.";
  if (parts.length !== 6) return `${parts.length} fields. A cron string needs 6.`;
  const [second, minute, hour, day, month, weekday] = parts;
  const every = [day, month, weekday].every((part) => part === "*");
  if (every && [second, minute, hour].every((part) => /^\d+$/.test(part ?? ""))) {
    return `Every day at ${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}:${second?.padStart(2, "0")}.`;
  }
  return "Fields: second, minute, hour, day, month, weekday.";
}
