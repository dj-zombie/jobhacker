"use client";

import { Keyboard, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "./kbd";

export interface ShortcutGroup {
  heading: string;
  items: { keys: string[]; label: string }[];
}

/** "?" opens this: every shortcut, grouped. */
export function ShortcutsDialog({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ShortcutGroup[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-surface-3 ring-1 ring-line-2">
            <Keyboard className="size-4 text-brand-hi" />
          </span>
          <div>
            <DialogTitle className="text-md font-semibold text-fg">Keyboard shortcuts</DialogTitle>
            <DialogDescription className="text-xs text-fg-3">Triage without touching the mouse.</DialogDescription>
          </div>
          <DialogClose className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-surface-3 hover:text-fg">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
        <div className="grid gap-x-8 gap-y-6 p-5 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.heading}>
              <h3 className="mb-2 text-2xs font-medium text-fg-4">{g.heading}</h3>
              <ul className="space-y-1.5">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center gap-3 text-sm text-fg-2">
                    <span className="min-w-0 flex-1">{it.label}</span>
                    <span className="flex shrink-0 gap-0.5">
                      {it.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
