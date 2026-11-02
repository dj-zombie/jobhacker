"use client";

import type * as React from "react";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "./kbd";

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

/** ⌘K: jump to any job or view, or run an action. */
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">Type to filter jobs, views and actions.</DialogDescription>
        <Command loop className="flex flex-col">
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-fg-3" />
            <Command.Input
              autoFocus
              placeholder={placeholder}
              className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-4"
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="max-h-[min(58vh,440px)] scroll-py-2 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-10 text-center text-sm text-fg-3">
              Nothing matches. Try a company name, or "scout".
            </Command.Empty>
            {groups.map((g) => (
              <Command.Group
                key={g.heading}
                heading={g.heading}
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-4"
              >
                {g.items.map((it) => (
                  <Command.Item
                    key={it.id}
                    value={`${it.label} ${it.keywords?.join(" ") ?? ""} ${it.id}`}
                    onSelect={() => {
                      onOpenChange(false);
                      it.onSelect();
                    }}
                    className="flex h-10 cursor-default select-none items-center gap-3 rounded-lg px-2.5 text-sm text-fg-2 outline-none data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg"
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
            <span className="ml-auto">{brand}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
