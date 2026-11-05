"use client";

import { RotateCcw, Save, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Hint } from "./hint";
import { ScoreHistogram } from "./score-histogram";
import { BandDot } from "./score";
import type { DimKey } from "./types";

export type Weights = Record<DimKey, number>;

export const DIMENSIONS: { key: DimKey; label: string; hint: string }[] = [
  { key: "role", label: "Role", hint: "The kind of work you do and want" },
  { key: "tech", label: "Tech", hint: "Stack overlap with your experience" },
  { key: "domain", label: "Domain", hint: "Games, audio, creative and developer tools" },
  { key: "seniority", label: "Seniority", hint: "Senior or staff IC, not management" },
  { key: "logistics", label: "Logistics", hint: "Remote, location and employment type" },
  { key: "comp", label: "Comp", hint: "Against your floor; ignored when not listed" },
];

/**
 * Live ranking controls. Every change here re-ranks locally from cached
 * dimension scores; the "Live" badge shows the API call count stays at zero.
 */
export function TunePanel({
  weights,
  onWeightsChange,
  thresholds,
  onThresholdsChange,
  scores,
  bandCounts,
  dirty,
  apiCalls = 0,
  onSave,
  onReset,
  onClose,
}: {
  weights: Weights;
  onWeightsChange: (w: Weights) => void;
  thresholds: { strong: number; maybe: number };
  onThresholdsChange: (t: { strong: number; maybe: number }) => void;
  scores: number[];
  bandCounts: { strong: number; maybe: number; no: number };
  dirty: boolean;
  apiCalls?: number;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="scanlines-light relative flex items-center gap-3 border-b border-line px-5 py-4 max-md:px-4">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left animate-power-on bg-linear-to-r from-transparent via-brand-hi to-transparent"
        />
        <span className="inline-flex size-9 items-center justify-center rounded-lg bg-brand-wash ring-1 ring-inset ring-brand/30">
          <SlidersHorizontal className="size-4 text-brand-hi" />
        </span>
        <div className="min-w-0">
          <h2 className="text-md font-semibold tracking-tight text-fg">Tune ranking</h2>
          <p className="text-xs text-fg-3">Drag a weight and watch the list re-rank.</p>
        </div>
        <Hint
          label="Live"
          detail="A weight change re-ranks on this machine. It doesn't call the model."
          side="bottom"
        >
          <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-strong-wash px-2 py-1 text-2xs font-medium text-strong ring-1 ring-inset ring-strong/25 sm:inline-flex">
            <span className="h-1.5 w-2.5 bg-strong text-strong shadow-[0_0_6px_currentColor]" />
            Live · <span className="tnum">{apiCalls}</span> API calls
          </span>
        </Hint>
        <Hint label="Close tuning" side="bottom">
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close tuning">
            <X />
          </Button>
        </Hint>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 max-md:p-4">
        <section className="surface-card rounded-xl p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="hud-label text-fg-2">Score distribution</h3>
            <div className="flex items-center gap-3 text-2xs text-fg-3">
              <span className="inline-flex items-center gap-1.5">
                <BandDot band="strong" /> Strong <b className="font-semibold tnum text-fg">{bandCounts.strong}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BandDot band="maybe" /> Maybe <b className="font-semibold tnum text-fg">{bandCounts.maybe}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BandDot band="no" /> Weak <b className="font-semibold tnum text-fg">{bandCounts.no}</b>
              </span>
            </div>
          </div>
          <ScoreHistogram scores={scores} thresholds={thresholds} />
        </section>

        <section className="surface-card rounded-xl p-4">
          <h3 className="hud-label text-fg-2">Weights</h3>
          <p className="mt-0.5 text-xs text-fg-3">How much each dimension counts. Only the ratios matter.</p>
          <div className="mt-4 space-y-4">
            {DIMENSIONS.map((d) => (
              <div key={d.key}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <label htmlFor={`w-${d.key}`} className="text-sm font-medium text-fg">
                    {d.label}
                  </label>
                  <span className="truncate text-xs text-fg-3">{d.hint}</span>
                  <span className="ml-auto font-mono text-sm font-semibold tnum text-fg">×{weights[d.key]}</span>
                </div>
                <Slider
                  id={`w-${d.key}`}
                  aria-label={`${d.label} weight`}
                  min={0}
                  max={8}
                  step={1}
                  value={[weights[d.key]]}
                  onValueChange={([v]) => onWeightsChange({ ...weights, [d.key]: v ?? 0 })}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card rounded-xl p-4">
          <h3 className="hud-label text-fg-2">Bands</h3>
          <p className="mt-0.5 text-xs text-fg-3">Where a match turns from weak to maybe, and maybe to strong.</p>
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-sm">
                <BandDot band="strong" />
                <span className="font-medium text-fg">Strong from</span>
                <span className="ml-auto font-semibold tnum text-fg">{thresholds.strong}</span>
              </div>
              <Slider
                aria-label="Strong threshold"
                min={thresholds.maybe + 1}
                max={95}
                step={1}
                value={[thresholds.strong]}
                onValueChange={([v]) => onThresholdsChange({ ...thresholds, strong: v ?? thresholds.strong })}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-sm">
                <BandDot band="maybe" />
                <span className="font-medium text-fg">Maybe from</span>
                <span className="ml-auto font-semibold tnum text-fg">{thresholds.maybe}</span>
              </div>
              <Slider
                aria-label="Maybe threshold"
                min={20}
                max={thresholds.strong - 1}
                step={1}
                value={[thresholds.maybe]}
                onValueChange={([v]) => onThresholdsChange({ ...thresholds, maybe: v ?? thresholds.maybe })}
              />
            </div>
          </div>
        </section>
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-5 py-3 max-md:px-4">
        <span className="text-xs text-fg-3">{dirty ? "Unsaved changes" : "Matches criteria.yaml"}</span>
        <Button variant="ghost" size="sm" className="ml-auto" disabled={!dirty} onClick={onReset}>
          <RotateCcw />
          Reset
        </Button>
        <Button size="sm" disabled={!dirty} onClick={onSave}>
          <Save />
          Save to criteria.yaml
        </Button>
      </footer>
    </div>
  );
}
