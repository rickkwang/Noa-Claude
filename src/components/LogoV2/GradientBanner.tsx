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
const CREAM_HEX = rgbToHex(220, 195, 170)
const DIMCOL_HEX = rgbToHex(120, 100, 82)
const BORDER_HEX = rgbToHex(100, 80, 65)
const GREEN_HEX = rgbToHex(130, 175, 130)

const LOGO_OPEN = [
  `  ███╗   ██╗ ████████╗ ████████╗`,
  `  ████╗  ██║ ██╔═══██║ ██╔═══██║`,
  `  ██╔██╗ ██║ ██║   ██║ ████████║`,
  `  ██║╚██╗██║ ██║   ██║ ██╔═══██║`,
  `  ██║ ╚████║ ████████║ ██║   ██║`,
  `  ╚═╝  ╚═══╝ ╚═══════╝ ╚═╝   ╚═╝`,
]


const LOGO_CLAUDE = [
  `  ████████╗ ██╗      ████████╗ ██╗   ██╗ ████████╗ ████████╗`,
  `  ██╔═════╝ ██║      ██╔═══██║ ██║   ██║ ██╔═══██║ ██╔═════╝`,
  `  ██║       ██║      ████████║ ██║   ██║ ██║   ██║ ██████╗  `,
  `  ██║       ██║      ██╔═══██║ ██║   ██║ ██║   ██║ ██╔═══╝  `,
  `  ████████╗ ████████╗██║   ██║ ╚██████╔╝ ████████║ ████████╗`,
  `  ╚═══════╝ ╚═══════╝╚═╝   ╚═╝  ╚═════╝  ╚═══════╝ ╚═══════╝`,
]

function isLocalUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('.local')
}

function detectProvider(displayModelLabel: string) {
  const provider = getAPIProvider()

  switch (provider) {
    case 'bedrock':
      return { name: 'Amazon Bedrock', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://bedrock.amazonaws.com', isLocal: false }
    case 'vertex':
      return { name: 'Google Vertex AI', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://vertexai.googleapis.com', isLocal: false }
    case 'foundry':
      return { name: 'Microsoft Foundry', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://foundry.ai.azure.com', isLocal: false }
    case 'openaiCompatible': {
      const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
      const isLocal = isLocalUrl(baseUrl)
      let name = 'OpenAI Compatible'
      if (/deepseek/i.test(baseUrl)) name = 'DeepSeek'
      else if (/openrouter/i.test(baseUrl)) name = 'OpenRouter'
      else if (/together/i.test(baseUrl)) name = 'Together AI'
      else if (/groq/i.test(baseUrl)) name = 'Groq'
      else if (/azure/i.test(baseUrl)) name = 'Azure OpenAI'
      else if (/ollama/i.test(baseUrl) || isLocal) name = 'Ollama / Local'
      return { name, model: displayModelLabel, baseUrl, isLocal }
    }
    case 'firstParty':
    default: {
      return { name: 'Anthropic', model: displayModelLabel, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', isLocal: false }
    }
  }
}

export function GradientBanner() {
  // Login/provider switch bumps authVersion; subscribe so provider/model/baseUrl
  // rows re-read process.env immediately after auth changes.
  useAppState((s: AppState) => s.authVersion)
  const displayModelLabel = renderModelName(useMainLoopModel())
  const p = detectProvider(displayModelLabel)
  const W = 62

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

  const provColor = p.isLocal ? GREEN_HEX : ACCENT_HEX
  const ep = p.baseUrl.length > 38 ? p.baseUrl.slice(0, 35) + '...' : p.baseUrl
  const statusColor = p.isLocal ? GREEN_HEX : ACCENT_HEX
  const statusType = p.isLocal ? 'local' : 'Directory:'
  const cwd = getOriginalCwd()
  const homeDir = process.env.HOME ?? ''
  const cwdDisplay = homeDir && cwd.startsWith(homeDir)
    ? '~' + cwd.slice(homeDir.length)
    : cwd

  // Label width constants
  const LABEL_W = 11 // " Provider  " = 11 chars
  const CONTENT_W = W - 2 // content area between borders

  return (
    <Box flexDirection="column">
      {/* Logo */}
      {logoTop}
      <Box height={1} />
      {logoBottom}

      {/* Spacer */}
      <Text> </Text>

      {/* Top border */}
      <Text color={BORDER_HEX}>┌{'─'.repeat(W - 2)}┐</Text>

      {/* Provider row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text> Provider  </Text>
        <Text color={provColor}>{p.name}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - LABEL_W - p.name.length))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Model row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text> Model     </Text>
        <Text>{p.model}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - LABEL_W - p.model.length))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Endpoint row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text> Endpoint  </Text>
        <Text>{ep}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - LABEL_W - ep.length))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Divider */}
      <Text color={BORDER_HEX}>├{'─'.repeat(W - 2)}┤</Text>

      {/* Status row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={statusColor}> • </Text>
        <Text color={DIMCOL_HEX}>{statusType}  </Text>
        <Text>{cwdDisplay}</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - 1 - 1 - statusType.length - 2 - cwdDisplay.length - 1))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Bottom border */}
      <Text color={BORDER_HEX}>└{'─'.repeat(W - 2)}┘</Text>

      {/* Version */}
      <Text>
        <Text dimColor>{'  >_ Noa Claude '}</Text>
        <Text color={ACCENT_HEX}>v{MACRO.DISPLAY_VERSION ?? MACRO.VERSION}</Text>
      </Text>
    </Box>
  )
}
