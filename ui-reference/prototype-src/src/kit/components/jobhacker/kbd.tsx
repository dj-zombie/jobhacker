import type * as React from "react";
import { cn } from "@/lib/utils";

/** A keyboard key cap. Use for every shortcut hint so they read the same everywhere. Inside a button, it presses down on hover. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-2 bg-surface-3 px-1",
        "font-mono text-2xs font-medium text-fg-3 shadow-key",
        "transition-[translate,box-shadow] duration-100 group-hover/btn:translate-y-px group-hover/btn:shadow-none",
        className,
      )}
      {...props}
    />
  );
}
