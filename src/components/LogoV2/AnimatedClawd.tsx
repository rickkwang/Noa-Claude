// @ts-nocheck
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Text } from '../../ink.js';
import { env } from '../../utils/env.js';
import { isBgSession } from '../../utils/background/bgJob.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { Clawd, type ClawdPose } from './Clawd.js';

type PoofKind = 'dot' | 'wave';
type ShadowKind = 'wide' | 'narrow';
type Frame = {
  pose: ClawdPose;
  /** marginTop in the fixed-height container: 0 = normal, 1 = crouched, 2 = deep
   * crouch (peekaboo), negative = above the frame (drop). */
  offset: number;
  /** marginLeft for horizontal movement (negative slides in from the left). */
  x?: number;
  /** little particle puffed out either side while crouched. */
  poof?: PoofKind;
  /** landing shadow drawn on the feet row (coin-hop). */
  shadow?: ShadowKind;
};

/** Names callers can pass via the `sequence` prop to play a specific animation. */
export type ClawdAnimation = 'jump' | 'look' | 'wave' | 'celebrate' | 'skip' | 'spin'
  | 'peekaboo' | 'drop' | 'waddle' | 'peek' | 'wink' | 'boop' | 'tap' | 'sneeze' | 'turn' | 'coin-hop';

/** Hold a pose for n frames (60ms each). */
function hold(pose: ClawdPose, offset: number, frames: number, x?: number): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset, x }));
}

function holdOpts(pose: ClawdPose, frames: number, opts: { offset?: number; x?: number; poof?: PoofKind; shadow?: ShadowKind } = {}): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset: opts.offset ?? 0, x: opts.x, poof: opts.poof, shadow: opts.shadow }));
}

// Offset semantics: marginTop in a fixed-height container. 0 = normal,
// 1 = crouched (feet row clipped below the frame), 2 = deep crouch (body dips
// too), negative = above the frame (drop entrance). Container height stays
// 3 (or 4 while a deep crouch is on screen) so the layout never shifts; during
// a crouch a `poof` particle is rendered on either side (see render).

// Particle characters puffed to the sides on crouch (offset>0) frames.
const POOF: Record<PoofKind, string> = { dot: '·', wave: '~' };

// Landing shadows for coin-hop: ▁▁▁ wide, ▁ narrow, placed on the feet row.
const SHADOW: Record<ShadowKind, { glyphs: string; left: number }> = {
  wide: { glyphs: '▁▁▁', left: 3 },
  narrow: { glyphs: '▁', left: 4 },
};

// Crouch-and-puff: two frames ducked below the frame, first a dot then a wave.
function crouchPoof(x?: number): Frame[] {
  return [
    { pose: 'default', offset: 1, x, poof: 'dot' },
    { pose: 'default', offset: 1, x, poof: 'wave' },
  ];
}

// The "blink" rest pose some sequences end on: eyes closed for a frame.
const BLINK_REST: Frame = { pose: { eyes: 'closed', arms: 'down', feet: 'both' }, offset: 0 };
const REST: Frame = { pose: 'default', offset: 0 };

// Spec helpers for the parameterized poses (upstream 2.1.285).
const spec = (eyes, arms = 'down', feet = 'both') => ({ eyes, arms, feet });
const facing = (f) => ({ facing: f });
const facingRun = (stages, shadowKind?) =>
  stages.flatMap((f) => holdOpts(facing(f), 1, { shadow: shadowKind }));

// Crouch (puffing), then spring up with both arms raised. Twice.
const JUMP: readonly Frame[] = [
  ...crouchPoof(), ...hold('arms-up', 0, 3), ...hold('default', 0, 1),
  ...crouchPoof(), ...hold('arms-up', 0, 3), ...hold('default', 0, 1),
];

// Glance right, then left, then back.
const LOOK: readonly Frame[] = [
  ...hold('look-right', 0, 5), ...hold('look-left', 0, 5), ...hold('default', 0, 1),
];

// Wave left and right (noa-only; upstream has no wave). wave-left maps to the
// arms-up state, wave-right to one-up (right arm up) — the noa-exclusive arm
// poses upstream lacks.
const WAVE: readonly Frame[] = [
  ...hold('wave-left', 0, 2), ...hold('default', 0, 2),
  ...hold('wave-right', 0, 2), ...hold('default', 0, 2),
  ...hold('wave-left', 0, 2), ...hold('default', 0, 1),
];

// Jump, then linger in the crouch — a little bow / celebration.
const CELEBRATE: readonly Frame[] = [...JUMP, ...hold('default', 1, 3)];

// Wiggle the eyes side to side, then throw the arms up.
const SPIN: readonly Frame[] = [
  ...hold('look-left', 0, 2), ...hold('look-right', 0, 2),
  ...hold('look-left', 0, 2), ...hold('arms-up', 0, 3), ...hold('default', 0, 1),
];

// Hop in from off-screen left, sliding x from -CLAWD_WIDTH toward 0.
const SKIP: readonly Frame[] = [
  ...hold('default', 1, 1, -9),
  ...hold('arms-up', 0, 2, -6), ...hold('default', 0, 1, -6), ...hold('default', 1, 1, -6),
  ...hold('arms-up', 0, 2, -3), ...hold('default', 0, 1, -3), ...hold('default', 1, 1, -3),
  ...hold('arms-up', 0, 2, 0), ...crouchPoof(0), ...hold('default', 0, 1, 0),
];

// ---- New in upstream Claude Code 2.1.285, ported frame-for-frame. ----

// Duck down deep, glance around, spring up with arms raised, blink.
const PEEKABOO: readonly Frame[] = [
  ...hold('default', 1, 1),
  ...hold('default', 2, 3),
  ...hold('look-right', 2, 3),
  ...hold('look-left', 2, 3),
  ...hold('default', 2, 2),
  ...hold('default', 1, 1),
  ...hold('arms-up', 0, 4),
  ...hold('default', 0, 2),
  BLINK_REST,
];

// Drop in from above the frame, crouch-poof, blink.
const DROP: readonly Frame[] = [
  ...hold('arms-up', -3, 1),
  ...hold('arms-up', -2, 2),
  ...hold('arms-up', -1, 2),
  ...hold('arms-up', 0, 1),
  ...crouchPoof(),
  ...hold('default', 0, 3),
  BLINK_REST,
];

// Waddle in from the left, alternating lifted feet.
const WADDLE: readonly Frame[] = [
  ...hold('look-right', 0, 1, -9),
  ...[-6, -5, -4, -3, -2, -1].flatMap((x) =>
    holdOpts(spec('right', 'down', x % 2 === 0 ? 'left' : 'right'), 2, { x })),
  ...hold('look-right', 0, 2),
  ...hold('default', 0, 2),
  BLINK_REST,
];

// Slide in from the left while peeking right, throw arms up, poof.
const PEEK: readonly Frame[] = [
  ...hold('look-right', 0, 1, -9),
  ...hold('look-right', 0, 5, -6),
  ...hold('look-right', 0, 3, -9),
  ...hold('look-right', 0, 4, -5),
  ...hold('arms-up', 0, 2, -3),
  ...hold('arms-up', 0, 2),
  ...crouchPoof(),
  REST,
];

// Hold a wink, then blink.
const WINK: readonly Frame[] = [
  ...holdOpts(spec('wink'), 5),
  BLINK_REST,
];

// Startle: eyes closed, duck down puffing, glance left, blink.
const BOOP: readonly Frame[] = [
  ...holdOpts(spec('closed'), 1, { offset: 1, poof: 'dot' }),
  ...holdOpts(spec('closed'), 2, { offset: 1, poof: 'wave' }),
  ...hold('look-left', 0, 4),
  ...hold('default', 0, 2),
  BLINK_REST,
];

// Alternating toe taps, then throw arms up.
const TAP: readonly Frame[] = [
  ...holdOpts(spec('open', 'down', 'left'), 2),
  ...holdOpts(spec('open', 'down', 'right'), 2),
  ...holdOpts(spec('open', 'down', 'left'), 2),
  ...holdOpts(spec('open', 'down', 'right'), 2),
  ...holdOpts(spec('open', 'down', 'left'), 1),
  ...holdOpts(spec('open', 'down', 'right'), 1),
  ...hold('arms-up', 0, 3),
  REST,
];

// Sneeze: arms up eyes closed, duck down and puff, blink.
const SNEEZE: readonly Frame[] = [
  ...holdOpts(spec('closed', 'up'), 4),
  ...holdOpts(spec('closed'), 2, { offset: 1, poof: 'wave' }),
  ...holdOpts(spec('closed'), 2),
  ...hold('default', 0, 2),
  BLINK_REST,
];

// 360° turn through 15 hand-drawn facing sprites.
const TURN: readonly Frame[] = [
  ...facingRun(['right-12', 'right-30', 'right-55', 'right-75', 'edge']),
  ...facingRun(['back-105', 'back-125', 'back-150', 'back', 'back']),
  ...facingRun(['back-150', 'back-125', 'back-105', 'edge']),
  ...facingRun(['left-75', 'left-55', 'left-30', 'left-12']),
  REST,
];

// Mario-style coin hop: crouch, spring up with a wide shadow, spin the facing
// sprites with a narrow shadow while airborne, land with a poof.
const COIN_HOP: readonly Frame[] = [
  ...hold('default', 1, 2),
  ...holdOpts('arms-up', 1, { shadow: 'wide' }),
  ...facingRun(['right-55', 'edge', 'back-125', 'back'], 'narrow'),
  ...facingRun(['back-125', 'edge', 'left-55'], 'narrow'),
  ...holdOpts('arms-up', 1, { shadow: 'wide' }),
  ...crouchPoof(),
  REST,
];

// Looping idle used by autoplay: stand still, then glance around.
const IDLE_LOOP: readonly Frame[] = [
  ...hold('default', 0, 12), ...hold('look-right', 0, 5), ...hold('look-left', 0, 5),
];

export const ANIMATIONS: Record<ClawdAnimation, readonly Frame[]> = {
  jump: JUMP, look: LOOK, wave: WAVE, celebrate: CELEBRATE, skip: SKIP, spin: SPIN,
  peekaboo: PEEKABOO, drop: DROP, waddle: WADDLE, peek: PEEK, wink: WINK,
  boop: BOOP, tap: TAP, sneeze: SNEEZE, turn: TURN, 'coin-hop': COIN_HOP,
};

// All entrances upstream can draw at random (the full animation list).
const ALL_ENTRANCES: readonly ClawdAnimation[] = [
  'skip', 'jump', 'look', 'spin', 'peekaboo', 'drop', 'waddle', 'peek', 'wink',
  'boop', 'tap', 'sneeze', 'turn', 'coin-hop',
];

// Click pool: the shared animations plus noa's WAVE. Apple Terminal falls back
// to eye-only animations (raised arms and facing sprites can't render there).
const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP, LOOK, WAVE, PEEKABOO, BOOP, TAP, SNEEZE, TURN, COIN_HOP];
const APPLE_TERMINAL_CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP, LOOK, WAVE, PEEKABOO, BOOP, TAP, SNEEZE];

const FRAME_MS = 60;
const CLAWD_WIDTH = 9;
const incrementFrame = (i: number) => i + 1;
// Forced sequences that have already been shown in this process.
const playedSequences = new Set<ClawdAnimation>();
// Whether this process has already served an entrance (the entrance also
// replays once per version bump — see getClawdEntranceSequence).
let clawdEntranceTaken = false;

function isAppleTerminal(): boolean {
  return env.terminal === 'Apple_Terminal';
}

function hasFacing(frames: readonly Frame[]): boolean {
  return frames.some((f) => typeof f.pose === 'object' && 'facing' in f.pose);
}

function isEyesOpenPose(pose: ClawdPose): boolean {
  if (typeof pose === 'string') return true; // all named poses have open eyes
  return 'eyes' in pose && pose.eyes === 'open';
}

// Upstream's $s/Kl filter. For clicks (Kl): drop sequences whose first frame
// starts off-screen (x !== 0) or with eyes closed/offset — those read as
// glitches out of context. On Apple Terminal the pool is further restricted
// to plain named poses that render in the bg-fill eye field. For entrances
// ($s with the full list): facing sprites are dropped everywhere (they only
// render on non-Apple terminals).
function filterForClick(names: readonly ClawdAnimation[]): ClawdAnimation[] {
  return names.filter((name) => {
    const first = ANIMATIONS[name][0];
    if (first === undefined) return false;
    if (isAppleTerminal()) {
      return typeof first.pose === 'string' && first.offset === 0 && (first.x ?? 0) === 0;
    }
    if (!isEyesOpenPose(first.pose) || first.offset !== 0 || (first.x ?? 0) !== 0) return false;
    return true;
  });
}

function filterForEntrance(names: readonly ClawdAnimation[]): ClawdAnimation[] {
  return names.filter((name) => {
    if (isAppleTerminal()) {
      const first = ANIMATIONS[name][0];
      // Apple Terminal: only sequences of plain named poses with open eyes.
      return (
        first !== undefined &&
        typeof first.pose === 'string' &&
        ANIMATIONS[name].every((f) => typeof f.pose === 'string') &&
        ANIMATIONS[name].every((f) => isEyesOpenPose(f.pose))
      );
    }
    return true;
  });
}

/**
 * The entrance animation to play at startup, if any. Upstream replays the
 * entrance when the installed version is newer than the last one that played
 * (lastClawdEntranceVersion in global config); noa keeps the same gate on top
 * of its per-process-once rule. A background session skips it entirely: its
 * frames would land in the PTY host's replay buffer and replay on every
 * attach.
 */
export function getClawdEntranceSequence(): ClawdAnimation | undefined {
  if (clawdEntranceTaken || isBgSession()) return undefined;
  const cfg = getGlobalConfig();
  const last = cfg.lastClawdEntranceVersion;
  const versionBumped = last === undefined || MACRO.VERSION !== last;
  if (!versionBumped) return undefined;
  clawdEntranceTaken = true;
  const pool = filterForEntrance(ALL_ENTRANCES);
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? 'jump';
  // Persist even if the render is skipped downstream (reduced motion / screen
  // toggle): upstream records the impression when the sequence is served.
  saveGlobalConfig((current) => ({ ...current, lastClawdEntranceVersion: MACRO.VERSION }));
  return pick;
}

const IDLE: Frame = { pose: 'default', offset: 0 };

// Pad the front of a forced sequence so it starts after `delayMs`. The lead
// frame reuses the sequence's own first frame when it carries an x offset
// (so it waits off-screen), otherwise it just stands idle.
function padDelay(seq: readonly Frame[], delayMs?: number): readonly Frame[] {
  if (!delayMs || seq.length === 0) return seq;
  const first = seq[0]!;
  const lead = first.x !== undefined && first.x !== 0 ? first : IDLE;
  const count = Math.max(1, Math.round(delayMs / FRAME_MS));
  return [...Array.from({ length: count }, () => lead), ...seq];
}

type Props = {
  /** Loop IDLE_LOOP forever instead of waiting for a click. */
  autoplay?: boolean;
  /** Play a specific animation once per process (ignores clicks while it runs). */
  sequence?: ClawdAnimation;
  /** Delay before a forced `sequence` begins. */
  delayMs?: number;
  /** Fired when a forced `sequence` finishes (or immediately if reduced-motion or already played). */
  onComplete?: () => void;
};

/**
 * Clawd with click-triggered animations plus optional programmatic playback.
 * Container height is fixed (3 rows, 4 while a deep crouch is on screen) and
 * width at CLAWD_WIDTH with overflow hidden — same footprint as a bare
 * `<Clawd />` — so the surrounding layout never shifts. During a crouch the
 * feet row clips below the frame; horizontal movement slides the body and
 * clips at the edges; negative offsets clip above. Click only fires when
 * mouse tracking is enabled (i.e. inside `<AlternateScreen>` / fullscreen);
 * elsewhere this renders and behaves identically to plain `<Clawd />`.
 */
export function AnimatedClawd({ autoplay, sequence, delayMs, onComplete }: Props = {}) {
  const { pose, bounceOffset, x, poof, shadow, onClick } = useClawdAnimation(autoplay, sequence, delayMs, onComplete);
  // Reserve the crouch row while a deep-crouch (offset>1) frame may be on
  // screen so the layout doesn't jump mid-sequence (upstream reserveCrouchRow).
  const reserveCrouchRow = (ANIMATIONS[sequence ?? 'jump'] ?? []).some((f) => f.offset > 1);
  const height = bounceOffset > 1 || reserveCrouchRow ? 4 : 3;
  const marginTop = bounceOffset > 1 ? bounceOffset + 1 : bounceOffset;
  return (
    <Box height={height} width={CLAWD_WIDTH} flexDirection="column" flexShrink={0} overflow="hidden" onClick={onClick}>
      <Box marginTop={marginTop} marginLeft={x} flexShrink={0}>
        <Clawd pose={pose} />
      </Box>
      {poof && bounceOffset > 0 ? (
        <>
          <Box position="absolute" top={height - 1} left={0}><Text color="inactive">{POOF[poof]}</Text></Box>
          <Box position="absolute" top={height - 1} right={0}><Text color="inactive">{POOF[poof]}</Text></Box>
        </>
      ) : null}
      {shadow ? (
        <Box position="absolute" top={height - 1} left={SHADOW[shadow].left}><Text color="inactive">{SHADOW[shadow].glyphs}</Text></Box>
      ) : null}
    </Box>
  );
}

function useClawdAnimation(
  autoplay?: boolean,
  sequence?: ClawdAnimation,
  delayMs?: number,
  onComplete?: () => void,
): { pose: ClawdPose; bounceOffset: number; x: number; poof?: PoofKind; shadow?: ShadowKind; onClick: () => void } {
  // Read once at mount — no useSettings() subscription, since that would
  // re-render on any settings change.
  const [reducedMotion] = useState(() => getInitialSettings().prefersReducedMotion ?? false);
  // A forced `sequence` is an entrance: play it once per process. The logo
  // remounts on screen switches (e.g. Ctrl+O transcript toggle), which would
  // otherwise replay it every time.
  const [alreadyPlayed] = useState(() => sequence !== undefined && playedSequences.has(sequence));
  useEffect(() => {
    if (sequence !== undefined) playedSequences.add(sequence);
  }, [sequence]);
  const skipAnimation = reducedMotion || alreadyPlayed;
  const playImmediately = (autoplay || sequence !== undefined) && !skipAnimation;
  const [frameIndex, setFrameIndex] = useState(playImmediately ? 0 : -1);
  const sequenceRef = useRef<readonly Frame[]>(
    padDelay(sequence ? ANIMATIONS[sequence] : autoplay ? IDLE_LOOP : JUMP, sequence ? delayMs : undefined),
  );
  // A forced `sequence` owns playback and ignores clicks until it finishes.
  const canClickRef = useRef(sequence === undefined || alreadyPlayed);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const onClick = () => {
    if (autoplay || reducedMotion || frameIndex !== -1 || !canClickRef.current) return;
    const names = isAppleTerminal()
      ? filterForClick(['jump', 'look', 'wave', 'peekaboo', 'boop', 'tap', 'sneeze'])
      : filterForClick(['jump', 'look', 'wave', 'peekaboo', 'boop', 'tap', 'sneeze', 'turn', 'coin-hop']);
    const pick = names[Math.floor(Math.random() * names.length)] ?? 'jump';
    sequenceRef.current = ANIMATIONS[pick];
    setFrameIndex(0);
  };

  // Not animating (reduced-motion or already played): resolve any onComplete waiter at once.
  useEffect(() => {
    if (skipAnimation) onCompleteRef.current?.();
  }, [skipAnimation]);

  useEffect(() => {
    if (frameIndex === -1) return;
    if (frameIndex >= sequenceRef.current.length) {
      canClickRef.current = true;
      onCompleteRef.current?.();
      // autoplay loops the idle sequence; everything else returns to rest.
      setFrameIndex(autoplay && sequence === undefined ? 0 : -1);
      return;
    }
    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame);
    return () => clearTimeout(timer);
  }, [frameIndex, autoplay, sequence]);

  const seq = sequenceRef.current;
  const fallback = sequence ? ANIMATIONS[sequence].at(-1)! : IDLE;
  const current = frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : fallback;
  return {
    pose: current.pose,
    bounceOffset: current.offset,
    x: current.x ?? 0,
    poof: current.poof,
    shadow: current.shadow,
    onClick,
  };
}
