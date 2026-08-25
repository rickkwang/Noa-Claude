import { describe, expect, test } from 'bun:test'
import {
  formatDoctorTextReport,
  type DoctorReportInput,
} from '../../utils/doctorTextReport.js'

function healthyInput(
  overrides: Partial<DoctorReportInput> = {},
): DoctorReportInput {
  return {
    diagnostic: {
      installationType: 'native',
      version: '1.10.0',
      installationPath: '/home/u/.local/share/noa',
      invokedBinary: '/home/u/.local/bin/noa',
      configInstallMethod: 'native',
      autoUpdates: 'enabled',
      hasUpdatePermissions: true,
      multipleInstallations: [{ type: 'native', path: '/home/u/.local/bin/noa' }],
      warnings: [],
      ripgrepStatus: { working: true, mode: 'embedded', systemPath: null },
    },
    autoUpdatesChannel: 'latest',
    invalidSettingsFiles: [],
    envVarIssues: [],
    locks: [],
    agentParseErrors: [],
    pluginErrors: [],
    sandbox: null,
    keybindingWarnings: [],
    mcpConfigErrors: [],
    contextWarnings: [],
    failedChecks: [],
    ...overrides,
  }
}

// The whole point of the summary line is that a reader can trust it without
// re-reading the body, so these pin the invariant rather than the prose.
describe('formatDoctorTextReport', () => {
  test('a clean install reports no issues and no warnings', () => {
    const { text, issueCount } = formatDoctorTextReport(healthyInput())

    expect(issueCount).toBe(0)
    expect(text).toContain('No installation issues found.')
    expect(text).not.toContain('Warning:')
  })

  test('counts every issue source, not just the first', () => {
    const { text, issueCount } = formatDoctorTextReport(
      healthyInput({
        diagnostic: {
          ...healthyInput().diagnostic,
          hasUpdatePermissions: false,
          ripgrepStatus: { working: false, mode: 'system', systemPath: '/bin/rg' },
          multipleInstallations: [
            { type: 'native', path: '/home/u/.local/bin/noa' },
            { type: 'npm-global', path: '/usr/local/bin/noa' },
          ],
          warnings: [{ issue: 'Leftover npm local installation', fix: 'Remove it' }],
        },
        invalidSettingsFiles: ['/home/u/.noa/settings.json'],
        envVarIssues: [{ name: 'BASH_MAX_OUTPUT_LENGTH', message: 'Invalid value' }],
        agentParseErrors: [{ path: '.noa/agents/x.md', error: 'missing description' }],
        pluginErrors: ['marketplace: failed to load'],
        sandbox: { status: 'Missing dependencies', details: ['bwrap not found'] },
        keybindingWarnings: ['unknown action "foo"'],
        mcpConfigErrors: [{ scope: 'project', message: 'failed to parse' }],
        contextWarnings: [{ message: 'Large agent descriptions', details: ['a: 1k'] }],
      }),
    )

    // ripgrep + update permissions + multiple installs + warning + settings + env
    // + mcp config + agent + plugin + keybinding + sandbox + context
    expect(issueCount).toBe(12)
    expect(text).toContain('12 installation issue(s) found.')
    expect(text).not.toContain('No installation issues found.')
  })

  test('a check that could not run is reported, never silently omitted', () => {
    // The failure mode this guards: a collector throws, its section is simply
    // absent, and the summary line calls the install clean — a green report
    // earned by not running the check.
    const { text, issueCount } = formatDoctorTextReport(
      healthyInput({
        failedChecks: [
          { check: 'Sandbox', error: 'runtime module missing' },
          { check: 'Plugins', error: 'ENOENT' },
        ],
      }),
    )

    expect(issueCount).toBe(2)
    expect(text).toContain('Checks that could not run')
    expect(text).toContain('Sandbox: runtime module missing')
    expect(text).toContain('Plugins: ENOENT')
    expect(text).not.toContain('No installation issues found.')
  })

  test('never claims a clean bill of health while printing warnings', () => {
    const { text } = formatDoctorTextReport(
      healthyInput({
        diagnostic: {
          ...healthyInput().diagnostic,
          warnings: [{ issue: 'Native install missing from PATH', fix: 'Add it' }],
        },
      }),
    )

    expect(text).toContain('Warning:')
    expect(text).not.toContain('No installation issues found.')
  })

  test('mirrors the interactive screen\'s search-mode labels', () => {
    const modes = [
      ['embedded', 'bundled'],
      ['builtin', 'vendor'],
    ] as const

    for (const [mode, label] of modes) {
      const { text } = formatDoctorTextReport(
        healthyInput({
          diagnostic: {
            ...healthyInput().diagnostic,
            ripgrepStatus: { working: true, mode, systemPath: null },
          },
        }),
      )
      expect(text).toContain(`Search: OK (${label})`)
    }

    const { text } = formatDoctorTextReport(
      healthyInput({
        diagnostic: {
          ...healthyInput().diagnostic,
          ripgrepStatus: { working: true, mode: 'system', systemPath: '/bin/rg' },
        },
      }),
    )
    expect(text).toContain('Search: OK (/bin/rg)')
  })

  test('reports the fields a pasted bug report needs', () => {
    const { text } = formatDoctorTextReport(healthyInput())

    for (const field of [
      'Running:',
      'Platform:',
      'Path:',
      'Invoked:',
      'Config install method:',
      'Search:',
      'Auto-updates:',
      'Auto-update channel:',
    ]) {
      expect(text).toContain(field)
    }
    expect(text.endsWith('\n')).toBe(true)
  })

  test('points at the checks this path cannot cover', () => {
    const { text } = formatDoctorTextReport(healthyInput())

    // The one check this path cannot run is MCP tool-schema cost, which needs
    // live connections; saying so keeps a clean report honest.
    expect(text).toContain('run /context in a session to measure MCP tool context cost')
    expect(text).toContain('run /doctor in a Noa Claude session.')
  })
})
