import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SkillInfo } from "@/types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Normalizes /api/skills and /api/system/status skill entries (string or SkillInfo) into SkillInfo[]. */
export function normalizeSkills(raw: unknown): SkillInfo[] {
  if (!Array.isArray(raw)) return [];
  const result: SkillInfo[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) result.push({ name, description: "", path: name });
    } else if (item && typeof item === "object") {
      const obj = item as Partial<SkillInfo>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      if (!name) continue;
      result.push({
        name,
        description: typeof obj.description === "string" ? obj.description : "",
        path: typeof obj.path === "string" && obj.path.trim() ? obj.path : name,
      });
    }
  }
  return result;
}
