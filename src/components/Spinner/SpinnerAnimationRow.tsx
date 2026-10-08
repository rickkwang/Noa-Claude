// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useMemo, useRef } from 'react';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text, useAnimationFrame, useResolvedTheme } from '../../ink.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { formatDuration, formatNumber } from '../../utils/format.js';
import { toInkColor } from '../../utils/ink.js';
import type { Theme } from '../../utils/theme.js';
import { Byline } from '../design-system/Byline.js';
import { GlimmerMessage } from './GlimmerMessage.js';
import { SpinnerGlyph } from './SpinnerGlyph.js';
import type { SpinnerMode } from './types.js';
import { useStalledAnimation } from './useStalledAnimation.js';
import { interpolateColor, parseRGB, toRGBColor } from './utils.js';
const SEP_WIDTH = stringWidth(' · ');
const THINKING_BARE_WIDTH = stringWidth('thinking');
const SHOW_TOKENS_AFTER_MS = 30_000;

// Thinking shimmer constants. Previously lived in a separate ThinkingShimmerText
// component with its own useAnimationFrame(50) — inlined here to reuse the
// row's animation clock and eliminate the redundant subscriber.
const THINKING_INACTIVE = {
  r: 153,
  g: 153,
  b: 153
};
const THINKING_INACTIVE_SHIMMER = {
  r: 185,
  g: 185,
  b: 185
};
const THINKING_DELAY_MS = 3000;
const THINKING_GLOW_PERIOD_S = 2;
// Thresholds match upstream CC 2.1.283: 10s still, 20s more,
// 30s some more, 45s deep in thought.
function progressiveThinkingText(thinkingMs: number): string {
  if (thinkingMs >= 45_000) return 'deep in thought';
  if (thinkingMs >= 30_000) return 'thinking some more';
  if (thinkingMs >= 20_000) return 'thinking more';
  if (thinkingMs >= 10_000) return 'still thinking';
  return 'thinking';
}
const TOOL_TIMER_MIN_MS = 2000;

// Tool-call timing window (upstream gn/kn): open when tools start, close when
// they end; cleared once a thinking status appears. With showToolCallTimer,
// shows `running tool for Ns` while open (>=2s) and `ran tool for Ns` after.
type ToolWindow = {
  start: number | null;
  end: number | null;
  thinkingBurstStart: number | null;
  wasThinking: boolean;
};
const INITIAL_TOOL_WINDOW: ToolWindow = {
  start: null,
  end: null,
  thinkingBurstStart: null,
  wasThinking: false
};
export type SpinnerAnimationRowProps = {
  // Animation inputs
  mode: SpinnerMode;
  reducedMotion: boolean;
  hasActiveTools: boolean;
  responseLengthRef: React.RefObject<number>;

  // Message (stable within a turn)
  message: string;
  messageColor: keyof Theme;
  shimmerColor: keyof Theme;
  overrideColor?: keyof Theme | null;

  // Timer refs (stable references)
  loadingStartTimeRef: React.RefObject<number>;
  totalPausedMsRef: React.RefObject<number>;
  pauseStartTimeRef: React.RefObject<number | null>;

  // Display flags
  spinnerSuffix?: string | null;
  verbose: boolean;
  columns: number;

  // Teammate-derived (computed by parent from tasks)
  hasRunningTeammates: boolean;
  teammateTokens: number;
  foregroundedTeammate: InProcessTeammateTaskState | undefined;
  /** Leader's turn has completed. Suppresses stall-red since responseLengthRef/hasActiveTools track leader state only. */
  leaderIsIdle?: boolean;

  // Thinking (state owned by parent, mode-dependent)
  thinkingStatus: 'thinking' | number | null;
  effortSuffix: string;
  // Show `running tool for Ns` / `ran tool for Ns` in the status line.
  showToolCallTimer?: boolean;
  /** While compacting: timer runs from compaction start (upstream 2.1.287).
   *  The token count stays on the shared streamed-char counter — REPL resets
   *  responseLengthRef to 0 on compact_start and the summary stream counts up
   *  from there, same as upstream. */
  compact?: { startedAt: number };
};

/**
 * The animation-clock-driven portion of SpinnerWithVerb. Owns
 * useAnimationFrame(32) and all values derived from that clock (frame,
 * glimmer, token counter animation, elapsed-time, stalled intensity,
 * thinking shimmer).
 *
 * The parent SpinnerWithVerb is freed from the animation render loop and only
 * re-renders when its props/app state change (~25x/turn instead of ~383x).
 * That keeps the outer Box shells, useAppState selectors, task filtering,
 * and tip/tree subtrees out of the hot animation path.
 */
export function SpinnerAnimationRow({
  mode,
  reducedMotion,
  hasActiveTools,
  responseLengthRef,
  message,
  messageColor,
  shimmerColor,
  overrideColor,
  loadingStartTimeRef,
  totalPausedMsRef,
  pauseStartTimeRef,
  spinnerSuffix,
  verbose,
  columns,
  hasRunningTeammates,
  teammateTokens,
  foregroundedTeammate,
  leaderIsIdle = false,
  thinkingStatus,
  effortSuffix,
  showToolCallTimer = false,
  compact
}: SpinnerAnimationRowProps): React.ReactNode {
  const [viewportRef, time] = useAnimationFrame(reducedMotion ? null : 32);

  // === Elapsed time (wall-clock, derived from refs each frame) ===
  const now = Date.now();
  const elapsedTimeMs = pauseStartTimeRef.current !== null ? pauseStartTimeRef.current - loadingStartTimeRef.current - totalPausedMsRef.current : now - loadingStartTimeRef.current - totalPausedMsRef.current;

  // Track wall-clock turn start for teammates. While a swarm is running the
  // leader's elapsedTimeMs may jump around (new API calls reset
  // loadingStartTimeRef; pauses freeze it), so we anchor to the earliest
  // derived start seen so far. When no teammates are running this just tracks
  // derivedStart every frame, effectively resetting for the next swarm.
  const derivedStart = now - elapsedTimeMs;
  const turnStartRef = useRef(derivedStart);
  if (!hasRunningTeammates || derivedStart < turnStartRef.current) {
    turnStartRef.current = derivedStart;
  }

  // === Animation derivations from `time` ===
  const currentResponseLength = responseLengthRef.current;

  // Suppress stall detection when leader is idle — responseLengthRef and
  // hasActiveTools both track leader state. When viewing an active teammate
  // while leader is idle, they'd otherwise flag a false stall after 3s.
  // Treating leaderIsIdle like hasActiveTools resets the stall timer.
  const {
    isStalled,
    stalledIntensity
  } = useStalledAnimation(time, currentResponseLength, hasActiveTools || leaderIsIdle, reducedMotion);
  const frame = reducedMotion ? 0 : Math.floor(time / 120);
  // message is stable within a turn; stringWidth is expensive enough (Bun native
  // call per code point) to memoize explicitly across the animation loop.
  const glimmerMessageWidth = useMemo(() => stringWidth(message), [message]);
  const glimmerHalfWidth = Math.max(glimmerMessageWidth * 0.1, 3);
  const sweep = time % 2000 / 2000 * (glimmerMessageWidth + 2 * glimmerHalfWidth);
  const glimmerIndex = reducedMotion || isStalled ? -100 : mode === 'requesting' ? sweep - glimmerHalfWidth : glimmerMessageWidth + glimmerHalfWidth - sweep;
  const flashOpacity = reducedMotion ? 0 : mode === 'tool-use' ? (Math.sin(time / 1000 * Math.PI) + 1) / 2 : 0;

  // === Token counter animation (smooth increment, rate-based so the clock
  // interval can change without retuning the constants) ===
  const tokenCounterRef = useRef(currentResponseLength);
  const tokenTickRef = useRef(time);
  // Compact resets responseLengthRef to 0 mid-turn (REPL compact_start); the
  // counter below only counts up, so snap it down or the pre-compact turn's
  // count would linger over the summary's fresh count.
  if (compact && tokenCounterRef.current > currentResponseLength) {
    tokenCounterRef.current = currentResponseLength;
  }
  // Cap dt: the clock freezes while offscreen, so the first tick after
  // returning would otherwise snap the counter straight to the target.
  const dtSec = Math.min(time - tokenTickRef.current, 250) / 1000;
  tokenTickRef.current = time;
  if (reducedMotion) {
    tokenCounterRef.current = currentResponseLength;
  } else {
    const gap = currentResponseLength - tokenCounterRef.current;
    if (gap > 0) {
      // Rates are the old per-tick constants read at the 100ms clock they were
      // tuned for: 30 tok/s when close, 80 tok/s plus 15%/tick while catching
      // up, 500 tok/s when far behind.
      const rate = gap < 70 ? 30 : gap < 200 ? Math.max(80, gap * 1.5) : 500;
      tokenCounterRef.current = Math.min(tokenCounterRef.current + rate * dtSec, currentResponseLength);
    }
  }
  const displayedResponseLength = tokenCounterRef.current;
  const leaderTokens = Math.round(displayedResponseLength / 4);
  const effectiveElapsedMs = compact ? now - compact.startedAt : hasRunningTeammates ? Math.max(elapsedTimeMs, now - turnStartRef.current) : elapsedTimeMs;
  const timerText = formatDuration(effectiveElapsedMs);
  const timerWidth = stringWidth(timerText);

  // === Token count (leader + teammates, or foregrounded teammate) ===
  const totalTokens = foregroundedTeammate && !foregroundedTeammate.isIdle ? foregroundedTeammate.progress?.tokenCount ?? 0 : leaderTokens + teammateTokens;
  const tokenCount = formatNumber(totalTokens);
  const tokensText = `${figures.arrowDown} ${tokenCount} tokens`;
  const tokensWidth = stringWidth(tokensText);

  // === Tool-call window + thinking burst tracking (upstream gn/kn) ===
  const toolWindowRef = useRef<ToolWindow>(INITIAL_TOOL_WINDOW);
  {
    const w = toolWindowRef.current;
    const isThinking = mode === 'thinking';
    if (hasActiveTools) {
      if (w.start === null || w.end !== null) w.start = now;
      w.end = null;
    } else if (w.start !== null && w.end === null) {
      w.end = now;
    }
    if (!hasActiveTools && thinkingStatus !== null) {
      w.start = null;
      w.end = null;
    }
    if (isThinking) {
      if (!w.wasThinking) w.thinkingBurstStart = now;
    } else {
      w.thinkingBurstStart = null;
    }
    w.wasThinking = isThinking;
  }
  const toolWindow = toolWindowRef.current;

  // Thinking intensity (upstream Tn): ramps 0→1 over 10s→20s of a thinking
  // burst; suppressed while tools run. Smoothed like stalledIntensity.
  const rawThinkingIntensity = hasActiveTools || mode !== 'thinking' || toolWindow.thinkingBurstStart === null ? 0 : Math.min(Math.max((now - toolWindow.thinkingBurstStart - 10_000) / 10_000, 0), 1);
  const thinkingIntensityRef = useRef(0);
  const thinkingSmoothRef = useRef(time);
  if (!reducedMotion && (rawThinkingIntensity > 0 || thinkingIntensityRef.current > 0)) {
    const dt = time - thinkingSmoothRef.current;
    if (dt >= 50) {
      const steps = Math.floor(dt / 50);
      let current = thinkingIntensityRef.current;
      for (let i = 0; i < steps; i++) {
        const diff = rawThinkingIntensity - current;
        if (Math.abs(diff) < 0.01) {
          current = rawThinkingIntensity;
          break;
        }
        current += diff * 0.1;
      }
      thinkingIntensityRef.current = current;
      thinkingSmoothRef.current = time;
    }
  } else {
    thinkingIntensityRef.current = rawThinkingIntensity;
    thinkingSmoothRef.current = time;
  }
  const thinkingIntensity = reducedMotion ? rawThinkingIntensity : thinkingIntensityRef.current;

  // Status-line kind (upstream kn): tool timer > thinking > thought-for.
  type StatusText =
    | { kind: 'tool-running'; toolMs: number }
    | { kind: 'tool-done'; toolMs: number }
    | { kind: 'thinking'; thinkingMs: number }
    | { kind: 'thought-for'; thoughtMs: number }
    | { kind: 'none' };
  let statusKind: StatusText;
  if (showToolCallTimer && hasActiveTools && toolWindow.start !== null && now - toolWindow.start >= TOOL_TIMER_MIN_MS) {
    statusKind = { kind: 'tool-running', toolMs: now - toolWindow.start };
  } else if (showToolCallTimer && !hasActiveTools && thinkingStatus === null && toolWindow.start !== null && toolWindow.end !== null && toolWindow.end - toolWindow.start >= TOOL_TIMER_MIN_MS) {
    statusKind = { kind: 'tool-done', toolMs: toolWindow.end - toolWindow.start };
  } else if (thinkingStatus === 'thinking' && !hasActiveTools) {
    statusKind = { kind: 'thinking', thinkingMs: toolWindow.thinkingBurstStart !== null ? now - toolWindow.thinkingBurstStart : 0 };
  } else if (typeof thinkingStatus === 'number') {
    statusKind = { kind: 'thought-for', thoughtMs: thinkingStatus };
  } else {
    statusKind = { kind: 'none' };
  }

  // === Thinking text (may shrink to fit) ===
  const progressiveBase = statusKind.kind === 'thinking' ? progressiveThinkingText(statusKind.thinkingMs) : 'thinking';
  let thinkingText =
    statusKind.kind === 'tool-running'
      ? `running tool for ${formatDuration(statusKind.toolMs)}`
      : statusKind.kind === 'tool-done'
        ? `ran tool for ${formatDuration(statusKind.toolMs)}`
        : statusKind.kind === 'thinking'
          ? `${progressiveBase}${effortSuffix}`
          : statusKind.kind === 'thought-for'
            ? `thought for ${Math.max(1, Math.round(statusKind.thoughtMs / 1000))}s`
            : null

  let thinkingWidthValue = thinkingText ? stringWidth(thinkingText) : 0;

  // === Progressive width gating ===
  const messageWidth = glimmerMessageWidth + 2;
  const sep = SEP_WIDTH;
  const wantsThinking = statusKind.kind !== 'none';
  // During compact the timer shows from the first frame (upstream: the timer
  // starts when compaction begins, not after SHOW_TOKENS_AFTER_MS).
  const wantsTimerAndTokens = compact !== undefined || verbose || hasRunningTeammates || effectiveElapsedMs > SHOW_TOKENS_AFTER_MS;
  const availableSpace = columns - messageWidth - 5;
  let showThinking = wantsThinking && availableSpace > thinkingWidthValue;
  if (!showThinking && wantsThinking && statusKind.kind === 'thinking' && (effortSuffix || progressiveBase !== 'thinking')) {
    if (availableSpace > THINKING_BARE_WIDTH) {
      thinkingText = 'thinking';
      thinkingWidthValue = THINKING_BARE_WIDTH;
      showThinking = true;
    }
  }
  const usedAfterThinking = showThinking ? thinkingWidthValue + sep : 0;
  const showTimer = wantsTimerAndTokens && availableSpace > usedAfterThinking + timerWidth;
  const usedAfterTimer = usedAfterThinking + (showTimer ? timerWidth + sep : 0);
  const showTokens = wantsTimerAndTokens && totalTokens > 0 && availableSpace > usedAfterTimer + tokensWidth;
  const thinkingOnly = showThinking && statusKind.kind === 'thinking' && !spinnerSuffix && !showTimer && !showTokens && true;

  // === Thinking shimmer color (formerly ThinkingShimmerText's own timer) ===
  // Same sine-wave opacity, but derived from our shared `time` instead of a
  // second useAnimationFrame(50) subscription. Blended toward the theme's
  // warning color as thinkingIntensity ramps up (upstream Do).
  const thinkingElapsedSec = (time - THINKING_DELAY_MS) / 1000;
  const thinkingOpacity = time < THINKING_DELAY_MS ? 0 : (Math.sin(thinkingElapsedSec * Math.PI * 2 / THINKING_GLOW_PERIOD_S) + 1) / 2;
  const theme = useResolvedTheme();
  const warningRGB = thinkingIntensity > 0 && theme.warning ? parseRGB(theme.warning) : null;
  let thinkingColor = interpolateColor(THINKING_INACTIVE, THINKING_INACTIVE_SHIMMER, thinkingOpacity);
  if (warningRGB && thinkingIntensity > 0) {
    thinkingColor = interpolateColor(thinkingColor, warningRGB, thinkingIntensity);
  }
  const thinkingShimmerColor = toRGBColor(thinkingColor);
  const thinkingTextColor = !warningRGB && thinkingIntensity > 0.5 ? 'warning' : thinkingShimmerColor;

  // === Build status parts ===
  const parts = [...(spinnerSuffix ? [<Text dimColor key="suffix">
            {spinnerSuffix}
          </Text>] : []), ...(showTimer ? [<Text dimColor key="elapsedTime">
            {timerText}
          </Text>] : []), ...(showTokens ? [<Box flexDirection="row" key="tokens">
            {!hasRunningTeammates && <SpinnerModeGlyph mode={mode} />}
            <Text dimColor>{tokenCount} tokens</Text>
          </Box>] : []), ...(showThinking && thinkingText ? [statusKind.kind === 'thinking' && !reducedMotion ? <Text key="thinking" color={thinkingTextColor}>
              {thinkingOnly ? `(${thinkingText})` : thinkingText}
            </Text> : <Text dimColor key="thinking">
              {thinkingText}
            </Text>] : [])];
  const status = foregroundedTeammate && !foregroundedTeammate.isIdle ? <>
        <Text dimColor>(esc to interrupt </Text>
        <Text color={toInkColor(foregroundedTeammate.identity.color)}>
          {foregroundedTeammate.identity.agentName}
        </Text>
        <Text dimColor>)</Text>
      </> : !foregroundedTeammate && parts.length > 0 ? thinkingOnly ? <Byline>{parts}</Byline> : <>
          <Text dimColor>(</Text>
          <Byline>{parts}</Byline>
          <Text dimColor>)</Text>
        </> : null;
  return <Box ref={viewportRef} flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
      <SpinnerGlyph frame={frame} messageColor={messageColor} stalledIntensity={overrideColor ? 0 : stalledIntensity} reducedMotion={reducedMotion} time={time} />
      <GlimmerMessage message={message} mode={mode} messageColor={messageColor} glimmerIndex={glimmerIndex} flashOpacity={flashOpacity} shimmerColor={shimmerColor} stalledIntensity={overrideColor ? 0 : stalledIntensity} />
      {status}
    </Box>;
}
function SpinnerModeGlyph(t0) {
  const $ = _c(2);
  const {
    mode
  } = t0;
  switch (mode) {
    case "tool-input":
    case "tool-use":
    case "responding":
    case "thinking":
      {
        let t1;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Box width={2}><Text dimColor={true}>{figures.arrowDown}</Text></Box>;
          $[0] = t1;
        } else {
          t1 = $[0];
        }
        return t1;
      }
    case "requesting":
      {
        let t1;
        if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Box width={2}><Text dimColor={true}>{figures.arrowUp}</Text></Box>;
          $[1] = t1;
        } else {
          t1 = $[1];
        }
        return t1;
      }
  }
}

export function _getThinkingTextForTesting(
  thinkingStatus: 'thinking' | number | null,
  effectiveElapsedMs: number,
  effortSuffix: string,
): string | null {
  if (thinkingStatus === 'thinking') {
    return `${progressiveThinkingText(effectiveElapsedMs)}${effortSuffix}`
  }
  if (typeof thinkingStatus === 'number') {
    return `thought for ${Math.max(1, Math.round(thinkingStatus / 1000))}s`
  }
  return null
}
