// @ts-nocheck
// Pure-text snapshot of the Clawd glyph model: prints the exact character
// grid each pose renders, without going through Ink/Theme (config guard).
// Mirrors Clawd.tsx row construction so it can be diffed against upstream.
// Usage: bun scripts/render-clawd-poses.ts
import {
  NAMED_POSES_FOR_TEST,
  ARMS_FOR_TEST,
  EYES_FOR_TEST,
  FEET_FOR_TEST,
  FACING_SPRITES_FOR_TEST,
} from '../src/components/LogoV2/Clawd.js';

function specRows(pose: any): string[] {
  const spec = typeof pose === 'string' ? NAMED_POSES_FOR_TEST[pose] : pose;
  const arms = ARMS_FOR_TEST[spec.arms];
  // Eye spans: lid glyphs lowercased so they show in the dump.
  let eye = '';
  for (const span of EYES_FOR_TEST[spec.eyes]) {
    eye += span.lid ? span.glyphs.toLowerCase() : span.glyphs;
  }
  const r1 = arms.r1L + eye + arms.r1R;
  const r2 = arms.r2L + '█████' + arms.r2R;
  return [r1, r2, FEET_FOR_TEST[spec.feet]];
}

function facingRows(f: string): string[] {
  const rows = FACING_SPRITES_FOR_TEST[f] ?? FACING_SPRITES_FOR_TEST['right-12'];
  return rows.map((r) => r.glyphs);
}

const poses: [string, any][] = [
  ['default', 'default'],
  ['arms-up', 'arms-up'],
  ['wave-left', 'wave-left'],
  ['wave-right', 'wave-right'],
  ['wink', { eyes: 'wink', arms: 'down', feet: 'both' }],
  ['closed', { eyes: 'closed', arms: 'down', feet: 'both' }],
  ['closed+arms-up', { eyes: 'closed', arms: 'up', feet: 'both' }],
  ['feet-left', { eyes: 'open', arms: 'down', feet: 'left' }],
  ['feet-right', { eyes: 'open', arms: 'down', feet: 'right' }],
  ['facing right-12', { facing: 'right-12' }],
  ['facing right-30', { facing: 'right-30' }],
  ['facing right-55', { facing: 'right-55' }],
  ['facing right-75', { facing: 'right-75' }],
  ['facing edge', { facing: 'edge' }],
  ['facing back-105', { facing: 'back-105' }],
  ['facing back-125', { facing: 'back-125' }],
  ['facing back-150', { facing: 'back-150' }],
  ['facing back', { facing: 'back' }],
  ['facing left-75', { facing: 'left-75' }],
  ['facing left-55', { facing: 'left-55' }],
  ['facing left-30', { facing: 'left-30' }],
  ['facing left-12', { facing: 'left-12' }],
];

for (const [label, pose] of poses) {
  const rows = typeof pose === 'object' && 'facing' in pose ? facingRows(pose.facing) : specRows(pose);
  console.log(`--- ${label} ---`);
  for (const r of rows) console.log(r);
}
