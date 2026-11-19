import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { StudioContext } from "../context.ts";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export function parseSkillFrontmatter(raw: string): { name?: string; description?: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].replace(/^["']|["']$/g, "").trim();
    if (key === "name") result.name = val;
    if (key === "description") result.description = val;
  }
  return result;
}

export function listSkills(skillsDir: string): SkillInfo[] {
  if (!existsSync(skillsDir)) return [];
  const entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  return entries.map((d) => {
    const skillMdPath = join(skillsDir, d.name, "SKILL.md");
    let name = d.name;
    let description = "";
    if (existsSync(skillMdPath)) {
      try {
        const parsed = parseSkillFrontmatter(readFileSync(skillMdPath, "utf8"));
        if (parsed.name) name = parsed.name;
        if (parsed.description) description = parsed.description;
      } catch {
        // fallback to directory name
      }
    }
    return {
      name,
      description,
      path: existsSync(skillMdPath) ? skillMdPath : join(skillsDir, d.name),
    };
  });
}

export function createSkillsRoutes(ctx: StudioContext): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const skills = listSkills(ctx.skillsDir);
    return c.json({ skills });
  });

  return app;
}
