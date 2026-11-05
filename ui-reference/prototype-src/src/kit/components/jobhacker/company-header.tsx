"use client";

import { useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { CompanyLogo, companyInitial, companyTileColor } from "./company-logo";
import { GlyphField } from "./glyph-field";
import {
  type LogoTheme,
  averageRelativeLuminance,
  contrastingLogoTheme,
  wordmarkBackdropLuminance,
} from "./logo-contrast";
import { Hint } from "./hint";
import { boxIn, lockTo, TargetLock } from "./target-lock";
import { replay, useAcquire } from "./use-acquire";

export interface HeaderFact {
  label: string;
  value: React.ReactNode;
}

/** The monitor's readout across the top of the art. */
export interface HeaderHud {
  /** Where this job is being looked at, e.g. the view: "Top matches". */
  label: string;
  /** A second, dimmer part of the label, e.g. the places in view. */
  dock?: string;
  /** This job's position in the list, from 1, and the list's length. */
  index?: number;
  total?: number;
  /** 0–1. Lights that share of the signal cells. */
  level?: number | null;
}

/**
 * The duotone the art is mapped through: black in the shadows, blood red in the
 * highlights, with no hue in between, so a midtone never turns pink. The SVG
 * filter and the logo-contrast reading both use these stops.
 */
const DUOTONE = {
  r: [0.012, 0.16, 0.5, 0.86],
  g: [0.006, 0.012, 0.03, 0.1],
  b: [0.012, 0.025, 0.075, 0.15],
} as const;
const DUOTONE_ID = "jh-duotone";
const SIGNAL_CELLS = 10;

/**
 * The top of a job, laid out like a game library's detail page: the company's
 * art across the pane, its logo as the cover, then the title, a row of facts
 * and the actions, all set on the art.
 *
 * Each of the company's three Brandfetch logos goes where it reads best. The
 * icon is the cover, and blurred into the art's color field. The symbol, the
 * glyph with no tile, is drawn large over the field, in the theme that contrasts
 * with that field. The wordmark names the company above the title, in the theme
 * that contrasts with the scrim it sits on. A company with no logo gets its monogram letter on
 * its tile color, and its name as text. Nothing else is fetched.
 *
 * The art's height is fixed, so an image that arrives late never moves the
 * layout. It scrolls away with the page, and a compact bar with the title and
 * actions takes its place at the top.
 *
 * The art reads as a surveillance monitor. It is mapped to a violet and red
 * duotone, with a glyph field and a scan beam over it, scanlines and grain, a
 * viewfinder, and the HUD readout along its top. When the job changes and the
 * change settles, the monitor acquires it: new art wipes in under a hazard band,
 * the frame drops and the scanlines jolt, the readout types in, the counter rolls,
 * and a target lock flies from the viewfinder onto the cover. Changes in a burst
 * (J held down) skip all of that and acquire once, when the burst ends.
 */
export function CompanyHeader({
  company,
  title,
  titleAs: Title = "h2",
  badge,
  artUrl,
  coverUrl,
  markOnDark,
  markOnLight,
  wordmarkOnDark,
  wordmarkOnLight,
  onEditLogo,
  facts,
  actions,
  compactActions,
  hud,
  contentClassName,
  className,
  children,
}: {
  company: string;
  title: string;
  titleAs?: "h1" | "h2";
  /** Beside the title, e.g. the triage state. */
  badge?: React.ReactNode;
  /** 128 px icon. The blurred color field, and the list's own URL, so it is already cached. */
  artUrl?: string | null;
  /** 256 px icon for the cover. Falls back to `artUrl`. */
  coverUrl?: string | null;
  /** Light-colored symbol, drawn when the art is dark. Falls back to the cover. */
  markOnDark?: string | null;
  /** Dark-colored symbol, drawn when the art is light. */
  markOnLight?: string | null;
  /** Light-colored wordmark, for the dark scrim under the title. A 404 shows the name. */
  wordmarkOnDark?: string | null;
  /** Dark-colored wordmark, for a near-white scrim. A 404 shows the name. */
  wordmarkOnLight?: string | null;
  /** When set, the cover is the button that opens the logo picker. */
  onEditLogo?: () => void;
  facts?: HeaderFact[];
  actions?: React.ReactNode;
  /** The actions for the compact bar once the art has scrolled away. */
  compactActions?: React.ReactNode;
  /** The readout along the top of the art. */
  hud?: HeaderHud;
  /** Lines the title block up with the page column. The art stays full width. */
  contentClassName?: string;
  className?: string;
  /** The rest of the page. It scrolls under the compact bar. */
  children?: React.ReactNode;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const heroRef = React.useRef<HTMLDivElement>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const coverRef = React.useRef<HTMLDivElement>(null);
  const lockRef = React.useRef<HTMLDivElement>(null);
  const finderRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [stuck, setStuck] = React.useState(false);
  const cover = coverUrl ?? artUrl ?? null;
  const art = artUrl ?? null;
  const [sample, setSample] = React.useState<ArtSample | null>(null);
  const sampled = sample?.src === art ? sample : null;
  // No art to read: the light logo, which is what the dark scrim needs.
  const pending = !!art && !sampled;
  const symbolTheme = sampled?.symbol ?? "light";
  const wordmarkTheme = sampled?.wordmark ?? "light";
  const symbolUrl = pending ? null : assetUrl(symbolTheme, markOnDark, markOnLight);
  const wordmarkUrl = pending ? null : assetUrl(wordmarkTheme, wordmarkOnDark, wordmarkOnLight);
  const onArtLuminance = React.useCallback((src: string, luminance: number | null) => {
    const artL = luminance ?? 0;
    setSample((prev) => {
      if (prev?.src === src) return prev;
      return {
        src,
        symbol: contrastingLogoTheme(artL),
        wordmark: contrastingLogoTheme(wordmarkBackdropLuminance(artL)),
      };
    });
  }, []);

  const fieldRef = React.useRef<HTMLDivElement>(null);
  const calm = useAcquire(
    `${company}|${title}`,
    () => {
      fieldRef.current?.removeAttribute("data-hold");
      acquire();
    },
    () => fieldRef.current?.setAttribute("data-hold", ""),
  );

  function acquire() {
    titleRef.current?.classList.add("glitch-run");
    const root = rootRef.current;
    const cover = coverRef.current;
    const finder = finderRef.current;
    if (!root || !cover) return;
    const target = boxIn(cover, root, 7);
    if (reduce || !finder) {
      lockTo(lockRef.current, target, { instant: true });
      return;
    }
    lockTo(lockRef.current, target, { from: boxIn(finder, root) });
    for (const el of root.querySelectorAll("[data-replay]")) replay(el);
  }

  // The cover moves when the pane is resized. Height changes, a longer description, never move it.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let width = root.clientWidth;
    const ro = new ResizeObserver(() => {
      const cover = coverRef.current;
      if (root.clientWidth === width || !cover) return;
      width = root.clientWidth;
      lockTo(lockRef.current, boxIn(cover, root, 7), { instant: true });
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const hero = heroRef.current;
    const root = hero ? scrollParent(hero) : null;
    if (!hero || !root) return;
    const onScroll = () => {
      const bar = barRef.current?.offsetHeight ?? 0;
      setStuck(hero.getBoundingClientRect().bottom <= root.getBoundingClientRect().top + bar);
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  const coverTile = (
    <span className="@container block size-34 rounded-[22px] bg-panel p-1 shadow-cover @max-xl:size-30 @max-md:size-23 @max-md:rounded-[21px]">
      <CompanyLogo name={company} src={cover} size={128} fluid />
    </span>
  );

  return (
    <div className={cn("@container", className)}>
      <div
        ref={rootRef}
        className="relative isolate [--art-gap:136px] [--art-h:460px] @max-xl:[--art-gap:116px] @max-xl:[--art-h:420px] @max-md:[--art-gap:92px] @max-md:[--art-h:340px]"
      >
        <DuotoneFilter />
        <HeaderArt
          name={company}
          artUrl={artUrl}
          coverUrl={cover}
          symbolUrl={symbolUrl}
          onArtLuminance={onArtLuminance}
          calm={calm}
          finderRef={finderRef}
          fieldRef={fieldRef}
          hud={hud}
        />
        <TargetLock ref={lockRef} corner={12} weight={2} className="[--lock-ms:520ms]" />

        <div className="sticky top-0 z-20 h-0">
          <div
            ref={barRef}
            inert={!stuck}
            aria-hidden={!stuck}
            className={cn(
              "absolute inset-x-0 top-0 overflow-hidden border-b border-line bg-panel shadow-card transition-opacity duration-150",
              stuck ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <div aria-hidden className="absolute inset-0 opacity-45">
              <ArtFill
                key={`${company}|${artUrl ?? ""}`}
                layer={{ id: -1, name: company, art: artUrl ?? null, cover: null, symbol: null }}
                entering={false}
                flat
              />
              <div className="hero-scrim absolute inset-0" />
            </div>
            <div className={cn("relative flex h-13 items-center gap-3 px-6 @max-md:px-4", contentClassName)}>
              <CompanyLogo name={company} src={cover} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="hud-label truncate text-fg-2">{company}</span>
                <span className="truncate text-sm font-semibold text-fg">{title}</span>
              </span>
              {compactActions ? <div className="flex shrink-0 items-center gap-1.5">{compactActions}</div> : null}
            </div>
          </div>
        </div>

        <div ref={heroRef} className={cn("relative px-6 pt-(--art-gap) pb-5 @max-md:px-4", contentClassName)}>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-5 @max-md:gap-x-4">
            <div
              ref={coverRef}
              className="relative row-span-2 @max-md:row-span-1 @max-md:self-center @3xl:row-span-3"
            >
              <span
                data-replay
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1/2 z-10 size-7 -translate-x-1/2 -translate-y-1/2 opacity-0 animate-cross-blink [animation-delay:420ms] before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-white after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-white"
              />
              {onEditLogo ? (
                <Hint label="Change company logo" detail={`Opens the picker for ${company}.`} side="bottom">
                  <button
                    type="button"
                    onClick={onEditLogo}
                    aria-label="Change company logo"
                    className="block rounded-[22px] outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-uv-hi"
                  >
                    {coverTile}
                  </button>
                </Hint>
              ) : (
                coverTile
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-2.5 @max-md:gap-1.5 @max-md:self-center">
              <CompanyName
                key={`${company}|${wordmarkUrl ?? ""}`}
                company={company}
                wordmarkUrl={wordmarkUrl}
                pending={pending}
              />
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <Title
                  key={title}
                  ref={titleRef}
                  data-text={title}
                  className="hero-text glitch-text relative font-display text-3xl font-semibold tracking-[-0.005em] text-balance text-fg [--glitch-ms:200ms] @max-xl:text-2xl @max-md:text-xl"
                >
                  {title}
                </Title>
                {badge}
              </div>
            </div>

            {facts?.length ? (
              <dl className="col-start-2 mt-3 flex flex-wrap gap-x-7 gap-y-3 @max-md:col-span-2 @max-md:col-start-1 @max-md:mt-4 @max-md:grid @max-md:grid-cols-2 @max-md:gap-x-4">
                {facts.map((f) => (
                  <div key={f.label} className="min-w-0 max-w-64">
                    <dt className="hero-text hud-label text-fg-3">{f.label}</dt>
                    <dd className="hero-text mt-1 flex min-w-0 items-center gap-1.5 text-sm font-medium text-fg">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {actions ? (
              <div className="col-span-2 col-start-1 mt-5 flex flex-wrap items-center gap-2 @3xl:col-span-1 @3xl:col-start-2">
                {actions}
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

/**
 * The company line above the title: smaller than the title, and never wider than
 * the cover. Its height is fixed, so the wordmark arriving never moves the title.
 */
function CompanyName({
  company,
  wordmarkUrl,
  pending,
}: {
  company: string;
  wordmarkUrl?: string | null;
  /** The art is still being read, so the name stays hidden until the wordmark is chosen. */
  pending: boolean;
}) {
  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const ref = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setState("ready");
  }, []);

  const showMark = !!wordmarkUrl && state !== "failed";
  // A missing theme shows the name. The other theme is not tried: a clashing logo reads worse.
  const showName = !pending && !showMark;
  return (
    <div className="flex h-9 min-w-0 items-center @max-xl:h-8 @max-md:h-6">
      {showMark ? (
        <img
          ref={ref}
          src={wordmarkUrl}
          alt={company}
          decoding="async"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
          className={cn(
            "hero-drop h-full w-auto max-w-34 object-contain object-left transition-opacity duration-200 @max-xl:max-w-30 @max-md:max-w-23",
            state === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      ) : showName ? (
        <span className="hero-text truncate text-xl font-semibold tracking-tight text-fg/90 @max-xl:text-lg @max-md:text-base">
          {company}
        </span>
      ) : null}
    </div>
  );
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let n = el.parentElement;
  while (n) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return n;
    n = n.parentElement;
  }
  return null;
}

type ArtLayer = { id: number; name: string; art: string | null; cover: string | null; symbol: string | null };

/** The SVG filter the art is drawn through. One per header; the art and the compact bar share it. */
function DuotoneFilter() {
  return (
    <svg aria-hidden focusable="false" className="pointer-events-none absolute size-0">
      <filter id={DUOTONE_ID} colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="table" tableValues={DUOTONE.r.join(" ")} />
          <feFuncG type="table" tableValues={DUOTONE.g.join(" ")} />
          <feFuncB type="table" tableValues={DUOTONE.b.join(" ")} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

/**
 * The art behind the header, and the monitor drawn over it. When the company
 * changes calmly, the new art wipes in over the old; in a burst it swaps at once.
 */
function HeaderArt({
  name,
  artUrl,
  coverUrl,
  symbolUrl,
  onArtLuminance,
  calm,
  finderRef,
  fieldRef,
  hud,
}: {
  name: string;
  artUrl?: string | null;
  coverUrl?: string | null;
  symbolUrl?: string | null;
  onArtLuminance?: (src: string, luminance: number | null) => void;
  /** Whether the latest change came after a pause. Set before this component's effects run. */
  calm: React.RefObject<boolean>;
  finderRef: React.Ref<HTMLDivElement>;
  fieldRef: React.Ref<HTMLDivElement>;
  hud?: HeaderHud;
}) {
  const reduce = useReducedMotion();
  const art = artUrl ?? null;
  const cover = coverUrl ?? null;
  const symbol = symbolUrl ?? null;
  const [layers, setLayers] = React.useState<ArtLayer[]>([{ id: 0, name, art, cover, symbol }]);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const wipe = !reduce && calm.current;
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.name === name && top.art === art && top.cover === cover && top.symbol === symbol) return prev;
      // The symbol arrives once the art has been read. Swap it on the current layer,
      // so the art does not wipe a second time.
      if (top && top.name === name && top.art === art && top.cover === cover) {
        const next = prev.slice();
        next[next.length - 1] = { ...top, symbol };
        return next;
      }
      seq.current += 1;
      const next = { id: seq.current, name, art, cover, symbol };
      return wipe && top ? [top, next] : [next];
    });
  }, [name, art, cover, symbol, reduce, calm]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-(--art-h) overflow-hidden">
      {layers.map((layer, i) => {
        const entering = layers.length > 1 && i === layers.length - 1;
        return (
          <ArtFill
            key={layer.id}
            layer={layer}
            entering={entering}
            onEntered={() => setLayers((prev) => (prev.length > 1 ? prev.slice(-1) : prev))}
            onArtLuminance={entering || layers.length === 1 ? onArtLuminance : undefined}
          />
        );
      })}
      <GlyphField ref={fieldRef} className="inset-y-0 right-0 left-[30%]" />
      <div className="hero-screen absolute inset-0" />
      <div className="hero-glow absolute inset-0" />
      <div data-replay className="scanlines absolute -inset-y-1 inset-x-0 animate-scan-jolt" />
      <div className="grain absolute inset-0 opacity-6" />
      <div className="hero-scrim absolute inset-0" />
      {layers.length > 1 ? (
        <div key={layers[layers.length - 1]?.id} className="absolute inset-0 animate-art-wipe">
          <div className="hazard absolute inset-x-0 bottom-0 h-3 shadow-[0_0_24px_4px_rgb(220_20_53/0.55)]" />
        </div>
      ) : null}
      <div data-replay className="absolute inset-0 bg-black opacity-0 animate-drop-flash" />
      <div ref={finderRef} className="viewfinder" style={{ bottom: "auto", height: "calc(var(--art-gap) - 28px)" }} />
      {hud ? <HudStrip hud={hud} /> : null}
    </div>
  );
}

/** REC, the label, the signal cells and the position counter, inside the viewfinder's top corners. */
function HudStrip({ hud }: { hud: HeaderHud }) {
  const level = hud.level == null ? null : Math.max(0, Math.min(1, hud.level));
  const lit = level == null ? 0 : Math.round(level * SIGNAL_CELLS);
  const cell = "h-2.5 w-[5px] -skew-x-[18deg]";
  return (
    <div className="hud-label hero-text absolute inset-x-[30px] top-[26px] flex items-center justify-between gap-4 text-fg-2 @max-md:inset-x-6 @max-md:top-[22px]">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="rec" />
        <span data-replay className="max-w-full shrink-0 truncate text-fg animate-readout-in">
          {hud.label}
        </span>
        {hud.dock ? <span className="truncate text-fg-3 @max-md:hidden">/ {hud.dock}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-5">
        {level != null ? (
          <span className="flex items-center gap-2 @max-md:hidden">
            <span className="text-fg-3">Sig</span>
            <span className="relative flex gap-[2px]">
              {Array.from({ length: SIGNAL_CELLS }, (_, i) => (
                <i
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed cells
                  key={i}
                  className={cn(cell, i < lit ? "bg-brand-hi shadow-[0_0_6px_rgb(255_46_79/0.55)]" : "bg-white/12")}
                />
              ))}
              {lit > 0 ? (
                <i
                  data-replay
                  className={cn(cell, "absolute top-0 left-0 bg-white animate-cell-blink [animation-delay:200ms]")}
                  style={{ translate: `${(lit - 1) * 7}px 0` }}
                />
              ) : null}
            </span>
          </span>
        ) : null}
        {hud.index != null && hud.total != null ? (
          <span className="tnum flex items-center text-fg">
            <span className="inline-flex overflow-hidden">
              <span data-replay className="inline-block animate-roll-in">
                {pad(hud.index)}
              </span>
            </span>
            <span className="text-fg-3">&nbsp;/&nbsp;{pad(hud.total)}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ArtFill({
  layer,
  entering,
  onEntered,
  flat = false,
  onArtLuminance,
}: {
  layer: ArtLayer;
  entering: boolean;
  onEntered?: () => void;
  /** Only the color field: no mark and no letter. The compact bar uses it. */
  flat?: boolean;
  /** Reads the blurred icon. Not set on the compact bar, or on an art that is fading out. */
  onArtLuminance?: (src: string, luminance: number | null) => void;
}) {
  // Each image that fails drops out on its own: a missing symbol falls back to the icon,
  // and only a missing icon turns the art into the monogram.
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(() => new Set());
  const usable = (...urls: (string | null)[]) => urls.find((u): u is string => !!u && !failed.has(u)) ?? null;
  const fail = (url: string) => setFailed((prev) => new Set(prev).add(url));
  const tile = companyTileColor(layer.name);
  const field = usable(layer.art, layer.cover);
  const mark = field ? usable(layer.symbol, layer.cover, layer.art) : null;

  return (
    <div
      className={cn("absolute inset-0", entering && "overflow-hidden animate-art-wipe")}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && entering) onEntered?.();
      }}
    >
      <div
        className={cn("absolute inset-0", entering && "animate-art-wipe-counter")}
        style={{ filter: `url(#${DUOTONE_ID})` }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 140% at 80% 10%, color-mix(in oklab, ${tile} 92%, white), ${tile} 38%, color-mix(in oklab, ${tile} 55%, black) 100%)`,
          }}
        />
        <ArtBody layer={layer} field={field} mark={mark} flat={flat} fail={fail} onArtLuminance={onArtLuminance} />
      </div>
    </div>
  );
}

function ArtBody({
  layer,
  field,
  mark,
  flat,
  fail,
  onArtLuminance,
}: {
  layer: ArtLayer;
  field: string | null;
  mark: string | null;
  flat: boolean;
  fail: (url: string) => void;
  onArtLuminance?: (src: string, luminance: number | null) => void;
}) {
  return (
    <>
      {field ? (
        <>
          <ArtImage
            key={field}
            src={field}
            company={layer.name}
            onFail={() => fail(field)}
            onLuminance={onArtLuminance && field === layer.art ? onArtLuminance : undefined}
            className="inset-0 size-full scale-125 object-cover blur-2xl contrast-125"
          />
          {!flat && mark ? (
            <ArtImage
              key={`mark|${mark}`}
              src={mark}
              company={layer.name}
              onFail={() => fail(mark)}
              className="top-[-22%] right-[-10%] aspect-square h-[100%] w-auto max-w-none -rotate-12 opacity-90 mix-blend-overlay mask-radial-from-50% mask-radial-to-72% mask-b-from-45% mask-b-to-85% @max-md:right-[-24%]"
            />
          ) : null}
        </>
      ) : flat ? null : (
        <span
          className="absolute top-[-8%] right-[4%] -rotate-12 select-none font-black leading-[0.8] text-white/50 mix-blend-overlay mask-b-from-40% mask-b-to-90% @max-md:right-[-6%]"
          style={{ fontSize: "calc(var(--art-h) * 0.8)" }}
        >
          {companyInitial(layer.name)}
        </span>
      )}
    </>
  );
}

function ArtImage({
  src,
  company,
  className,
  onFail,
  onLuminance,
}: {
  src: string;
  company: string;
  className?: string;
  onFail: () => void;
  /** Set on the icon that paints the field. Null means the pixels could not be read. */
  onLuminance?: (src: string, luminance: number | null) => void;
}) {
  const remote = src.startsWith("https:") || src.startsWith("http:");
  const [plain, setPlain] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const ref = React.useRef<HTMLImageElement>(null);
  const onFailRef = React.useRef(onFail);
  const onLuminanceRef = React.useRef(onLuminance);
  onFailRef.current = onFail;
  onLuminanceRef.current = onLuminance;
  // A remote icon is read through a CORS load. If that is refused, load it again
  // without CORS so the art still paints, and the header uses the light logo.
  const cross = !!onLuminance && remote && !plain;

  const report = React.useCallback(
    (img: HTMLImageElement) => {
      const fn = onLuminanceRef.current;
      if (!fn) return;
      if (remote && plain) {
        fn(src, null);
        return;
      }
      fn(src, readArtLuminance(img, company));
    },
    [company, plain, remote, src],
  );

  React.useEffect(() => {
    const img = ref.current;
    if (!img?.complete || img.naturalWidth === 0) return;
    setReady(true);
    report(img);
  }, [report]);

  return (
    <img
      key={cross ? "cors" : "plain"}
      ref={ref}
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="strict-origin-when-cross-origin"
      crossOrigin={cross ? "anonymous" : undefined}
      onLoad={(e) => {
        setReady(true);
        report(e.currentTarget);
      }}
      onError={() => {
        if (cross) {
          setPlain(true);
          return;
        }
        onFailRef.current();
        onLuminanceRef.current?.(src, null);
      }}
      className={cn("absolute transition-opacity duration-200", ready ? "" : "opacity-0!", className)}
    />
  );
}

type ArtSample = { src: string; symbol: LogoTheme; wordmark: LogoTheme };

function assetUrl(theme: LogoTheme, onDark?: string | null, onLight?: string | null): string | null {
  const url = theme === "light" ? onDark : onLight;
  return url ?? null;
}

/** The icon, drawn over the company's tile color and mapped through the duotone, reduced to one luminance. */
function readArtLuminance(img: HTMLImageElement, company: string): number | null {
  const size = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = resolveTileColor(company);
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  try {
    const px = ctx.getImageData(0, 0, size, size).data;
    for (let i = 0; i < px.length; i += 4) {
      const grey = (0.2126 * (px[i] ?? 0) + 0.7152 * (px[i + 1] ?? 0) + 0.0722 * (px[i + 2] ?? 0)) / 255;
      px[i] = tone(DUOTONE.r, grey) * 255;
      px[i + 1] = tone(DUOTONE.g, grey) * 255;
      px[i + 2] = tone(DUOTONE.b, grey) * 255;
    }
    return averageRelativeLuminance(px);
  } catch {
    return null;
  }
}

/** feFuncX type="table": linear between evenly spaced stops. */
function tone(stops: readonly number[], v: number): number {
  const n = stops.length - 1;
  const k = Math.min(n - 1, Math.max(0, Math.floor(v * n)));
  const a = stops[k] ?? 0;
  const b = stops[k + 1] ?? a;
  return a + (b - a) * (v * n - k);
}

function resolveTileColor(name: string): string {
  if (typeof document === "undefined") return "black";
  const probe = document.createElement("span");
  probe.style.backgroundColor = companyTileColor(name);
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return "black";
  return color;
}
