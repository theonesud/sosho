import { describe, expect, it } from "vitest";
import { isMacPlatform, keyParts } from "./key-label";

describe("key labels", () => {
  it("shows Cmd on macOS and Ctrl elsewhere", () => {
    expect(keyParts("mod+shift+z", true)).toEqual(["Cmd", "Shift", "Z"]);
    expect(keyParts("mod+shift+z", false)).toEqual(["Ctrl", "Shift", "Z"]);
    expect(keyParts("delete", true)).toEqual(["Del"]);
    expect(keyParts("shift", false)).toEqual(["Shift"]);
  });

  it("detects a macOS platform string", () => {
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("iPad")).toBe(true);
    expect(isMacPlatform("Linux x86_64")).toBe(false);
    expect(isMacPlatform("Win32")).toBe(false);
  });
});
