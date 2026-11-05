import { describe, expect, it } from "vitest";
import { shortcutKeys } from "./hint.js";

describe("shortcutKeys", () => {
  it("keeps a single key, and splits a modifier", () => {
    expect(shortcutKeys("S")).toEqual(["S"]);
    expect(shortcutKeys("⌘B")).toEqual(["⌘", "B"]);
    expect(shortcutKeys("⌘ K")).toEqual(["⌘", "K"]);
    expect(shortcutKeys("⌘+K")).toEqual(["⌘", "K"]);
  });

  it("leaves a word whole, and drops an empty shortcut", () => {
    expect(shortcutKeys("Shift")).toEqual(["Shift"]);
    expect(shortcutKeys("  ")).toEqual([]);
  });
});
