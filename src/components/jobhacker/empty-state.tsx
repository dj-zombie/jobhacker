import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { RadarSweep } from "./radar";

/**
 * An empty view that says what belongs here and how to get it. Its icon sits on a
 * radar that sweeps while it's on screen; pass `still` where another live loop
 * shares the screen. Not a client component: server pages pass it an icon
 * component, which can't cross into one, so only the radar is client code.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  still = false,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  still?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <RadarSweep still={still} className="size-16">
        <Icon className="size-5 text-fg-2" />
      </RadarSweep>
      <h3 className="mt-4 text-md font-semibold text-fg">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-sm text-fg-3">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
