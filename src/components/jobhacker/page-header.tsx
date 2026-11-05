import type * as React from "react";
import { Skull, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DecodeText } from "./decode-text";

/**
 * The deck at the top of the main panel: the page's section and title, its view controls and
 * actions, and an optional toolbar row for filters. The deck is darker than the panel, carries
 * the grid, grain and the section's art, which all fade out before its lit bottom edge, and it
 * sits raised over the content below. The title decodes once when it changes, the art tears
 * once when the title or `glitchKey` changes, and a power-on line draws across the bottom edge.
 */
export function PageHeader({
  icon: Icon,
  kicker,
  title,
  count,
  leading,
  children,
  actions,
  toolbar,
  art,
  glitchKey,
  className,
}: {
  icon?: LucideIcon;
  /** A HUD label above the title: the sidebar section the page sits in, e.g. "Triage". */
  kicker?: string;
  title: string;
  count?: React.ReactNode;
  /** Rendered before the icon, e.g. a menu button on small screens. */
  leading?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  /** A second row inside the deck, such as the view's filters. On phones it scrolls sideways. */
  toolbar?: React.ReactNode;
  /** The URL of the section's art, held to the deck's right side. */
  art?: string;
  /** A change replays the art's tear, e.g. a new band or place. */
  glitchKey?: string | number;
  className?: string;
}) {
  return (
    <div className={cn("deck relative z-10 shrink-0", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="grid-bg absolute inset-0" />
        {art ? (
          <div
            key={`${title}:${glitchKey ?? ""}`}
            className="deck-art animate-deck-glitch"
            style={{ "--deck-art": `url(${art})` } as React.CSSProperties}
          />
        ) : null}
        <div className="grain absolute inset-0 opacity-8" />
      </div>
      <div className="relative flex min-h-17 flex-wrap items-center gap-x-6 gap-y-2.5 px-5 py-2 max-md:min-h-14 max-md:gap-x-3 max-md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          {leading}
          {Icon ? (
            <span className="deck-tile inline-flex size-10 shrink-0 items-center justify-center rounded-lg max-md:size-9">
              <Icon className="size-5 text-brand-hi max-md:size-4.5" />
            </span>
          ) : null}
          <div className="min-w-0">
            {kicker ? (
              <p className="hud-label flex items-center gap-1.5 text-fg-3 max-md:hidden">
                <Skull aria-hidden className="size-3 text-brand-hi" />
                {kicker}
              </p>
            ) : null}
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="text-aberration relative truncate font-display text-2xl font-semibold uppercase tracking-[0.04em] text-fg max-md:text-xl">
                <DecodeText text={title} />
              </h1>
              {count != null ? (
                <span className="shrink-0 rounded-sm border border-line-2 bg-surface-2 px-1.5 font-mono text-2xs leading-5 tnum text-fg-2">
                  {count}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {children ? (
          <div className="min-w-0 max-w-full max-md:order-2 max-md:basis-full">{children}</div>
        ) : null}
        {actions ? (
          <div className="ml-auto flex items-center gap-1.5 max-md:order-1">{actions}</div>
        ) : null}
      </div>
      {toolbar ? (
        <div className="relative flex min-w-0 flex-wrap items-center gap-2 border-t border-line bg-black/40 px-5 py-2 max-md:scroll-fade-end max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4">
          {toolbar}
        </div>
      ) : null}
      <span aria-hidden className="deck-rail" />
      <span
        key={title}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left animate-power-on bg-linear-to-r from-transparent via-brand-hi to-transparent"
      />
    </div>
  );
}
