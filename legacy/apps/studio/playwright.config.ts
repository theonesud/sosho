import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.STUDIO_UI_URL || "http://127.0.0.1:3000",
    headless: true,
  },
});
