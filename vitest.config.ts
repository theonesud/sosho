import { defineConfig } from "vitest/config";

// The legacy paths below hold old tsx test scripts. The rebuild stages remove them from this list.
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/**",
      "packages/**",
      "yue2/**",
      "workflows/**",
      "tests/**",
      "docker/**",
      ".pi/**",
      ".agents/skills/**",
      ".impeccable/**",
      "models/**",
    ],
  },
});
