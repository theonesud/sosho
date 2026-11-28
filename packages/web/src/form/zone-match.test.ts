import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTypeaheadBuffer, matchZone } from "./zone-match";

const zones = [
  "UTC",
  "Africa/Cairo",
  "America/Argentina/Buenos_Aires",
  "America/New_York",
  "Asia/Calcutta",
  "Asia/Tokyo",
];

describe("zone typeahead matcher", () => {
  it("matches the full name and the part after a slash", () => {
    expect(matchZone(zones, "Asia/Cal")).toBe(4);
    expect(matchZone(zones, "calc")).toBe(4);
    expect(matchZone(zones, "Buenos")).toBe(2);
    expect(matchZone(zones, "new y")).toBe(3);
    expect(matchZone(zones, "utc")).toBe(0);
  });

  it("returns -1 for empty or unknown text and prefers a full name match", () => {
    expect(matchZone(zones, "")).toBe(-1);
    expect(matchZone(zones, "zzz")).toBe(-1);
    expect(matchZone(["Europe/Asia", "Asia/Tokyo"], "asia")).toBe(1);
  });
});

describe("typeahead buffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins keys typed within the wait and resets after it", () => {
    const buffer = createTypeaheadBuffer(500);
    expect(buffer.push("C")).toBe("C");
    vi.advanceTimersByTime(400);
    expect(buffer.push("a")).toBe("Ca");
    vi.advanceTimersByTime(499);
    expect(buffer.text()).toBe("Ca");
    vi.advanceTimersByTime(2);
    expect(buffer.text()).toBe("");
    expect(buffer.push("x")).toBe("x");
  });
});
