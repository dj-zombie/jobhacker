"use client";

import { LoaderCircle } from "lucide-react";
import type * as React from "react";
import { Toaster, toast } from "sonner";
import { Kbd } from "./kbd";

/**
 * Mount once in the root layout. Styled entirely from tokens. Sonner centers
 * its loader absolutely inside the icon box, so the box keeps `relative` and a
 * fixed size; a loading toast also sweeps a progress line along its bottom edge.
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      offset={20}
      gap={8}
      icons={{ loading: <LoaderCircle className="animate-spin text-brand-hi" /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[min(440px,calc(100vw-32px))] items-center gap-3 rounded-xl border border-line-2 bg-surface-3/95 px-3.5 py-3 text-sm text-fg shadow-pop backdrop-blur-md",
          loading: "progress-sweep",
          title: "font-medium text-fg",
          description: "mt-0.5 text-xs text-fg-3",
          icon: "relative flex size-4 shrink-0 items-center justify-center [&_svg]:size-4",
          actionButton:
            "ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-surface-4 px-2.5 text-xs font-medium text-fg ring-1 ring-inset ring-line-2 transition-colors hover:bg-surface-2",
        },
      }}
    />
  );
}

/**
 * Confirm an action with an Undo button. The toast's wording should use the
 * same verb as the button that triggered it ("Shortlist" -> "Shortlisted").
 */
export function toastUndo(
  title: string,
  onUndo: () => void,
  opts?: { description?: string; icon?: React.ReactNode },
) {
  return toast(title, {
    description: opts?.description,
    icon: opts?.icon,
    duration: 5000,
    action: {
      label: (
        <>
          Undo <Kbd className="h-4 min-w-4 text-2xs">U</Kbd>
        </>
      ),
      onClick: onUndo,
    },
  });
}

export { toast };
