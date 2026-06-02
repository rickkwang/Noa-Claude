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

function detectProvider(displayModelLabel: string) {
  const provider = getAPIProvider()

  switch (provider) {
    case 'bedrock':
      return { name: 'Amazon Bedrock', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://bedrock.amazonaws.com' }
    case 'vertex':
      return { name: 'Google Vertex AI', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://vertexai.googleapis.com' }
    case 'foundry':
      return { name: 'Microsoft Foundry', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://foundry.ai.azure.com' }
    case 'openaiCompatible': {
      const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
      let name = 'OpenAI Compatible'
      if (/deepseek/i.test(baseUrl)) name = 'DeepSeek'
      else if (/openrouter/i.test(baseUrl)) name = 'OpenRouter'
      else if (/together/i.test(baseUrl)) name = 'Together AI'
      else if (/groq/i.test(baseUrl)) name = 'Groq'
      else if (/azure/i.test(baseUrl)) name = 'Azure OpenAI'
      else if (/ollama/i.test(baseUrl) || /localhost|127\.0\.0\.1|\.local/.test(baseUrl)) name = 'Ollama / Local'
      return { name, model: displayModelLabel, baseUrl }
    }
    case 'firstParty':
    default: {
      return { name: 'Anthropic', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' }
    }
  }
}

export function GradientBanner() {
  // Login/provider switch bumps authVersion; subscribe so provider/model/baseUrl
  // rows re-read process.env immediately after auth changes.
  useAppState((s: AppState) => s.authVersion)
  const displayModelLabel = renderModelName(useMainLoopModel())
  const p = detectProvider(displayModelLabel)

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

  const modelLine = p.model
  const modelHint = '/provider to change'
  const ep = p.baseUrl.length > 40 ? p.baseUrl.slice(0, 37) + '...' : p.baseUrl
  const version = MACRO.DISPLAY_VERSION ?? MACRO.VERSION

  // Compute dynamic box width based on content length
  const titleLen = 18 + version.length       // ' >_ Noa Claude ' + '(v' + version + ')'
  const modelLen = 38 + modelLine.length     // ' model:     ' + model + gap + hint
  const dirLen = 12 + cwdDisplay.length      // ' directory: ' + cwd
  const epLen = 12 + ep.length               // ' endpoint:  ' + ep
  const maxContentLen = Math.max(titleLen, modelLen, dirLen, epLen, 60)
  const CONTENT_W = maxContentLen + 2        // 2 chars buffer on the right
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
        <Text color={BORDER_HEX}>{' >_ '}</Text>
        <Text bold>{'Noa Claude '}</Text>
        <Text color={BORDER_HEX}>(v{version})</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - 15 - 3 - version.length))}</Text>
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
        <Text color={BORDER_HEX}>{' model:     '}</Text>
        <Text>{modelLine}</Text>
        <Text color={ACCENT_HEX}>{' '.repeat(8)}/provider</Text><Text color={BORDER_HEX}> to change</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - 12 - modelLine.length - 8 - modelHint.length))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Directory row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={BORDER_HEX}>{' directory: '}</Text>
        <Text>{cwdDisplay}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - 12 - cwdDisplay.length))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Endpoint row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={BORDER_HEX}>{' endpoint:  '}</Text>
        <Text>{ep}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - 12 - ep.length))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Bottom border */}
      <Text color={BORDER_HEX}>╰{'─'.repeat(W - 2)}╯</Text>
    </Box>
  )
}
