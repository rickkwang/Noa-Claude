import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

// applySafeConfigEnvironmentVariables reads settings from disk and mutates
// process.env, so each case runs in a fresh subprocess with CLAUDE_CONFIG_DIR
// pointed at a temp dir. spawnSync inherits the parent env — the scripts
// scrub every ambient key that could leak into an assertion.
const STALE_ENV = {
  ANTHROPIC_BASE_URL: 'https://stale-provider.example',
  ANTHROPIC_AUTH_TOKEN: 'stale-token',
  ANTHROPIC_MODEL: 'stale-model',
  NOA_TEST_SETTINGS_MARKER: 'kept',
}

const SCRUB = `
  delete process.env.CLAUDE_CODE_ENTRYPOINT
  delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  delete process.env.ANTHROPIC_UNIX_SOCKET
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_MODEL
  delete process.env.NOA_TEST_SETTINGS_MARKER
`

function run(script: string): void {
  const result = spawnSync('bun', ['--eval', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  // stderr is the failure message, not an assertion: the script signals
  // failure by throwing (non-zero status), and asserting it is empty breaks on
  // any unrelated warning bun decides to print.
  if (result.status !== 0) throw new Error(result.stderr)
  expect(result.status).toBe(0)
}

describe('settings env under --bare', () => {
  test('strips provider/auth/model vars from file-sourced settings env', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-bare-settings-env-'))
    try {
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({ env: STALE_ENV }),
      )

      run(`
        process.argv.push('--bare')
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        ${SCRUB}

        const { applySafeConfigEnvironmentVariables } =
          await import('./src/utils/managedEnv.ts')
        applySafeConfigEnvironmentVariables()

        // Persisted profile env (persistProviderEnvToUserSettings writes
        // exactly these keys) must not reroute a bare session.
        if (process.env.ANTHROPIC_BASE_URL !== undefined) {
          throw new Error('settings.env ANTHROPIC_BASE_URL leaked into bare mode')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== undefined) {
          throw new Error('settings.env ANTHROPIC_AUTH_TOKEN leaked into bare mode')
        }
        if (process.env.ANTHROPIC_MODEL !== undefined) {
          throw new Error('settings.env ANTHROPIC_MODEL leaked into bare mode')
        }
        // Non-provider settings.env vars still apply under bare.
        if (process.env.NOA_TEST_SETTINGS_MARKER !== 'kept') {
          throw new Error('non-provider settings.env var was stripped')
        }
      `)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('still applies settings env outside bare mode', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-settings-env-'))
    try {
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({ env: STALE_ENV }),
      )

      run(`
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        ${SCRUB}

        const { applySafeConfigEnvironmentVariables } =
          await import('./src/utils/managedEnv.ts')
        applySafeConfigEnvironmentVariables()

        // Asserted synchronously: the void applyActiveProviderProfileEnv()
        // at the end of the apply deletes these keys, but only after its
        // async profile-file read resolves — sync code runs first.
        if (process.env.ANTHROPIC_BASE_URL !== 'https://stale-provider.example') {
          throw new Error('settings.env ANTHROPIC_BASE_URL not applied')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== 'stale-token') {
          throw new Error('settings.env ANTHROPIC_AUTH_TOKEN not applied')
        }
        if (process.env.ANTHROPIC_MODEL !== 'stale-model') {
          throw new Error('settings.env ANTHROPIC_MODEL not applied')
        }
      `)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('--settings env stays a deliberate channel under --bare', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-bare-flag-settings-'))
    try {
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({ env: STALE_ENV }),
      )
      const flagSettingsPath = join(configDir, 'flag-settings.json')
      writeFileSync(
        flagSettingsPath,
        JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'https://flag-deliberate.example',
            ANTHROPIC_AUTH_TOKEN: 'flag-token',
          },
        }),
      )

      run(`
        process.argv.push('--bare')
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        ${SCRUB}

        const { setFlagSettingsPath } =
          await import('./src/bootstrap/state.ts')
        setFlagSettingsPath(${JSON.stringify(flagSettingsPath)})

        const { applySafeConfigEnvironmentVariables } =
          await import('./src/utils/managedEnv.ts')
        applySafeConfigEnvironmentVariables()

        // flagSettings is exempt from the bare strip, and wins over the
        // (stripped) userSettings value.
        if (process.env.ANTHROPIC_BASE_URL !== 'https://flag-deliberate.example') {
          throw new Error('--settings ANTHROPIC_BASE_URL not honoured under bare')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== 'flag-token') {
          throw new Error('--settings ANTHROPIC_AUTH_TOKEN not honoured under bare')
        }
        // Only present in userSettings, which is stripped under bare.
        if (process.env.ANTHROPIC_MODEL !== undefined) {
          throw new Error('userSettings ANTHROPIC_MODEL leaked into bare mode')
        }
      `)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
