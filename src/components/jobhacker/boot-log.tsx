import { cn } from "@/lib/utils";
import { DecodeText } from "./decode-text";
import { GlyphField } from "./glyph-field";

export type BootTone = "ok" | "warn" | "info" | "muted";

export interface BootLine {
  tone: BootTone;
  /** The bracketed tag, drawn as "[ OK ]". */
  tag: string;
  text: string;
}

const TAG_TONE: Record<BootTone, string> = {
  ok: "text-strong",
  warn: "text-maybe",
  info: "text-info",
  muted: "text-fg-4",
};

/**
 * A boot / MOTD strip: a glyph field with its scanning beam behind monospace log lines, each a
 * real telemetry readout tagged [ OK ] / [ WARN ]. An optional headline decodes once. The beam is
 * the one ambient loop, and it pauses off screen; a live sweep swaps the status block for a REC
 * marker. Presentational — pass the lines and headline in.
 */
export function BootLog({
  lines,
  headline,
  epigraph,
  live = false,
  className,
}: {
  lines: BootLine[];
  /** A one-line result that decodes once, e.g. the signal summary. */
  headline?: string;
  /** A faint motto under the log. */
  epigraph?: string;
  /** A sweep is in progress: show a REC marker instead of the ready block. */
  live?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "chamfer relative overflow-hidden rounded-xl border border-line bg-black/55 p-4 shadow-hairline",
        className,
      )}
    >
      <GlyphField className="inset-0 opacity-60" seed="recon" />
      <span aria-hidden className="scanlines pointer-events-none absolute inset-0 opacity-35" />
      <div className="relative min-w-0">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("shrink-0", live ? "rec" : "h-2 w-3 bg-strong shadow-[0_0_6px_var(--color-strong)]")}
          />
          <span className="hud-label text-fg-2">{live ? "sweep in progress" : "recon console"}</span>
        </div>
        <ul className="mt-3 space-y-1 font-mono text-2xs leading-relaxed">
          {lines.map((l) => (
            <li key={l.text} className="flex gap-2">
              <span className={cn("w-16 shrink-0 tnum", TAG_TONE[l.tone])}>[ {l.tag} ]</span>
              <span className="min-w-0 text-fg-2">{l.text}</span>
            </li>
          ))}
        </ul>
        {headline ? (
          <p className="relative mt-3.5 font-mono text-sm font-medium tracking-wide text-balance text-fg">
            <DecodeText text={headline} />
          </p>
        ) : null}
        {epigraph ? <p className="mt-2 font-mono text-2xs italic text-fg-4">“{epigraph}”</p> : null}
      </div>
    </div>
  );
}
