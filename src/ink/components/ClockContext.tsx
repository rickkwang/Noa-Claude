// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import React, { createContext, useEffect, useState } from 'react';
import { FRAME_INTERVAL_MS } from '../constants.js';
import { setFramePressureListener } from '../frame-cost.js';
import { useTerminalFocus } from '../hooks/use-terminal-focus.js';
export type Clock = {
  subscribe: (onChange: () => void, keepAlive: boolean) => () => void;
  now: () => number;
  setTickInterval: (ms: number) => void;
};
export function createClock(tickIntervalMs: number): Clock {
  const subscribers = new Map<() => void, boolean>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentTickIntervalMs = tickIntervalMs;
  let startTime = 0;
  // Snapshot of the current tick's time, ensuring all subscribers in the same
  // tick see the same value (keeps animations synchronized)
  let tickTime = 0;
  function tick(): void {
    tickTime = Date.now() - startTime;
    for (const onChange of subscribers.keys()) {
      onChange();
    }
  }
  function updateInterval(): void {
    const anyKeepAlive = [...subscribers.values()].some(Boolean);
    if (anyKeepAlive) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (startTime === 0) {
        startTime = Date.now();
      }
      interval = setInterval(tick, currentTickIntervalMs);
    } else if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }
  return {
    subscribe(onChange, keepAlive) {
      subscribers.set(onChange, keepAlive);
      updateInterval();
      return () => {
        subscribers.delete(onChange);
        updateInterval();
      };
    },
    now() {
      if (startTime === 0) {
        startTime = Date.now();
      }
      // When the clock interval is running, return the synchronized tickTime
      // so all subscribers in the same tick see the same value.
      // When paused (no keepAlive subscribers), return real-time to avoid
      // returning a stale tickTime from the last tick before the pause.
      if (interval && tickTime) {
        return tickTime;
      }
      return Date.now() - startTime;
    },
    setTickInterval(ms) {
      if (ms === currentTickIntervalMs) return;
      currentTickIntervalMs = ms;
      updateInterval();
    }
  };
}
export const ClockContext = createContext<Clock | null>(null);
// Halved tick rate. Two independent reasons to use it: the terminal is
// unfocused, or frame-cost backpressure is active.
const SLOW_TICK_INTERVAL_MS = FRAME_INTERVAL_MS * 2;

// Own component so App.tsx doesn't re-render when the clock is created.
// The clock value is stable (created once via useState), so the provider
// never causes consumer re-renders on its own.
//
// NOTE: checked-in React Compiler output (the compiler is not part of this
// build), hand-edited since — the effects below are written by hand. So the
// $ memo slots are maintained manually: keep them contiguous and _c(n) sized
// to match.
export function ClockProvider(t0) {
  const $ = _c(3);
  const {
    children
  } = t0;
  const [clock] = useState(_temp);
  const focused = useTerminalFocus();
  // Frame-cost backpressure (omp Loader-style): sustained expensive frames
  // raise the tick interval so animations stop competing with the render
  // pipeline for CPU. Independent of focus; either one slows the clock.
  const [pressured, setPressured] = useState(false);
  useEffect(() => setFramePressureListener(setPressured), []);
  useEffect(() => {
    clock.setTickInterval(focused && !pressured ? FRAME_INTERVAL_MS : SLOW_TICK_INTERVAL_MS);
  }, [clock, focused, pressured]);
  let t3;
  if ($[0] !== children || $[1] !== clock) {
    t3 = <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
    $[0] = children;
    $[1] = clock;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  return t3;
}
function _temp() {
  return createClock(FRAME_INTERVAL_MS);
}
