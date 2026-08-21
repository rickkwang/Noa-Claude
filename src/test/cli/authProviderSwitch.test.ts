import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function runOAuthInstallScenario(
  logoutTiming: 'none' | 'after' | 'during',
  settingsModel = 'claude-opus-4-1',
) {
  const configDir = mkdtempSync(join(tmpdir(), 'noa-auth-provider-switch-'))
  try {
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        model: settingsModel,
        env: {
          ANTHROPIC_BASE_URL: 'https://api.minimax.test',
          ANTHROPIC_AUTH_TOKEN: 'minimax-token',
          ANTHROPIC_MODEL: 'MiniMax-M3',
        },
      }),
    )
    writeFileSync(join(configDir, '.config.json'), '{}\n')
    writeFileSync(
      join(configDir, 'provider-profiles.json'),
      JSON.stringify([
        {
          id: 'minimax-test',
          name: 'MiniMax',
          type: 'minimax',
          active: true,
          baseUrl: 'https://api.minimax.test',
          apiKey: 'minimax-token',
          model: 'MiniMax-M3',
        },
      ]),
    )

    const script = `
      import { mock } from 'bun:test'
      import { readFileSync } from 'fs'

      mock.module('./src/services/api/firstTokenDate.js', () => ({
        fetchAndStoreClaudeCodeFirstTokenDate: async () => {
          if (${JSON.stringify(logoutTiming)} === 'during') await Bun.sleep(100)
        },
      }))
      mock.module('axios', () => ({
        default: {
          get: async () => ({
            status: 200,
            statusText: 'OK',
            data: { organization_role: 'user', workspace_role: 'user' },
          }),
          post: async () => { throw new Error('not used') },
        },
      }))
      let secureStorageData = {}
      mock.module('./src/utils/secureStorage/index.js', () => ({
        getSecureStorage: () => ({
          name: 'test-storage',
          read: () => secureStorageData,
          readAsync: async () => secureStorageData,
          update: next => {
            secureStorageData = next
            return { success: true }
          },
          delete: () => {
            secureStorageData = {}
            return { success: true }
          },
        }),
      }))
      mock.module('./src/utils/telemetry/instrumentation.js', () => ({
        flushTelemetry: async () => {},
      }))

      const { enableConfigs } = await import('./src/utils/config.ts')
      enableConfigs()
      const { installOAuthTokens } = await import('./src/cli/handlers/auth.ts')
      const installPromise = installOAuthTokens({
        accessToken: 'oauth-access-token',
        refreshToken: 'oauth-refresh-token',
        expiresAt: Date.now() + 60_000,
        scopes: ['user:inference'],
        subscriptionType: 'pro',
        rateLimitTier: null,
      })
      if (${JSON.stringify(logoutTiming)} === 'during') {
        await Bun.sleep(30)
        const { performLogout } = await import('./src/commands/logout/logout.tsx')
        await performLogout({ clearOnboarding: false })
      }
      await installPromise
      if (${JSON.stringify(logoutTiming)} === 'after') {
        const { performLogout } = await import('./src/commands/logout/logout.tsx')
        await performLogout({ clearOnboarding: false })
      }

      const profiles = JSON.parse(
        readFileSync(process.env.CLAUDE_CONFIG_DIR + '/provider-profiles.json', 'utf8'),
      )
      const globalConfig = JSON.parse(
        readFileSync(process.env.CLAUDE_CONFIG_DIR + '/.config.json', 'utf8'),
      )
      const settings = JSON.parse(
        readFileSync(process.env.CLAUDE_CONFIG_DIR + '/settings.json', 'utf8'),
      )
      console.log(JSON.stringify({
        profileActive: profiles[0].active,
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
        authToken: process.env.ANTHROPIC_AUTH_TOKEN ?? null,
        model: process.env.ANTHROPIC_MODEL ?? null,
        launcherProvider: globalConfig.launcherProvider ?? null,
        settingsModel: settings.model ?? null,
        providerEnvKeys: Object.keys(settings.env ?? {}).filter(
          key => key.startsWith('ANTHROPIC_') || key.startsWith('OPENAI_'),
        ),
        hasStoredOauth: secureStorageData.claudeAiOauth !== undefined,
      }))
    `
    const result = spawnSync('bun', ['--eval', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: undefined,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_PRODUCT_DIR: configDir,
        ANTHROPIC_BASE_URL: 'https://api.minimax.test',
        ANTHROPIC_AUTH_TOKEN: 'minimax-token',
        ANTHROPIC_MODEL: 'MiniMax-M3',
      } as NodeJS.ProcessEnv,
    })

    if (result.status !== 0) throw new Error(result.stderr)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

describe('shared OAuth credential installation', () => {
  test('deactivates a third-party profile and persists Anthropic launcher routing', () => {
    expect(runOAuthInstallScenario('none')).toEqual({
      profileActive: false,
      baseUrl: null,
      authToken: null,
      model: null,
      launcherProvider: 'anthropic',
      settingsModel: 'claude-opus-4-1',
      providerEnvKeys: [],
      hasStoredOauth: true,
    })
  })

  test('logout restores the explicit product-default launcher route', () => {
    expect(runOAuthInstallScenario('after').launcherProvider).toBe('product-default')
  })

  test('clears a persisted model that belongs to the deactivated provider', () => {
    expect(runOAuthInstallScenario('none', 'MiniMax-M3').settingsModel).toBeNull()
  })

  test('clears a non-default model selected on the deactivated provider', () => {
    expect(
      runOAuthInstallScenario('none', 'MiniMax-M3-highspeed').settingsModel,
    ).toBeNull()
  })

  test('serializes concurrent login and logout transitions', () => {
    const result = runOAuthInstallScenario('during')
    expect(result.launcherProvider).toBe('product-default')
    expect(result.hasStoredOauth).toBe(false)
  })
})
