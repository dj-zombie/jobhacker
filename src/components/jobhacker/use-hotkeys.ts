"use client";

import * as React from "react";

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

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
 * Global single-key shortcuts. Keys are lowercase `event.key` values, with
 * "mod+" for ⌘/Ctrl ("mod+k"). Ignored while typing in a field, except
 * mod+k and Escape. Pass `enabled: false` while a dialog owns the keyboard.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = React.useRef(map);
  ref.current = map;

  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
      const combo = mod ? `mod+${key}` : key;
      if (isTyping(e.target) && combo !== "mod+k" && key !== "escape") return;
      if (key === "enter" && isActivator(e.target)) return;
      if (combo !== "mod+k" && document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (mod && combo !== "mod+k") return;
      const fn = ref.current[combo] ?? (e.key === "?" ? ref.current["?"] : undefined);
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
