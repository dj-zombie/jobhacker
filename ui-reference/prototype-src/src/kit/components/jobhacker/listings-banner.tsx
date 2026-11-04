"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Listings have not been checked in a week, or have never been checked.
 * `checkedOn` is already in words ("26 Oct 2026"). The caller decides when to show this.
 */
export function ListingsBanner({
  checkedOn,
  onRefresh,
}: {
  /** The last finished scout, or null when none has finished. */
  checkedOn: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-2 px-5 py-2.5 max-md:px-4">
      <TriangleAlert className="size-4 shrink-0 text-maybe" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-fg-2">
        {checkedOn ? (
          <>
            Listings were last checked on <span className="font-medium text-fg">{checkedOn}</span>.
          </>
        ) : (
          "Listings haven't been checked yet."
        )}
      </p>
      <Button size="sm" variant="secondary" onClick={onRefresh}>
        <RefreshCw />
        Refresh listings
      </Button>
    </div>
  );
}
