// @ts-nocheck
import { isEnvTruthy } from './envUtils.js'

type DebugDiagnosticsOptions = {
  includeLauncherDebug?: boolean
}

function formatDiagnosticError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isDebugDiagnosticsEnabled(
  options?: DebugDiagnosticsOptions,
): boolean {
  return (
    (options?.includeLauncherDebug === true &&
      isEnvTruthy(process.env.CLAUDE_CODE_LAUNCHER_DEBUG)) ||
    isEnvTruthy(process.env.DEBUG) ||
    isEnvTruthy(process.env.DEBUG_SDK) ||
    process.argv.includes('--debug') ||
    process.argv.includes('-d') ||
    process.argv.includes('--debug-to-stderr') ||
    process.argv.includes('-d2e') ||
    process.argv.some(arg => arg.startsWith('--debug=')) ||
    process.argv.some(
      arg => arg === '--debug-file' || arg.startsWith('--debug-file='),
    )
  )
}

export function logDebugDiagnosticWarn(
  moduleName: string,
  message: string,
  error?: unknown,
  options?: DebugDiagnosticsOptions,
): void {
  if (!isDebugDiagnosticsEnabled(options)) return
  const details = error === undefined ? '' : `: ${formatDiagnosticError(error)}`
  process.stderr.write(
    `${new Date().toISOString()} [WARN] [${moduleName}] ${message}${details}\n`,
  )
}
