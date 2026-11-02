import type * as React from "react";
import { Bookmark, FileText, MessageSquareText, Pencil, Send, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineGroup, TimelineItem } from "./types";

const KIND: Record<TimelineItem["kind"], { icon: React.ElementType; cls: string }> = {
  score: { icon: Sparkles, cls: "text-strong" },
  triage: { icon: Bookmark, cls: "text-brand-hi" },
  prep: { icon: FileText, cls: "text-fg-2" },
  fill: { icon: Wand2, cls: "text-info" },
  draft: { icon: MessageSquareText, cls: "text-maybe" },
  submit: { icon: Send, cls: "text-strong" },
  note: { icon: Pencil, cls: "text-fg-2" },
};

/** Human-readable application history, grouped by day. No internal event names. */
export function Timeline({ groups }: { groups: TimelineGroup[] }) {
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.day}>
          <h3 className="mb-2 text-xs font-medium text-fg-3">{g.day}</h3>
          <ol className="relative">
            <span aria-hidden className="absolute bottom-3 left-[13px] top-3 w-px bg-line-2" />
            {g.items.map((it) => {
              const k = KIND[it.kind];
              const Icon = k.icon;
              return (
                <li key={it.id} className="relative flex items-start gap-3 py-1.5">
                  <span className="relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 ring-4 ring-panel">
                    <Icon className={cn("size-3.5", k.cls)} />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="text-sm text-fg">{it.title}</div>
                    {it.detail ? <div className="mt-0.5 text-xs text-fg-3">{it.detail}</div> : null}
                  </div>
                  <span className="shrink-0 pt-1 text-xs tnum text-fg-3">{it.time}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
