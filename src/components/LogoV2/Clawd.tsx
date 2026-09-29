// @ts-nocheck
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { env } from '../../utils/env.js';

// Clawd pose model, aligned with upstream Claude Code 2.1.285: a pose is
// parameterized as {eyes, arms, feet} instead of a flat per-pose glyph table.
//   eyes: open | left | right | closed (4-segment blink) | wink (3-segment)
//   arms: down | up | one-up (noa-only: left down, right up — kept from the
//         noa-exclusive wave poses, which upstream still lacks)
//   feet: both | left | right (one foot lifted)
// Closed/wink eyes are drawn as "lid" spans: the lid glyph is painted in
// clawd_body as the character with a clawd_background background, so it reads
// as the body color cutting into the white of the eye.
// A pose may also be a facing sprite ({facing}) for the 360° turn — 15 hand-
// drawn stages (right-12 … back … left-12) with per-row {glyphs, from, to}
// background spans.

type Eyes = 'open' | 'left' | 'right' | 'closed' | 'wink';
type Arms = 'down' | 'up' | 'one-up';
type Feet = 'both' | 'left' | 'right';

export type ClawdPoseSpec = {
  eyes: Eyes;
  arms: Arms;
  feet: Feet;
};

export type ClawdFacing = {
  facing: string;
};

// Pose accepted by <Clawd />: an upstream/named pose, a spec object, or a
// facing sprite. The legacy noa names (default / arms-up / look-left /
// look-right / wave-left / wave-right) map onto specs; wave-left/wave-right
// remain noa-only single-arm-up poses.
export type ClawdPose = ClawdPoseSpec | ClawdFacing;

type Props = {
  pose?: ClawdPose;
  /** Per-cell body color override (wand ripple); omit for the flat clawd_body. */
  paint?: Paint;
};

const NAMED_POSES: Record<string, ClawdPoseSpec> = {
  default: { eyes: 'open', arms: 'down', feet: 'both' },
  'arms-up': { eyes: 'open', arms: 'up', feet: 'both' },
  'look-left': { eyes: 'left', arms: 'down', feet: 'both' },
  'look-right': { eyes: 'right', arms: 'down', feet: 'both' },
  // noa-only single-arm poses (upstream has no wave; its one-up arm state is
  // used only for the ultra-effort wand, which this fork does not port).
  'wave-left': { eyes: 'open', arms: 'up', feet: 'both' },
  'wave-right': { eyes: 'open', arms: 'one-up', feet: 'both' },
};

// Row-1/row-2 arm + body-curve segments, keyed by arm state.
const ARMS: Record<Arms, { r1L: string; r1R: string; r2L: string; r2R: string }> = {
  down: { r1L: ' ▐', r1R: '', r2L: '▝▜', r2R: '█▀' },
  up: { r1L: '▗▟', r1R: '▄', r2L: ' ▜', r2R: '█▘' },
  'one-up': { r1L: ' ▐', r1R: '▄', r2L: '▝▜', r2R: '█▘' },
};

// Multi-segment eye rows. Upstream stacks these as consecutive spans starting
// at column 2 (after the 2-char r1L); segment lengths must sum to 6.
const EYES: Record<Eyes, { glyphs: string; lid?: boolean }[]> = {
  open: [{ glyphs: '▛███▛█' }],
  left: [{ glyphs: '▟███▟█' }],
  right: [{ glyphs: '█▟███▟' }],
  closed: [{ glyphs: '▂', lid: true }, { glyphs: '███' }, { glyphs: '▂', lid: true }, { glyphs: '█' }],
  wink: [{ glyphs: '▛███' }, { glyphs: '▂', lid: true }, { glyphs: '█' }],
};

const FEET: Record<Feet, string> = {
  both: ' ▝▝   ▝▝ ',
  left: ' ▝▝      ',
  right: '      ▝▝ ',
};

// Apple Terminal uses a bg-fill trick (see below), so only eye poses make
// sense. Arm/feet variation and facing sprites fall back to the eye field.
const APPLE_EYES: Record<Eyes, string> = {
  open: ' ▗   ▖ ',
  left: ' ▘   ▘ ',
  right: ' ▝   ▝ ',
  closed: ' ▂   ▂ ',
  wink: ' ▗   ▂ ',
};

function isFacing(pose: ClawdPose): pose is ClawdFacing {
  return typeof pose === 'object' && pose !== null && 'facing' in pose;
}

export function normalizePose(pose: ClawdPose): ClawdPose {
  return typeof pose === 'string' ? NAMED_POSES[pose] : pose;
}

function isAppleTerminal(): boolean {
  return env.terminal === 'Apple_Terminal';
}

// One row of a facing sprite: glyphs outside [from,to) take `color`; inside,
// clawd_background is set behind the glyph (the eye white), matching upstream.
function FacingRow({ glyphs, from, to, color }: { glyphs: string; from: number; to: number; color: string }) {
  return (
    <Text color={color}>
      {glyphs.slice(0, from)}
      <Text backgroundColor="clawd_background">{glyphs.slice(from, to)}</Text>
      {glyphs.slice(to)}
    </Text>
  );
}

const FACING_SPRITES: Record<string, { glyphs: string; from: number; to: number }[]> = {
  'right-12': [
    { glyphs: ' ▐█▜██▛█ ', from: 2, to: 8 },
    { glyphs: '▝▜██████▀', from: 2, to: 7 },
    { glyphs: ' ▝▝   ▝▝ ', from: 0, to: 0 },
  ],
  'right-30': [
    { glyphs: '  █▛██▛▌ ', from: 2, to: 7 },
    { glyphs: ' ▝█████▛ ', from: 2, to: 7 },
    { glyphs: '  ▘▘  ▘▘ ', from: 0, to: 0 },
  ],
  'right-55': [
    { glyphs: '  ▐█▛█▜  ', from: 3, to: 7 },
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▝▝ ▝▝  ', from: 0, to: 0 },
  ],
  'right-75': [
    { glyphs: '   ██▛▌  ', from: 3, to: 6 },
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ▘  ▘  ', from: 0, to: 0 },
  ],
  edge: [
    { glyphs: '   ▐██   ', from: 4, to: 6 },
    { glyphs: '   ▐██   ', from: 4, to: 6 },
    { glyphs: '   ▝ ▝   ', from: 0, to: 0 },
  ],
  'back-105': [
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ▘  ▘  ', from: 0, to: 0 },
  ],
  'back-125': [
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▝▝ ▝▝  ', from: 0, to: 0 },
  ],
  'back-150': [
    { glyphs: '  █████▌ ', from: 2, to: 7 },
    { glyphs: ' ▝█████▛ ', from: 2, to: 7 },
    { glyphs: '  ▘▘  ▘▘ ', from: 0, to: 0 },
  ],
  back: [
    { glyphs: ' ▐██████ ', from: 2, to: 8 },
    { glyphs: '▝▜██████▀', from: 2, to: 7 },
    { glyphs: ' ▝▝   ▝▝ ', from: 0, to: 0 },
  ],
  'left-75': [
    { glyphs: '   ▛██▌  ', from: 3, to: 6 },
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ▘  ▘  ', from: 0, to: 0 },
  ],
  'left-55': [
    { glyphs: '  ▐▜▛██  ', from: 3, to: 7 },
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▝▝ ▝▝  ', from: 0, to: 0 },
  ],
  'left-30': [
    { glyphs: '  ▛██▛█▌ ', from: 2, to: 7 },
    { glyphs: ' ▝█████▛ ', from: 2, to: 7 },
    { glyphs: '  ▘▘  ▘▘ ', from: 0, to: 0 },
  ],
  'left-12': [
    { glyphs: ' ▐▛███▜█ ', from: 2, to: 8 },
    { glyphs: '▝▜██████▀', from: 2, to: 7 },
    { glyphs: ' ▝▝   ▝▝ ', from: 0, to: 0 },
  ],
};

function FacingClawd({ facing, color }: { facing: string; color: string }) {
  const rows = FACING_SPRITES[facing] ?? FACING_SPRITES['right-12'];
  return (
    <Box flexDirection="column" flexShrink={0}>
      {rows.map((row, i) => (
        <FacingRow key={i} glyphs={row.glyphs} from={row.from} to={row.to} color={color} />
      ))}
    </Box>
  );
}

function AppleTerminalClawd({ spec, color }: { spec: ClawdPoseSpec; color: string }) {
  const eyes = APPLE_EYES[spec.eyes];
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        <Text color={color}>▗</Text>
        <Text color="clawd_background" backgroundColor={color}>{eyes}</Text>
        <Text color={color}>▖</Text>
      </Text>
      <Text backgroundColor={color}>{' '.repeat(7)}</Text>
      <Text color={color}>▘▘   ▝▝</Text>
    </Box>
  );
}

/** Per-cell body color (column, row) → css color; used by the wand ripple. */
export type Paint = (column: number, row: number) => string;

// Paints one glyph row. Spaces continue the previous segment's color (mirrors
// upstream's run-length grouping); non-lid spans carry the clawd_background
// behind the glyph (the eye white), lid spans invert fg/bg so the body color
// reads as an eyelid over the eye.
function GlyphRow({ glyphs, color, on, column = 0, row = 0, paint }: { glyphs: string; color: string; on?: 'lid' | 'eyes'; column?: number; row?: number; paint?: Paint }) {
  const segments: { text: string; color: string }[] = [];
  Array.from(glyphs).forEach((ch, i) => {
    const c = ch === ' ' && segments.length > 0 ? segments[segments.length - 1].color : paint ? paint(column + i, row) : color;
    const last = segments[segments.length - 1];
    if (last && last.color === c) last.text += ch;
    else segments.push({ text: ch, color: c });
  });
  return (
    <Text>
      {segments.map((seg, i) =>
        on === 'lid' ? (
          <Text key={i} color="clawd_background" backgroundColor={seg.color}>{seg.text}</Text>
        ) : (
          <Text key={i} color={seg.color} backgroundColor={on === 'eyes' ? 'clawd_background' : undefined}>{seg.text}</Text>
        ),
      )}
    </Text>
  );
}

export function Clawd({ pose, paint }: Props = {}) {
  const p = normalizePose(pose ?? 'default');
  if (isFacing(p)) {
    return isAppleTerminal()
      ? <AppleTerminalClawd spec={NAMED_POSES.default} color="clawd_body" />
      : <FacingClawd facing={p.facing} color="clawd_body" />;
  }
  if (isAppleTerminal()) {
    return <AppleTerminalClawd spec={p} color="clawd_body" />;
  }
  const arms = ARMS[p.arms];
  // Eye segments stack from column 2; columns must line up with r1L (2 chars).
  let column = 2;
  const eyeSpans = EYES[p.eyes].map((span) => {
    const at = column;
    column += span.glyphs.length;
    return { ...span, column: at };
  });
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text>
        <GlyphRow glyphs={arms.r1L} color="clawd_body" column={0} row={0} paint={paint} />
        {eyeSpans.map((span, i) => (
          <GlyphRow key={i} glyphs={span.glyphs} color="clawd_body" on={span.lid ? 'lid' : 'eyes'} column={span.column} row={0} paint={paint} />
        ))}
        <GlyphRow glyphs={arms.r1R} color="clawd_body" column={8} row={0} paint={paint} />
      </Text>
      <Text>
        <GlyphRow glyphs={arms.r2L} color="clawd_body" column={0} row={1} paint={paint} />
        <GlyphRow glyphs="█████" color="clawd_body" on="eyes" column={2} row={1} paint={paint} />
        <GlyphRow glyphs={arms.r2R} color="clawd_body" column={7} row={1} paint={paint} />
      </Text>
      <GlyphRow glyphs={FEET[p.feet]} color="clawd_body" column={0} row={2} paint={paint} />
    </Box>
  );
}

// Test-only raw tables so frame/glyph dumps can run without booting config.
export const NAMED_POSES_FOR_TEST = NAMED_POSES;
export const ARMS_FOR_TEST = ARMS;
export const EYES_FOR_TEST = EYES;
export const FEET_FOR_TEST = FEET;
export const FACING_SPRITES_FOR_TEST = FACING_SPRITES;
