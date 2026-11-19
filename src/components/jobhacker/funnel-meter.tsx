import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { AnimatedNumber } from "./score";

export interface FunnelStage {
  id: string;
  label: string;
  value: number;
  /** Background class for the bar, e.g. "bg-info". Every stage also carries its label. */
  tone: string;
  /** The drop from the stage before it, e.g. "−241 gated". */
  note?: string;
}

/**
 * The recon pipeline as a set of descending bars: harvested → past the gates → scored → matches.
 * Each bar is scaled to the widest stage, so the narrowing reads as "signal out of noise". Counts
 * roll up once on mount; bars grow in once. Presentational; pass the stages widest-first.
 */
export function FunnelMeter({ stages, className }: { stages: FunnelStage[]; className?: string }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <ol className={cn("space-y-3", className)}>
      {stages.map((st, i) => (
        <li key={st.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="hud-label text-fg-3">{st.label}</span>
            <span className="flex items-baseline gap-2">
              {st.note ? <span className="font-mono text-2xs tnum text-fg-4">{st.note}</span> : null}
              <AnimatedNumber
                value={st.value}
                startFrom={0}
                format={(n) => formatCount(Math.round(n))}
                className="font-display text-lg font-semibold tnum text-fg"
              />
            </span>
          </div>
          <span className="mt-1.5 block h-2 w-full overflow-hidden bg-surface-3">
            <span
              className={cn("block h-full origin-left animate-bar-grow", st.tone)}
              style={{ width: `${Math.max((st.value / max) * 100, 0.8)}%`, animationDelay: `${i * 90}ms` }}
            />
          </span>
        </li>
      ))}
    </ol>
  );
}
