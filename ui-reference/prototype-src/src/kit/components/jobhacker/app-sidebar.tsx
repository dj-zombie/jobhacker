"use client";

import type * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BrandMark } from "./brand-mark";
import { Kbd } from "./kbd";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number | string;
  /** Draw attention to the count, e.g. follow-ups due. */
  countTone?: "default" | "brand" | "maybe" | "danger";
}

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

/**
 * App navigation. `collapsed` renders an icon rail (labels move into
 * tooltips). The active item's background slides between items.
 */
export function AppSidebar({
  sections,
  activeHref,
  onSearch,
  footer,
  collapsed = false,
  user,
  brand = "JobHacker",
  className,
}: {
  sections: NavSection[];
  activeHref: string;
  onSearch?: () => void;
  footer?: React.ReactNode;
  collapsed?: boolean;
  user?: { name: string; initials: string };
  brand?: string;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col py-3 pr-2 pl-[max(10px,env(safe-area-inset-left,0px))]",
        collapsed ? "w-[64px] items-center" : "w-[248px]",
        className,
      )}
    >
      <div className={cn("flex h-10 items-center gap-2.5", collapsed ? "justify-center" : "px-2")}>
        <BrandMark />
        {collapsed ? null : (
          <>
            <span className="text-md font-semibold tracking-tight text-fg">{brand}</span>
            {user ? (
              <span
                title={user.name}
                className="ml-auto inline-flex size-7 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-fg-2 ring-1 ring-line-2"
              >
                {user.initials}
              </span>
            ) : null}
          </>
        )}
      </div>

      {onSearch ? (
        collapsed ? (
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search or jump to (⌘K)"
            className="mt-3 inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface-1 text-fg-3 outline-none hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-brand-hi max-md:size-10"
          >
            <Search className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSearch}
            className={cn(
              "mt-3 flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-1 px-2.5 text-sm text-fg-3 shadow-hairline max-md:min-h-10",
              "outline-none transition-colors hover:border-line-2 hover:text-fg-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-brand-hi",
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

      <nav className={cn("mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto", collapsed && "w-full")}>
        {sections.map((section) => (
          <div key={section.label}>
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-line" />
            ) : (
              <div className="px-2 pb-1.5 text-2xs font-medium text-fg-4">{section.label}</div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                const link = (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "group relative flex h-8 items-center gap-2.5 rounded-md text-sm font-medium outline-none transition-colors max-md:min-h-10",
                      "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-brand-hi",
                      collapsed ? "mx-auto w-9 justify-center" : "px-2",
                      active ? "text-fg" : "text-fg-2 hover:bg-surface-1 hover:text-fg",
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-md bg-surface-2 shadow-hairline ring-1 ring-line-2"
                        transition={{ type: "spring", stiffness: 520, damping: 42 }}
                      />
                    ) : null}
                    <Icon
                      className={cn(
                        "relative size-4 shrink-0 transition-colors",
                        active ? "text-brand-hi" : "text-fg-3 group-hover:text-fg-2",
                      )}
                    />
                    {collapsed ? null : <span className="relative truncate">{item.label}</span>}
                    {!collapsed && item.count != null ? (
                      <span className={cn("relative ml-auto text-xs tnum", TONE[item.countTone ?? "default"])}>
                        {item.count}
                      </span>
                    ) : null}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">
                          {item.label}
                          {item.count != null ? <span className="ml-2 tnum text-fg-3">{item.count}</span> : null}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      link
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
