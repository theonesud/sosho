import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

function loadRootStudioToken(): string {
  if (process.env.SOSHO_STUDIO_TOKEN?.trim()) {
    return process.env.SOSHO_STUDIO_TOKEN.trim();
  }
  const rootEnv = resolve(process.cwd(), "../../.env");
  if (existsSync(rootEnv)) {
    const raw = readFileSync(rootEnv, "utf8");
    const match = raw.match(/^\s*SOSHO_STUDIO_TOKEN\s*=\s*(.+?)\s*$/m);
    if (match) {
      return match[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return "";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SOSHO_STUDIO_TOKEN: loadRootStudioToken(),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:4101/api/:path*",
      },
    ];
  },
};

export default nextConfig;
