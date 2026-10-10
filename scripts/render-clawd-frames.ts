// @ts-nocheck
// Renders every Clawd animation frame-by-frame to stdout for visual
// verification against upstream frame tables.
// Usage: bun scripts/render-clawd-frames.ts [animation ...]
import { ANIMATIONS } from '../src/components/LogoV2/AnimatedClawd.js';

function frameToText(frame) {
  const { pose, offset, x = 0, poof, shadow } = frame;
  let art;
  if (typeof pose === 'object' && 'facing' in pose) {
    art = ['(facing ' + pose.facing + ')'];
  } else {
    art = ['(pose ' + JSON.stringify(pose) + ')'];
  }
  return { offset, x, poof, shadow, art };
}

const names = process.argv.slice(2);
const list = names.length > 0 ? names : Object.keys(ANIMATIONS);
for (const name of list) {
  const frames = ANIMATIONS[name as keyof typeof ANIMATIONS];
  console.log(`\n=== ${name} (${frames.length} frames) ===`);
  frames.forEach((f, i) => {
    const t = frameToText(f);
    const parts = [`#${i}`, `off=${f.offset}`, `x=${f.x ?? 0}`];
    if (f.poof) parts.push(`poof=${f.poof}`);
    if (f.shadow) parts.push(`shadow=${f.shadow}`);
    console.log(parts.join(' ') + '  ' + t.art[0]);
  });
}
