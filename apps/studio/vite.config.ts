import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function readDevStudioToken(): string {
  if (process.env.VITE_SOSHO_STUDIO_TOKEN) return process.env.VITE_SOSHO_STUDIO_TOKEN;
  if (process.env.SOSHO_STUDIO_TOKEN) return process.env.SOSHO_STUDIO_TOKEN;
  const envPath = resolve(import.meta.dirname, "../../.env");
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*SOSHO_STUDIO_TOKEN\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return "";
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define:
    command === "serve"
      ? {
          "import.meta.env.VITE_SOSHO_STUDIO_TOKEN": JSON.stringify(readDevStudioToken()),
        }
      : {},
  server: {
    host: "127.0.0.1",
    port: 4100,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4101",
        changeOrigin: true,
      },
    },
  },
}));
