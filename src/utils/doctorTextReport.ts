// Rendering for the `noa doctor` terminal subcommand.
// Plain text for every context: a terminal, a pipe, `noa doctor > issue.txt`.
//
// This replaced an Ink screen, which needed a TTY to render at all: Ink puts
// stdin in raw mode, so in a pipe it threw "Raw mode is not supported" and
// printed a stack trace INSTEAD of the diagnostics while still exiting 0 —
// silently useless in exactly the scripted and paste-into-an-issue contexts
// people reach for when something is broken. It also blocked on a keypress.
//
// Every section the old Ink screen rendered is collected here instead, because
// each underlying source turned out to have a plain module entry point — agent
// definitions, plugins, sandbox, keybindings, MCP config parsing, and even the
// permission context all load without React. The one thing this cannot do is
// measure MCP tool-schema cost, which needs live MCP connections that `noa
// doctor` deliberately no longer opens; `/context` reports that in a session.
//
// Collection and formatting are split so the summary-line invariant can be
// tested against synthetic inputs instead of whatever the dev machine happens
// to be installed like.
import type { DiagnosticInfo } from './doctorDiagnostic.js'
import { getDoctorDiagnostic } from './doctorDiagnostic.js'
import { getSettingsWithAllErrors } from './settings/allErrors.js'
import { getInitialSettings } from './settings/settings.js'
import {
  getAllLockInfo,
  isPidBasedLockingEnabled,
  type LockInfo,
} from './nativeInstaller/pidLock.js'
import { validateBoundedIntEnvVar } from './envValidation.js'
import {
  BASH_MAX_OUTPUT_DEFAULT,
  BASH_MAX_OUTPUT_UPPER_LIMIT,
} from './shell/outputLimits.js'
import {
  TASK_MAX_OUTPUT_DEFAULT,
  TASK_MAX_OUTPUT_UPPER_LIMIT,
} from './task/outputFormatting.js'
import { getXDGStateHome } from './xdg.js'
import { getPlatform } from './platform.js'
import { join } from 'path'
import { getCwd } from './cwd.js'
import { getAgentDefinitionsWithOverrides } from '../tools/AgentTool/loadAgentsDir.js'
import { loadAllPlugins } from './plugins/pluginLoader.js'
import { getPluginErrorMessage } from '../types/plugin.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { loadKeybindingsSyncWithWarnings } from '../keybindings/loadUserBindings.js'
import { getMcpConfigsByScope } from '../services/mcp/config.js'
import { checkContextWarnings } from './doctorContextWarnings.js'
import { initializeToolPermissionContext } from './permissions/permissionSetup.js'

export type DoctorReportInput = {
  diagnostic: DiagnosticInfo
  autoUpdatesChannel: string
  /** Files whose settings failed to parse/validate, excluding MCP-sourced errors. */
  invalidSettingsFiles: string[]
  envVarIssues: Array<{ name: string; message: string }>
  locks: LockInfo[]
  /** Agent definition files that carry a `name` but fail to load. */
  agentParseErrors: Array<{ path: string; error: string }>
  pluginErrors: string[]
  sandbox: { status: string; details: string[] } | null
  keybindingWarnings: string[]
  mcpConfigErrors: Array<{ scope: string; message: string }>
  contextWarnings: Array<{ message: string; details: string[] }>
  /**
   * Checks whose collector threw. A diagnostic that silently omits a check it
   * could not run reports a clean bill of health it did not earn, so these are
   * named in the body and counted like any other issue.
   */
  failedChecks: Array<{ check: string; error: string }>
}

export type DoctorTextReport = { text: string; issueCount: number }

const ENV_VARS_CHECKED = [
  {
    name: 'BASH_MAX_OUTPUT_LENGTH',
    default: BASH_MAX_OUTPUT_DEFAULT,
    upperLimit: BASH_MAX_OUTPUT_UPPER_LIMIT,
  },
  {
    name: 'TASK_MAX_OUTPUT_LENGTH',
    default: TASK_MAX_OUTPUT_DEFAULT,
    upperLimit: TASK_MAX_OUTPUT_UPPER_LIMIT,
  },
] as const

export function formatDoctorTextReport(
  input: DoctorReportInput,
): DoctorTextReport {
  const { diagnostic } = input
  // Every issue source funnels through this list, so the summary line can never
  // disagree with the body above it.
  const issues: string[] = []
  const lines: string[] = []

  lines.push('Noa Claude doctor', '')
  lines.push(`Running: ${diagnostic.installationType} (${diagnostic.version})`)
  lines.push(`Platform: ${getPlatform()}-${process.arch}`)
  if (diagnostic.packageManager) {
    lines.push(`Package manager: ${diagnostic.packageManager}`)
  }
  lines.push(`Path: ${diagnostic.installationPath}`)
  lines.push(`Invoked: ${diagnostic.invokedBinary}`)
  lines.push(`Config install method: ${diagnostic.configInstallMethod}`)
  // Mirror the interactive screen's mode→label mapping exactly; the two
  // surfaces disagreeing about the same field is its own bug report.
  const searchMode =
    diagnostic.ripgrepStatus.mode === 'embedded'
      ? 'bundled'
      : diagnostic.ripgrepStatus.mode === 'builtin'
        ? 'vendor'
        : diagnostic.ripgrepStatus.systemPath || 'system'
  lines.push(
    `Search: ${diagnostic.ripgrepStatus.working ? 'OK' : 'Not working'} (${searchMode})`,
  )

  lines.push(
    `Auto-updates: ${diagnostic.packageManager ? 'Managed by package manager' : diagnostic.autoUpdates}`,
  )
  if (diagnostic.hasUpdatePermissions !== null) {
    lines.push(
      `Update permissions: ${diagnostic.hasUpdatePermissions ? 'Yes' : 'No (requires sudo)'}`,
    )
  }
  lines.push(`Auto-update channel: ${input.autoUpdatesChannel}`)

  if (!diagnostic.ripgrepStatus.working) {
    issues.push(
      diagnostic.ripgrepStatus.mode === 'system'
        ? `ripgrep is not working at ${diagnostic.ripgrepStatus.systemPath ?? 'system path'}`
        : 'ripgrep fallback is active; file search may be degraded',
    )
  }
  if (diagnostic.hasUpdatePermissions === false) {
    issues.push('No write permissions for auto-updates (requires sudo)')
  }

  if (diagnostic.multipleInstallations.length > 1) {
    lines.push('')
    lines.push('Warning: Multiple installations found')
    for (const install of diagnostic.multipleInstallations) {
      lines.push(`  ${install.type} at ${install.path}`)
    }
    issues.push(
      `${diagnostic.multipleInstallations.length} installations found`,
    )
  }

  for (const warning of diagnostic.warnings) {
    lines.push('')
    lines.push(`Warning: ${warning.issue}`)
    lines.push(`Fix: ${warning.fix}`)
    issues.push(warning.issue)
  }

  if (input.invalidSettingsFiles.length > 0) {
    lines.push('')
    lines.push('Invalid Settings')
    for (const file of input.invalidSettingsFiles) {
      lines.push(`  ${file} (ignored)`)
      issues.push(`${file} failed to parse or validate and is being ignored`)
    }
  }

  if (input.envVarIssues.length > 0) {
    lines.push('')
    lines.push('Environment Variables')
    for (const issue of input.envVarIssues) {
      lines.push(`  ${issue.name}: ${issue.message}`)
      issues.push(`${issue.name}: ${issue.message}`)
    }
  }

  if (input.locks.length > 0) {
    lines.push('')
    lines.push('Version Locks')
    for (const lock of input.locks) {
      lines.push(
        `  ${lock.version}: PID ${lock.pid} ${lock.isProcessRunning ? '(running)' : '(stale)'}`,
      )
    }
  }

  if (input.mcpConfigErrors.length > 0) {
    lines.push('')
    lines.push('MCP Config Errors')
    for (const err of input.mcpConfigErrors) {
      lines.push(`  ${err.scope}: ${err.message}`)
      issues.push(`MCP config (${err.scope}): ${err.message}`)
    }
  }

  if (input.agentParseErrors.length > 0) {
    lines.push('')
    lines.push('Agent Parse Errors')
    for (const failure of input.agentParseErrors) {
      lines.push(`  ${failure.path}: ${failure.error}`)
      issues.push(`Agent definition failed to load: ${failure.path}`)
    }
  }

  if (input.pluginErrors.length > 0) {
    lines.push('')
    lines.push('Plugin Errors')
    for (const error of input.pluginErrors) {
      lines.push(`  ${error}`)
      issues.push(`Plugin error: ${error}`)
    }
  }

  if (input.keybindingWarnings.length > 0) {
    lines.push('')
    lines.push('Keybinding Warnings')
    for (const warning of input.keybindingWarnings) {
      lines.push(`  ${warning}`)
      issues.push(`Keybinding: ${warning}`)
    }
  }

  if (input.sandbox) {
    lines.push('')
    lines.push(`Sandbox: ${input.sandbox.status}`)
    for (const detail of input.sandbox.details) {
      lines.push(`  ${detail}`)
      issues.push(`Sandbox: ${detail}`)
    }
  }

  if (input.contextWarnings.length > 0) {
    lines.push('')
    lines.push('Context Usage Warnings')
    for (const warning of input.contextWarnings) {
      lines.push(`  ${warning.message}`)
      for (const detail of warning.details) {
        lines.push(`    ${detail}`)
      }
      issues.push(`Context: ${warning.message}`)
    }
  }

  if (input.failedChecks.length > 0) {
    lines.push('')
    lines.push('Checks that could not run')
    for (const failure of input.failedChecks) {
      lines.push(`  ${failure.check}: ${failure.error}`)
      issues.push(`${failure.check} could not be checked: ${failure.error}`)
    }
  }

  lines.push('')
  lines.push(
    issues.length === 0
      ? 'No installation issues found.'
      : `${issues.length} installation issue(s) found.`,
  )
  lines.push('')
  lines.push(
    'MCP servers are not started here; run /context in a session to measure MCP tool context cost.',
  )
  lines.push(
    'For a full setup checkup that can also fix issues, run /doctor in a Noa Claude session.',
  )

  return { text: lines.join('\n') + '\n', issueCount: issues.length }
}

function collectEnvVarIssues(): Array<{ name: string; message: string }> {
  const issues: Array<{ name: string; message: string }> = []
  for (const v of ENV_VARS_CHECKED) {
    const raw = process.env[v.name]
    if (raw === undefined) continue
    const result = validateBoundedIntEnvVar(v.name, raw, v.default, v.upperLimit)
    if (result.status === 'valid' || result.message === undefined) continue
    issues.push({ name: v.name, message: result.message })
  }
  return issues
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function renderDoctorTextReport(): Promise<DoctorTextReport> {
  const diagnostic = await getDoctorDiagnostic()
  const failedChecks: Array<{ check: string; error: string }> = []
  const recordFailure = (check: string) => (error: unknown) => {
    failedChecks.push({ check, error: describeError(error) })
    return null
  }

  // MCP config errors carry `mcpErrorMetadata` and are reported separately by
  // collectMcpConfigErrors() from the MCP config sources; dropping them here
  // keeps the same finding from being counted twice.
  const { errors: settingsErrors } = getSettingsWithAllErrors()
  const invalidSettingsFiles = Array.from(
    new Set(
      settingsErrors
        .filter(error => error.mcpErrorMetadata === undefined)
        .map(error => error.file)
        .filter((file): file is string => file !== undefined),
    ),
  )

  // Unlike the interactive screen, this path does NOT call cleanupStaleLocks():
  // a piped or CI invocation should report state, not silently delete the
  // user's update locks as a side effect of being read.
  const locks = isPidBasedLockingEnabled()
    ? getAllLockInfo(join(getXDGStateHome(), 'claude', 'locks'))
    : []

  // Each of these has a plain module entry point, so the report loses nothing
  // by not running inside a React tree. Failures are contained per source: a
  // wedged plugin loader must not take the installation diagnostics down with
  // it, since that is the part someone reaches for when things are broken.
  const [agentInfo, pluginErrors, contextWarnings] = await Promise.all([
    getAgentDefinitionsWithOverrides(getCwd()).catch(
      recordFailure('Agent definitions'),
    ),
    loadAllPlugins()
      .then(result =>
        (result.errors ?? []).map(
          error =>
            `${error.source || 'unknown'}${'plugin' in error && error.plugin ? ` [${error.plugin}]` : ''}: ${getPluginErrorMessage(error)}`,
        ),
      )
      .catch(recordFailure('Plugins')),
    collectContextWarnings(failedChecks),
  ])

  return formatDoctorTextReport({
    diagnostic,
    autoUpdatesChannel: getInitialSettings()?.autoUpdatesChannel ?? 'latest',
    invalidSettingsFiles,
    envVarIssues: collectEnvVarIssues(),
    locks,
    agentParseErrors: [...(agentInfo?.failedFiles ?? [])],
    pluginErrors: pluginErrors ?? [],
    sandbox: collectSandboxStatus(failedChecks),
    keybindingWarnings: collectKeybindingWarnings(failedChecks),
    mcpConfigErrors: collectMcpConfigErrors(),
    contextWarnings: contextWarnings ?? [],
    failedChecks,
  })
}

function collectMcpConfigErrors(): Array<{ scope: string; message: string }> {
  const scopes = ['user', 'project', 'local', 'enterprise'] as const
  const errors: Array<{ scope: string; message: string }> = []
  for (const scope of scopes) {
    try {
      for (const error of getMcpConfigsByScope(scope).errors ?? []) {
        errors.push({ scope, message: error.message ?? String(error) })
      }
    } catch (error) {
      errors.push({ scope, message: `could not be read (${String(error)})` })
    }
  }
  return errors
}

function collectKeybindingWarnings(
  failedChecks: Array<{ check: string; error: string }>,
): string[] {
  try {
    return loadKeybindingsSyncWithWarnings().warnings.map(
      warning => warning.message ?? String(warning),
    )
  } catch (error) {
    failedChecks.push({ check: 'Keybindings', error: describeError(error) })
    return []
  }
}

function collectSandboxStatus(
  failedChecks: Array<{ check: string; error: string }>,
): { status: string; details: string[] } | null {
  try {
    if (!SandboxManager.isSandboxEnabledInSettings()) {
      return null
    }
    if (!SandboxManager.isSupportedPlatform()) {
      return { status: 'Not supported on this platform', details: [] }
    }
    const check = SandboxManager.checkDependencies()
    const errors = check.errors ?? []
    return errors.length > 0
      ? { status: 'Missing dependencies', details: errors.map(String) }
      : { status: 'Available', details: [] }
  } catch (error) {
    failedChecks.push({ check: 'Sandbox', error: describeError(error) })
    return null
  }
}

async function collectContextWarnings(
  failedChecks: Array<{ check: string; error: string }>,
): Promise<Array<{ message: string; details: string[] }>> {
  try {
    const agentInfo = await getAgentDefinitionsWithOverrides(getCwd())
    // CLI overrides are irrelevant to a diagnostic run: what matters is the
    // rule set the user's settings produce. Tools are passed empty because the
    // MCP-cost check needs live connections this command no longer opens.
    const { toolPermissionContext } = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      permissionMode: 'default',
      allowDangerouslySkipPermissions: false,
      addDirs: [],
    })
    const warnings = await checkContextWarnings(
      [],
      agentInfo,
      async () => toolPermissionContext,
    )
    return [
      warnings.claudeMdWarning,
      warnings.agentWarning,
      warnings.unreachableRulesWarning,
    ]
      .filter(warning => warning !== null)
      .map(warning => ({
        message: warning.message,
        details: warning.details ?? [],
      }))
  } catch (error) {
    failedChecks.push({
      check: 'Context and permission rules',
      error: describeError(error),
    })
    return []
  }
}
