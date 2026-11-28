import { describe, expect, it } from "vitest";
import { curlCommand, formatNextFire, maskToken, statusPhrase } from "./trigger-info";

describe("trigger info text", () => {
  it("formats text for the webhook, schedule, and follower lines", () => {
    expect(maskToken("abcdefgh1234")).toBe("••••••••1234");
    expect(curlCommand("http://x/w", "tok")).toBe(
      `curl -X POST http://x/w -H 'X-Sosho-Token: tok' -H 'Content-Type: application/json' -d '{"example":"body"}'`,
    );
    expect(statusPhrase("any")).toBe("finishes");
    expect(statusPhrase("failed")).toBe("failed");
    expect(formatNextFire("2026-01-01T09:00:00+00:00", "Asia/Tokyo")).toMatch(/18:00:00|6:00:00/);
    expect(formatNextFire("nope", "UTC")).toBeNull();
    expect(formatNextFire("2026-01-01T09:00:00+00:00", "Bad/Zone")).toBeNull();
  });
});
