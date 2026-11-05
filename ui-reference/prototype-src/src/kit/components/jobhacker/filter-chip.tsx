"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A filter as a pill that opens a single-choice menu. Hovered or open, it locks corner brackets on. */
export function FilterChip<T extends string>({
  label,
  value,
  options,
  onChange,
  defaultValue,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** When value equals this, the chip renders as inactive. */
  defaultValue?: T;
}) {
  const current = options.find((o) => o.value === value);
  const active = defaultValue !== undefined && value !== defaultValue;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group hud-corners relative inline-flex h-7 max-md:min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs outline-none transition-colors",
          "hover:hud-on data-[state=open]:hud-on",
          "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi data-[state=open]:bg-surface-3",
          active
            ? "border-brand/40 bg-brand-wash text-fg"
            : "border-line-2 bg-surface-1 text-fg-2 hover:border-uv-hi/40 hover:bg-surface-2 hover:text-fg",
        )}
      >
        <span className="text-fg-3">{label}</span>
        <span className="font-medium">{current?.label}</span>
        <ChevronDown className="size-3 text-fg-3 transition-transform duration-200 ease-out-quint group-data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
