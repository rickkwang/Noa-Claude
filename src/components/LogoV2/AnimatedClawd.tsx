// @ts-nocheck
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Text } from '../../ink.js';
import { env } from '../../utils/env.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { Clawd, type ClawdPose } from './Clawd.js';

type PoofKind = 'dot' | 'wave';
type Frame = {
  pose: ClawdPose;
  /** marginTop in the fixed-height container: 0 = normal, 1 = crouched. */
  offset: number;
  /** marginLeft for horizontal movement (negative slides in from the left). */
  x?: number;
  /** little particle puffed out either side while crouched. */
  poof?: PoofKind;
};

/** Names callers can pass via the `sequence` prop to play a specific animation. */
export type ClawdAnimation = 'jump' | 'look' | 'wave' | 'celebrate' | 'skip' | 'spin';

/** Hold a pose for n frames (60ms each). */
function hold(pose: ClawdPose, offset: number, frames: number, x?: number): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset, x }));
}

// Offset semantics: marginTop in a fixed-height-3 container. 0 = normal,
// 1 = crouched. Container height stays 3 so the layout never shifts; during
// a crouch (offset=1) Clawd's feet row dips below the container and gets
// clipped — reads as "ducking below the frame" before springing back up.
// During a crouch a `poof` particle is rendered on either side (see render).

// Particle characters puffed to the sides on the crouch (offset=1) frames.
const POOF: Record<PoofKind, string> = { dot: '·', wave: '~' };

// Crouch-and-puff: two frames ducked below the frame, first a dot then a wave.
function crouchPoof(x?: number): Frame[] {
  return [
    { pose: 'default', offset: 1, x, poof: 'dot' },
    { pose: 'default', offset: 1, x, poof: 'wave' },
  ];
}

// Crouch (puffing), then spring up with both arms raised. Twice.
const JUMP: readonly Frame[] = [
  ...crouchPoof(), ...hold('arms-up', 0, 3), ...hold('default', 0, 1),
  ...crouchPoof(), ...hold('arms-up', 0, 3), ...hold('default', 0, 1),
];

// Glance right, then left, then back.
const LOOK: readonly Frame[] = [
  ...hold('look-right', 0, 5), ...hold('look-left', 0, 5), ...hold('default', 0, 1),
];

// Wave left and right (noa-only; arms fall back to default on Apple Terminal).
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

// Looping idle used by autoplay: stand still, then glance around.
const IDLE_LOOP: readonly Frame[] = [
  ...hold('default', 0, 12), ...hold('look-right', 0, 5), ...hold('look-left', 0, 5),
];

const ANIMATIONS: Record<ClawdAnimation, readonly Frame[]> = {
  jump: JUMP, look: LOOK, wave: WAVE, celebrate: CELEBRATE, skip: SKIP, spin: SPIN,
};

// Pool a click randomly draws from. WAVE is noa-only; Apple Terminal can't
// render the raised-arm poses, so it falls back to the eye-only animations.
const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP, LOOK, WAVE];
const APPLE_TERMINAL_CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP, LOOK];

const IDLE: Frame = { pose: 'default', offset: 0 };
const FRAME_MS = 60;
const incrementFrame = (i: number) => i + 1;
const CLAWD_HEIGHT = 3;
const CLAWD_WIDTH = 9;

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
  /** Play a specific animation once (ignores clicks while it runs). */
  sequence?: ClawdAnimation;
  /** Delay before a forced `sequence` begins. */
  delayMs?: number;
  /** Fired when a forced `sequence` finishes (or immediately if reduced-motion). */
  onComplete?: () => void;
};

/**
 * Clawd with click-triggered animations (crouch-jump with arms up, look-around,
 * or wave) plus optional programmatic playback. Container height is fixed at
 * CLAWD_HEIGHT and width at CLAWD_WIDTH with overflow hidden — same footprint as
 * a bare `<Clawd />` — so the surrounding layout never shifts. During a crouch
 * only the feet row clips (see comment above); horizontal movement (SKIP) slides
 * the body and clips at the edges. Click only fires when mouse tracking is
 * enabled (i.e. inside `<AlternateScreen>` / fullscreen); elsewhere this renders
 * and behaves identically to plain `<Clawd />`.
 */
export function AnimatedClawd({ autoplay, sequence, delayMs, onComplete }: Props = {}) {
  const { pose, bounceOffset, x, poof, onClick } = useClawdAnimation(autoplay, sequence, delayMs, onComplete);
  return (
    <Box height={CLAWD_HEIGHT} width={CLAWD_WIDTH} flexDirection="column" flexShrink={0} overflow="hidden" onClick={onClick}>
      <Box marginTop={bounceOffset} marginLeft={x} flexShrink={0}>
        <Clawd pose={pose} />
      </Box>
      {poof && bounceOffset > 0 ? (
        <>
          <Box position="absolute" top={CLAWD_HEIGHT - 1} left={0}><Text color="inactive">{POOF[poof]}</Text></Box>
          <Box position="absolute" top={CLAWD_HEIGHT - 1} right={0}><Text color="inactive">{POOF[poof]}</Text></Box>
        </>
      ) : null}
    </Box>
  );
}

function useClawdAnimation(
  autoplay?: boolean,
  sequence?: ClawdAnimation,
  delayMs?: number,
  onComplete?: () => void,
): { pose: ClawdPose; bounceOffset: number; x: number; poof?: PoofKind; onClick: () => void } {
  // Read once at mount — no useSettings() subscription, since that would
  // re-render on any settings change.
  const [reducedMotion] = useState(() => getInitialSettings().prefersReducedMotion ?? false);
  const playImmediately = (autoplay || sequence !== undefined) && !reducedMotion;
  const [frameIndex, setFrameIndex] = useState(playImmediately ? 0 : -1);
  const sequenceRef = useRef<readonly Frame[]>(
    padDelay(sequence ? ANIMATIONS[sequence] : autoplay ? IDLE_LOOP : JUMP, sequence ? delayMs : undefined),
  );
  // A forced `sequence` owns playback and ignores clicks until it finishes.
  const canClickRef = useRef(sequence === undefined);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const onClick = () => {
    if (autoplay || reducedMotion || frameIndex !== -1 || !canClickRef.current) return;
    const animations = env.terminal === 'Apple_Terminal' ? APPLE_TERMINAL_CLICK_ANIMATIONS : CLICK_ANIMATIONS;
    sequenceRef.current = animations[Math.floor(Math.random() * animations.length)]!;
    setFrameIndex(0);
  };

  // Reduced-motion: never animates, so resolve any onComplete waiter at once.
  useEffect(() => {
    if (reducedMotion) onCompleteRef.current?.();
  }, [reducedMotion]);

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
    onClick,
  };
}
