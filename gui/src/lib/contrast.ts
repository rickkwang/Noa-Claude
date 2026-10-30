import type { AppSettings } from '../types';

type Variant = 'light' | 'dark';

/**
 * Theme contrast follows the reference theme editor: a 0–100 value per variant, with the
 * light and dark defaults chosen so the palette at rest is the one the app shipped with.
 */
export const CONTRAST_DEFAULTS: Record<Variant, number> = { light: 45, dark: 60 };

/** Stored values can be missing (older settings) or out of range; clamp to whole percent. */
export function clampContrast(value: unknown, variant: Variant): number {
  const fallback = CONTRAST_DEFAULTS[variant];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * Piecewise remap around the default, matching the reference: below the default the slider
 * moves softly, above it at double the slope, so the range is usable without blowing out.
 */
export function effectiveContrast(contrast: number, variant: Variant): number {
  const base = CONTRAST_DEFAULTS[variant];
  const ratio = contrast / 100 + ((contrast - base) / 60) * 0.7;
  return contrast <= base ? ratio : base / 100 + (ratio - base / 100) * 2;
}

/** Alpha for an ink tier whose reference formula is `base + slope * contrast`. */
export function inkAlpha(base: number, slope: number, contrast: number): number {
  return roundAlpha(base + slope * contrast);
}

/** Linear mix of two `r,g,b` triplets, the form the control-surface fill uses. */
export function mixRgb(from: string, to: string, amount: number): string {
  const a = from.split(',').map(Number);
  const b = to.split(',').map(Number);
  const t = Math.min(1, Math.max(0, amount));
  return a.map((channel, index) => Math.round(channel + ((b[index] ?? channel) - channel) * t)).join(',');
}

function roundAlpha(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}

/** The contrast value the theme injector should apply for the active variant. */
export function activeContrast(appearance: AppSettings['appearance'], isDark: boolean): number {
  const variant: Variant = isDark ? 'dark' : 'light';
  return clampContrast(appearance.contrast?.[variant], variant);
}
