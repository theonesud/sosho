import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "legacy/**",
      "packages/memory/**",
      "packages/yue2/**",
      ".pi/**",
      ".agents/skills/**",
      "models/**",
    ],
  },
});
