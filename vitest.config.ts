import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "legacy/**",
      "apps/**",
      "workflows/**",
      "packages/llm/**",
      "packages/memory/**",
      "packages/workflow-engine/**",
      "packages/yue2/**",
      ".pi/**",
      ".agents/skills/**",
      "models/**",
    ],
  },
});
