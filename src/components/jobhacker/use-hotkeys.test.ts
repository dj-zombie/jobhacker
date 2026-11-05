import { describe, expect, it } from "vitest";
import { hotkeyCombo } from "./use-hotkeys.js";

const bare = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe("hotkeyCombo", () => {
  it("names ⌘ and Ctrl the same way", () => {
    expect(hotkeyCombo({ ...bare, key: "b", metaKey: true })).toBe("mod+b");
    expect(hotkeyCombo({ ...bare, key: "K", ctrlKey: true })).toBe("mod+k");
  });

  it("lets ⌘⇧ through, so the bookmarks bar keeps ⌘⇧B", () => {
    expect(hotkeyCombo({ ...bare, key: "b", metaKey: true, shiftKey: true })).toBeNull();
  });

  it("keeps ? and lets Alt through", () => {
    expect(hotkeyCombo({ ...bare, key: "?", shiftKey: true })).toBe("?");
    expect(hotkeyCombo({ ...bare, key: "b", metaKey: true, altKey: true })).toBeNull();
  });
});
