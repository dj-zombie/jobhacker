import { useSyncExternalStore } from "react";

/* In-memory router for the prototype. The kit links to real paths; this maps them to views. */
let current = "/";
if (typeof location !== "undefined" && new URLSearchParams(location.search).get("frame") === "closed") {
  current = "/shortlist";
}
const listeners = new Set<() => void>();

export function navigate(path: string) {
  if (path === current) return;
  current = path;
  listeners.forEach((l) => l());
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
