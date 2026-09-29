// @ts-nocheck
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { getDisplayedEffortLevel } from '../../utils/effort.js';
import { useResolvedTheme, useTheme } from '../design-system/ThemeProvider.js';
import type { Paint } from './Clawd.js';

// Clawd's wand: a ╱ shaft and a ✦ tip drawn in the two columns right of the
// raised arm, with a flame that flares, cools, flickers and ramps back on a
// 24-step loop (128ms per step, same cadence as upstream's ultra-effort wand).
// noa has no ultracode mode, so it lights up at high effort instead: the
// wand shows for xhigh/max, with no fullscreen / truecolor / animation-clock
// preconditions. Reduced motion just freezes the resting colors.

export const WAND_COLUMNS = 2;
const STEP_MS = 128;
const LOOP_STEPS = 24;
const FLARE_STEPS = 2;
const COOL_STEPS = 3;
const RAMP_STEPS = 4;
const LOOP_MS = LOOP_STEPS * STEP_MS;

// Ripple: a ring radiates from the wand tip (column 10, row 0; rows are half as
// wide as columns, hence the 2x) and lightens the body toward white as it passes.
const TIP = { column: 10, row: 0 };
const RING_SPEED = 7; // cells per second
const RING_TRAIL = 3.5; // the softer echo sits this far behind the front
const RING_ECHO = 0.4;
const FALL_AHEAD = 0.9;
const FALL_BEHIND = 1.8;

type RGB = { r: number; g: number; b: number };
const DARK = {
  wood: { r: 208, g: 162, b: 100 }, woodLit: { r: 255, g: 240, b: 184 }, ember: { r: 240, g: 128, b: 72 },
  gold: { r: 255, g: 204, b: 104 }, bright: { r: 255, g: 236, b: 160 }, flare: { r: 255, g: 252, b: 235 },
};
const LIGHT = {
  wood: { r: 150, g: 104, b: 48 }, woodLit: { r: 196, g: 120, b: 24 }, ember: { r: 232, g: 150, b: 40 },
  gold: { r: 240, g: 118, b: 24 }, bright: { r: 238, g: 84, b: 16 }, flare: { r: 224, g: 40, b: 8 },
};

const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
});
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const css = (c: RGB) => `rgb(${c.r},${c.g},${c.b})`;

function wandColors(step: number, p: typeof DARK) {
  if (step < FLARE_STEPS) return { wand: p.woodLit, flame: p.flare, flaring: true };
  if (step < FLARE_STEPS + COOL_STEPS) {
    const t = (step - FLARE_STEPS + 1) / COOL_STEPS;
    return { wand: mix(p.woodLit, p.wood, t), flame: mix(p.bright, p.gold, t), flaring: false };
  }
  if (step >= LOOP_STEPS - RAMP_STEPS) {
    const t = (step - (LOOP_STEPS - RAMP_STEPS) + 1) / RAMP_STEPS;
    return { wand: mix(p.wood, p.woodLit, t / 2), flame: mix(p.gold, p.bright, t), flaring: false };
  }
  // Deterministic per-step flicker between ember and gold.
  const k = Math.round((Math.abs(Math.sin(step * 12.9898) * 43758.5453) % 1) * 8) / 8;
  return { wand: p.wood, flame: mix(p.ember, p.gold, k), flaring: false };
}

const falloff = (x: number) => Math.exp(x >= 0 ? -x / FALL_BEHIND : x / FALL_AHEAD);

/** Per-cell body paint for the ripple at clock time `ms`; null when the theme
 * color isn't truecolor (ansi themes can't be blended). */
export function wandRipplePaint(base: RGB | null, ms: number, light: boolean): Paint | null {
  if (!base) return null;
  const crest = mix(base, WHITE, light ? 0.7 : 0.8);
  const front = ((ms % LOOP_MS) / 1000) * RING_SPEED;
  return (column, row) => {
    const d = Math.hypot(column - TIP.column, 2 * (row - TIP.row));
    const k = Math.max(falloff(front - d), RING_ECHO * falloff(front - RING_TRAIL - d));
    return css(mix(base, crest, Math.round(k * 8) / 8));
  };
}

export function parseRgb(color: string | undefined): RGB | null {
  const m = color?.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

/** Shared animation clock (ms) for the wand flame and the body ripple. */
export function useWandClock(active: boolean, animate: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active || !animate) return;
    const start = Date.now();
    const id = setInterval(() => setMs(Date.now() - start), STEP_MS);
    return () => clearInterval(id);
  }, [active, animate]);
  return ms;
}

/** Ripple paint for the current theme + clock, or undefined when unavailable. */
export function useWandPaint(active: boolean, ms: number): Paint | undefined {
  const theme = useResolvedTheme();
  const [name] = useTheme();
  if (!active) return undefined;
  const light = ['light', 'light-daltonized', 'light-ansi'].includes(name);
  return wandRipplePaint(parseRgb(theme.clawd_body), ms, light) ?? undefined;
}

/** True when the wand should be shown: high (xhigh/max) effort on the main model. */
export function useWandActive(): boolean {
  const model = useMainLoopModel();
  const effortValue = useAppState((s) => s.effortValue);
  try {
    const level = getDisplayedEffortLevel(model, effortValue);
    return level === 'xhigh' || level === 'max';
  } catch {
    return false;
  }
}

export function ClawdWand({ ms, animate }: { ms: number; animate: boolean }) {
  const [theme] = useTheme();
  const palette = ['light', 'light-daltonized', 'light-ansi'].includes(theme) ? LIGHT : DARK;
  const step = Math.floor(ms / STEP_MS) % LOOP_STEPS;
  const c = animate ? wandColors(step, palette) : { wand: palette.wood, flame: palette.gold, flaring: false };
  return (
    <Text>
      <Text color={css(c.wand)} bold>╱</Text>
      <Text color={css(c.flame)} bold={c.flaring}>✦</Text>
    </Text>
  );
}
