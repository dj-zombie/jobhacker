import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** An empty view that says what belongs here and how to get it. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-surface-2 ring-1 ring-line-2">
        <Icon className="size-5 text-fg-3" />
      </span>
      <h3 className="mt-4 text-md font-semibold text-fg">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-sm text-fg-3">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
