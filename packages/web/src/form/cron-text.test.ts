import { describe, expect, it } from "vitest";
import { cronFromEngine, cronIssueMessage, cronPreview, cronToEngine } from "./cron-text";

describe("cron conversion", () => {
  it("adds a leading seconds field on save", () => {
    expect(cronToEngine("0 9 * * *")).toBe("0 0 9 * * *");
    expect(cronToEngine("  0   9 * * * ")).toBe("0 0 9 * * *");
    expect(cronToEngine("1 0 9 * * *")).toBe("1 0 9 * * *");
    expect(cronToEngine("0 9 * *")).toBe("0 9 * *");
    expect(cronToEngine("")).toBe("");
  });

  it("shows five fields when seconds are zero, else all six", () => {
    expect(cronFromEngine("0 0 9 * * *")).toEqual({ text: "0 9 * * *", seconds: false });
    expect(cronFromEngine("30 0 9 * * *")).toEqual({ text: "30 0 9 * * *", seconds: true });
    expect(cronFromEngine("")).toEqual({ text: "", seconds: false });
  });
});

describe("cron preview", () => {
  const preview = (text: string) => cronPreview(text, "UTC");

  it("describes common patterns with the time zone", () => {
    expect(preview("0 9 * * *")).toBe("At 09:00 every day (time zone UTC)");
    expect(preview("30 8 * * 1-5")).toBe("At 08:30 on weekdays (time zone UTC)");
    expect(preview("0 9 * * 1")).toBe("At 09:00 on Monday (time zone UTC)");
    expect(preview("0 9 15 * *")).toBe("At 09:00 on day 15 of every month (time zone UTC)");
    expect(preview("* * * * *")).toBe("Every minute (time zone UTC)");
    expect(preview("*/5 * * * *")).toBe("Every 5 minutes (time zone UTC)");
    expect(preview("0 */2 * * *")).toBe("Every 2 hours at minute 0 (time zone UTC)");
  });

  it("shows the raw text for other patterns and nothing for empty text", () => {
    expect(preview("0 9 1,15 6 *")).toBe("0 9 1,15 6 * (time zone UTC)");
    expect(preview("61 9 * * *")).toBe("61 9 * * * (time zone UTC)");
    expect(preview("")).toBeNull();
  });
});

describe("cron issue message", () => {
  it("names the bad field in the five-field form", () => {
    expect(cronIssueMessage("0 61 9 * * *", "Cron string 0 61 9 * * * is not valid")).toBe(
      "Minute must be 0 to 59",
    );
    expect(cronIssueMessage("0 0 25 * * *", "bad")).toBe("Hour must be 0 to 23");
    expect(cronIssueMessage("0 0 9 * 13 *", "bad")).toBe("Month must be 1 to 12");
  });

  it("rewrites the engine form to the typed form", () => {
    expect(cronIssueMessage("0 0 9 * * x", "Cron string 0 0 9 * * x is not valid")).toBe(
      "Cron string 0 9 * * x is not valid",
    );
    expect(cronIssueMessage("30 0 9 * * x", "Cron string 30 0 9 * * x is bad")).toBe(
      "Cron string 30 0 9 * * x is bad",
    );
  });
});
