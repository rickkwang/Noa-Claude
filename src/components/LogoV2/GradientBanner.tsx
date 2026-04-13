/**
 * Gradient ASCII banner — Ink component version.
 * Logo has gradient colors, info box uses solid colors for stability.
 */

import React from 'react'
import { Box, Text } from '../../ink.js'
import { getAPIProvider } from '../../utils/model/providers.js'

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

function detectProvider() {
  const provider = getAPIProvider()

  switch (provider) {
    case 'bedrock':
      return { name: 'Amazon Bedrock', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://bedrock.amazonaws.com', isLocal: false }
    case 'vertex':
      return { name: 'Google Vertex AI', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://vertexai.googleapis.com', isLocal: false }
    case 'foundry':
      return { name: 'Microsoft Foundry', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://foundry.ai.azure.com', isLocal: false }
    case 'openaiCompatible': {
      const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
      const rawModel = process.env.OPENAI_MODEL || 'gpt-4o'
      const isLocal = isLocalUrl(baseUrl)
      let name = 'OpenAI Compatible'
      if (/deepseek/i.test(baseUrl)) name = 'DeepSeek'
      else if (/openrouter/i.test(baseUrl)) name = 'OpenRouter'
      else if (/together/i.test(baseUrl)) name = 'Together AI'
      else if (/groq/i.test(baseUrl)) name = 'Groq'
      else if (/azure/i.test(baseUrl)) name = 'Azure OpenAI'
      else if (/ollama/i.test(baseUrl) || isLocal) name = 'Ollama / Local'
      return { name, model: rawModel, baseUrl, isLocal }
    }
    case 'firstParty':
    default: {
      const modelSetting = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
      return { name: 'Anthropic', model: modelSetting, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', isLocal: false }
    }
  }
}

export function GradientBanner() {
  const p = detectProvider()
  const W = 62

  const allLogo = LOGO_CLAUDE
  const total = allLogo.length

  // Build logo lines with per-character gradient colors
  const logoLines: React.ReactNode[] = []
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    const tokens: React.ReactNode[] = []
    const line = allLogo[i]!
    for (let j = 0; j < line.length; j++) {
      const charT = line.length > 1 ? t * 0.5 + (j / (line.length - 1)) * 0.5 : t
      const [r, g, b] = gradAt(SUNSET_GRAD, charT)
      tokens.push(
        <Text key={j} color={rgbToHex(r, g, b)}>{line[j]}</Text>
      )
    }
    logoLines.push(<Box key={`logo-${i}`}>{tokens}</Box>)
  }

  const provColor = p.isLocal ? GREEN_HEX : ACCENT_HEX
  const ep = p.baseUrl.length > 38 ? p.baseUrl.slice(0, 35) + '...' : p.baseUrl
  const statusColor = p.isLocal ? GREEN_HEX : ACCENT_HEX
  const statusType = p.isLocal ? 'local' : 'cloud'

  // Label width constants
  const LABEL_W = 11 // " Provider  " = 11 chars
  const CONTENT_W = W - 2 // content area between borders

  return (
    <Box flexDirection="column">
      {/* Logo */}
      {logoLines}

      {/* Spacer */}
      <Text> </Text>

      {/* Tagline */}
      <Text>
        <Text color={ACCENT_HEX}>  ✦  </Text>
        <Text color={CREAM_HEX}>Dream bigger. Think faster. Ship instantly.</Text>
        <Text color={ACCENT_HEX}>  ✦</Text>
      </Text>

      {/* Spacer */}
      <Text> </Text>

      {/* Top border */}
      <Text color={BORDER_HEX}>╔{'═'.repeat(W - 2)}╗</Text>

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
      <Text color={BORDER_HEX}>╠{'═'.repeat(W - 2)}╣</Text>

      {/* Status row */}
      <Text>
        <Text color={BORDER_HEX}>│</Text>
        <Text color={statusColor}> ● </Text>
        <Text color={DIMCOL_HEX}>{statusType}    Ready — type </Text>
        <Text color={ACCENT_HEX}>/help</Text>
        <Text color={DIMCOL_HEX}> to begin</Text>
        <Text>{' '.repeat(Math.max(0, CONTENT_W - 39))}</Text>
        <Text color={BORDER_HEX}>│</Text>
      </Text>

      {/* Bottom border */}
      <Text color={BORDER_HEX}>╚{'═'.repeat(W - 2)}╝</Text>

      {/* Version */}
      <Text>
        <Text dimColor>  claude </Text>
        <Text color={ACCENT_HEX}>v{MACRO.DISPLAY_VERSION ?? MACRO.VERSION}</Text>
      </Text>
    </Box>
  )
}
