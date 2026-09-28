/**
 * Gradient ASCII banner — Ink component version.
 * Logo has gradient colors; the info lines below it use solid colors.
 */

import React from 'react'
import { sep } from 'path'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { renderModelName } from '../../utils/model/model.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
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

export function GradientBanner() {
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
        const [r, g, b] = gradAt(SUNSET_GRAD, charT)
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
    <Box flexDirection="column">
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
