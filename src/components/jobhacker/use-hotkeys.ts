"use client";

import * as React from "react";

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

export interface HotkeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The shortcut name for a keydown, or null when the browser should keep it.
 * ⌘ and Ctrl share `mod+`. Shift with ⌘/Ctrl is left alone (⌘⇧B is the bookmarks bar).
 * `?` is Shift+/ and has no modifier, so it still matches.
 */
export function hotkeyCombo(e: HotkeyInput): string | null {
  if (e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.shiftKey) return null;
  const key = e.key.toLowerCase();
  return mod ? `mod+${key}` : key;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** A focused button or link should keep Enter. The triage Enter handler must not swallow it. */
function isActivator(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button";
}

/**
 * Global shortcuts. Keys are lowercase `event.key` values, with "mod+" for
 * ⌘/Ctrl ("mod+k", "mod+b"). A modifier combo runs only when the map lists it,
 * so an unused one still reaches the browser. Ignored while typing in a field,
 * except mod+k and Escape. Pass `enabled: false` while a dialog owns the keyboard.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = React.useRef(map);
  ref.current = map;

  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.repeat) return;
      const combo = hotkeyCombo(e);
      if (!combo) return;
      const key = e.key.toLowerCase();
      if (isTyping(e.target) && combo !== "mod+k" && key !== "escape") return;
      if (key === "enter" && isActivator(e.target)) return;
      if (combo !== "mod+k" && document.querySelector('[role="dialog"][data-state="open"]')) return;
      const fn = ref.current[combo] ?? (e.key === "?" ? ref.current["?"] : undefined);
      if (!fn) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
