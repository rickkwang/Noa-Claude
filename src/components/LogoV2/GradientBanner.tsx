/**
 * Gradient ASCII banner — Ink component version.
 * Logo has gradient colors; the info lines below it use solid colors.
 */

import React, { useEffect, useRef, useState } from 'react'
import { sep } from 'path'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { renderModelName } from '../../utils/model/model.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { useWandActive } from './ClawdWand.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { GREETINGS } from './greetings.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

type RGB = [number, number, number]

const SUNSET_GRAD: RGB[] = [
  [255, 180, 100],
  [240, 140, 80],
  [217, 119, 87],
  [193, 95, 60],
  [160, 75, 55],
  [130, 60, 50],
]

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradAt(stops: RGB[], t: number): RGB {
  const c = Math.max(0, Math.min(1, t))
  const s = c * (stops.length - 1)
  const i = Math.floor(s)
  if (i >= stops.length - 1) return stops[stops.length - 1]!
  return lerp(stops[i]!, stops[i + 1]!, s - i)
}

const ACCENT_HEX = rgbToHex(240, 148, 100)
const DIM_HEX = rgbToHex(136, 136, 136)

// Module scope: one greeting per process, stable across re-renders.
const GREETING = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]!

const LOGO_OPEN = [
  "░█▀█░█▀█░█▀█░░░█▀▀░█░░░█▀█░█░█░█▀▄░█▀▀░",
  "░█░█░█░█░█▀█░░░█░░░█░░░█▀█░█░█░█░█░█▀▀░",
  "░▀░▀░▀▀▀░▀░▀░░░▀▀▀░▀▀▀░▀░▀░▀▀▀░▀▀░░▀▀▀░",
]

// Startup ripple: one soft band of light sweeps left to right across the logo,
// warming each column toward a golden-cream highlight drawn from the gradient's
// own bright end, then the banner rests on its static gradient. The band is a
// plain gaussian over the column, so every row brightens together and the
// intensity rises and falls smoothly. Plays once per process at startup (the
// banner remounts on screen switches and must not replay), again on each click
// (needs mouse tracking, i.e. fullscreen), and never under reduced motion. At
// xhigh/max effort (the same gate as the Clawd wand) it loops with a short rest
// between sweeps.
const RIPPLE_TICK_MS = 50
const RIPPLE_DELAY_MS = 250
const RIPPLE_LOOP_GAP_MS = 1500 // rest between sweeps while looping
const RIPPLE_SPEED = 26 // columns per second
const RIPPLE_SIGMA = 4.5 // band half-width in columns
const RIPPLE_CREST = 0.7 // peak blend toward the highlight
const LOGO_WIDTH = LOGO_OPEN[0]!.length
// The band starts and ends 3 sigma outside the logo so it enters and leaves at zero.
const RIPPLE_END_MS = RIPPLE_DELAY_MS + ((LOGO_WIDTH + 6 * RIPPLE_SIGMA) / RIPPLE_SPEED) * 1000
let rippleDone = false

const RIPPLE_HIGHLIGHT: RGB = lerp(SUNSET_GRAD[0]!, [255, 240, 190], 0.75)

// Elapsed ms of the running ripple (null when it isn't playing) plus a replay
// trigger for clicks. Clicks are ignored mid-ripple and under reduced motion.
// With `loop` the sweep restarts after a rest instead of stopping.
function useStartupRipple(loop: boolean): [number | null, () => void] {
  const reducedMotion = getInitialSettings().prefersReducedMotion ?? false
  const loopRef = useRef(loop && !reducedMotion)
  loopRef.current = loop && !reducedMotion
  const [ms, setMs] = useState<number | null>(() => (rippleDone && !loopRef.current) || reducedMotion ? null : 0)
  const playing = ms !== null
  useEffect(() => {
    if (!playing) return
    let start = Date.now()
    let resting = false
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= RIPPLE_END_MS + (loopRef.current ? RIPPLE_LOOP_GAP_MS : 0)) {
        rippleDone = true
        if (loopRef.current) {
          start = Date.now()
          resting = false
          setMs(0)
        } else {
          clearInterval(id)
          setMs(null)
        }
      } else if (elapsed >= RIPPLE_END_MS) {
        // Resting between sweeps: the band is off-screen, so repaint once and
        // then leave the banner alone until the next sweep.
        if (!resting) {
          resting = true
          setMs(RIPPLE_END_MS)
        }
      } else {
        setMs(elapsed)
      }
    }, RIPPLE_TICK_MS)
    return () => clearInterval(id)
  }, [playing])
  // Effort just went high after the ripple had finished: start sweeping.
  useEffect(() => {
    if (loop && !reducedMotion && ms === null) setMs(0)
  }, [loop, reducedMotion, ms === null])
  const replay = () => {
    if (!playing && !reducedMotion) setMs(0)
  }
  return [ms, replay]
}

export function GradientBanner() {
  const [rippleMs, replayRipple] = useStartupRipple(useWandActive())
  // Band center in columns: starts 3 sigma left of the logo, ends 3 sigma right.
  const front = rippleMs === null || rippleMs >= RIPPLE_END_MS ? null : ((rippleMs - RIPPLE_DELAY_MS) / 1000) * RIPPLE_SPEED - 3 * RIPPLE_SIGMA
  // Login/provider switch bumps authVersion; subscribe so the model row
  // re-reads the active provider immediately after auth changes.
  useAppState((s: AppState) => s.authVersion)
  const modelLine = renderModelName(useMainLoopModel())

  const renderLogoSection = (lines: string[], offset: number, total: number): React.ReactNode[] =>
    lines.map((line, i) => {
      const t = total > 1 ? (offset + i) / (total - 1) : 0
      const tokens: React.ReactNode[] = []
      for (let j = 0; j < line.length; j++) {
        const charT = line.length > 1 ? t * 0.5 + (j / (line.length - 1)) * 0.5 : t
        let [r, g, b] = gradAt(SUNSET_GRAD, charT)
        if (front !== null && line[j] !== ' ') {
          const x = (j - front) / RIPPLE_SIGMA
          ;[r, g, b] = lerp([r, g, b], RIPPLE_HIGHLIGHT, Math.exp(-x * x / 2) * RIPPLE_CREST)
        }
        tokens.push(<Text key={j} color={rgbToHex(r, g, b)}>{line[j]}</Text>)
      }
      return <Box key={`logo-${offset + i}`}>{tokens}</Box>
    })

  const logoTop = renderLogoSection(LOGO_OPEN, 0, LOGO_OPEN.length)

  const cwd = getOriginalCwd()
  const homeDir = process.env.HOME ?? ''
  const cwdDisplay = homeDir && (cwd === homeDir || cwd.startsWith(homeDir + sep))
    ? '~' + cwd.slice(homeDir.length)
    : cwd

  const version = MACRO.DISPLAY_VERSION ?? MACRO.VERSION

  return (
    <Box flexDirection="column" onClick={replayRipple}>
      {/* Logo */}
      {logoTop}
      <Box height={1} />

      <Text>
        <Text bold>Noa Claude</Text>
        <Text color={DIM_HEX}>{` v${version}`}</Text>
      </Text>
      <Text color={DIM_HEX} wrap="truncate-middle">{`${modelLine} · ${cwdDisplay}`}</Text>

      <Box height={1} />
      <Text color={ACCENT_HEX}>{GREETING}</Text>
    </Box>
  )
}
