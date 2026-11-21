import { expect, test } from "@playwright/test";

test.describe("Sosho Studio E2E", () => {
  test("workflow canvas loads on root route", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toContainText(/Workflow|Canvas|Studio/i);
  });

  test("playground screen renders chat and compare controls", async ({ page }) => {
    await page.goto("/?view=playground");
    await expect(page.locator("body")).toContainText(/Playground|Prompt|Role/i);
  });

  test("memory screen renders memory explorer", async ({ page }) => {
    await page.goto("/?view=memory");
    await expect(page.locator("body")).toContainText(/Memory|Search|Scope/i);
  });
});
