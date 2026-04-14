/**
 * Claude-style startup screen — gradient-filled block text logo.
 * Called once at CLI startup before the Ink UI renders.
 *
 * Enabled via STARTUP_BANNER env var or global startup-banner.json under
 * CLAUDE_CONFIG_DIR (defaults to ~/.claude-agent):
 *   - "claude"     : Show Claude-style gradient banner
 *   - "clawd"      : Show Clawd official logo
 *   - not set      : Skip (use only WelcomeV2)
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAPIProvider } from '../utils/model/providers.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import {
  normalizeStartupBannerMode,
  STARTUP_BANNER_SETTINGS_FILENAME,
} from '../utils/startupBannerMode.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

const ESC = '\x1b['
const RESET = `${ESC}0m`
const DIM = `${ESC}2m`

type RGB = [number, number, number]
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`

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

function paintLine(text: string, stops: RGB[], lineT: number): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? lineT * 0.5 + (i / (text.length - 1)) * 0.5 : lineT
    const [r, g, b] = gradAt(stops, t)
    out += `${rgb(r, g, b)}${text[i]!}`
  }
  return out + RESET
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const SUNSET_GRAD: RGB[] = [
  [255, 180, 100],
  [240, 140, 80],
  [217, 119, 87],
  [193, 95, 60],
  [160, 75, 55],
  [130, 60, 50],
]

const ACCENT: RGB = [240, 148, 100]
const CREAM: RGB = [220, 195, 170]
const DIMCOL: RGB = [120, 100, 82]
const BORDER: RGB = [100, 80, 65]

// ─── Filled Block Text Logo ───────────────────────────────────────────────────

const LOGO_OPEN: string[] = []

const LOGO_CLAUDE = [
  `  ████████╗ ██╗      ████████╗ ██╗   ██╗ ████████╗ ████████╗`,
  `  ██╔═════╝ ██║      ██╔═══██║ ██║   ██║ ██╔═══██║ ██╔═════╝`,
  `  ██║       ██║      ████████║ ██║   ██║ ██║   ██║ ██████╗  `,
  `  ██║       ██║      ██╔═══██║ ██║   ██║ ██║   ██║ ██╔═══╝  `,
  `  ████████╗ ████████╗██║   ██║ ╚██████╔╝ ████████║ ████████╗`,
  `  ╚═══════╝ ╚═══════╝╚═╝   ╚═╝  ╚═════╝  ╚═══════╝ ╚═══════╝`,
]

// ─── Provider detection ────────────────────────────────────────────────────────

function isLocalUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('.local')
}

function detectProvider(): { name: string; model: string; baseUrl: string; isLocal: boolean } {
  const provider = getAPIProvider()

  switch (provider) {
    case 'bedrock':
      return {
        name: 'Amazon Bedrock',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://bedrock.amazonaws.com',
        isLocal: false,
      }
    case 'vertex':
      return {
        name: 'Google Vertex AI',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://vertexai.googleapis.com',
        isLocal: false,
      }
    case 'foundry':
      return {
        name: 'Microsoft Foundry',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://foundry.ai.azure.com',
        isLocal: false,
      }
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
      return {
        name: 'Anthropic',
        model: modelSetting,
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        isLocal: false,
      }
    }
  }
}

// ─── Box drawing ──────────────────────────────────────────────────────────────

function boxRow(content: string, width: number, rawLen: number): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${rgb(...BORDER)}│${RESET}${content}${' '.repeat(pad)}${rgb(...BORDER)}│${RESET}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function getStartupBannerMode(): string | null {
  // Env var takes precedence
  if (process.env.STARTUP_BANNER) {
    const envMode = normalizeStartupBannerMode(process.env.STARTUP_BANNER)
    if (envMode) return envMode
  }
  // Read startup banner mode from the global config file.
  try {
    const settingsPath = join(getClaudeConfigHomeDir(), STARTUP_BANNER_SETTINGS_FILENAME)
    if (existsSync(settingsPath)) {
      const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      return normalizeStartupBannerMode(data.mode)
    }
  } catch {}
  return null
}

export function printStartupScreen(): void {
  const mode = getStartupBannerMode()
  if (mode !== 'claude') return

  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const p = detectProvider()
  const W = 62
  const out: string[] = []

  out.push('')

  // Gradient logo
  const allLogo = [...LOGO_OPEN, '', ...LOGO_CLAUDE]
  const total = allLogo.length
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    if (allLogo[i] === '') {
      out.push('')
    } else {
      out.push(paintLine(allLogo[i]!, SUNSET_GRAD, t))
    }
  }

  out.push('')

  // Tagline
  out.push(`  ${rgb(...ACCENT)}✦${RESET} ${rgb(...CREAM)}Dream bigger. Think faster. Ship instantly.${RESET} ${rgb(...ACCENT)}✦${RESET}`)
  out.push('')

  // Provider info box
  out.push(`${rgb(...BORDER)}╔${'═'.repeat(W - 2)}╗${RESET}`)

  const lbl = (k: string, v: string, c: RGB = CREAM): [string, number] => {
    const padK = k.padEnd(9)
    return [` ${DIM}${rgb(...DIMCOL)}${padK}${RESET} ${rgb(...c)}${v}${RESET}`, ` ${padK} ${v}`.length]
  }

  const provC: RGB = p.isLocal ? [130, 175, 130] : ACCENT
  let [r, l] = lbl('Provider', p.name, provC)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Model', p.model)
  out.push(boxRow(r, W, l))
  const ep = p.baseUrl.length > 38 ? p.baseUrl.slice(0, 35) + '...' : p.baseUrl
  ;[r, l] = lbl('Endpoint', ep)
  out.push(boxRow(r, W, l))

  out.push(`${rgb(...BORDER)}╠${'═'.repeat(W - 2)}╣${RESET}`)

  const sC: RGB = p.isLocal ? [130, 175, 130] : ACCENT
  const sL = p.isLocal ? 'local' : 'cloud'
  const sRow = ` ${rgb(...sC)}●${RESET} ${DIM}${rgb(...DIMCOL)}${sL}${RESET}    ${DIM}${rgb(...DIMCOL)}Ready — type ${RESET}${rgb(...ACCENT)}/help${RESET}${DIM}${rgb(...DIMCOL)} to begin${RESET}`
  const sLen = ` ● ${sL}    Ready — type /help to begin`.length
  out.push(boxRow(sRow, W, sLen))

  out.push(`${rgb(...BORDER)}╚${'═'.repeat(W - 2)}╝${RESET}`)
  out.push(`  ${DIM}${rgb(...DIMCOL)}claude ${RESET}${rgb(...ACCENT)}v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}${RESET}`)
  out.push('')

  process.stdout.write(out.join('\n') + '\n')
}
