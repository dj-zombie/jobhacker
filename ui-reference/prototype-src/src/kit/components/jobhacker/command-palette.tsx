"use client";

import * as React from "react";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "./kbd";
import { boxIn, lockTo, releaseLock, TargetLock } from "./target-lock";

export interface PaletteItem {
  id: string;
  label: string;
  /** Extra words to match on, e.g. the company for a job. */
  keywords?: string[];
  hint?: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  onSelect: () => void;
}

export interface PaletteGroup {
  heading: string;
  items: PaletteItem[];
}

/** ⌘K: jump to any job or view, or run an action. A target lock springs to the highlighted item. */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  placeholder = "Search jobs and companies, or type a command",
  brand = "JobHacker",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PaletteGroup[];
  placeholder?: string;
  brand?: string;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const lockRef = React.useRef<HTMLDivElement>(null);
  const placed = React.useRef(false);
  const frame = React.useRef(0);
  // cmdk reports the highlighted item only when its value is controlled.
  const [value, setValue] = React.useState("");
  const follow = React.useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const list = listRef.current;
      const item = list?.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
      if (!list || !item) return releaseLock(lockRef.current);
      lockTo(lockRef.current, boxIn(item, list), { instant: !placed.current });
      placed.current = true;
    });
  }, []);
  React.useEffect(() => {
    placed.current = false;
    setValue("");
    if (open) follow();
    return () => cancelAnimationFrame(frame.current);
  }, [open, follow]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">Type to filter jobs, views and actions.</DialogDescription>
        <Command
          loop
          value={value}
          onValueChange={(v) => {
            setValue(v);
            follow();
          }}
          className="flex flex-col"
        >
          <div className="scanlines-light flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-brand-hi" />
            <Command.Input
              autoFocus
              onValueChange={follow}
              placeholder={placeholder}
              className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-4"
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List ref={listRef} className="relative max-h-[min(58vh,440px)] scroll-py-2 overflow-y-auto p-2">
            <TargetLock ref={lockRef} corner={8} />
            <Command.Empty className="px-3 py-10 text-center text-sm text-fg-3">
              Nothing matches. Try a company name, or "scout".
            </Command.Empty>
            {groups.map((g) => (
              <Command.Group
                key={g.heading}
                heading={g.heading}
                className="[&_[cmdk-group-heading]]:hud-label [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-fg-4"
              >
                {g.items.map((it) => (
                  <Command.Item
                    key={it.id}
                    value={`${it.label} ${it.keywords?.join(" ") ?? ""} ${it.id}`}
                    onSelect={() => {
                      onOpenChange(false);
                      it.onSelect();
                    }}
                    className={cn(
                      "relative flex h-10 cursor-default select-none items-center gap-3 rounded-md px-2.5 text-sm text-fg-2 outline-none",
                      "data-[selected=true]:bg-surface-3 data-[selected=true]:row-wash data-[selected=true]:text-fg",
                    )}
                  >
                    {it.icon ? <span className="flex size-5 shrink-0 items-center justify-center">{it.icon}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.hint ? <span className="shrink-0 text-xs text-fg-3">{it.hint}</span> : null}
                    {it.shortcut ? (
                      <span className="flex shrink-0 gap-0.5">
                        {it.shortcut.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
          <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-2xs text-fg-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              Move
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd>
              Open
            </span>
            <span className="ml-auto font-mono uppercase tracking-wider">{brand}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
