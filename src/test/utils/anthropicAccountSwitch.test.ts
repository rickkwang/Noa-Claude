import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Exercises the /provider "back to Anthropic" row end to end: a live process
 * with a third-party profile applied, switched back without going through
 * /login. Run in a child process because the transition mutates process.env,
 * the config dir and module-level config caches.
 */
function runAnthropicSwitch({ settingsModel }: { settingsModel: string }) {
  const configDir = mkdtempSync(join(tmpdir(), 'noa-anthropic-switch-'))
  try {
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        model: settingsModel,
        env: {
          ANTHROPIC_BASE_URL: 'https://api.minimax.test',
          ANTHROPIC_AUTH_TOKEN: 'minimax-token',
          ANTHROPIC_MODEL: 'MiniMax-M3',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M3',
          // The model catalogue keys are the ones a prefix-filtered assertion
          // misses: left behind, /model keeps offering the third party's models
          // after the session has moved back to Anthropic.
          NOA_CLAUDE_PROVIDER_MODELS: 'MiniMax-M3,MiniMax-M2.7',
          NOA_CLAUDE_PROVIDER_CONTEXT_WINDOWS: 'MiniMax-M3=1048576',
          // Not written by any profile — a handwritten entry that must survive.
          HANDWRITTEN_KEY: 'keep-me',
        },
      }),
    )
    // launcherProvider omitted on purpose: the product default is what a
    // profile-routed install carries, and the switch has to overwrite it.
    writeFileSync(
      join(configDir, '.config.json'),
      JSON.stringify({
        oauthAccount: {
          accountUuid: 'account-uuid',
          emailAddress: 'user@example.test',
        },
      }),
    )
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
      import { readFileSync } from 'fs'
      const { enableConfigs } = await import('./src/utils/config.ts')
      enableConfigs()
      const { switchToAnthropicAccount } = await import('./src/utils/providerProfile.ts')
      await switchToAnthropicAccount()

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
        launcherProvider: globalConfig.launcherProvider ?? null,
        settingsModel: settings.model ?? null,
        // Whole object, not a prefixed subset: a filter narrow enough to skip
        // the catalogue keys is also blind to a clear that ate unrelated ones.
        settingsEnv: settings.env ?? {},
        processEnv: Object.fromEntries(
          [
            'ANTHROPIC_BASE_URL',
            'ANTHROPIC_AUTH_TOKEN',
            'ANTHROPIC_MODEL',
            'ANTHROPIC_DEFAULT_OPUS_MODEL',
            'NOA_CLAUDE_PROVIDER_MODELS',
            'NOA_CLAUDE_PROVIDER_CONTEXT_WINDOWS',
          ].map(key => [key, process.env[key] ?? null]),
        ),
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
        // What the launcher hands a profile-routed session: settings.env
        // already applied to the process.
        ANTHROPIC_BASE_URL: 'https://api.minimax.test',
        ANTHROPIC_AUTH_TOKEN: 'minimax-token',
        ANTHROPIC_MODEL: 'MiniMax-M3',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M3',
        NOA_CLAUDE_PROVIDER_MODELS: 'MiniMax-M3,MiniMax-M2.7',
        NOA_CLAUDE_PROVIDER_CONTEXT_WINDOWS: 'MiniMax-M3=1048576',
      } as NodeJS.ProcessEnv,
    })

    if (result.status !== 0) throw new Error(result.stderr)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

describe('switching back to the Anthropic account', () => {
  test('clears the profile from this process and the next launch', () => {
    expect(runAnthropicSwitch({ settingsModel: 'claude-opus-4-1' })).toEqual({
      profileActive: false,
      launcherProvider: 'anthropic',
      settingsModel: 'claude-opus-4-1',
      // Routing, tier pins and the model catalogue go; the handwritten entry
      // stays. Clearing by value-match rather than by key list is what makes
      // the difference, so assert both halves.
      settingsEnv: { HANDWRITTEN_KEY: 'keep-me' },
      // The whole point of the row: routing is gone from the live process too,
      // so the session falls through to the OAuth tokens already in storage
      // instead of requiring /login.
      processEnv: {
        ANTHROPIC_BASE_URL: null,
        ANTHROPIC_AUTH_TOKEN: null,
        ANTHROPIC_MODEL: null,
        ANTHROPIC_DEFAULT_OPUS_MODEL: null,
        NOA_CLAUDE_PROVIDER_MODELS: null,
        NOA_CLAUDE_PROVIDER_CONTEXT_WINDOWS: null,
      },
    })
  })

  test('clears a persisted model that belongs to the deactivated provider', () => {
    expect(
      runAnthropicSwitch({ settingsModel: 'MiniMax-M3' }).settingsModel,
    ).toBeNull()
  })
})
