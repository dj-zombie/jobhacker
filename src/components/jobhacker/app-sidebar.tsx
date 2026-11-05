"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { railBadgeText } from "@/lib/sidebar-preference";
import { BrandMark } from "./brand-mark";
import { Hint } from "./hint";
import { Kbd } from "./kbd";
import { boxIn, lockTo, releaseLock, TargetLock } from "./target-lock";

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/** A link, or a button that opens something in place. A button has no route. */
export type NavItem = {
  label: string;
  icon: LucideIcon;
  count?: number | string;
  /** Draw attention to the count, e.g. follow-ups due. */
  countTone?: "default" | "brand" | "maybe" | "danger";
} & ({ href: string; onSelect?: undefined } | { onSelect: () => void; href?: undefined });

export interface NavSection {
  label: string;
  items: NavItem[];
}

const TONE: Record<NonNullable<NavItem["countTone"]>, string> = {
  default: "text-fg-3",
  brand: "rounded-full bg-brand-wash px-1.5 text-brand-hi",
  maybe: "rounded-full bg-maybe-wash px-1.5 text-maybe",
  danger: "rounded-full bg-danger-wash px-1.5 text-danger",
};

/** Rail chip. Same tones as the expanded count, solid so 11px text stays readable. */
const RAIL_BADGE: Record<NonNullable<NavItem["countTone"]>, string> = {
  default: "bg-surface-4 text-fg ring-1 ring-line-2",
  brand: "bg-brand text-white",
  maybe: "bg-maybe text-canvas",
  danger: "bg-danger text-canvas",
};

/** Pins the sidebar to the icon rail, or back. Hidden below 1280, where the rail is the layout. */
function SidebarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Hint label={label} shortcut="⌘B" side={collapsed ? "right" : "bottom"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        aria-label={label}
        className={cn(
          "hidden shrink-0 items-center justify-center rounded-md text-fg-4 outline-none transition-colors xl:inline-flex",
          "hover:bg-surface-1 hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
          collapsed ? "size-9" : "size-7",
        )}
      >
        <Icon className="size-4" />
      </button>
    </Hint>
  );
}

/**
 * App navigation. `collapsed` renders an icon rail (labels move into
 * tooltips, short counts into a chip). The active item's background and its
 * lit left bar slide between items. A target lock rests on the active item,
 * glides to whichever item the pointer is over, and glides back when the
 * pointer leaves. The wordmark glitches once on hover. `onToggleCollapsed`
 * pins the rail on a wide window; below 1280 the control is hidden.
 */
export function AppSidebar({
  sections,
  activeHref,
  onSearch,
  footer,
  collapsed = false,
  onToggleCollapsed,
  user,
  brand = "JobHacker",
  className,
}: {
  sections: NavSection[];
  activeHref: string;
  onSearch?: () => void;
  footer?: React.ReactNode;
  collapsed?: boolean;
  /** Pin the rail, or open it. Omitted on the phone drawer and anywhere the width is fixed. */
  onToggleCollapsed?: () => void;
  user?: { name: string; initials: string };
  brand?: string;
  className?: string;
}) {
  const navRef = React.useRef<HTMLElement>(null);
  const lockRef = React.useRef<HTMLDivElement>(null);
  const placed = React.useRef(false);
  const restOnActive = React.useCallback((instant = false) => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return releaseLock(lockRef.current);
    lockTo(lockRef.current, boxIn(active, nav), { instant });
  }, []);
  useIsoLayoutEffect(() => {
    restOnActive(!placed.current);
    placed.current = true;
  }, [activeHref, collapsed, restOnActive]);

  return (
    <aside
      id={onToggleCollapsed ? "app-sidebar" : undefined}
      data-state={collapsed ? "rail" : "expanded"}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden py-3 pr-2 pl-[max(10px,env(safe-area-inset-left,0px))] transition-[width] duration-200 ease-out-quint",
        collapsed ? "w-[64px] items-center" : "w-[248px]",
        className,
      )}
    >
      <div className={cn("group/brand flex h-10 items-center gap-2.5", collapsed ? "justify-center" : "px-2")}>
        <BrandMark />
        {collapsed ? null : (
          <>
            <span
              data-text={brand}
              className="glitch-text relative font-display text-[13px] font-semibold uppercase tracking-[0.06em] text-fg group-hover/brand:glitch-run"
            >
              {brand}
            </span>
            {user ? (
              <Hint label={user.name} side="bottom">
                <span className="ml-auto inline-flex size-7 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-fg-2 ring-1 ring-line-2">
                  {user.initials}
                </span>
              </Hint>
            ) : null}
            {onToggleCollapsed ? (
              <span className={user ? undefined : "ml-auto"}>
                <SidebarToggle collapsed={false} onToggle={onToggleCollapsed} />
              </span>
            ) : null}
          </>
        )}
      </div>

      {collapsed && onToggleCollapsed ? (
        <div className="mt-2 hidden justify-center xl:flex">
          <SidebarToggle collapsed onToggle={onToggleCollapsed} />
        </div>
      ) : null}

      {onSearch ? (
        collapsed ? (
          <Hint label="Search or jump to" shortcut="⌘K" side="right">
            <button
              type="button"
              onClick={onSearch}
              aria-label="Search or jump to (⌘K)"
              className="hud-corners relative mt-3 inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface-1 text-fg-3 outline-none transition-colors hover:hud-on hover:border-uv-hi/50 hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi max-md:size-10"
            >
              <Search className="size-4" />
            </button>
          </Hint>
        ) : (
          <button
            type="button"
            onClick={onSearch}
            className={cn(
              "group/btn hud-corners relative mt-3 flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-1 px-2.5 text-sm text-fg-3 shadow-hairline max-md:min-h-10",
              "outline-none transition-colors hover:hud-on hover:border-uv-hi/50 hover:text-fg-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
            )}
          >
            <Search className="size-4" />
            Search or jump to
            <span className="ml-auto flex gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        )
      ) : null}

      <nav
        ref={navRef}
        onPointerOver={(e) => {
          const nav = navRef.current;
          const item = (e.target as HTMLElement).closest<HTMLElement>("[data-nav-item]");
          if (nav && item && nav.contains(item)) lockTo(lockRef.current, boxIn(item, nav));
        }}
        onPointerLeave={() => restOnActive()}
        className={cn("relative mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto", collapsed && "w-full")}
      >
        <TargetLock ref={lockRef} corner={7} />
        {sections.map((section) => (
          <div key={section.label}>
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-line" />
            ) : (
              <div className="hud-label hud-rule px-2 pb-1.5 text-fg-4">
                <span aria-hidden className="-mr-1 h-px w-2 bg-brand-hi/70" />
                {section.label}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                const badge = collapsed ? railBadgeText(item.count) : null;
                const accessible = collapsed
                  ? item.count != null
                    ? `${item.label}, ${item.count}`
                    : item.label
                  : undefined;
                const className = cn(
                  "group relative flex h-8 items-center gap-2.5 rounded-md text-sm font-medium outline-none transition-colors max-md:min-h-10",
                  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
                  collapsed ? "mx-auto w-9 justify-center" : "w-full px-2",
                  active ? "text-fg" : "text-fg-2 hover:bg-surface-1 hover:row-wash hover:text-fg",
                );
                const body = (
                  <>
                    {active ? (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-md bg-surface-2 shadow-hairline ring-1 ring-line-2"
                        transition={{ type: "spring", stiffness: 520, damping: 42 }}
                      >
                        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-hi shadow-neon" />
                      </motion.span>
                    ) : null}
                    <Icon
                      className={cn(
                        "relative size-4 shrink-0 transition-colors",
                        active ? "text-brand-hi" : "text-fg-3 group-hover:text-brand-hi",
                      )}
                    />
                    {collapsed ? null : (
                      <span
                        className={cn(
                          "relative truncate transition-transform duration-200 ease-out-quint",
                          !active && "group-hover:translate-x-0.5",
                        )}
                      >
                        {item.label}
                      </span>
                    )}
                    {!collapsed && item.count != null ? (
                      <span className={cn("relative ml-auto text-xs tnum", TONE[item.countTone ?? "default"])}>
                        {item.count}
                      </span>
                    ) : null}
                    {badge ? (
                      <span
                        aria-hidden
                        className={cn(
                          "pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 font-mono text-2xs leading-none tnum ring-2 ring-canvas",
                          RAIL_BADGE[item.countTone ?? "default"],
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </>
                );
                const control = item.onSelect ? (
                  <button
                    type="button"
                    data-nav-item
                    onClick={item.onSelect}
                    aria-label={accessible}
                    className={className}
                  >
                    {body}
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    data-nav-item
                    aria-current={active ? "page" : undefined}
                    aria-label={accessible}
                    className={className}
                  >
                    {body}
                  </Link>
                );
                return (
                  <li key={item.href ?? item.label}>
                    {collapsed ? (
                      <Hint side="right" label={item.label} meta={item.count}>
                        {control}
                      </Hint>
                    ) : (
                      control
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {footer ? <div className={cn("mt-3", collapsed ? "w-full px-1" : "")}>{footer}</div> : null}
    </aside>
  );
}
