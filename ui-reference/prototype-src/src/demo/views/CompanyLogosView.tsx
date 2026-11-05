import { Images, Menu } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  BAND_SHORT,
  CompanyLogo,
  EmptyState,
  PageHeader,
  Segmented,
  type Band,
} from "@/components/jobhacker";
import { cn } from "@/lib/utils";
import { useDemo } from "../App";
import { applyLogo, companyLogoRows, openLogoPicker, useLogoOverrides, type DemoLogoRow } from "../logo-store";
import { placeholderMark } from "../logos";
import deckAlien from "@/art/deck-alien.webp";

type Segment = "needs" | "confirmed" | "all";

function inSegment(row: DemoLogoRow, segment: Segment): boolean {
  if (segment === "all") return true;
  if (segment === "confirmed") return row.state === "confirmed" || row.state === "none";
  return row.state === "found" || row.state === "missing";
}

function provenance(row: DemoLogoRow): string | null {
  if (row.state === "none") return "No logo";
  if (row.state === "confirmed") return "Picked by you";
  if (row.state === "found") return "Found in a posting";
  return null;
}

const BAND_TEXT: Record<"strong" | "maybe", string> = {
  strong: "text-strong",
  maybe: "text-maybe",
};

export function CompanyLogosView() {
  const { state, isMobile, openMobileNav } = useDemo();
  const overrides = useLogoOverrides();
  const rows = React.useMemo(
    () => companyLogoRows(state.jobs, state.weights, state.thresholds, overrides),
    [state.jobs, state.weights, state.thresholds, overrides],
  );
  const [segment, setSegment] = React.useState<Segment>("needs");
  const [loaded, setLoaded] = React.useState<ReadonlySet<string>>(new Set());

  const visible = rows.filter((row) => inSegment(row, segment));
  const counted = visible.filter((row) => row.state !== "none");
  const showing = counted.filter((row) => loaded.has(row.name)).length;

  const mark = (name: string, status: "loaded" | "failed") => {
    setLoaded((prev) => {
      const has = prev.has(name);
      if (status === "loaded" && has) return prev;
      if (status === "failed" && !has) return prev;
      const next = new Set(prev);
      if (status === "loaded") next.add(name);
      else next.delete(name);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={Images}
        kicker="Setup"
        title="Company logos"
        art={deckAlien}
        leading={
          isMobile ? (
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={openMobileNav}>
              <Menu />
            </Button>
          ) : null
        }
        actions={
          <span className="text-sm text-fg-2">
            Logos showing: <span className="tnum font-medium text-fg">{showing}</span> of{" "}
            <span className="tnum font-medium text-fg">{counted.length}</span>
          </span>
        }
      >
        <Segmented
          aria-label="Logo segments"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "needs", label: "Needs a look", count: rows.filter((r) => inSegment(r, "needs")).length },
            { value: "confirmed", label: "Confirmed", count: rows.filter((r) => inSegment(r, "confirmed")).length },
            { value: "all", label: "All", count: rows.length },
          ]}
        />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-5 max-md:px-4">
          {visible.length === 0 ? (
            <EmptyState icon={Images} title="Nothing in this view" body="Every company here has been answered." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1 shadow-card">
              {visible.map((row) => (
                <LogoRow key={row.name} row={row} onStatus={(status) => mark(row.name, status)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function LogoRow({ row, onStatus }: { row: DemoLogoRow; onStatus: (status: "loaded" | "failed") => void }) {
  const source = provenance(row);
  const band = row.band as Band;
  const src = row.domain && row.state !== "none" ? placeholderMark(row.domain) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <CompanyLogo name={row.name} src={src} size={40} onStatus={onStatus} />
      <div className="min-w-0 flex-1 basis-40">
        <div className="truncate text-base font-medium text-fg">{row.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-fg-3">
          <span className="text-fg-2">{row.domain && row.state !== "none" ? row.domain : "No domain yet"}</span>
          {source ? <span>{source}</span> : null}
        </div>
      </div>
      <span className={cn("text-xs font-medium", BAND_TEXT[row.band])}>{BAND_SHORT[band]}</span>
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={row.state !== "found" || !row.domain}
          onClick={() => applyLogo(row.name, { state: "confirmed", domain: row.domain })}
        >
          Looks right
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => openLogoPicker(row.name)}>
          Change
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={row.state === "none"}
          onClick={() => applyLogo(row.name, { state: "none", domain: null })}
        >
          No logo
        </Button>
      </div>
    </li>
  );
}
