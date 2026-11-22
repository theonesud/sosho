import { defineConfig } from "vitest/config";

// packages/llm, packages/memory, packages/workflow-engine, and packages/yue2 are pending review.
// The legacy folder holds old tsx test scripts. The rebuild stages remove it from this list.
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
