import { basename } from 'path'

const KNOWN_COMMANDS = new Set(['claude-agent', 'claude-code', 'claude'])

function normalizeCandidate(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const base = basename(raw).replace(/\.(cjs|mjs|js)$/i, '').trim()
  if (!base) return undefined
  if (KNOWN_COMMANDS.has(base)) return base
  // npm/global wrappers often execute *claude-agent*/*claude-code* scripts by path.
  if (base.includes('claude-agent')) return 'claude-agent'
  if (base.includes('claude-code')) return 'claude-code'
  if (base === 'claude') return 'claude'
  return undefined
}

export function getPreferredCliCommandName(): string {
  return (
    normalizeCandidate(process.env.CLAUDE_CLI_NAME) ??
    normalizeCandidate(process.argv[1]) ??
    normalizeCandidate(process.argv[0]) ??
    'claude-agent'
  )
}
