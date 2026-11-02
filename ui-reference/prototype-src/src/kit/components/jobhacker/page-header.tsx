import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The bar at the top of the main panel: title, count, view controls, actions. */
export function PageHeader({
  icon: Icon,
  title,
  count,
  leading,
  children,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  count?: React.ReactNode;
  /** Rendered before the icon, e.g. a menu button on small screens. */
  leading?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2.5 max-md:px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {leading}
        {Icon ? (
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-surface-3 ring-1 ring-line-2">
            <Icon className="size-4 text-brand-hi" />
          </span>
        ) : null}
        <h1 className="truncate text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {count != null ? <span className="text-sm tnum text-fg-3">{count}</span> : null}
      </div>
      {children ? (
        <div className="min-w-0 max-w-full max-md:order-2 max-md:basis-full">{children}</div>
      ) : null}
      {actions ? (
        <div className="ml-auto flex items-center gap-1.5 max-md:order-1">{actions}</div>
      ) : null}
    </div>
  );
}
