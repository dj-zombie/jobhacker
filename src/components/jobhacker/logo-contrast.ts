/**
 * Which Brandfetch logo contrasts with the header art.
 *
 * Brandfetch's `theme` is the color of the logo. `light` is the light-colored
 * logo, drawn on dark art. `dark` is the dark-colored logo, drawn on light art.
 *
 * The same two functions live in `src/core/brand/logo-url.ts`. A test fails if
 * they disagree. This copy is here because the kit is also the prototype, whose
 * `@/` does not reach core, and the two kit trees have to stay identical.
 */

export type LogoTheme = "light" | "dark";

/** How much of the wordmark's backdrop is the panel. The left edge of `hero-scrim`. */
const WORDMARK_SCRIM = 0.8;

/** sRGB channel, 0–1, to linear light. */
function linearChannel(srgb: number): number {
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0–1, from sRGB channels that are themselves 0–1. */
function relativeLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

/** `--color-panel`, the color the wordmark's scrim mixes toward. */
const PANEL_LUMINANCE = relativeLuminance(0x0c / 255, 0x0e / 255, 0x13 / 255);

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function contrastRatio(foreground: number, background: number): number {
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The Brandfetch theme whose logo contrasts with a backdrop of this relative
 * luminance. A white logo wins below about 0.18, where it beats a black one.
 */
export function contrastingLogoTheme(backdropLuminance: number): LogoTheme {
  const backdrop = clamp01(backdropLuminance);
  const light = contrastRatio(1, backdrop);
  const dark = contrastRatio(0, backdrop);
  return light >= dark ? "light" : "dark";
}

/**
 * The wordmark sits on the left of the art, under a scrim that is mostly the
 * panel. Its backdrop is that mix, so a light wordmark is used unless the art
 * itself is near white.
 */
export function wordmarkBackdropLuminance(artLuminance: number): number {
  const art = clamp01(artLuminance);
  return WORDMARK_SCRIM * PANEL_LUMINANCE + (1 - WORDMARK_SCRIM) * art;
}

/** Mean relative luminance of RGBA pixels. Transparent pixels count as what was drawn under them. */
export function averageRelativeLuminance(pixels: Uint8ClampedArray): number {
  const count = pixels.length / 4;
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i] ?? 0;
    const green = pixels[i + 1] ?? 0;
    const blue = pixels[i + 2] ?? 0;
    sum += relativeLuminance(red / 255, green / 255, blue / 255);
  }
  return sum / count;
}
