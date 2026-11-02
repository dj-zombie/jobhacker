"use client";

import { useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { CompanyLogo, companyInitial, companyTileColor } from "./company-logo";

export interface HeaderFact {
  label: string;
  value: React.ReactNode;
}

/**
 * The top of a job, laid out like a game library's detail page: the company's
 * art across the pane, its logo as the cover, then the title, a row of facts
 * and the actions, all set on the art.
 *
 * Each of the company's three Brandfetch logos goes where it reads best. The
 * icon is the cover, and blurred into the art's color field. The symbol, the
 * glyph with no tile, is drawn large over the field. The wordmark names the
 * company above the title. A company with no logo gets its monogram letter on
 * its tile color, and its name as text. Nothing else is fetched.
 *
 * The art's height is fixed, so an image that arrives late never moves the
 * layout. It scrolls away with the page, and a compact bar with the title and
 * actions takes its place at the top.
 */
export function CompanyHeader({
  company,
  title,
  titleAs: Title = "h2",
  badge,
  artUrl,
  coverUrl,
  markUrl,
  wordmarkUrl,
  onEditLogo,
  facts,
  actions,
  compactActions,
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
  /** The symbol drawn large on the art. Falls back to the cover. */
  markUrl?: string | null;
  /** The wordmark for dark backgrounds, above the title. Falls back to the name as text. */
  wordmarkUrl?: string | null;
  /** When set, the cover is the button that opens the logo picker. */
  onEditLogo?: () => void;
  facts?: HeaderFact[];
  actions?: React.ReactNode;
  /** The actions for the compact bar once the art has scrolled away. */
  compactActions?: React.ReactNode;
  /** Lines the title block up with the page column. The art stays full width. */
  contentClassName?: string;
  className?: string;
  /** The rest of the page. It scrolls under the compact bar. */
  children?: React.ReactNode;
}) {
  const heroRef = React.useRef<HTMLDivElement>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = React.useState(false);
  const cover = coverUrl ?? artUrl ?? null;

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
      <div className="relative isolate [--art-gap:136px] [--art-h:460px] @max-xl:[--art-gap:116px] @max-xl:[--art-h:420px] @max-md:[--art-gap:92px] @max-md:[--art-h:340px]">
        <HeaderArt name={company} artUrl={artUrl} coverUrl={cover} symbolUrl={markUrl} />

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
                <span className="truncate text-2xs font-semibold uppercase tracking-wider text-fg-2">{company}</span>
                <span className="truncate text-sm font-semibold text-fg">{title}</span>
              </span>
              {compactActions ? <div className="flex shrink-0 items-center gap-1.5">{compactActions}</div> : null}
            </div>
          </div>
        </div>

        <div ref={heroRef} className={cn("relative px-6 pt-(--art-gap) pb-5 @max-md:px-4", contentClassName)}>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-5 @max-md:gap-x-4">
            <div className="row-span-2 @max-md:row-span-1 @max-md:self-center @3xl:row-span-3">
              {onEditLogo ? (
                <button
                  type="button"
                  onClick={onEditLogo}
                  aria-label="Change company logo"
                  className="block rounded-[22px] outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-hi"
                >
                  {coverTile}
                </button>
              ) : (
                coverTile
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-2.5 @max-md:gap-1.5 @max-md:self-center">
              <CompanyName key={`${company}|${wordmarkUrl ?? ""}`} company={company} wordmarkUrl={wordmarkUrl} />
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <Title className="hero-text text-3xl font-semibold tracking-tight text-balance text-fg @max-xl:text-2xl @max-md:text-xl">
                  {title}
                </Title>
                {badge}
              </div>
            </div>

            {facts?.length ? (
              <dl className="col-start-2 mt-3 flex flex-wrap gap-x-7 gap-y-3 @max-md:col-span-2 @max-md:col-start-1 @max-md:mt-4 @max-md:grid @max-md:grid-cols-2 @max-md:gap-x-4">
                {facts.map((f) => (
                  <div key={f.label} className="min-w-0 max-w-64">
                    <dt className="hero-text text-2xs font-medium uppercase tracking-wider text-fg-3">{f.label}</dt>
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
function CompanyName({ company, wordmarkUrl }: { company: string; wordmarkUrl?: string | null }) {
  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const ref = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setState("ready");
  }, []);

  const showMark = !!wordmarkUrl && state !== "failed";
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
      ) : (
        <span className="hero-text truncate text-xl font-semibold tracking-tight text-fg/90 @max-xl:text-lg @max-md:text-base">
          {company}
        </span>
      )}
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

/** The art behind the header. When the company changes, the new art fades in over the old. */
function HeaderArt({
  name,
  artUrl,
  coverUrl,
  symbolUrl,
}: {
  name: string;
  artUrl?: string | null;
  coverUrl?: string | null;
  symbolUrl?: string | null;
}) {
  const reduce = useReducedMotion();
  const art = artUrl ?? null;
  const cover = coverUrl ?? null;
  const symbol = symbolUrl ?? null;
  const [layers, setLayers] = React.useState<ArtLayer[]>([{ id: 0, name, art, cover, symbol }]);
  const seq = React.useRef(0);

  React.useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.name === name && top.art === art && top.cover === cover && top.symbol === symbol) return prev;
      seq.current += 1;
      const next = { id: seq.current, name, art, cover, symbol };
      return reduce || !top ? [next] : [top, next];
    });
  }, [name, art, cover, symbol, reduce]);

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
          />
        );
      })}
      <div className="hero-screen absolute inset-0" />
      <div className="hero-glow absolute inset-0" />
      <div className="hero-scrim absolute inset-0" />
    </div>
  );
}

function ArtFill({
  layer,
  entering,
  onEntered,
  flat = false,
}: {
  layer: ArtLayer;
  entering: boolean;
  onEntered?: () => void;
  /** Only the color field: no mark and no letter. The compact bar uses it. */
  flat?: boolean;
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
      className={cn("absolute inset-0", entering && "animate-header-art")}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && entering) onEntered?.();
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 140% at 80% 10%, color-mix(in oklab, ${tile} 92%, white), ${tile} 38%, color-mix(in oklab, ${tile} 55%, black) 100%)`,
        }}
      />
      {flat ? (
        field ? (
          <ArtImage
            key={field}
            src={field}
            onFail={() => fail(field)}
            className="inset-0 size-full scale-125 object-cover blur-2xl saturate-150"
          />
        ) : null
      ) : field && mark ? (
        <>
          <ArtImage
            key={field}
            src={field}
            onFail={() => fail(field)}
            className="inset-0 size-full scale-125 object-cover blur-2xl saturate-150"
          />
          <ArtImage
            key={`mark|${mark}`}
            src={mark}
            onFail={() => fail(mark)}
            className="top-[-22%] right-[-10%] aspect-square h-[100%] w-auto max-w-none -rotate-12 opacity-90 mix-blend-overlay mask-radial-from-50% mask-radial-to-72% mask-b-from-45% mask-b-to-85% @max-md:right-[-24%]"
          />
        </>
      ) : (
        <span
          className="absolute top-[-8%] right-[4%] -rotate-12 select-none font-black leading-[0.8] text-white/50 mix-blend-overlay mask-b-from-40% mask-b-to-90% @max-md:right-[-6%]"
          style={{ fontSize: "calc(var(--art-h) * 0.8)" }}
        >
          {companyInitial(layer.name)}
        </span>
      )}
    </div>
  );
}

function ArtImage({ src, className, onFail }: { src: string; className?: string; onFail: () => void }) {
  const [ready, setReady] = React.useState(false);
  const ref = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setReady(true);
  }, []);

  return (
    <img
      ref={ref}
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() => setReady(true)}
      onError={onFail}
      className={cn("absolute transition-opacity duration-200", ready ? "" : "opacity-0!", className)}
    />
  );
}
