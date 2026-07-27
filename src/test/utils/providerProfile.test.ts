import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import {
  buildProviderEnv,
  normalizeProviderProfileCredential,
  type ProviderProfile,
} from '../../utils/providerProfile.js'

function profile(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'provider-profile-test',
    name: 'Test Provider',
    type: 'kimi',
    baseUrl: 'https://api.kimi.com/coding/',
    model: 'kimi-test-model',
    ...overrides,
  }
}

describe('provider profile credentials', () => {
  test('maps Kimi apiKey to Anthropic auth token for Bearer auth', () => {
    const env = buildProviderEnv(
      profile({
        apiKey: 'sk-kimi-test-token',
      }),
    )

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-kimi-test-token')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('trims pasted credentials before persisting or applying env', () => {
    const normalized = normalizeProviderProfileCredential(
      profile({
        apiKey: '  sk-kimi-test-token  ',
      }),
    )
    const env = buildProviderEnv(normalized)

    expect(normalized.apiKey).toBe('sk-kimi-test-token')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-kimi-test-token')
  })

  test('rejects instruction text before it can become a Bearer token', () => {
    expect(() =>
      buildProviderEnv(
        profile({
          apiKey:
            '收到消息时必须先检查是否有相关 skill，哪怕最后没用到，也要先看一遍',
        }),
      ),
    ).toThrow('invalid API key')
  })

  test('rejects whitespace-bearing notes before they can become a header value', () => {
    expect(() =>
      normalizeProviderProfileCredential(
        profile({
          apiKey: 'sk-token do not skip skill checks',
        }),
      ),
    ).toThrow('invalid API key')
  })

  test('--bare preserves caller provider env instead of applying the active profile', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-bare-provider-profile-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({
            active: true,
            apiKey: 'profile-api-key',
          }),
        ]),
      )

      const script = `
        process.argv.push('--bare')
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        // spawnSync inherits the parent env; scrub the profile-applied key so
        // the assertion below tests the code, not the caller's shell.
        delete process.env.ANTHROPIC_AUTH_TOKEN
        process.env.ANTHROPIC_API_KEY = 'caller-api-key'
        process.env.ANTHROPIC_BASE_URL = 'https://caller.example.test'
        process.env.ANTHROPIC_MODEL = 'caller-model'

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        const applied = await applyActiveProviderProfileEnv()

        if (applied !== null) throw new Error('active profile was applied')
        if (process.env.ANTHROPIC_API_KEY !== 'caller-api-key') {
          throw new Error('caller API key was overwritten')
        }
        if (process.env.ANTHROPIC_BASE_URL !== 'https://caller.example.test') {
          throw new Error('caller base URL was overwritten')
        }
        if (process.env.ANTHROPIC_MODEL !== 'caller-model') {
          throw new Error('caller model was overwritten')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== undefined) {
          throw new Error('profile auth token leaked into bare mode')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      // Surface stderr as the failure message rather than asserting it is
      // empty: the subprocess signals failure by throwing, which is already a
      // non-zero status, so an empty-stderr assertion adds no signal and
      // breaks the moment bun writes an unrelated warning.
      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('applies the active provider profile env outside bare mode', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-profile-apply-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({
            active: true,
            apiKey: 'profile-api-key',
          }),
        ]),
      )

      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        // Seed stale routing env rather than scrubbing it. Scrubbing first
        // makes every "must not survive" assertion below pass even with
        // applyActiveProviderProfileEnv's delete loop removed — it cannot
        // tell "cleared by the loop" from "never set". A kimi profile writes
        // only the ANTHROPIC_* keys, so the bedrock/vertex/openai ones are
        // reachable exclusively through that loop.
        process.env.CLAUDE_CODE_USE_BEDROCK = '1'
        process.env.OPENAI_API_KEY = 'stale-openai-key'
        process.env.ANTHROPIC_VERTEX_PROJECT_ID = 'stale-project'
        process.env.ANTHROPIC_API_KEY = 'stale-x-api-key'
        process.env.ANTHROPIC_AUTH_TOKEN = 'stale-bearer-token'
        process.env.ANTHROPIC_BASE_URL = 'https://stale.example.test'
        process.env.ANTHROPIC_MODEL = 'stale-model'
        process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'stale-opus'

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        const applied = await applyActiveProviderProfileEnv()

        if (applied?.id !== 'provider-profile-test') {
          throw new Error('active profile was not applied')
        }
        // Kimi authenticates via Bearer token, never x-api-key: the stale key
        // must be deleted, since nothing overwrites it.
        if (process.env.ANTHROPIC_AUTH_TOKEN !== 'profile-api-key') {
          throw new Error('profile auth token not applied')
        }
        if (process.env.ANTHROPIC_API_KEY !== undefined) {
          throw new Error('stale API key survived for a Bearer-auth provider')
        }
        // Routing env for other backends must not outlive the switch.
        if (process.env.CLAUDE_CODE_USE_BEDROCK !== undefined) {
          throw new Error('stale CLAUDE_CODE_USE_BEDROCK survived the switch')
        }
        if (process.env.OPENAI_API_KEY !== undefined) {
          throw new Error('stale OPENAI_API_KEY survived the switch')
        }
        if (process.env.ANTHROPIC_VERTEX_PROJECT_ID !== undefined) {
          throw new Error('stale ANTHROPIC_VERTEX_PROJECT_ID survived the switch')
        }
        // getNormalizedBaseUrl strips trailing slashes.
        if (process.env.ANTHROPIC_BASE_URL !== 'https://api.kimi.com/coding') {
          throw new Error('profile base URL not applied')
        }
        if (process.env.ANTHROPIC_MODEL !== 'kimi-test-model') {
          throw new Error('profile model not applied')
        }
        if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL !== 'kimi-test-model') {
          throw new Error('stale default model env survived the switch')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      // Surface stderr as the failure message rather than asserting it is
      // empty: the subprocess signals failure by throwing, which is already a
      // non-zero status, so an empty-stderr assertion adds no signal and
      // breaks the moment bun writes an unrelated warning.
      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('selecting a profile deleted since mount activates nothing', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-profile-ghost-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({ id: 'kept', name: 'Kept', active: true, apiKey: 'kept-key' }),
          profile({
            id: 'ghost',
            name: 'Ghost',
            active: false,
            apiKey: 'ghost-key',
            baseUrl: 'https://ghost.example.test/',
          }),
        ]),
      )

      // This is the contract /provider's guard rests on. The picker's list is a
      // snapshot taken at mount, so a profile can be deleted before the user
      // hits enter. setActiveProviderProfile resolves to null instead of
      // throwing, and applyActiveProviderProfileEnv then applies whichever
      // profile is still active — the command used to report the selected one
      // as switched while the session ran on the other.
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        const { writeFileSync } = await import('fs')
        const {
          loadProviderProfiles,
          setActiveProviderProfile,
          applyActiveProviderProfileEnv,
        } = await import('./src/utils/providerProfile.ts')

        const snapshot = await loadProviderProfiles()
        writeFileSync(
          ${JSON.stringify(join(configDir, 'provider-profiles.json'))},
          JSON.stringify(snapshot.filter(p => p.id !== 'ghost')),
        )

        const activated = await setActiveProviderProfile('ghost')
        if (activated !== null) {
          throw new Error('expected null for a profile that is gone from disk')
        }

        const applied = await applyActiveProviderProfileEnv()
        if (applied?.id !== 'kept') {
          throw new Error('expected the still-active profile to be applied')
        }
        if (process.env.ANTHROPIC_BASE_URL !== 'https://api.kimi.com/coding') {
          throw new Error('env did not follow the still-active profile')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
