/**
 * Gradient ASCII banner — Ink component version.
 * Logo has gradient colors, info box uses solid colors for stability.
 */

import React from 'react'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { renderModelName } from '../../utils/model/model.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'

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
const BORDER_HEX = rgbToHex(136, 136, 136)

const LOGO_OPEN = [
  ` ██████   █████   ███████     █████████ `,
  `░░██████ ░░███  ███░░░░░███  ███░░░░░███`,
  ` ░███░███ ░███ ███     ░░███░███    ░███`,
  ` ░███░░███░███░███      ░███░███████████`,
  ` ░███ ░░██████░███      ░███░███░░░░░███`,
  ` ░███  ░░█████░░███     ███ ░███    ░███`,
  ` █████  ░░█████░░░███████░  █████   █████`,
  `░░░░░    ░░░░░   ░░░░░░░   ░░░░░   ░░░░░`,
]


const LOGO_CLAUDE = [
  `   █████████  █████        █████████  █████  ███████████████  ██████████`,
  `  ███░░░░░███░░███        ███░░░░░███░░███  ░░███░░███░░░░███░░███░░░░░█`,
  ` ███     ░░░  ░███       ░███    ░███ ░███   ░███ ░███   ░░███░███  █ ░`,
  `░███          ░███       ░███████████ ░███   ░███ ░███    ░███░██████`,
  `░███          ░███       ░███░░░░░███ ░███   ░███ ░███    ░███░███░░█`,
  `░░███     ███ ░███      █░███    ░███ ░███   ░███ ░███    ███ ░███ ░   █`,
  ` ░░█████████  ████████████████   █████░░████████  ██████████  ██████████`,
  `  ░░░░░░░░░  ░░░░░░░░░░░░░░░░   ░░░░░  ░░░░░░░░  ░░░░░░░░░░  ░░░░░░░░░░`,
]

function resolveEndpoint(): string {
  switch (getAPIProvider()) {
    case 'bedrock':
      return process.env.ANTHROPIC_BASE_URL || 'https://bedrock.amazonaws.com'
    case 'vertex':
      return process.env.ANTHROPIC_BASE_URL || 'https://vertexai.googleapis.com'
    case 'foundry':
      return process.env.ANTHROPIC_BASE_URL || 'https://foundry.ai.azure.com'
    case 'openaiCompatible':
      return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    case 'firstParty':
    default:
      return process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
  }
}

export function GradientBanner() {
  // Login bumps authVersion; subscribe so the model row re-renders on auth changes.
  useAppState((s: AppState) => s.authVersion)
  const modelLine = renderModelName(useMainLoopModel())
  const endpoint = resolveEndpoint()

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

  const logoTop = renderLogoSection(LOGO_OPEN, 0, LOGO_OPEN.length + LOGO_CLAUDE.length)
  const logoBottom = renderLogoSection(LOGO_CLAUDE, LOGO_OPEN.length, LOGO_OPEN.length + LOGO_CLAUDE.length)

  const cwd = getOriginalCwd()
  const homeDir = process.env.HOME ?? ''
  const cwdDisplay = homeDir && cwd.startsWith(homeDir)
    ? '~' + cwd.slice(homeDir.length)
    : cwd

  const version = MACRO.DISPLAY_VERSION ?? MACRO.VERSION

  // Each row's segments — defined once, used for both rendering and width calculation.
  const TITLE_PREFIX = ' >_ '
  const TITLE_NAME = 'Noa Claude '
  const TITLE_VER = `(v${version})`
  const MODEL_LABEL = ' model:     '
  const MODEL_GAP = ' '.repeat(8)
  const MODEL_HINT_ACCENT = '/provider'
  const MODEL_HINT_GRAY = ' to change'
  const ENDPOINT_LABEL = ' endpoint:  '
  const DIR_LABEL = ' directory: '

  const titleLen = TITLE_PREFIX.length + TITLE_NAME.length + TITLE_VER.length
  const modelLen = MODEL_LABEL.length + modelLine.length + MODEL_GAP.length + MODEL_HINT_ACCENT.length + MODEL_HINT_GRAY.length
  const endpointLen = ENDPOINT_LABEL.length + endpoint.length
  const dirLen = DIR_LABEL.length + cwdDisplay.length
  const maxContentLen = Math.max(titleLen, modelLen, endpointLen, dirLen)
  const CONTENT_W = maxContentLen + 10
  const W = CONTENT_W + 2

  return (
    <Box flexDirection="column">
      {/* Logo */}
      {logoTop}
      <Box height={1} />
      {logoBottom}

      <Text> </Text>

      {/* Top border */}
      <Text color={BORDER_HEX}>╭{'─'.repeat(W - 2)}╮</Text>

      {/* Title row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={BORDER_HEX}>{TITLE_PREFIX}</Text>
        <Text bold>{TITLE_NAME}</Text>
        <Text color={BORDER_HEX}>{TITLE_VER}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - titleLen))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Empty row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text>{' '.repeat(CONTENT_W)}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Model row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={BORDER_HEX}>{MODEL_LABEL}</Text>
        <Text>{modelLine}</Text>
        <Text color={ACCENT_HEX}>{MODEL_GAP}{MODEL_HINT_ACCENT}</Text>
        <Text color={BORDER_HEX}>{MODEL_HINT_GRAY}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - modelLen))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Endpoint row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={BORDER_HEX}>{ENDPOINT_LABEL}</Text>
        <Text>{endpoint}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - endpointLen))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Directory row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={BORDER_HEX}>{DIR_LABEL}</Text>
        <Text>{cwdDisplay}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - dirLen))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Bottom border */}
      <Text color={BORDER_HEX}>╰{'─'.repeat(W - 2)}╯</Text>
    </Box>
  )
}
