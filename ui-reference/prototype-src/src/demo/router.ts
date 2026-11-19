import { useSyncExternalStore } from "react";

/* In-memory router for the prototype. The kit links to real paths; this maps them to views. */
let current = "/";
if (typeof location !== "undefined") {
  const params = new URLSearchParams(location.search);
  // Shooting aids: `?frame=closed` opens on the shortlist; `?at=<path>` opens on any route,
  // so a screenshot can land directly on, say, `/matches` without clicking through the nav.
  if (params.get("frame") === "closed") current = "/shortlist";
  const at = params.get("at");
  if (at) current = at;
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
